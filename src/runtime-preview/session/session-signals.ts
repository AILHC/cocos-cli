export interface RuntimePreviewSessionCloser {
    close(): Promise<void>;
}

interface SignalProcess {
    on(signal: NodeJS.Signals, listener: () => void): unknown;
    off(signal: NodeJS.Signals, listener: () => void): unknown;
    exit(code?: number): never | void;
    exitCode?: number | string | null;
}

const installedHandlers = new WeakMap<object, () => void>();

/**
 * The CLI entrypoint owns process signals. Mounting a session never installs
 * handlers, which keeps library consumers and Vitest isolated from process
 * global state.
 */
export function installRuntimePreviewSessionSignalHandlers(
    session: RuntimePreviewSessionCloser,
    target: SignalProcess = process,
): () => void {
    installedHandlers.get(target as object)?.();

    let cleaningUp = false;
    let removed = false;
    const remove = () => {
        if (removed) {
            return;
        }
        removed = true;
        target.off('SIGINT', onSigint);
        target.off('SIGTERM', onSigterm);
        installedHandlers.delete(target as object);
    };
    const onSignal = (signal: NodeJS.Signals) => {
        if (cleaningUp) {
            return;
        }
        cleaningUp = true;
        void (async () => {
            try {
                await session.close();
                const exitCode = signal === 'SIGINT' ? 130 : 143;
                target.exitCode = exitCode;
                remove();
                target.exit(exitCode);
            } catch (error) {
                console.error(`Failed to close Runtime Preview session after ${signal}:`, error);
                target.exitCode = 1;
                remove();
                target.exit(1);
            }
        })();
    };
    const onSigint = () => onSignal('SIGINT');
    const onSigterm = () => onSignal('SIGTERM');
    target.on('SIGINT', onSigint);
    target.on('SIGTERM', onSigterm);
    installedHandlers.set(target as object, remove);
    return remove;
}
