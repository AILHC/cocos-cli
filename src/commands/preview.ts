import chalk from 'chalk';
import { BaseCommand } from './base';
import { existsSync, readJSONSync } from 'fs-extra';
import { installRuntimePreviewSessionSignalHandlers } from '../runtime-preview/session/session-signals';


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

                    const { default: Launcher } = await import('../core/launcher');
                    const launcher = new Launcher(resolvedPath);
                    if (mode !== 'build') {
                        const session = await launcher.startRuntimePreview({
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
                        let buildOptions: Record<string, any> = {};
                        if (options.buildConfig) {
                            if (!existsSync(options.buildConfig)) {
                                console.error(chalk.red(`Error: Build config does not exist: ${options.buildConfig}`));
                                process.exit(1);
                            }
                            buildOptions = readJSONSync(options.buildConfig);
                        }

                        const platform = options.platform || buildOptions.platform || 'web-desktop';
                        await launcher.startPreview({
                            port,
                            platform,
                            open: options.open,
                            buildOptions,
                        });
                    }


                    // 保持进程运行
                    process.stdin.resume();
                } catch (error) {
                    console.error(chalk.red('Failed to start preview'));
                    console.error(error);
                    process.exit(1);
                }
            });
    }
}
