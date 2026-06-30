import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import {
    createRuntimePreviewContext,
    type RuntimePreviewContext,
    type RuntimePreviewExtensionLibraryRoot,
} from '../context/runtime-preview-context';
import { createRuntimePreviewLogger, type RuntimePreviewLogger } from '../logging/runtime-preview-logger';
import {
    createRuntimeRefreshCoordinator,
    type RuntimeRefreshCoordinator,
    type RuntimeRefreshResult,
} from '../refresh/runtime-refresh-coordinator';
import { PreviewSettingsProvider } from '../settings/preview-settings-provider';
import {
    createRuntimeAssetChangeWatcher,
    type RuntimeAssetChangeWatcher,
    createRuntimeAssetStartupSnapshot,
    type RuntimeAssetStartupSnapshot,
} from '../watch/runtime-asset-change-watcher';
import {
    createRuntimeAssetDirtyStore,
    type RuntimeAssetDirtyStore,
} from '../watch/runtime-asset-dirty-store';
import { createImportReplacementExtensionResolver } from './import-replacement-extension-cache';
import {
    handleRuntimePreviewRequest,
    type RuntimeRefreshClientState,
} from './runtime-preview-routes';
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
    scriptLoadConcurrency?: number;
    refreshOnReload?: boolean;
    watchAssets?: boolean;
    deferAssetWatcherStart?: boolean;
    assetWatcherStartupSnapshot?: RuntimeAssetStartupSnapshot;
    assetDirtyStoreFactory?: (input: { projectRoot: string }) => RuntimeAssetDirtyStore;
    assetChangeWatcherFactory?: (input: {
        projectRoot: string;
        dirtyStore: RuntimeAssetDirtyStore;
        logger: RuntimePreviewLogger;
        startupSnapshot?: RuntimeAssetStartupSnapshot;
    }) => RuntimeAssetChangeWatcher;
    refreshTarget?: (target: string) => Promise<number | null | undefined>;
    refreshCoordinator?: Pick<RuntimeRefreshCoordinator, 'refresh'>;
    prepareRuntimePreview?: (serverUrl: string) => Promise<void>;
    readiness?: {
        isReady(): boolean;
        describe(): {
            settingsReady: boolean;
            assetWatcherReady: boolean;
            artifactsInspected: boolean;
        };
    };
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
    startAssetWatcher: () => Promise<void>;
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
const maxRuntimeRefreshBodyBytes = 64 * 1024;
const runtimePreviewPreparingText = 'Runtime preview is preparing. Reload after preview:ready.';

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

function isMalformedJsonError(error: unknown): boolean {
    return !!error
        && typeof error === 'object'
        && (error as { type?: string }).type === 'entity.parse.failed';
}

function createRuntimeRefreshFailureResult(
    reason: 'endpoint' | 'reload',
    error: unknown,
): RuntimeRefreshResult {
    const message = error instanceof Error ? error.message : String(error);
    return {
        ok: false,
        refreshId: 'runtime-refresh-error',
        target: 'db://assets',
        reason,
        changedAssetCount: null,
        scriptCompile: {
            status: 'skipped',
            durationMs: 0,
        },
        durationMs: 0,
        error: message,
    };
}

function isRuntimeRefreshJsonObject(body: unknown): body is { target?: unknown } {
    return !!body && typeof body === 'object' && !Array.isArray(body);
}

