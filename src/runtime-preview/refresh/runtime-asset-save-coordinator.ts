import type { IAssetSavedEvent } from '../../core/assets/@types/public';
import type { RuntimeRefreshCoordinator } from './runtime-refresh-coordinator';
import type { RuntimeAssetDirtyStore } from '../watch/runtime-asset-dirty-store';

export interface RuntimeAssetSaveSource {
    onAssetSaved(listener: (event: IAssetSavedEvent) => void | Promise<void>): () => void;
}

export interface RuntimeAssetSaveCoordinator {
    close(): Promise<void>;
}

export function createRuntimeAssetSaveCoordinator(options: {
    source: RuntimeAssetSaveSource;
    refreshCoordinator: Pick<RuntimeRefreshCoordinator, 'refreshImportedAsset'>;
    dirtyStore?: RuntimeAssetDirtyStore;
    logger?: { write: (line: string) => Promise<void> | void };
}): RuntimeAssetSaveCoordinator {
    let closed = false;
    const inFlight = new Set<Promise<void>>();

    const onAssetSaved = (event: IAssetSavedEvent): Promise<void> => {
        if (closed) {
            return Promise.resolve();
        }

        const task = (async () => {
            options.dirtyStore?.acknowledgeAssetDbSuccess({
                target: event.asset.url,
                generation: event.generation,
                sourceFileGeneration: event.sourceFileGeneration,
                metaFileGeneration: event.metaFileGeneration,
            });
            const result = await options.refreshCoordinator.refreshImportedAsset({
                target: event.asset.url,
                generation: event.generation,
            });
            await options.logger?.write([
                'runtime-asset-save',
                `generation=${event.generation}`,
                `target=${result.target}`,
                `ok=${result.ok}`,
                `source=${event.sourceFileGeneration
                    ? `${event.sourceFileGeneration.mtimeMs}:${event.sourceFileGeneration.size}`
                    : 'missing'}`,
                `meta=${event.metaFileGeneration
                    ? `${event.metaFileGeneration.mtimeMs}:${event.metaFileGeneration.size}`
                    : 'missing'}`,
            ].join(' '));
            if (!result.ok) {
                throw new Error(result.error ?? `Runtime refresh failed for ${result.target}.`);
            }
        })();
        inFlight.add(task);
        void task.then(
            () => inFlight.delete(task),
            () => inFlight.delete(task),
        );
        return task;
    };

    const unsubscribe = options.source.onAssetSaved(onAssetSaved);
    let closePromise: Promise<void> | null = null;

    return {
        close(): Promise<void> {
            if (!closePromise) {
                closed = true;
                unsubscribe();
                closePromise = Promise.allSettled(Array.from(inFlight)).then(() => undefined);
            }
            return closePromise;
        },
    };
}
