import type { RuntimePreviewRouterHandle, RuntimePreviewRouterOptions } from '../server/runtime-preview-server';
import { mountRuntimePreviewRouter } from '../server/runtime-preview-server';
import { serverService } from '../../server/server';

export interface RuntimePreviewSessionOptions extends Omit<RuntimePreviewRouterOptions, 'serverUrl'> {
    host?: string;
    port?: number;
}

export interface StartedRuntimePreviewSession extends RuntimePreviewRouterHandle {
    host: string;
    port: number;
    url: string;
    /**
     * Register a resource acquired after the HTTP session starts. Cleanup is
     * intentionally phase based so the shared server remains the last owner
     * to release its resource.
     */
    registerCleanup(phase: 'runtime' | 'scene' | 'project', close: () => Promise<void>): void;
}

type CleanupPhase = 'runtime' | 'scene' | 'project';

function toAggregateError(errors: unknown[], message: string): Error {
    return new AggregateError(errors, message);
}

export async function startRuntimePreviewSession(
    options: RuntimePreviewSessionOptions,
): Promise<StartedRuntimePreviewSession> {
    const {
        host: requestedHost,
        port: requestedPort,
        ...runtimeOptions
    } = options;
    const host = requestedHost ?? '127.0.0.1';
    await serverService.start(requestedPort, host);
    const url = serverService.url;

    let runtime: RuntimePreviewRouterHandle | undefined;
    try {
        runtime = await mountRuntimePreviewRouter(serverService.router, {
            ...runtimeOptions,
            serveRootLibraryPathsForNode: true,
            serverUrl: url,
        });
        const listeningLine = `server:listening ${url}`;
        runtime.startupLogLines.push(listeningLine);
        await runtime.logger.write(listeningLine);
    } catch (error) {
        const rollbackErrors: unknown[] = [error];
        try {
            await runtime?.close();
        } catch (cleanupError) {
            rollbackErrors.push(cleanupError);
        }
        try {
            await serverService.stop();
        } catch (cleanupError) {
            rollbackErrors.push(cleanupError);
        }
        if (rollbackErrors.length > 1) {
            throw new AggregateError(rollbackErrors, 'Runtime Preview session startup failed and rollback was incomplete.');
        }
        throw error;
    }

    const mountedRuntime = runtime;
    const cleanupSteps: Record<CleanupPhase, Array<() => Promise<void>>> = {
        runtime: [mountedRuntime.close],
        scene: [],
        project: [],
    };
    let closePromise: Promise<void> | null = null;
    return {
        ...mountedRuntime,
        host: serverService.host,
        port: serverService.port,
        url,
        registerCleanup: (phase, close) => {
            if (closePromise) {
                throw new Error(`Cannot register ${phase} cleanup after Runtime Preview session close has started.`);
            }
            cleanupSteps[phase].push(close);
        },
        close: () => {
            if (!closePromise) {
                closePromise = (async () => {
                    const errors: unknown[] = [];
                    for (const phase of ['runtime', 'scene', 'project'] as const) {
                        for (const cleanup of cleanupSteps[phase].reverse()) {
                            try {
                                await cleanup();
                            } catch (error) {
                                errors.push(error);
                            }
                        }
                    }
                    try {
                        await serverService.stop();
                    } catch (error) {
                        errors.push(error);
                    }
                    if (errors.length) {
                        throw toAggregateError(errors, 'Runtime Preview session cleanup failed.');
                    }
                })();
            }
            return closePromise;
        },
    };
}