function requiresRuntimePreviewReadiness(pathname: string): boolean {
    if (pathname === '/' || pathname === '/settings.js') {
        return true;
    }
    if (/^\/(?:assets|remote)\/[^/]+\/(?:config(?:\.[^/.]+)?\.json|index(?:\.[^/.]+)?\.js)$/.test(pathname)) {
        return true;
    }
    return pathname.startsWith('/plugins/');
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
        scriptLoadConcurrency: options.scriptLoadConcurrency,
    });
    const importReplacementExtensionResolver = createImportReplacementExtensionResolver(context);
    const dirtyStore = options.watchAssets === true
        ? (options.assetDirtyStoreFactory?.({ projectRoot: context.projectRoot })
            ?? createRuntimeAssetDirtyStore({ projectRoot: context.projectRoot }))
        : undefined;
    const assetWatcher = dirtyStore
        ? (options.assetChangeWatcherFactory?.({
            projectRoot: context.projectRoot,
            dirtyStore,
            logger,
            startupSnapshot: options.assetWatcherStartupSnapshot,
        })
            ?? createRuntimeAssetChangeWatcher({
                projectRoot: context.projectRoot,
                dirtyStore,
                logger,
                failSoft: true,
                startupSnapshot: options.assetWatcherStartupSnapshot,
                snapshotFiles: options.assetWatcherStartupSnapshot
                    ? createRuntimeAssetStartupSnapshot
                    : undefined,
            }))
        : undefined;
    let assetWatcherStarted = false;
    const startAssetWatcher = async (): Promise<void> => {
        if (!assetWatcher || assetWatcherStarted) {
            return;
        }

        assetWatcherStarted = true;
        try {
            await assetWatcher.start();
        } catch (error) {
            assetWatcherStarted = false;
            throw error;
        }
    };
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
    const isPreviewReady = (): boolean => options.readiness?.isReady() ?? true;
    const describeReadiness = () => {
        const detail = options.readiness?.describe();
        return {
            ready: isPreviewReady(),
            settingsReady: detail?.settingsReady ?? true,
            assetWatcherReady: detail?.assetWatcherReady ?? true,
            artifactsInspected: detail?.artifactsInspected ?? true,
        };
    };
    const sendPreparingResponse = (response: Response): void => {
        response.status(503).type('text/plain').send(runtimePreviewPreparingText);
    };
    let refreshCoordinator = options.refreshCoordinator;
    const getRefreshCoordinator = (): Pick<RuntimeRefreshCoordinator, 'refresh'> => {
        if (!refreshCoordinator) {
            refreshCoordinator = createRuntimeRefreshCoordinator({
                projectRoot: context.projectRoot,
                refreshTarget: options.refreshTarget ?? (async (target) => {
                    const { assetOperation } = await import('../../core/assets/manager/operation');
                    return assetOperation.refreshAsset(target);
                }),
                waitForIdle: async () => {
                    const { default: scripting } = await import('../../core/scripting');
                    await scripting.waitForIdle({ timeoutMs: 30_000 });
                },
                invalidateSettings: () => getSettingsProvider().invalidate(),
                clearImportReplacement: () => importReplacementExtensionResolver.clear(),
                dirtyProvider: dirtyStore && assetWatcher
                    ? {
                        drainDirtyTargets: () => dirtyStore.drainDirtyTargets(),
                        requeueTargets: (targets) => dirtyStore.requeueTargets(targets),
                        getStatus: () => assetWatcher.getStatus(),
                    }
                    : undefined,
                logger,
            });
        }
        return refreshCoordinator;
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
        `scriptLoadConcurrency=${context.scriptLoadConcurrency ?? ''}`,
    ];
    for (const line of startupLogLines) {
        await logger.write(line);
    }
    if (options.deferAssetWatcherStart !== true) {
        await startAssetWatcher();
    }

    const app = express();
    app.disable('x-powered-by');

    app.post('/preview-error', express.text({
        type: () => true,
        limit: maxPreviewErrorBodyBytes,
    }));

    app.all(
        '/__runtime-preview/refresh',
        async (request: Request, response: Response, next: NextFunction) => {
            if (!isPreviewReady()) {
                sendPreparingResponse(response);
                return;
            }
            if (request.method !== 'POST') {
                response.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' });
                response.end('Runtime refresh endpoint only supports POST.');
                return;
            }

            next();
        },
        express.json({
            type: () => true,
            limit: maxRuntimeRefreshBodyBytes,
        }),
        async (request: Request, response: Response) => {
            try {
                if (!isRuntimeRefreshJsonObject(request.body)) {
                    response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
                    response.end('Runtime refresh JSON body must be an object.');
                    return;
                }

                await options.prepareRuntimePreview?.(serverUrl);
                const result = await getRefreshCoordinator().refresh({
                    reason: 'endpoint',
                    target: request.body.target,
                });
                response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
                response.end(JSON.stringify(result));
            } catch (error) {
                const result = createRuntimeRefreshFailureResult('endpoint', error);
                response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
                response.end(JSON.stringify(result));
            }
        },
    );

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
            if (pathname === '/__runtime-preview/status') {
                response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
                response.end(JSON.stringify(describeReadiness()));
                return;
            }

            if (requiresRuntimePreviewReadiness(pathname) && !isPreviewReady()) {
                sendPreparingResponse(response);
                return;
            }

            let runtimeRefreshState: RuntimeRefreshClientState | null = null;
            if (pathname === '/' && options.refreshOnReload === true) {
                try {
                    await options.prepareRuntimePreview?.(serverUrl);
                    const result = await getRefreshCoordinator().refresh({ reason: 'reload' });
                    runtimeRefreshState = result.ok
                        ? { lastRefresh: result }
                        : { refreshOnReloadFailure: result };
                } catch (error) {
                    runtimeRefreshState = {
                        refreshOnReloadFailure: createRuntimeRefreshFailureResult('reload', error),
                    };
                }
            }
            if (pathname === '/' && assetWatcher) {
                runtimeRefreshState = {
                    ...(runtimeRefreshState ?? {}),
                    watcher: assetWatcher.getStatus(),
                };
            }

            const routeResponse = await handleRuntimePreviewRequest({
                runtimeContext: context,
                settingsProvider: getSettingsProvider(),
                capturedRuntimeUrls: options.capturedRuntimeUrls,
                logger,
                method: request.method,
                body: typeof request.body === 'string' ? request.body : undefined,
                importReplacementExtensionResolver,
                runtimeRefreshState,
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

        if (isMalformedJsonError(error) && _request.path === '/__runtime-preview/refresh') {
            response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
            response.end('Invalid runtime refresh JSON body.');
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
        startAssetWatcher,
        close: async () => {
            try {
                await assetWatcher?.stop();
            } finally {
                await close(server);
            }
        },
    };
}

export function getDefaultProjectProgrammingRoot(projectRoot: string): string {
    return join(projectRoot, 'temp', 'cli', 'programming');
}
