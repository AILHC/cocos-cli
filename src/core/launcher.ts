import { join, resolve } from 'path';
import { IBuildCommandOption, Platform } from './builder/@types/protected';
import utils from './base/utils';
import { newConsole } from './base/console';
import { startServer, getServerUrl } from '../server';
import { GlobalConfig, GlobalPaths } from '../global';
import scripting from './scripting';
import { startupScene } from './scene';
import { spawn } from 'child_process';

interface RuntimePreviewStageDiagnostics {
    stageStart: (stage: string) => void;
    stageDone: (stage: string) => void;
    stageError: (stage: string, error: unknown) => void;
}

/**
 * 启动器，主要用于整合各个模块的初始化和关闭流程
 * 默认支持几种启动方式：单独导入项目、单独启动项目、单独构建项目
 */
export default class Launcher {
    private projectPath: string;

    private _init = false;
    private _import = false;

    constructor(projectPath: string) {
        this.projectPath = projectPath;
        // 初始化日志系统
        newConsole.init(join(this.projectPath, 'temp', 'logs'), true);
        newConsole.record();
    }

    private getEngineRoot() {
        const testEngineRoot = process.env.COCOS_CLI_TEST_ENGINE_ROOT;
        const testProjectRoot = process.env.COCOS_CLI_TEST_PROJECT_ROOT;
        if (testEngineRoot && testProjectRoot && resolve(this.projectPath) === resolve(testProjectRoot)) {
            return testEngineRoot;
        }
        return GlobalPaths.enginePath;
    }

    private async init(options: { serverURL?: string; diagnostics?: RuntimePreviewStageDiagnostics } = {}) {
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
            await initEngine(this.getEngineRoot(), this.projectPath, options.serverURL);
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
    async import(options: { serverURL?: string; diagnostics?: RuntimePreviewStageDiagnostics } = {}) {
        if (this._import) {
            return;
        }
        this._import = true;
        await this.init({ serverURL: options.serverURL, diagnostics: options.diagnostics });
        // 在导入资源之前，初始化 scripting 模块，才能正常导入编译脚本
        const { Engine } = await import('./engine');
        await scripting.initialize(this.projectPath, this.getEngineRoot(), Engine.getConfig().includeModules);

        const { createProgrammingFacet } = await import('./scripting/programming/FacetInstance');
        await createProgrammingFacet(Engine.getInfo().typescript.path, scripting.projectPath, Engine.getConfig().includeModules);

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
        await startupScene(this.getEngineRoot(), this.projectPath);
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

    async startRuntimePreview(options: { port?: number; host?: string; scene?: string; settingsTimeoutMs?: number } = {}) {
        const {
            getDefaultProjectProgrammingRoot,
            PreviewSettingsProvider,
            startRuntimePreviewServer,
        } = await import('../runtime-preview');
        const projectLibraryRoot = process.env.COCOS_CLI_TEST_EDITOR_LIBRARY_REF || join(this.projectPath, 'library');
        const projectProgrammingRoot = process.env.COCOS_CLI_TEST_EDITOR_PROGRAMMING_REF
            ? join(process.env.COCOS_CLI_TEST_EDITOR_PROGRAMMING_REF, 'programming')
            : getDefaultProjectProgrammingRoot(this.projectPath);
        const cliProgrammingRoot = getDefaultProjectProgrammingRoot(this.projectPath);
        const engineRoot = this.getEngineRoot();
        let serverUrl = '';
        let writeRuntimePreviewLog: ((line: string) => void) | null = null;
        const emitRuntimePreviewEvent = (line: string) => {
            console.log(`[runtime-preview] ${line}`);
            writeRuntimePreviewLog?.(line);
        };
        const diagnostics: RuntimePreviewStageDiagnostics = {
            stageStart: (stage) => emitRuntimePreviewEvent(`${stage}:start`),
            stageDone: (stage) => emitRuntimePreviewEvent(`${stage}:done`),
            stageError: (stage, error) => {
                const message = error instanceof Error ? error.message : String(error);
                emitRuntimePreviewEvent(`${stage}:error ${message}`);
            },
        };
        let preparePreviewSettings: Promise<void> | null = null;
        const ensurePreviewSettingsReady = () => {
            if (!preparePreviewSettings) {
                preparePreviewSettings = (async () => {
                    const engineServerUrl = serverUrl.endsWith('/') ? serverUrl : `${serverUrl}/`;
                    await this.import({ serverURL: engineServerUrl, diagnostics });
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
                return getPreviewSettings({
                    ...(buildOptions ?? {}),
                    server: serverUrl,
                    startScene,
                } as never);
            },
        });

        const server = await startRuntimePreviewServer({
            projectRoot: this.projectPath,
            engineRoot,
            projectLibraryRoot,
            projectProgrammingRoot,
            cliProgrammingRoot,
            internalLibraryRoot: join(engineRoot, 'editor', 'library'),
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

        server.startupLogLines.forEach((line) => console.log(`[runtime-preview] ${line}`));
        emitRuntimePreviewEvent(`server:listening ${server.url}`);
        if (options.scene) {
            emitRuntimePreviewEvent(`scene=${options.scene}`);
        }
        emitRuntimePreviewEvent('preview:preparing');
        try {
            await settingsProvider.getPreviewSettings(options.scene ? { startScene: options.scene } : undefined);
            emitRuntimePreviewEvent('preview:ready');
        } catch (error) {
            diagnostics.stageError('preview', error);
            throw error;
        }

        return server;
    }

    /**
     * 构建，主要是作为命令行构建的入口
     * @param platform
     * @param options
     */
    async build(platform: Platform, options: Partial<IBuildCommandOption>) {
        GlobalConfig.mode = 'simple';
        // 先导入项目
        await this.import();
        // 执行构建流程
        const { init, build } = await import('./builder');
        await init(platform);
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
