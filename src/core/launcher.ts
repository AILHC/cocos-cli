import { join, resolve } from 'path';
import { IBuildCommandOption, Platform } from './builder/@types/protected';
import utils from './base/utils';
import { newConsole } from './base/console';
import { startServer, getServerUrl } from '../server';
import { GlobalConfig } from '../global';
import scripting from './scripting';
import { startupScene } from './scene';
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { pathToFileURL } from 'url';
import { resolveProjectExtensionAssetDbMounts } from './assets/extension-asset-db-mounts';
import { resolveLauncherEngineRoot, type LauncherEngineRootResolution } from './launcher-engine-root';

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
        newConsole.init(join(this.projectPath, 'temp', 'logs'), true);
        newConsole.record();
    }

    private async resolveEngineRoot() {
        if (!this._engineRootResolution) {
            this._engineRootResolution = await resolveLauncherEngineRoot(this.projectPath);
            if (this._engineRootResolution.source === 'global-fallback') {
                console.warn(`[runtime-preview] engineRoot:global-fallback ${this._engineRootResolution.engineRoot}`);
            }
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
        await scripting.initialize(this.projectPath, (await this.resolveEngineRoot()).engineRoot, Engine.getConfig().includeModules);

        const { createProgrammingFacet } = await import('./scripting/programming/FacetInstance');
        await createProgrammingFacet(Engine.getInfo().typescript.path, scripting.projectPath, Engine.getConfig().includeModules);

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

    async startPreview(port?: number) {
        await this.import();
        await startServer(port);
        // 初始化构建
        const { init: initBuilder } = await import('./builder');
        await initBuilder();

        const { init: initScene } = await import('./scene');
        await initScene();

        // 注册调试用的中间件（仅 preview 模式）
        const { middlewareService } = await import('../server/middleware');
        const { default: PreviewDebugMiddleware } = await import('./scene/preview.debug.middleware');
        middlewareService.register('PreviewDebug', PreviewDebugMiddleware);

        const { Rpc } = await import('./scene/main-process/rpc');
        await Rpc.startup();

        const browserPath = process.platform === 'win32'
            ? 'start'
            : process.platform === 'darwin'
                ? 'open'
                : 'xdg-open';
        spawn(browserPath, [getServerUrl()], { stdio: 'ignore', detached: true });
    }

    async startRuntimePreview(options: {
        port?: number;
        host?: string;
        scene?: string;
        settingsTimeoutMs?: number;
        clearProgrammingCache?: boolean;
    } = {}) {
        const {
            getDefaultProjectProgrammingRoot,
            PreviewSettingsProvider,
            startRuntimePreviewServer,
        } = await import('../runtime-preview');
        const projectLibraryRoot = process.env.COCOS_CLI_TEST_EDITOR_LIBRARY_REF || join(this.projectPath, 'library', 'cli');
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
        let preparePreviewSettings: Promise<void> | null = null;
        const ensurePreviewSettingsReady = () => {
            if (!preparePreviewSettings) {
                preparePreviewSettings = (async () => {
                    const engineServerUrl = serverUrl.endsWith('/') ? serverUrl : `${serverUrl}/`;
                    await this.import({
                        serverURL: engineServerUrl,
                        diagnostics,
                        clearRuntimePreviewProgrammingCache: options.clearProgrammingCache === true,
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
                if (!serverUrl) {
                    throw new Error('Runtime preview settings requested before server URL was assigned.');
                }
                await ensurePreviewSettingsReady();
                const { getPreviewSettings } = await import('./builder');
                const startScene = typeof buildOptions?.startScene === 'string'
                    ? buildOptions.startScene
                    : options.scene;
                const settingsStageStartedAt = Date.now();
                emitRuntimePreviewEvent(`settings:build:start scene=${startScene ?? ''}`);
                try {
                    const result = await getPreviewSettings({
                        ...(buildOptions ?? {}),
                        server: serverUrl,
                        startScene,
                    } as never);
                    const scriptCount = Object.keys(result.script2library ?? {}).length;
                    const bundleCount = Array.isArray(result.bundleConfigs) ? result.bundleConfigs.length : 0;
                    emitRuntimePreviewEvent([
                        `settings:build:done durationMs=${Date.now() - settingsStageStartedAt}`,
                        `scene=${startScene ?? ''}`,
                        `scripts=${scriptCount}`,
                        `bundles=${bundleCount}`,
                    ].join(' '));
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

        const server = await startRuntimePreviewServer({
            projectRoot: this.projectPath,
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
            settingsProvider,
        });
        serverUrl = server.url;
        writeRuntimePreviewLog = (line) => {
            void server.logger.write(line).catch((error) => {
                console.warn(`[runtime-preview] log-write:error ${error instanceof Error ? error.message : String(error)}`);
            });
        };

        server.startupLogLines.forEach(writeRuntimePreviewConsoleLine);
        emitRuntimePreviewSummary({
            url: server.url,
            engineRoot,
            engineRootSource,
            libraryRoot: projectLibraryRoot,
            extensionLibraryRoots: extensionLibraryRoots.map((entry) => `${entry.name}:${entry.root}`).join(';'),
            programmingRoot: projectProgrammingRoot,
            internalLibraryRoot,
            logFilePath: server.logFilePath,
        });
        if (options.scene) {
            emitRuntimePreviewEvent(`scene=${options.scene}`);
        }
        emitRuntimePreviewEvent('preview:preparing');
        try {
            await settingsProvider.getPreviewSettings(options.scene ? { startScene: options.scene } : undefined);
            if (assetDbScriptCompileErrorLine) {
                emitRuntimePreviewEvent('asset-db:script-compile:report-only source=asset-db:script-compile:error');
            }
            if (!assetDbScriptCompileDoneLine) {
                emitRuntimePreviewEvent('asset-db:script-compile:missing');
            }
            try {
                await inspectRuntimePreviewProgrammingArtifacts({
                    projectRoot: this.projectPath,
                    engineRoot,
                    programmingRoot: projectProgrammingRoot,
                    emit: emitRuntimePreviewEvent,
                });
            } catch (error) {
                if (!assetDbScriptCompileErrorLine) {
                    throw error;
                }
                const message = error instanceof Error ? error.message : String(error);
                emitRuntimePreviewEvent(
                    `programming:inspection:report-only source=asset-db:script-compile:error error=${message}`,
                );
            }
            emitRuntimePreviewEvent(`preview:ready durationMs=${Date.now() - previewStartedAt}`);
        } catch (error) {
            diagnostics.stageError('preview', error);
            throw error;
        }

        return {
            ...server,
            close: async () => {
                try {
                    await server.close();
                } finally {
                    runtimePreviewGlobal.__cocosCliRuntimePreviewDiagnostics = previousRuntimePreviewDiagnostics;
                }
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

    async close() {
        // 关闭服务器
        const { stopServer } = await import('../server');
        await stopServer();

        // 关闭场景进程
        const { sceneWorker } = await import('./scene/main-process/scene-worker');
        await sceneWorker.stop();

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
