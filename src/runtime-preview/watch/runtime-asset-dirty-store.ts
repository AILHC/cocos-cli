import {
    createRuntimeAssetPathCanonicalizer,
    type RuntimeAssetPathCanonicalizer,
} from '../path/runtime-asset-path-canonicalizer';

export type RuntimeAssetWatchEventType = 'create' | 'update' | 'delete';

export interface RuntimeAssetWatchEvent {
    type: RuntimeAssetWatchEventType;
    path: string;
    fileGeneration?: RuntimeAssetFileGeneration;
}

export interface RuntimeAssetFileGeneration {
    mtimeMs: number;
    size: number;
}

export interface RuntimeAssetDbSuccess {
    target: string;
    generation: number;
    sourceFileGeneration?: RuntimeAssetFileGeneration;
    metaFileGeneration?: RuntimeAssetFileGeneration;
}

export interface RuntimeAssetDirtyBatch {
    targets: string[];
    entries: RuntimeAssetDirtyEntry[];
    eventCount: number;
    drainedAt: number;
}

export interface RuntimeAssetDirtyEntry {
    target: string;
    eventTypes: RuntimeAssetWatchEventType[];
    assetEventCount: number;
    metaEventCount: number;
}

export interface RuntimeAssetDirtyStore {
    recordFileEvent(event: RuntimeAssetWatchEvent): void;
    recordDirtyTarget(input: {
        target: string;
        eventType: RuntimeAssetWatchEventType;
        assetEventCount?: number;
        metaEventCount?: number;
    }): void;
    acknowledgeAssetDbSuccess(input: RuntimeAssetDbSuccess): void;
    drainDirtyTargets(): RuntimeAssetDirtyBatch;
    requeueTargets(targets: string[]): void;
    peekDirtyTargets(limit?: number): string[];
    getDirtyTargetCount(): number;
    getEventCount(): number;
}

function compareTargets(left: string, right: string): number {
    return left.localeCompare(right);
}

export function createRuntimeAssetDirtyStore(options: {
    projectRoot: string;
    pathCanonicalizer?: RuntimeAssetPathCanonicalizer;
    now?: () => number;
}): RuntimeAssetDirtyStore {
    const now = options.now ?? Date.now;
    const pathCanonicalizer = options.pathCanonicalizer
        ?? createRuntimeAssetPathCanonicalizer({ projectRoot: options.projectRoot });
    const targets = new Map<string, {
        eventTypes: Set<RuntimeAssetWatchEventType>;
        assetEventCount: number;
        metaEventCount: number;
        sourceFileGeneration?: RuntimeAssetFileGeneration;
        metaFileGeneration?: RuntimeAssetFileGeneration;
    }>();
    let eventCount = 0;
    const importedGenerations = new Map<string, RuntimeAssetDbSuccess>();

    const isSameFileGeneration = (
        left: RuntimeAssetFileGeneration | undefined,
        right: RuntimeAssetFileGeneration | undefined,
    ): boolean => !!left
        && !!right
        && left.mtimeMs === right.mtimeMs
        && left.size === right.size;

    const updateTarget = (
        target: string,
        eventType: RuntimeAssetWatchEventType,
        assetEventCount: number,
        metaEventCount: number,
        fileGeneration?: RuntimeAssetFileGeneration,
    ): void => {
        const entry = targets.get(target) ?? {
            eventTypes: new Set<RuntimeAssetWatchEventType>(),
            assetEventCount: 0,
            metaEventCount: 0,
        };
        entry.eventTypes.add(eventType);
        entry.assetEventCount += assetEventCount;
        entry.metaEventCount += metaEventCount;
        if (assetEventCount > 0) {
            entry.sourceFileGeneration = fileGeneration;
        }
        if (metaEventCount > 0) {
            entry.metaFileGeneration = fileGeneration;
        }
        targets.set(target, entry);
        eventCount += assetEventCount + metaEventCount;
    };

    return {
        recordFileEvent(event: RuntimeAssetWatchEvent): void {
            const eventTarget = pathCanonicalizer.fileEventPathToDbTargetInfo(event.path);
            if (!eventTarget) {
                return;
            }

            const importedGeneration = importedGenerations.get(eventTarget.target);
            const expectedFileGeneration = eventTarget.isMetaEvent
                ? importedGeneration?.metaFileGeneration
                : importedGeneration?.sourceFileGeneration;
            if (isSameFileGeneration(event.fileGeneration, expectedFileGeneration)) {
                return;
            }
            if (importedGeneration && expectedFileGeneration) {
                importedGenerations.delete(eventTarget.target);
            }

            if (eventTarget.isMetaEvent) {
                updateTarget(eventTarget.target, event.type, 0, 1, event.fileGeneration);
            } else {
                updateTarget(eventTarget.target, event.type, 1, 0, event.fileGeneration);
            }
        },
        recordDirtyTarget(input): void {
            const normalized = pathCanonicalizer.refreshTargetToDbTarget(input.target, 'dirty-target');
            if (!normalized.ok) {
                return;
            }

            const assetEventCount = input.assetEventCount ?? 1;
            const metaEventCount = input.metaEventCount ?? 0;
            updateTarget(normalized.canonicalTarget, input.eventType, assetEventCount, metaEventCount);
        },
        acknowledgeAssetDbSuccess(input): void {
            const normalized = pathCanonicalizer.refreshTargetToDbTarget(input.target, 'dirty-target');
            if (!normalized.ok) {
                return;
            }

            const target = normalized.canonicalTarget;
            const current = importedGenerations.get(target);
            if (current && current.generation >= input.generation) {
                return;
            }

            const pending = targets.get(target);
            if (pending) {
                eventCount = Math.max(
                    0,
                    eventCount - pending.assetEventCount - pending.metaEventCount,
                );
                targets.delete(target);
            }
            if (input.sourceFileGeneration || input.metaFileGeneration) {
                importedGenerations.set(target, {
                    ...input,
                    target,
                });
            } else {
                importedGenerations.delete(target);
            }
        },
        drainDirtyTargets(): RuntimeAssetDirtyBatch {
            const entries = Array.from(targets.entries())
                .map(([target, entry]) => ({
                    target,
                    eventTypes: Array.from(entry.eventTypes).sort() as RuntimeAssetWatchEventType[],
                    assetEventCount: entry.assetEventCount,
                    metaEventCount: entry.metaEventCount,
                }))
                .sort((left, right) => compareTargets(left.target, right.target));
            const drainedEventCount = eventCount;

            targets.clear();
            eventCount = 0;

            return {
                targets: entries.map((entry) => entry.target),
                entries,
                eventCount: drainedEventCount,
                drainedAt: now(),
            };
        },
        requeueTargets(failedTargets: string[]): void {
            for (const failedTarget of failedTargets) {
                const normalized = pathCanonicalizer.refreshTargetToDbTarget(failedTarget, 'dirty-target');
                if (!normalized.ok) {
                    continue;
                }

                const target = normalized.canonicalTarget;
                const entry = targets.get(target) ?? {
                    eventTypes: new Set<RuntimeAssetWatchEventType>(),
                    assetEventCount: 0,
                    metaEventCount: 0,
                };
                entry.eventTypes.add('update');
                entry.assetEventCount += 1;
                targets.set(target, entry);
            }
        },
        peekDirtyTargets(limit = 5): string[] {
            return Array.from(targets.keys()).sort(compareTargets).slice(0, limit);
        },
        getDirtyTargetCount(): number {
            return targets.size;
        },
        getEventCount(): number {
            return eventCount;
        },
    };
}
