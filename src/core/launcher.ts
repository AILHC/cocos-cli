import { isAbsolute, join, resolve } from 'path';
import { BuildExitCode, IBuildCommandOption, Platform } from './builder/@types/protected';
import utils from './base/utils';
import { newConsole } from './base/console';
import { startServer, getServerUrl } from '../server';
import { GlobalConfig } from '../global';
import scripting from './scripting';
import { startupScene } from './scene';
import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { pathToFileURL } from 'url';
import { resolveProjectExtensionAssetDbMounts } from './assets/extension-asset-db-mounts';
import { resolveLauncherEngineRoot, type LauncherEngineRootResolution } from './launcher-engine-root';
import { eventEmitter } from './scripting/event-emitter';
import {
    createScriptCompileDiagnostic,
    formatScriptCompileDiagnosticSummary,
    type ScriptCompileDiagnostic,
} from './scripting/compile-error-diagnostics';
import { assertPreviewOutputIntegritySeal } from './scripting/packer-driver/script-registration-integrity';
import type { RuntimeRefreshResult } from '../runtime-preview/refresh/runtime-refresh-coordinator';
import type { PreviewSessionOwnership } from './preview-session';
import { PREVIEW_SESSION_IDENTITY_PATH } from './preview-session/constants';

interface IPreviewStartOptions {
    port?: number;
    platform?: Platform | string;
    open?: boolean;
    buildOptions?: Partial<IBuildCommandOption>;
    // 可选 ownership 句柄(issues/19:--build 是 blocking-only owner,不是 editing
    // session):server ready 后挂 identity endpoint,build 完成开始 serve 后
    // publishReady(与 runtime preview 同一事务语义,失败有界重试后回滚);
    // 不挂 /mcp——cocos session 对该 session 报「不是 editing session」。
    ownership?: PreviewSessionOwnership;
}

interface RuntimePreviewStageDiagnostics {
    stageStart: (stage: string) => void;
    stageDone: (stage: string) => void;
    stageError: (stage: string, error: unknown) => void;
}

type EngineRuntimeMode = 'editor-nodejs' | 'build-nodejs';

type RuntimePreviewDiagnosticsGlobal = typeof globalThis & {
    __cocosCliRuntimePreviewDiagnostics?: {
        event: (line: string) => void;
    };
};

function writeRuntimePreviewConsoleLine(line: string) {
    const rawConsole = (console as typeof console & { __rawConsole?: typeof console }).__rawConsole;
    (rawConsole ?? console).log(`[runtime-preview] ${line}`);
}

// ready descriptor 发布重试参数(issues/F4):瞬态 IO 抖动给有限重试机会,
// 最终仍失败则由调用方进入启动回滚,绝不留「ready backend + starting descriptor」。
const PUBLISH_READY_MAX_ATTEMPTS = 3;
const PUBLISH_READY_RETRY_DELAY_MS = 100;

