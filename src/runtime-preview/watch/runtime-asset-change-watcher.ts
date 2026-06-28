import { join } from 'node:path';
import * as parcelWatcher from '@parcel/watcher';
import type { RuntimeAssetDirtyStore, RuntimeAssetWatchEvent } from './runtime-asset-dirty-store';

type ParcelEvent = { type: 'create' | 'update' | 'delete'; path: string };
type ParcelSubscription = { unsubscribe: () => Promise<void> | void };
type Subscribe = (
    root: string,
    callback: (error: Error | null, events: ParcelEvent[]) => void,
    options?: { ignore?: string[] },
) => Promise<ParcelSubscription>;

export interface RuntimeAssetWatcherStatus {
    enabled: boolean;
    running: boolean;
    assetsRoot: string;
    error?: string;
    eventCount: number;
    dirtyTargetCount: number;
    sampleTargets: string[];
}

export interface RuntimeAssetChangeWatcher {
    start(): Promise<void>;
    stop(): Promise<void>;
    getStatus(): RuntimeAssetWatcherStatus;
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export function createRuntimeAssetChangeWatcher(options: {
    projectRoot: string;
    dirtyStore: RuntimeAssetDirtyStore;
    subscribe?: Subscribe;
    failSoft?: boolean;
    logger?: { write: (line: string) => Promise<void> | void };
}): RuntimeAssetChangeWatcher {
    const assetsRoot = join(options.projectRoot, 'assets');
    const subscribe = options.subscribe ?? parcelWatcher.subscribe;
    const failSoft = options.failSoft ?? true;
    let subscription: ParcelSubscription | null = null;
    let error: string | undefined;

    const writeLog = async (line: string): Promise<void> => {
        await options.logger?.write(`runtime-asset-watch ${line}`);
    };

    const getStatus = (): RuntimeAssetWatcherStatus => ({
        enabled: true,
        running: !!subscription && !error,
        assetsRoot,
        error,
        eventCount: options.dirtyStore.getEventCount(),
        dirtyTargetCount: options.dirtyStore.getDirtyTargetCount(),
        sampleTargets: options.dirtyStore.peekDirtyTargets(5),
    });

    return {
        async start(): Promise<void> {
            if (subscription) {
                return;
            }

            try {
                subscription = await subscribe(
                    assetsRoot,
                    (callbackError, events) => {
                        if (callbackError) {
                            error = callbackError.message;
                            void writeLog(`event-error ${error}`);
                            return;
                        }

                        for (const event of events) {
                            options.dirtyStore.recordFileEvent(event as RuntimeAssetWatchEvent);
                        }

                        const sampleTargets = options.dirtyStore.peekDirtyTargets(5).join(',');
                        void writeLog([
                            `events count=${events.length}`,
                            `dirtyTargets=${options.dirtyStore.getDirtyTargetCount()}`,
                            `sample=${sampleTargets}`,
                        ].join(' '));
                    },
                    {
                        ignore: [
                            '**/.DS_Store',
                            '**/Thumbs.db',
                        ],
                    },
                );
                error = undefined;
                await writeLog(`start assetsRoot=${assetsRoot}`);
            } catch (startError) {
                error = getErrorMessage(startError);
                await writeLog(`start-error ${error}`);
                if (!failSoft) {
                    throw startError;
                }
            }
        },
        async stop(): Promise<void> {
            const active = subscription;
            subscription = null;
            if (active) {
                await active.unsubscribe();
                await writeLog('stop');
            }
        },
        getStatus,
    };
}
