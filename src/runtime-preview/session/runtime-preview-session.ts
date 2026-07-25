import type { RuntimePreviewRouterHandle, RuntimePreviewRouterOptions } from '../server/runtime-preview-server';
import { mountRuntimePreviewRouter } from '../server/runtime-preview-server';
import { serverService } from '../../server/server';
import type { PreviewSessionOwnership } from '../../core/preview-session';

export interface RuntimePreviewSessionOptions extends Omit<RuntimePreviewRouterOptions, 'serverUrl'> {
    host?: string;
    port?: number;
    /**
     * 统一 session 生命周期的 ownership 句柄(可选,T3 在 command 层 acquire 后传入)。
     * close 开始即 markDraining + release(issues/17:验活立即落空,不阻塞相位化 close);
     * 启动回滚同样先释放 claim 再清理已初始化资源。
     */
    ownership?: PreviewSessionOwnership;
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
        ownership,
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
        // 启动失败回滚(issues/17):先释放 claim,再清理已初始化资源;
        // release 为 best-effort 且可重复调用。
        await ownership?.release();
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
                    // close 开始即释放 ownership(issues/17):先 markDraining 再 release,
                    // 验活立即落空;两者均为 best-effort,不阻塞后续相位化 close。
                    if (ownership) {
                        await ownership.markDraining();
                        await ownership.release();
                    }
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
