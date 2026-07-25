import chalk from 'chalk';
import { resolve } from 'path';
import { BaseCommand } from './base';
import { existsSync, readJSONSync } from 'fs-extra';
import { installRuntimePreviewSessionSignalHandlers } from '../runtime-preview/session/session-signals';
import { acquirePreviewSessionOwnership, type PreviewSessionOwnership } from '../core/preview-session';
import { collectIgnoredPreviewParams, reportExistingPreviewSession } from './preview-existing-session';

// --build-config 读取结果;失败形态带面向用户的 message。
type BuildConfigReadResult =
    | { ok: true; buildOptions: Record<string, any> }
    | { ok: false; message: string };

// 路径 canonicalization + 存在性 + JSON parse(issues/F13:在 acquire 之前调用)。
function readBuildConfigFile(buildConfig: string): BuildConfigReadResult {
    const buildConfigPath = resolve(buildConfig);
    if (!existsSync(buildConfigPath)) {
        return { ok: false, message: `Build config does not exist: ${buildConfigPath}` };
    }
    try {
        return { ok: true, buildOptions: readJSONSync(buildConfigPath) };
    } catch (error) {
        return {
            ok: false,
            message: `Build config is not valid JSON: ${buildConfigPath} ` +
                `(${error instanceof Error ? error.message : String(error)})`,
        };
    }
}


/**
 * Preview 命令类
 */
