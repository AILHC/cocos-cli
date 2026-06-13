import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import {
    createRuntimePreviewContext,
    type RuntimePreviewContext,
    type RuntimePreviewExtensionLibraryRoot,
} from '../context/runtime-preview-context';
import { createRuntimePreviewLogger, type RuntimePreviewLogger } from '../logging/runtime-preview-logger';
import { PreviewSettingsProvider } from '../settings/preview-settings-provider';
import { handleRuntimePreviewRequest } from './runtime-preview-routes';
import type { RuntimePreviewHttpResponse } from './serve-on-demand-file';

export interface RuntimePreviewServerOptions {
    projectRoot: string;
    engineRoot: string;
    engineRootSource?: string;
    projectLibraryRoot: string;
    extensionLibraryRoots?: RuntimePreviewExtensionLibraryRoot[];
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
    settingsProvider: PreviewSettingsProvider;
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

const fetchBlockedPorts = new Set([
    1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95,
    101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161,
    179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532, 540, 548, 554, 556, 563,
    587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060,
    5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6697, 10080,
]);

async function listenOnFetchReachablePort(server: Server, port: number, host: string): Promise<number> {
    for (let attempt = 0; attempt < 10; attempt += 1) {
        const resolvedPort = await listen(server, port, host);
        if (port !== 0 || !fetchBlockedPorts.has(resolvedPort)) {
            return resolvedPort;
        }

        await close(server);
    }

    throw new Error('Runtime preview server could not allocate a fetch-reachable local port.');
}

const maxPreviewErrorBodyBytes = 64 * 1024;

function sendRuntimePreviewResponse(
    response: Response,
    routeResponse: RuntimePreviewHttpResponse,
    next: NextFunction,
): void {
    if (routeResponse.kind === 'file') {
        for (const [name, value] of Object.entries(routeResponse.headers)) {
            response.setHeader(name, value);
        }
        response.status(routeResponse.statusCode);
        response.sendFile(routeResponse.absolutePath, { dotfiles: 'allow' }, (error) => {
            if (error) {
                next(error);
            }
        });
        return;
    }

    const { 'content-type': contentType, ...headers } = routeResponse.headers;
    for (const [name, value] of Object.entries(headers)) {
        response.setHeader(name, value);
    }
    response.status(routeResponse.statusCode);
    if (contentType) {
        response.type(contentType);
    }
    response.send(routeResponse.body);
}

function isBodyTooLargeError(error: unknown): boolean {
    return !!error
        && typeof error === 'object'
        && (error as { type?: string }).type === 'entity.too.large';
}

export async function startRuntimePreviewServer(options: RuntimePreviewServerOptions): Promise<StartedRuntimePreviewServer> {
    const host = options.host ?? '127.0.0.1';
    const requestedPort = options.port ?? 19530;
    const logger = await createRuntimePreviewLogger(options.projectRoot);
    const context = createRuntimePreviewContext({
        projectRoot: options.projectRoot,
        engineRoot: options.engineRoot,
        engineRootSource: options.engineRootSource,
        scene: options.scene,
        projectLibraryRoot: options.projectLibraryRoot,
        extensionLibraryRoots: options.extensionLibraryRoots,
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
    const extensionRootSummary = context.extensionLibraryRoots
        .map((entry) => `${entry.name}:${entry.root}`)
        .join(';');
    const startupLogLines = [
        `projectRoot=${context.projectRoot}`,
        `engineRoot=${context.engineRoot}`,
        `engineRootSource=${context.engineRootSource ?? ''}`,
        `projectLibraryRoot=${context.projectLibraryRoot}`,
        `extensionLibraryRoots=${extensionRootSummary}`,
        `projectProgrammingRoot=${context.projectProgrammingRoot}`,
        `cliProgrammingRoot=${context.cliProgrammingRoot ?? ''}`,
        `internalLibraryRoot=${context.internalLibraryRoot ?? ''}`,
    ];
    for (const line of startupLogLines) {
        await logger.write(line);
    }

    const app = express();
    app.disable('x-powered-by');

    app.post('/preview-error', express.text({
        type: () => true,
        limit: maxPreviewErrorBodyBytes,
    }));

    app.use(async (request: Request, response: Response, next: NextFunction) => {
        let pathname = '';
        try {
            const requestUrl = new URL(request.originalUrl || request.url || '/', `http://${host}`);
            pathname = requestUrl.pathname;
            if (pathname === '/__runtime-preview/health') {
                response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
                response.end(JSON.stringify({
                    ok: true,
                    projectRoot: context.projectRoot,
                    engineRoot: context.engineRoot,
                    engineRootSource: context.engineRootSource,
                    projectLibraryRoot: context.projectLibraryRoot,
                    extensionLibraryRoots: context.extensionLibraryRoots,
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
                method: request.method,
                body: typeof request.body === 'string' ? request.body : undefined,
            }, request.originalUrl || request.url || '/');
            sendRuntimePreviewResponse(response, routeResponse, next);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (pathname === '/settings.js') {
                console.error(`[runtime-preview] settings:generation:error ${message}`);
            }
            next(error);
        }
    });

    app.use((error: unknown, _request: Request, response: Response, next: NextFunction) => {
        if (response.headersSent) {
            next(error);
            return;
        }

        if (isBodyTooLargeError(error)) {
            response.writeHead(413, { 'content-type': 'text/plain; charset=utf-8' });
            response.end('Runtime preview request body is too large.');
            return;
        }

        const message = error instanceof Error ? error.message : String(error);
        response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
        response.end(message);
    });

    const server = createServer(app);

    const port = await listenOnFetchReachablePort(server, requestedPort, host);
    const url = `http://${host}:${port}`;
    serverUrl = url;
    const listeningLine = `server:listening ${url}`;
    startupLogLines.push(listeningLine);
    await logger.write(listeningLine);
    return {
        server,
        host,
        port,
        url,
        context,
        settingsProvider: getSettingsProvider(),
        startupLogLines,
        logFilePath: logger.logFilePath,
        logger,
        close: () => close(server),
    };
}

export function getDefaultProjectProgrammingRoot(projectRoot: string): string {
    return join(projectRoot, 'temp', 'cli', 'programming');
}
