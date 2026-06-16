export interface EditorFacadeContext {
    projectRoot: string;
}

export interface EditorFacade {
    Project: {
        path: string;
    };
    Message: {
        request(channel: string, message: string, ...args: unknown[]): Promise<unknown>;
        send(channel: string, message: string, ...args: unknown[]): void;
    };
}

type EditorMessageKind = 'request' | 'send';

type PendingOperation = () => Promise<unknown>;

type NativeSetTimeout = (...args: any[]) => ReturnType<typeof globalThis.setTimeout>;

const pendingOperations = new WeakMap<EditorFacade, PendingOperation[]>();
let activeNativeSetTimeout: NativeSetTimeout | undefined;

function getUnsupportedError(kind: EditorMessageKind, channel: string, message: string) {
    return new Error(`Unsupported Editor.Message ${kind}: ${channel}.${message}`);
}

async function runWithNativeSetTimeout<T>(runner: () => Promise<T> | T): Promise<T> {
    if (!activeNativeSetTimeout) {
        return await Promise.resolve(runner());
    }

    const globalObject = globalThis as any;
    const currentSetTimeout = globalObject.setTimeout;
    globalObject.setTimeout = activeNativeSetTimeout;

    try {
        return await Promise.resolve(runner());
    } finally {
        globalObject.setTimeout = currentSetTimeout;
    }
}

async function handleEditorMessage(
    kind: EditorMessageKind,
    channel: string,
    message: string,
    args: unknown[],
): Promise<unknown> {
    if (channel !== 'asset-db') {
        throw getUnsupportedError(kind, channel, message);
    }

    if (message === 'move-asset') {
        return runWithNativeSetTimeout(async () => {
            const { assetManager } = await import('../assets');
            const [source, target, options] = args as [string, string, { overwrite?: unknown; override?: unknown; rename?: unknown } | undefined];
            return assetManager.moveAsset(source, target, {
                overwrite: Boolean(options?.overwrite ?? options?.override),
                rename: Boolean(options?.rename),
            });
        });
    }

    if (message === 'delete-asset') {
        return runWithNativeSetTimeout(async () => {
            const { assetManager } = await import('../assets');
            const [target] = args as [string];
            return assetManager.removeAsset(target, { useTrash: false });
        });
    }

    if (message === 'query-asset-meta') {
        return runWithNativeSetTimeout(async () => {
            const { assetManager } = await import('../assets');
            const [target] = args as [string];
            return assetManager.queryAssetMeta(target);
        });
    }

    if (message === 'query-uuid') {
        return runWithNativeSetTimeout(async () => {
            const { assetManager } = await import('../assets');
            const [urlOrPath] = args as [string];
            return assetManager.queryUUID(urlOrPath) || '';
        });
    }

    if (message === 'save-asset-meta') {
        return runWithNativeSetTimeout(async () => {
            const { assetManager } = await import('../assets');
            const [target, rawMeta] = args as [string, unknown];
            const meta = typeof rawMeta === 'string' ? JSON.parse(rawMeta) : rawMeta;
            return assetManager.saveAssetMeta(target, meta as any);
        });
    }

    if (message === 'refresh-asset') {
        return runWithNativeSetTimeout(async () => {
            const { assetManager } = await import('../assets');
            const [target] = args as [string];
            return assetManager.refreshAsset(target);
        });
    }

    if (message === 'reimport-asset') {
        return runWithNativeSetTimeout(async () => {
            const { assetManager } = await import('../assets');
            const [target] = args as [string];
            return assetManager.reimportAsset(target);
        });
    }

    if (message === 'save-asset') {
        return runWithNativeSetTimeout(async () => {
            const { assetManager } = await import('../assets');
            const [target, content] = args as [string, string | Buffer];
            return assetManager.saveAsset(target, content);
        });
    }

    throw getUnsupportedError(kind, channel, message);
}

export function createEditorFacade(context: EditorFacadeContext): EditorFacade {
    const pending = [] as PendingOperation[];
    const facade: EditorFacade = {
        Project: {
            path: context.projectRoot,
        },
        Message: {
            request(channel: string, message: string, ...args: unknown[]) {
                return handleEditorMessage('request', channel, message, args);
            },
            send(channel: string, message: string, ...args: unknown[]) {
                pending.push(() => handleEditorMessage('send', channel, message, args));
            },
        },
    };

    pendingOperations.set(facade, pending);
    return facade;
}

export async function drainEditorFacade(facade: EditorFacade = (globalThis as any).Editor): Promise<void> {
    const pending = pendingOperations.get(facade);
    if (!pending) {
        return;
    }

    while (pending.length) {
        const operation = pending.shift();
        if (operation) {
            await operation();
        }
    }
}

export async function withEditorFacade<T>(
    context: EditorFacadeContext,
    run: () => Promise<T>,
): Promise<T> {
    const globalObject = globalThis as any;
    const previousEditor = globalObject.Editor;
    const hadPreviousEditor = Object.prototype.hasOwnProperty.call(globalObject, 'Editor');
    const previousSetTimeout = globalObject.setTimeout;
    const previousActiveSetTimeout = activeNativeSetTimeout;

    const facade = createEditorFacade(context);
    const timerFailures: Error[] = [];
    const scheduledTimers: Promise<void>[] = [];

    const wrappedSetTimeout = (...args: any[]) => {
        const [callback, delay = 0, ...rest] = args;
        const resolvedDelay = typeof delay === 'number' ? delay : 0;

        if (resolvedDelay > 0) {
            timerFailures.push(new Error('Editor.Message send scheduled after hook scope'));
            return previousSetTimeout(() => undefined, resolvedDelay);
        }

        const callbackFn = typeof callback === 'function'
            ? callback
            : () => undefined;
        let timerHandle: ReturnType<typeof previousSetTimeout> | undefined;
        const timerPromise = new Promise<void>((resolve, reject) => {
            timerHandle = previousSetTimeout(async () => {
                try {
                    const result = callbackFn(...rest);
                    if (result && typeof (result as Promise<unknown>).then === 'function') {
                        await result;
                    }
                    resolve();
                } catch (error) {
                    reject(error as Error);
                }
            }, resolvedDelay);
        });
        scheduledTimers.push(timerPromise);
        return timerHandle;
    };

    const drainScheduledTimers = async () => {
        while (scheduledTimers.length) {
            const timers = scheduledTimers.splice(0, scheduledTimers.length);
            await Promise.all(timers);
        }
    };

    globalObject.Editor = facade;
    activeNativeSetTimeout = previousSetTimeout;
    globalObject.setTimeout = wrappedSetTimeout;

    let runResult: T;
    let error: unknown;

    try {
        runResult = await run();
        await new Promise((resolve) => {
            previousSetTimeout(resolve, 0);
        });
        await drainScheduledTimers();
        if (timerFailures.length > 0) {
            throw timerFailures[0];
        }
        await drainEditorFacade(facade);
    } catch (runErr) {
        error = runErr;
    } finally {
        globalObject.setTimeout = previousSetTimeout;
        activeNativeSetTimeout = previousActiveSetTimeout;
        if (hadPreviousEditor) {
            globalObject.Editor = previousEditor;
        } else {
            delete globalObject.Editor;
        }
    }

    if (error) {
        throw error;
    }

    return runResult!;
}