export class PreviewCommand extends BaseCommand {
    register(): void {
        this.program
            .command('preview')
            .description('Preview a Cocos project')
            .option('-j, --project <path>', 'Path to the Cocos project')
            .option('-p, --port <number>', 'Port number for the preview server', '9527')
            .option('--host <host>', 'Host for the runtime preview server')
            .option('--runtime', 'Use the runtime preview initial page (compatibility option)')
            .option('-s, --scene <sceneUrlOrUuid>', 'Start scene (uuid or db:// url)')
            .option('--settings-timeout-ms <number>', 'Runtime preview settings generation timeout in milliseconds')
            .option('--script-load-concurrency <number>', 'Runtime preview project script load concurrency')
            .option('--clear-programming-cache', 'Clear runtime preview programming cache before startup script sync')
            .option('--refresh-on-reload', 'Refresh AssetDB before serving the runtime preview root page')
            .option('--watch-assets', 'Watch project assets and refresh only changed files during runtime preview refresh')
            .option('-P, --platform <platform>', 'Target web platform (web-desktop or web-mobile)')
            .option('-c, --build-config <path>', 'Specify build config file path')
            .option('--no-open', 'Do not open the preview URL in browser')
            .option('--build', 'Use the legacy build-based preview (full build then serve) instead of the dynamic serve preview')
            .option('--scene-editor', 'Open the shared Runtime Preview session at the scene editor page')
            .action(async (options: any) => {
                let ownership: PreviewSessionOwnership | undefined;
                try {
                    const projectPath = options.project ?? this.readLocalConfigProject();
                    if (!projectPath) {
                        console.error(chalk.red('Error: --project is required. Provide it via CLI or config.local.json'));
                        process.exit(1);
                    }
                    const resolvedPath = this.validateProjectPath(projectPath);
                    const port = parseInt(options.port, 10);
                    const selectedModes = [
                        options.runtime === true ? 'runtime' : undefined,
                        options.build === true ? 'build' : undefined,
                        options.sceneEditor === true ? 'scene-editor' : undefined,
                    ].filter(Boolean);
                    if (selectedModes.length > 1) {
                        throw new Error(`Preview modes are mutually exclusive: ${selectedModes.join(', ')}`);
                    }
                    const mode = selectedModes[0] ?? 'runtime';
                    const runtimeOnlyOptions = [
                        options.host !== undefined ? '--host' : undefined,
                        options.settingsTimeoutMs !== undefined ? '--settings-timeout-ms' : undefined,
                        options.scriptLoadConcurrency !== undefined ? '--script-load-concurrency' : undefined,
                        options.clearProgrammingCache === true ? '--clear-programming-cache' : undefined,
                        options.refreshOnReload === true ? '--refresh-on-reload' : undefined,
                        options.watchAssets === true ? '--watch-assets' : undefined,
                    ].filter(Boolean);
                    if (mode === 'build' && runtimeOnlyOptions.length) {
                        throw new Error(`${runtimeOnlyOptions.join(', ')} cannot be used with --build`);
                    }
                    const buildOnlyOptions = [
                        options.platform !== undefined ? '--platform' : undefined,
                        options.buildConfig !== undefined ? '--build-config' : undefined,
                    ].filter(Boolean);
                    if (mode !== 'build' && buildOnlyOptions.length) {
                        throw new Error(`${buildOnlyOptions.join(', ')} can only be used with --build`);
                    }
                    if (mode === 'build' && options.scene !== undefined) {
                        throw new Error('--scene is not valid with --build');
                    }
                    const settingsTimeoutMs = options.settingsTimeoutMs === undefined
                        ? undefined
                        : parseInt(options.settingsTimeoutMs, 10);
                    const scriptLoadConcurrency = options.scriptLoadConcurrency === undefined
                        ? undefined
                        : parseInt(options.scriptLoadConcurrency, 10);

                    // 验证端口号
                    if (isNaN(port) || port < 1 || port > 65535) {
                        console.error(chalk.red('Error: Invalid port number. Port must be between 1 and 65535.'));
                        process.exit(1);
                    }
                    if (settingsTimeoutMs !== undefined && (isNaN(settingsTimeoutMs) || settingsTimeoutMs < 1)) {
                        console.error(chalk.red('Error: Invalid settings timeout. Timeout must be a positive number.'));
                        process.exit(1);
                    }
                    if (
                        scriptLoadConcurrency !== undefined
                        && (isNaN(scriptLoadConcurrency) || scriptLoadConcurrency < 1)
                    ) {
                        console.error(chalk.red('Error: Invalid script load concurrency. Concurrency must be a positive number.'));
                        process.exit(1);
                    }

                    // --build-config 校验(路径 canonicalization + 存在性 + JSON parse)
                    // 必须在 acquire/new Launcher 之前(issues/F13):acquire 与 Launcher
                    // 构造都会写 <project>/temp,usage 错误不得先产生项目写入。
                    let buildOptions: Record<string, any> = {};
                    if (mode === 'build' && options.buildConfig) {
                        const parsedBuildConfig = readBuildConfigFile(options.buildConfig);
                        if (!parsedBuildConfig.ok) {
                            console.error(chalk.red(`Error: ${parsedBuildConfig.message}`));
                            return process.exit(1);
                        }
                        buildOptions = parsedBuildConfig.buildOptions;
                    }

                    // Ownership acquire 接缝(spec issues/18):参数验证/canonicalization 之后、
                    // new Launcher 之前(Launcher 构造函数会写 <project>/temp/logs,ownership
                    // 必须早于任何项目写入);stale 回收与 draining 等待由 acquire 内部处理。
                    const acquireResult = await acquirePreviewSessionOwnership({ projectRoot: resolvedPath });
                    if (!acquireResult.acquired) {
                        // live loser 在本层处理完即退出,绝不进入 stdin.resume() 保活路径
                        // (spec issues/06/17:ready 报 URL 开页 exit 0;starting/incompatible/conflict 非零)。
                        const outcome = await reportExistingPreviewSession(acquireResult, {
                            open: options.open === true,
                            openPage: mode === 'scene-editor' ? 'scene-editor' : 'runtime',
                            ignoredParams: collectIgnoredPreviewParams(options, mode),
                            openUrl: async (url) => {
                                const { openUrlAsync } = await import('../core/builder/platforms/web-common/utils');
                                await openUrlAsync(url);
                            },
                        });
                        return process.exit(outcome === 'reused' ? 0 : 1);
                    }
                    ownership = acquireResult.ownership;
                    // starting 窗口保护(issues/17/18):acquire 成功后立即安装 signal handler,
                    // SIGINT/SIGTERM 时先 release ownership 再退出。runtime session 就绪后
                    // installRuntimePreviewSessionSignalHandlers 内部去重替换本 handler
                    // (同一 lifecycle owner);--build 无 session handler,沿用本 handler
                    // 保证信号时 release。
                    installRuntimePreviewSessionSignalHandlers({
                        close: async () => {
                            await ownership?.release();
                        },
                    });

                    const { default: Launcher } = await import('../core/launcher');
                    const launcher = new Launcher(resolvedPath);
                    if (mode !== 'build') {
                        const session = await launcher.startRuntimePreview({
                            ownership,
                            port,
                            host: options.host,
                            scene: options.scene,
                            open: options.open,
                            openPage: mode === 'scene-editor' ? 'scene-editor' : 'runtime',
                            settingsTimeoutMs,
                            scriptLoadConcurrency,
                            clearProgrammingCache: options.clearProgrammingCache === true,
                            refreshOnReload: options.refreshOnReload === true,
                            watchAssets: options.watchAssets === true,
                        });
                        installRuntimePreviewSessionSignalHandlers(session);
                    } else if (mode === 'build') {
                        // --build 是 blocking-only owner(issues/19):ownership 传入
                        // startPreview,由其挂 identity endpoint 并在 server ready 后
                        // publishReady;build config 已在 acquire 前完成校验与解析。
                        const platform = options.platform || buildOptions.platform || 'web-desktop';
                        await launcher.startPreview({
                            ownership,
                            port,
                            platform,
                            open: options.open,
                            buildOptions,
                        });
                    }


                    // 保持进程运行
                    process.stdin.resume();
                } catch (error) {
                    // 启动失败回滚(issues/17):先 release ownership 再退出;release 幂等,
                    // 与 launcher 内部回滚双调无害。
                    await ownership?.release();
                    console.error(chalk.red('Failed to start preview'));
                    console.error(error);
                    process.exit(1);
                }
            });
    }
}