async function publishReadyWithRetry(ownership: PreviewSessionOwnership, serverUrl: string): Promise<void> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= PUBLISH_READY_MAX_ATTEMPTS; attempt += 1) {
        try {
            await ownership.publishReady(serverUrl);
            return;
        } catch (error) {
            lastError = error;
            console.warn(
                `[runtime-preview] preview-session:publish-ready attempt ${attempt}/${PUBLISH_READY_MAX_ATTEMPTS} failed:`,
                error,
            );
            if (attempt < PUBLISH_READY_MAX_ATTEMPTS) {
                await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, PUBLISH_READY_RETRY_DELAY_MS));
            }
        }
    }
    throw new Error(
        `Failed to publish the preview session ready descriptor after ${PUBLISH_READY_MAX_ATTEMPTS} attempts; ` +
        `rolling back startup. Cause: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
    );
}

function formatRuntimePreviewDiagnosticLocation(diagnostic: ScriptCompileDiagnostic): string {
    const location = diagnostic.location;
    const file = location.relativeFilePath ?? location.filePath ?? location.assetUrl ?? 'unknown';
    if (typeof location.line === 'number' && typeof location.column === 'number') {
        return `${file}:${location.line}:${location.column}`;
    }
    if (typeof location.line === 'number') {
        return `${file}:${location.line}`;
    }
    return file;
}

function formatPackBuildFailedLine(payload: {
    targetName?: string;
    error?: unknown;
    diagnostic?: ScriptCompileDiagnostic;
}): string {
    const targetName = payload.targetName ?? payload.diagnostic?.target ?? 'unknown';
    const diagnostic = payload.diagnostic;
    if (diagnostic) {
        return [
            `pack-target:build:failed target=${targetName}`,
            `file=${formatRuntimePreviewDiagnosticLocation(diagnostic)}`,
            `message=${diagnostic.message}`,
        ].join(' ');
    }
    const message = payload.error instanceof Error ? payload.error.message : String(payload.error ?? 'unknown error');
    return `pack-target:build:failed target=${targetName} message=${message}`;
}

function toStartupCompileDiagnostic(diagnostic: ScriptCompileDiagnostic): ScriptCompileDiagnostic {
    return {
        ...diagnostic,
        phase: 'startup',
        target: diagnostic.target ?? 'preview',
        outputState: 'noUsableOutput',
    };
}

function createStartupCompileFailureResult(diagnostic: ScriptCompileDiagnostic): RuntimeRefreshResult {
    const startupDiagnostic = toStartupCompileDiagnostic(diagnostic);
    const error = formatScriptCompileDiagnosticSummary(startupDiagnostic);
    return {
        ok: false,
        refreshId: 'runtime-startup-compile-error',
        target: 'db://assets',
        reason: 'reload',
        changedAssetCount: null,
        scriptCompile: {
            status: 'failed',
            durationMs: 0,
            error,
            diagnostic: startupDiagnostic,
        },
        outputState: 'noUsableOutput',
        compileError: startupDiagnostic,
        durationMs: 0,
        error,
    };
}

function stripAnsiControlCodes(text: string): string {
    return text.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '');
}

function createDiagnosticFromAssetDbScriptCompileErrorLine(
    line: string,
    options: { projectRoot: string },
): ScriptCompileDiagnostic | null {
    const cleanLine = stripAnsiControlCodes(line);
    const match = cleanLine.match(/Script compile failed:\s+(.+):(\d+):(\d+)\s+(.+)$/);
    if (!match) {
        return null;
    }
    const file = match[1];
    const lineNumber = Number(match[2]);
    const columnNumber = Number(match[3]);
    const message = match[4].trim();
    const location = isAbsolute(file)
        ? {
            filePath: file,
            relativeFilePath: file.startsWith(options.projectRoot)
                ? file.slice(options.projectRoot.length).replace(/^[\\/]+/, '')
                : undefined,
        }
        : {
            relativeFilePath: file,
        };

    return {
        phase: 'startup',
        target: 'preview',
        message,
        location: {
            ...location,
            line: lineNumber,
            column: columnNumber,
        },
        outputState: 'noUsableOutput',
    };
}

function createStartupCompileDiagnosticFromFailure(options: {
    assetDbScriptCompileErrorLine: string;
    projectRoot: string;
    failureDiagnostic?: ScriptCompileDiagnostic;
    fallbackError: unknown;
}): ScriptCompileDiagnostic {
    const parsedDiagnostic = createDiagnosticFromAssetDbScriptCompileErrorLine(
        options.assetDbScriptCompileErrorLine,
        { projectRoot: options.projectRoot },
    );
    if (parsedDiagnostic) {
        return {
            ...parsedDiagnostic,
            name: options.failureDiagnostic?.name,
            codeFrame: options.failureDiagnostic?.codeFrame,
            stackSummary: options.failureDiagnostic?.codeFrame
                ? options.failureDiagnostic.stackSummary
                : undefined,
            logFilePath: options.failureDiagnostic?.logFilePath,
        };
    }
    return options.failureDiagnostic
        ?? createScriptCompileDiagnostic(options.fallbackError, {
            phase: 'startup',
            outputState: 'noUsableOutput',
        });
}

function resolveRuntimePreviewInternalLibraryRoot(projectPath: string, engineRoot: string): string {
    const projectInternalLibraryRoot = join(projectPath, 'library');
    if (existsSync(projectInternalLibraryRoot)) {
        return projectInternalLibraryRoot;
    }
    return join(engineRoot, 'editor', 'library');
}

async function inspectRuntimePreviewProgrammingArtifacts(options: {
    projectRoot: string;
    engineRoot: string;
    programmingRoot: string;
    emit: (line: string) => void;
}): Promise<void> {
    const recordsRoot = join(options.programmingRoot, 'packer-driver', 'targets', 'preview');
    assertPreviewOutputIntegritySeal(recordsRoot);
    const [importMap, mainRecord] = await Promise.all([
        readJsonFile<{ imports?: Record<string, string>; scopes?: Record<string, Record<string, string>> }>(
            join(recordsRoot, 'import-map.json'),
        ),
        readJsonFile<{ modules?: Record<string, { chunkId?: string }> }>(
            join(recordsRoot, 'main-record.json'),
        ),
    ]);
    const modules = Object.keys(mainRecord.modules ?? {});
    const staleModules = modules.filter((moduleUrl) => isStaleRuntimePreviewModuleUrl(
        moduleUrl,
        options.projectRoot,
        options.engineRoot,
    ));
    if (staleModules.length > 0) {
        options.emit([
            'programming:stale-records:detected',
            `count=${staleModules.length}`,
            `sample=${staleModules.slice(0, 3).join(',')}`,
        ].join(' '));
    } else {
        options.emit(`programming:stale-records:clear modules=${modules.length}`);
    }

    const prerequisiteImport = importMap.imports?.['cce:/internal/x/prerequisite-imports'];
    const prerequisiteScope = prerequisiteImport ? importMap.scopes?.[prerequisiteImport] : undefined;
    if (!prerequisiteImport || !prerequisiteScope) {
        throw new Error('Runtime preview programming output is inconsistent: prerequisite import scope is missing.');
    }
    if (!prerequisiteImport.startsWith('./chunks/') || prerequisiteImport.split('/').includes('..')) {
        throw new Error(`Runtime preview programming output is inconsistent: invalid prerequisite chunk ${prerequisiteImport}.`);
    }

    const prerequisiteChunkPath = join(recordsRoot, ...prerequisiteImport.slice('./'.length).split('/'));
    const prerequisiteChunkSource = await readFile(prerequisiteChunkPath, 'utf8');
    const requiredSpecifiers = collectRuntimePreviewUnresolvedSpecifiers(prerequisiteChunkSource);
    const missingSpecifiers = requiredSpecifiers.filter((specifier) => !isRuntimePreviewChunkImport(prerequisiteScope[specifier]));
    options.emit([
        'programming:prerequisite-scope',
        `required=${requiredSpecifiers.length}`,
        `mapped=${Object.keys(prerequisiteScope).length}`,
        `missing=${missingSpecifiers.length}`,
    ].join(' '));
    if (missingSpecifiers.length > 0) {
        throw new Error(
            `Runtime preview programming output is inconsistent: prerequisite scope is missing ${missingSpecifiers[0]}.`,
        );
    }
}

async function readJsonFile<T>(filePath: string): Promise<T> {
    return JSON.parse(await readFile(filePath, 'utf8')) as T;
}

function isStaleRuntimePreviewModuleUrl(moduleUrl: string, projectRoot: string, engineRoot: string): boolean {
    if (!moduleUrl.startsWith('file:///')) {
        return false;
    }
    const normalizedUrl = moduleUrl.replace(/\\/g, '/');
    if (!normalizedUrl.includes('/assets/') && !normalizedUrl.includes('/extensions/')) {
        return false;
    }
    const projectRootUrl = pathToFileURL(resolve(projectRoot)).href.replace(/\/$/, '');
    const engineRootUrl = pathToFileURL(resolve(engineRoot)).href.replace(/\/$/, '');
    return !normalizedUrl.startsWith(`${projectRootUrl}/`) && !normalizedUrl.startsWith(`${engineRootUrl}/`);
}

function collectRuntimePreviewUnresolvedSpecifiers(source: string): string[] {
    const specifiers = new Set<string>();
    const pattern = /__unresolved_\d+/g;
    let match: RegExpExecArray | null = null;
    while ((match = pattern.exec(source))) {
        specifiers.add(match[0]);
    }

    return Array.from(specifiers)
        .sort((left, right) => Number(left.slice('__unresolved_'.length)) - Number(right.slice('__unresolved_'.length)));
}

function isRuntimePreviewChunkImport(value: unknown): value is string {
    return typeof value === 'string' && /^\.\/chunks\/[^/]+\/[^/]+\.js$/.test(value);
}

/**
 * 启动器，主要用于整合各个模块的初始化和关闭流程
 * 默认支持几种启动方式：单独导入项目、单独启动项目、单独构建项目
 */
export default class Launcher {
    private projectPath: string;

    private _init = false;
    private _import = false;
    private _engineRootResolution?: LauncherEngineRootResolution;

    constructor(projectPath: string) {
        this.projectPath = projectPath;
        // 初始化日志系统
        newConsole.init(join(this.projectPath, 'temp', 'logs', 'cocos.log'), true);
        newConsole.record();
    }

    private async resolveEngineRoot() {
        if (!this._engineRootResolution) {
            this._engineRootResolution = await resolveLauncherEngineRoot(this.projectPath);
        }
        return this._engineRootResolution;
    }

    private async init(options: {
        serverURL?: string;
        diagnostics?: RuntimePreviewStageDiagnostics;
        engineRuntimeMode?: EngineRuntimeMode;
    } = {}) {
        if (this._init) {
            return;
        }
        this._init = true;
        /**
         * 初始化一些基础模块信息
         */
        utils.Path.register('project', {
            label: '项目',
            path: this.projectPath,
        });
        const { configurationManager } = await import('./configuration');
        await configurationManager.initialize(this.projectPath);
        // 初始化项目信息
        const { default: Project } = await import('./project');
        await Project.open(this.projectPath);
        // 初始化引擎
        const { initEngine } = await import('./engine');
        options.diagnostics?.stageStart('engine:init');
        try {
            await initEngine(
                (await this.resolveEngineRoot()).engineRoot,
                this.projectPath,
                options.serverURL,
                options.engineRuntimeMode,
            );
            options.diagnostics?.stageDone('engine:init');
        } catch (error) {
            options.diagnostics?.stageError('engine:init', error);
            throw error;
        }
        console.log('initEngine success');
    }

    /**
     * 导入资源
     */
    async import(options: {
        serverURL?: string;
        diagnostics?: RuntimePreviewStageDiagnostics;
        clearRuntimePreviewProgrammingCache?: boolean;
        engineRuntimeMode?: EngineRuntimeMode;
        programmingRoot?: string;
    } = {}) {
        if (this._import) {
            return;
        }
        this._import = true;
        await this.init({
            serverURL: options.serverURL,
            diagnostics: options.diagnostics,
            engineRuntimeMode: options.engineRuntimeMode,
        });
        // 在导入资源之前，初始化 scripting 模块，才能正常导入编译脚本
        const { Engine } = await import('./engine');
        await scripting.initialize(this.projectPath, (await this.resolveEngineRoot()).engineRoot, Engine.getConfig().includeModules, {
            programmingRoot: options.programmingRoot,
        });

        const { createProgrammingFacet } = await import('./scripting/programming/FacetInstance');
        await createProgrammingFacet(Engine.getInfo().typescript.path, scripting.projectPath, Engine.getConfig().includeModules, {
            programmingRoot: options.programmingRoot,
        });

        if (options.clearRuntimePreviewProgrammingCache) {
            options.diagnostics?.stageStart('programming:cache-clear');
            try {
                await scripting.clearCacheWithoutRebuild();
                options.diagnostics?.stageDone('programming:cache-clear');
            } catch (error) {
                options.diagnostics?.stageError('programming:cache-clear', error);
                throw error;
            }
        }

        // 启动以及初始化资源数据库
        const { initAssetDB, startAssetDB } = await import('./assets');
        options.diagnostics?.stageStart('asset-db');
        try {
            await initAssetDB();
            await startAssetDB();
            options.diagnostics?.stageDone('asset-db');
        } catch (error) {
            options.diagnostics?.stageError('asset-db', error);
            throw error;
        }
    }

    /**
     * 启动项目
     */
    async startup(port?: number) {
        await this.import();
        await startServer(port);
        // 初始化构建
        const { init: initBuilder } = await import('./builder');
        await initBuilder();

        // 启动场景进程，需要在 Builder 之后，因为服务器路由场景还没有做前缀约束匹配范围比较广
        await startupScene((await this.resolveEngineRoot()).engineRoot, this.projectPath);
    }

    async startPreview(options: number | IPreviewStartOptions = {}) {
        const previewOptions: IPreviewStartOptions = typeof options === 'number' ? { port: options } : options;
        const platform = previewOptions.platform || previewOptions.buildOptions?.platform || 'web-desktop';
        if (!platform.startsWith('web')) {
            throw new Error(`Preview only supports web platforms, got: ${platform}`);
        }

        try {
            GlobalConfig.mode = 'simple';
            await this.import();
            await startServer(previewOptions.port);

            // blocking owner(issues/19):server ready 后立即挂只读 identity endpoint,
            // 让验活语义闭环(否则该 owner 会被误判 unreachable-owner-alive 遭回收)。
            // 不挂 /mcp:--build session 不是 editing session。
            if (previewOptions.ownership) {
                const { createPreviewSessionIdentityHandler } = await import(
                    '../runtime-preview/server/preview-session-identity'
                );
                const { serverService } = await import('../server/server');
                const claimDir = previewOptions.ownership.claimDir;
                serverService.router.get(PREVIEW_SESSION_IDENTITY_PATH, createPreviewSessionIdentityHandler({
                    claimDir,
                    resolveServerUrl: () => getServerUrl(),
                }));
            }

            const { init, build } = await import('./builder');
            await init(platform, this.projectPath);

            const buildOptions: Partial<IBuildCommandOption> = {
                ...previewOptions.buildOptions,
                platform,
                outputName: previewOptions.buildOptions?.outputName || 'preview',
                taskName: previewOptions.buildOptions?.taskName || 'preview',
            };
            if (buildOptions.debug === undefined) {
                buildOptions.debug = true;
            }

            const result = await build(platform as Platform, buildOptions);
            if (result.code !== BuildExitCode.BUILD_SUCCESS) {
                throw new Error(result.reason || 'Preview build failed.');
            }

            const previewUrl = result.custom?.previewUrl;
            if (!previewUrl) {
                throw new Error('Preview build completed but did not return a preview URL.');
            }

            // build 完成、server 已在 serve:发布 ready descriptor(server 根 URL)。
            // 与 runtime preview 同一事务语义(F4):失败有界重试后进入回滚,
            // 不留「ready backend + starting descriptor」。
            if (previewOptions.ownership) {
                await publishReadyWithRetry(previewOptions.ownership, getServerUrl());
            }

            console.log(`Preview URL: ${previewUrl}`);
            if (previewOptions.open !== false) {
                const { openUrlAsync } = await import('./builder/platforms/web-common/utils');
                await openUrlAsync(previewUrl);
            }

            return result;
        } catch (error) {
            // 启动失败回滚(issues/17/19):先 release claim;release 幂等,
            // 与 command 层 catch 的双调无害。
            await previewOptions.ownership?.release();
            throw error;
        }
    }

    /**
     * 启动动态游戏预览（只托管不构建，对齐编辑器浏览器预览）。
     * 与场景编辑器预览的区别：不启动场景进程 / RPC。
     */
    async startGamePreview(options: { port?: number; scene?: string; open?: boolean } = {}) {
        await this.import();
        await startServer(options.port);

        // getPreviewSettings 需要 builder 初始化
        const { init: initBuilder } = await import('./builder');
        await initBuilder();

        const { registerBrowserPreview } = await import('./preview/register');
        await registerBrowserPreview(this.projectPath);

        const serverUrl = getServerUrl();
        const url = options.scene ? `${serverUrl}/?scene=${encodeURIComponent(options.scene)}` : serverUrl;
        console.log(`Game preview: ${url}`);
        await this.printPreviewScenes(serverUrl, options.scene);
        if (options.open !== false) {
            const { openUrlAsync } = await import('./builder/platforms/web-common/utils');
            await openUrlAsync(url);
        }
    }

    /**
     * 打印当前启动场景与项目内可用场景列表，方便用 ?scene=<url|uuid> 切换。
     */
    private async printPreviewScenes(serverUrl: string, scene?: string) {
        try {
            const { assetManager } = await import('./assets');
            const { getCachedPreviewSettings } = await import('./preview/preview-settings');
            const { settings } = await getCachedPreviewSettings(scene || '');
            const launchUuid = (settings as any)?.launch?.launchScene || '';
            const launchInfo = launchUuid ? assetManager.queryAssetInfo(launchUuid) : null;
            console.log(`Launch scene: ${launchInfo?.url || launchUuid || '(none)'}`);

            const scenes = assetManager.queryAssetInfos({ ccType: 'cc.SceneAsset' });
            if (scenes && scenes.length) {
                console.log('Available scenes (switch via ?scene=<url-or-uuid>):');
                for (const s of scenes) {
                    console.log(`  ${serverUrl}/?scene=${encodeURIComponent(s.url)}`);
                }
            } else {
                console.log('No scene asset found in project.');
            }
        } catch (err) {
            console.warn('[Preview] Failed to list scenes:', err);
        }
    }

    async startSceneEditorPreview(options: number | { port?: number; open?: boolean } = {}) {
        const opts = typeof options === 'number' ? { port: options } : options;
        return this.startRuntimePreview({
            port: opts.port,
            open: opts.open ?? true,
            openPage: 'scene-editor',
        });
    }

    async startRuntimePreview(options: {
        port?: number;
        host?: string;
        scene?: string;
        open?: boolean;
        openPage?: 'runtime' | 'scene-editor';
        settingsTimeoutMs?: number;
        scriptLoadConcurrency?: number;
        clearProgrammingCache?: boolean;
        refreshOnReload?: boolean;
        watchAssets?: boolean;
        // 可选 ownership 句柄(T3 在 command 层 acquire 后传入);undefined = 无 ownership,
        // 保持现有行为。全部能力 ready 后 publishReady,close 开始 markDraining + release,
        // 启动失败回滚先 release 再清理已初始化资源。
        ownership?: PreviewSessionOwnership;
    } = {}) {
        const {
            getDefaultProjectProgrammingRoot,
            PreviewSettingsProvider,
            startRuntimePreviewSession,
        } = await import('../runtime-preview');
        const { createRuntimeAssetStartupSnapshot } = await import(
            '../runtime-preview/watch/runtime-asset-change-watcher'
        );
        const useSharedProjectLibrary = process.env.COCOS_CLI_SHARED_LIBRARY_OUTPUT !== '0';
        const projectLibraryRoot = process.env.COCOS_CLI_TEST_EDITOR_LIBRARY_REF
            || (useSharedProjectLibrary
                ? join(this.projectPath, 'library')
                : join(this.projectPath, 'library', 'cli'));
        const extensionLibraryRoots = resolveProjectExtensionAssetDbMounts(this.projectPath).map((mount) => ({
            name: mount.name,
            root: mount.library,
        }));
        const projectProgrammingRoot = process.env.COCOS_CLI_TEST_EDITOR_PROGRAMMING_REF
            ? join(process.env.COCOS_CLI_TEST_EDITOR_PROGRAMMING_REF, 'programming')
            : getDefaultProjectProgrammingRoot(this.projectPath);
        const cliProgrammingRoot = getDefaultProjectProgrammingRoot(this.projectPath);
        const engineRootResolution = await this.resolveEngineRoot();
        const engineRoot = engineRootResolution.engineRoot;
        const engineRootSource = engineRootResolution.source;
        const internalLibraryRoot = resolveRuntimePreviewInternalLibraryRoot(this.projectPath, engineRoot);
        let serverUrl = '';
        let preparedServerUrl = '';
        let writeRuntimePreviewLog: ((line: string) => void) | null = null;
        const previewStartedAt = Date.now();
        const stageStartedAt = new Map<string, number>();
        const runtimePreviewGlobal = globalThis as RuntimePreviewDiagnosticsGlobal;
        const previousRuntimePreviewDiagnostics = runtimePreviewGlobal.__cocosCliRuntimePreviewDiagnostics;
        let assetDbScriptCompileErrorLine = '';
        let assetDbScriptCompileDoneLine = '';
        const emitRuntimePreviewEvent = (line: string) => {
            if (line.startsWith('asset-db:script-compile:error')) {
                assetDbScriptCompileErrorLine = line;
            } else if (line.startsWith('asset-db:script-compile:done')) {
                assetDbScriptCompileDoneLine = line;
            }
            writeRuntimePreviewConsoleLine(line);
            writeRuntimePreviewLog?.(line);
        };
        runtimePreviewGlobal.__cocosCliRuntimePreviewDiagnostics = {
            event: emitRuntimePreviewEvent,
        };
        const diagnostics: RuntimePreviewStageDiagnostics = {
            stageStart: (stage) => {
                stageStartedAt.set(stage, Date.now());
                emitRuntimePreviewEvent(`${stage}:start`);
            },
            stageDone: (stage) => {
                const startedAt = stageStartedAt.get(stage);
                const durationPart = typeof startedAt === 'number'
                    ? ` durationMs=${Date.now() - startedAt}`
                    : '';
                stageStartedAt.delete(stage);
                emitRuntimePreviewEvent(`${stage}:done${durationPart}`);
            },
            stageError: (stage, error) => {
                const message = error instanceof Error ? error.message : String(error);
                const startedAt = stageStartedAt.get(stage);
                const durationPart = typeof startedAt === 'number'
                    ? ` durationMs=${Date.now() - startedAt}`
                    : '';
                stageStartedAt.delete(stage);
                emitRuntimePreviewEvent(`${stage}:error${durationPart} ${message}`);
            },
        };
        const readinessState = {
            settingsReady: false,
            assetWatcherReady: options.watchAssets !== true,
            artifactsInspected: false,
        };
        let startupCompileFailureResult: RuntimeRefreshResult | null = null;
        const readiness = {
            isReady: () => readinessState.settingsReady
                && readinessState.assetWatcherReady
                && readinessState.artifactsInspected,
            describe: () => ({ ...readinessState }),
        };
        let preparePreviewSettings: Promise<void> | null = null;
        const ensurePreviewSettingsReady = (runtimeServerUrl: string) => {
            if (!runtimeServerUrl) {
                throw new Error('Runtime preview settings requested before server URL was assigned.');
            }
            if (preparedServerUrl && preparedServerUrl !== runtimeServerUrl) {
                throw new Error(`Runtime preview was prepared for ${preparedServerUrl}, not ${runtimeServerUrl}`);
            }
            if (!preparedServerUrl) {
                preparedServerUrl = runtimeServerUrl;
            }
            if (!preparePreviewSettings) {
                preparePreviewSettings = (async () => {
                    const activeServerUrl = preparedServerUrl;
                    if (!activeServerUrl) {
                        throw new Error('Runtime preview settings requested before server URL was assigned.');
                    }
                    const engineServerUrl = activeServerUrl.endsWith('/') ? activeServerUrl : `${activeServerUrl}/`;
                    await this.import({
                        serverURL: engineServerUrl,
                        diagnostics,
                        clearRuntimePreviewProgrammingCache: options.clearProgrammingCache === true,
                        programmingRoot: projectProgrammingRoot,
                    });
                    const { init: initBuilder } = await import('./builder');
                    diagnostics.stageStart('builder:init');
                    try {
                        await initBuilder();
                        diagnostics.stageDone('builder:init');
                    } catch (error) {
                        diagnostics.stageError('builder:init', error);
                        throw error;
                    }
                })();
            }
            return preparePreviewSettings;
        };
        const settingsProvider = new PreviewSettingsProvider({
            timeoutMs: options.settingsTimeoutMs,
            loadPreviewSettings: async (buildOptions) => {
                const activeServerUrl = serverUrl || preparedServerUrl;
                if (!activeServerUrl) {
                    throw new Error('Runtime preview settings requested before server URL was assigned.');
                }
                await ensurePreviewSettingsReady(activeServerUrl);
                const { getPreviewSettings } = await import('./builder');
                const startScene = typeof buildOptions?.startScene === 'string'
                    ? buildOptions.startScene
                    : options.scene;
                const settingsStageStartedAt = Date.now();
                emitRuntimePreviewEvent(`settings:build:start scene=${startScene ?? ''}`);
                try {
                    const result = await getPreviewSettings({
                        ...(buildOptions ?? {}),
                        server: activeServerUrl,
                        startScene,
                        featureFilteredEngine: true,
                    } as never);
                    const scriptCount = Object.keys(result.script2library ?? {}).length;
                    const bundleCount = Array.isArray(result.bundleConfigs) ? result.bundleConfigs.length : 0;
                    emitRuntimePreviewEvent([
                        `settings:build:done durationMs=${Date.now() - settingsStageStartedAt}`,
                        `scene=${startScene ?? ''}`,
                        `scripts=${scriptCount}`,
                        `bundles=${bundleCount}`,
                    ].join(' '));
                    readinessState.settingsReady = true;
                    return result;
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    emitRuntimePreviewEvent(`settings:build:error durationMs=${Date.now() - settingsStageStartedAt} scene=${startScene ?? ''} ${message}`);
                    throw error;
                }
            },
        });
        const emitRuntimePreviewSummary = (summary: Record<string, string>) => {
            emitRuntimePreviewEvent('active-output:');
            for (const [key, value] of Object.entries(summary)) {
                emitRuntimePreviewEvent(`  ${key}: ${value}`);
            }
        };
        const assetWatcherStartupSnapshot = options.watchAssets === true
            ? await createRuntimeAssetStartupSnapshot(join(this.projectPath, 'assets'))
            : undefined;
        const { assetManager } = await import('./assets');

        const session = await startRuntimePreviewSession({
            projectRoot: this.projectPath,
            ownership: options.ownership,
            // identity endpoint 的数据源:有 ownership 时挂载,无 ownership 不挂载。
            previewSessionClaimDir: options.ownership?.claimDir,
            engineRoot,
            engineRootSource,
            projectLibraryRoot,
            extensionLibraryRoots,
            projectProgrammingRoot,
            cliProgrammingRoot,
            internalLibraryRoot,
            host: options.host,
            port: options.port,
            scene: options.scene,
            scriptLoadConcurrency: options.scriptLoadConcurrency,
            refreshOnReload: options.refreshOnReload === true,
            watchAssets: options.watchAssets === true,
            deferAssetWatcherStart: options.watchAssets === true,
            assetWatcherStartupSnapshot,
            assetSaveSource: assetManager,
            prepareRuntimePreview: ensurePreviewSettingsReady,
            verifyProgrammingOutput: () => inspectRuntimePreviewProgrammingArtifacts({
                projectRoot: this.projectPath,
                engineRoot,
                programmingRoot: projectProgrammingRoot,
                emit: emitRuntimePreviewEvent,
            }),
            settingsProvider,
            startupCompileFailure: () => startupCompileFailureResult,
            clearStartupCompileFailure: () => {
                startupCompileFailureResult = null;
            },
            readiness,
        });
        serverUrl = session.url;
        let projectContextCleanupRegistered = false;
        const closeProjectContext = async () => {
            const errors: unknown[] = [];
            const cleanupSteps = [
                async () => {
                    const { stopAssetDB } = await import('./assets');
                    await stopAssetDB();
                    assetManager.destroyed();
                },
                async () => scripting.close(),
                async () => {
                    const { default: Project } = await import('./project');
                    await Project.close();
                },
            ];
            for (const cleanup of cleanupSteps) {
                try {
                    await cleanup();
                } catch (error) {
                    errors.push(error);
                }
            }
            if (errors.length === 1) {
                throw errors[0];
            }
            if (errors.length > 1) {
                throw new AggregateError(errors, 'Runtime Preview project context cleanup failed.');
            }
        };
        const sceneEditorUrl = `${session.url}/scene-editor/`;
        writeRuntimePreviewLog = (line) => {
            void session.logger.write(line).catch((error) => {
                console.warn(`[runtime-preview] log-write:error ${error instanceof Error ? error.message : String(error)}`);
            });
        };

        session.startupLogLines.forEach(writeRuntimePreviewConsoleLine);
        emitRuntimePreviewSummary({
            url: session.url,
            engineRoot,
            engineRootSource,
            libraryRoot: projectLibraryRoot,
            extensionLibraryRoots: extensionLibraryRoots.map((entry) => `${entry.name}:${entry.root}`).join(';'),
            programmingRoot: projectProgrammingRoot,
            internalLibraryRoot,
            logFilePath: session.logFilePath,
        });
        if (options.scene) {
            emitRuntimePreviewEvent(`scene=${options.scene}`);
        }
        emitRuntimePreviewEvent('preview:preparing');
        const packBuildStartedAt = new Map<string, number>();
        const onPackBuildStart = (targetName: string) => {
            packBuildStartedAt.set(targetName, Date.now());
            emitRuntimePreviewEvent(`pack-target:build:start target=${targetName}`);
        };
        const onPackBuildEnd = (targetName: string) => {
            const startedAt = packBuildStartedAt.get(targetName);
            const durationPart = typeof startedAt === 'number'
                ? ` durationMs=${Date.now() - startedAt}`
                : '';
            packBuildStartedAt.delete(targetName);
            emitRuntimePreviewEvent(`pack-target:build:done target=${targetName}${durationPart}`);
        };
        const onPackBuildFailed = (payload: {
            targetName?: string;
            error?: unknown;
            diagnostic?: ScriptCompileDiagnostic;
        }) => {
            if (payload.targetName) {
                packBuildStartedAt.delete(payload.targetName);
            }
            emitRuntimePreviewEvent(formatPackBuildFailedLine(payload));
        };
        eventEmitter.on('pack-build-start', onPackBuildStart);
        eventEmitter.on('pack-build-end', onPackBuildEnd);
        eventEmitter.on('pack-build-failed', onPackBuildFailed);
        const cleanupPackBuildListeners = () => {
            eventEmitter.off('pack-build-start', onPackBuildStart);
            eventEmitter.off('pack-build-end', onPackBuildEnd);
            eventEmitter.off('pack-build-failed', onPackBuildFailed);
        };
        let sceneWorkerHandle: Awaited<ReturnType<typeof startupScene>> | null = null;
        let mcpHandle: Awaited<ReturnType<typeof import('../mcp/mount-mcp').mountMcp>> | null = null;
        try {
            await settingsProvider.getPreviewSettings(options.scene ? { startScene: options.scene } : undefined);
            session.registerCleanup('project', closeProjectContext);
            projectContextCleanupRegistered = true;
            if (assetDbScriptCompileErrorLine) {
                emitRuntimePreviewEvent('asset-db:script-compile:report-only source=asset-db:script-compile:error');
            }
            if (!assetDbScriptCompileDoneLine) {
                emitRuntimePreviewEvent('asset-db:script-compile:missing');
            }
            await session.startAssetWatcher();
            readinessState.assetWatcherReady = true;
            try {
                await inspectRuntimePreviewProgrammingArtifacts({
                    projectRoot: this.projectPath,
                    engineRoot,
                    programmingRoot: projectProgrammingRoot,
                    emit: emitRuntimePreviewEvent,
                });
                readinessState.artifactsInspected = true;
            } catch (error) {
                if (!assetDbScriptCompileErrorLine) {
                    throw error;
                }
                const message = error instanceof Error ? error.message : String(error);
                emitRuntimePreviewEvent(
                    `programming:inspection:report-only source=asset-db:script-compile:error error=${message}`,
                );
                const failure = scripting.getLastCompileFailure();
                startupCompileFailureResult = createStartupCompileFailureResult(
                    createStartupCompileDiagnosticFromFailure({
                        assetDbScriptCompileErrorLine,
                        projectRoot: this.projectPath,
                        failureDiagnostic: failure?.diagnostic,
                        fallbackError: error,
                    }),
                );
                readinessState.artifactsInspected = true;
            }
            if (!readiness.isReady()) {
                throw new Error('Runtime preview readiness state did not reach ready before preview:ready.');
            }
            sceneWorkerHandle = await startupScene(engineRoot, this.projectPath);
            session.registerCleanup('scene', async () => {
                await sceneWorkerHandle!.stop();
            });
            const [{ mountMcp }, { serverService }] = await Promise.all([
                import('../mcp/mount-mcp'),
                import('../server/server'),
            ]);
            mcpHandle = await mountMcp({
                router: serverService.router,
                serverUrl: session.url,
                projectPath: this.projectPath,
            });
            session.registerCleanup('runtime', () => mcpHandle!.close());
            const { middlewareService } = await import('../server/middleware');
            const { default: PreviewDebugMiddleware } = await import('./scene/preview.debug.middleware');
            middlewareService.register('PreviewDebug', PreviewDebugMiddleware);
            emitRuntimePreviewEvent(`scene-editor:url ${sceneEditorUrl}`);
            emitRuntimePreviewEvent(`mcp:url ${mcpHandle.url}`);
            emitRuntimePreviewEvent(`preview:ready durationMs=${Date.now() - previewStartedAt}`);
            // 全部能力 ready 后发布 ready 态 descriptor(补 serverUrl)。发布是启动事务的
            // 必要步骤(issues/F4):有界重试后仍失败则抛错,走下方 catch 回滚(先 release
            // claim 再 close session),不留「ready backend + starting descriptor」。
            if (options.ownership) {
                await publishReadyWithRetry(options.ownership, session.url);
            }
            if (options.open === true) {
                const { openUrlAsync } = await import('./builder/platforms/web-common/utils');
                await openUrlAsync(options.openPage === 'scene-editor' ? sceneEditorUrl : session.url);
            }
        } catch (error) {
            // 启动失败回滚(issues/17):先释放 claim,再清理已初始化资源。
            await options.ownership?.release();
            cleanupPackBuildListeners();
            diagnostics.stageError('preview', error);
            runtimePreviewGlobal.__cocosCliRuntimePreviewDiagnostics = previousRuntimePreviewDiagnostics;
            const cleanupErrors: unknown[] = [];
            if (!projectContextCleanupRegistered) {
                session.registerCleanup('project', closeProjectContext);
                projectContextCleanupRegistered = true;
            }
            try {
                await session.close();
            } catch (cleanupError) {
                cleanupErrors.push(cleanupError);
            }
            if (cleanupErrors.length) {
                throw new AggregateError([error, ...cleanupErrors], 'Runtime Preview startup and rollback failed.');
            }
            throw error;
        }

        const mountedMcp = mcpHandle;
        let closePromise: Promise<void> | null = null;
        return {
            ...session,
            sceneEditorUrl,
            mcpUrl: mountedMcp.url,
            close: () => {
                if (!closePromise) {
                    closePromise = session.close().finally(() => {
                        cleanupPackBuildListeners();
                        runtimePreviewGlobal.__cocosCliRuntimePreviewDiagnostics = previousRuntimePreviewDiagnostics;
                    });
                }
                return closePromise;
            },
        };
    }

    /**
     * 构建，主要是作为命令行构建的入口
     * @param platform
     * @param options
     */
    async build(platform: Platform, options: Partial<IBuildCommandOption>) {
        GlobalConfig.mode = 'simple';
        // 先导入项目
        await this.import({
            engineRuntimeMode: 'build-nodejs',
        });
        // 执行构建流程
        const { init, build } = await import('./builder');
        await init(platform, this.projectPath);
        return await build(platform, options);
    }

    static async make(platform: Platform, dest: string) {
        GlobalConfig.mode = 'simple';
        const { init, executeBuildStageTask } = await import('./builder');
        await init(platform);
        return await executeBuildStageTask('command make', 'make', {
            platform,
            dest,
        });
    }

    static async run(platform: Platform, dest: string) {
        GlobalConfig.mode = 'simple';
        const { init, executeBuildStageTask } = await import('./builder');
        if (platform.startsWith('web')) {
            await startServer();
        }
        await init(platform);
        return await executeBuildStageTask('command run', 'run', {
            platform,
            dest,
        });
    }

    static async upload(platform: Platform, dest: string, accessToken?: string) {
        GlobalConfig.mode = 'simple';
        const { init, executeBuildStageTask } = await import('./builder');
        await init(platform);
        return await executeBuildStageTask('command upload', 'upload', {
            platform,
            dest,
            packages: accessToken ? {
                [platform]: {
                    accessToken,
                },
            } : undefined,
        });
    }

    async close() {
        // 释放浏览器预览资源（扩展预览后端 + 热重载监听），对齐 Creator 生命周期
        try {
            const { disposeBrowserPreview } = await import('./preview/register');
            await disposeBrowserPreview();
        } catch (err) {
            console.warn('[Preview] dispose failed:', err);
        }

        // 先关闭 attached RPC 与场景进程，再释放它依赖的共享 server。
        const { sceneWorker } = await import('./scene/main-process/scene-worker');
        await sceneWorker.stop();

        // 关闭服务器
        const { stopServer } = await import('../server');
        await stopServer();

        // 关闭资源数据库
        const { stopAssetDB } = await import('./assets');
        await stopAssetDB();

        // 关闭脚本管理器
        const { default: scripting } = await import('./scripting');
        await scripting.close();

        // 保存项目配置
        const { default: Project } = await import('./project');
        await Project.close();
        // ----- TODO 可能有的更多其他模块的保存销毁操作 ----
    }
}
