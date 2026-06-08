import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import { createRuntimePreviewContext, type RuntimePreviewContext } from '../context/runtime-preview-context';
import { createRuntimePreviewLogger, type RuntimePreviewLogger } from '../logging/runtime-preview-logger';
import { PreviewSettingsProvider } from '../settings/preview-settings-provider';
import { handleRuntimePreviewRequest } from './runtime-preview-routes';

export interface RuntimePreviewServerOptions {
    projectRoot: string;
    engineRoot: string;
    projectLibraryRoot: string;
    projectProgrammingRoot: string;
    cliProgrammingRoot?: string;
    internalLibraryRoot?: string;
    host?: string;
    port?: number;
    scene?: string;
    settingsBuildOptions?: Record<string, any>;
    settingsProvider?: PreviewSettingsProvider;
    capturedRuntimeUrls?: Array<{ url: string }>;
}

export interface StartedRuntimePreviewServer {
    server: Server;
    host: string;
    port: number;
    url: string;
    context: RuntimePreviewContext;
    startupLogLines: string[];
    logFilePath: string;
    logger: RuntimePreviewLogger;
    close: () => Promise<void>;
}

function listen(server: Server, port: number, host: string): Promise<number> {
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
            const address = server.address();
            if (!address || typeof address === 'string') {
                reject(new Error('Runtime preview server did not expose a TCP address.'));
                return;
            }
            resolve(address.port);
        });
    });
}

function close(server: Server): Promise<void> {
    return new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
    });
}

export async function startRuntimePreviewServer(options: RuntimePreviewServerOptions): Promise<StartedRuntimePreviewServer> {
    const host = options.host ?? '127.0.0.1';
    const requestedPort = options.port ?? 19530;
    const logger = await createRuntimePreviewLogger(options.projectRoot);
    const context = createRuntimePreviewContext({
        projectRoot: options.projectRoot,
        engineRoot: options.engineRoot,
        projectLibraryRoot: options.projectLibraryRoot,
        projectProgrammingRoot: options.projectProgrammingRoot,
        cliProgrammingRoot: options.cliProgrammingRoot,
        internalLibraryRoot: options.internalLibraryRoot,
    });
    let serverUrl = '';
    let settingsProvider = options.settingsProvider;
    const getSettingsProvider = (): PreviewSettingsProvider => {
        if (!settingsProvider) {
            if (!serverUrl) {
                throw new Error('Runtime preview settings provider requested before server URL was assigned.');
            }
            settingsProvider = new PreviewSettingsProvider({
                buildOptions: {
                    ...(options.settingsBuildOptions ?? {}),
                    server: serverUrl,
                    startScene: options.scene,
                },
            });
        }
        return settingsProvider;
    };
    const startupLogLines = [
        `projectRoot=${context.projectRoot}`,
        `engineRoot=${context.engineRoot}`,
        `projectLibraryRoot=${context.projectLibraryRoot}`,
        `projectProgrammingRoot=${context.projectProgrammingRoot}`,
        `cliProgrammingRoot=${context.cliProgrammingRoot ?? ''}`,
        `internalLibraryRoot=${context.internalLibraryRoot ?? ''}`,
    ];
    for (const line of startupLogLines) {
        await logger.write(line);
    }

    const server = createServer(async (request, response) => {
        let pathname = '';
        try {
            const requestUrl = new URL(request.url ?? '/', `http://${host}`);
            pathname = requestUrl.pathname;
            if (pathname === '/__runtime-preview/health') {
                response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
                response.end(JSON.stringify({
                    ok: true,
                    projectRoot: context.projectRoot,
                    engineRoot: context.engineRoot,
                    projectLibraryRoot: context.projectLibraryRoot,
                    projectProgrammingRoot: context.projectProgrammingRoot,
                    cliProgrammingRoot: context.cliProgrammingRoot,
                    logFilePath: logger.logFilePath,
                }));
                return;
            }

            const routeResponse = await handleRuntimePreviewRequest({
                runtimeContext: context,
                settingsProvider: getSettingsProvider(),
                capturedRuntimeUrls: options.capturedRuntimeUrls,
                logger,
            }, request.url ?? '/');
            response.writeHead(routeResponse.statusCode, routeResponse.headers);
            response.end(routeResponse.body);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (pathname === '/settings.js') {
                console.error(`[runtime-preview] settings:generation:error ${message}`);
            }
            response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
            response.end(message);
        }
    });

    const port = await listen(server, requestedPort, host);
    const url = `http://${host}:${port}`;
    serverUrl = url;
    const listeningLine = `server:listening=${url}`;
    startupLogLines.push(listeningLine);
    await logger.write(listeningLine);
    return {
        server,
        host,
        port,
        url,
        context,
        startupLogLines,
        logFilePath: logger.logFilePath,
        logger,
        close: () => close(server),
    };
}

export function getDefaultProjectProgrammingRoot(projectRoot: string): string {
    return join(projectRoot, 'temp', 'cli', 'programming');
}
