import {
    createRuntimeAssetPathCanonicalizer,
    type RuntimeAssetPathCanonicalizer,
} from '../path/runtime-asset-path-canonicalizer';

export type RuntimeAssetWatchEventType = 'create' | 'update' | 'delete';

export interface RuntimeAssetWatchEvent {
    type: RuntimeAssetWatchEventType;
    path: string;
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
    }>();
    let eventCount = 0;

    const updateTarget = (
        target: string,
        eventType: RuntimeAssetWatchEventType,
        assetEventCount: number,
        metaEventCount: number,
    ): void => {
        const entry = targets.get(target) ?? {
            eventTypes: new Set<RuntimeAssetWatchEventType>(),
            assetEventCount: 0,
            metaEventCount: 0,
        };
        entry.eventTypes.add(eventType);
        entry.assetEventCount += assetEventCount;
        entry.metaEventCount += metaEventCount;
        targets.set(target, entry);
        eventCount += assetEventCount + metaEventCount;
    };

    return {
        recordFileEvent(event: RuntimeAssetWatchEvent): void {
            const eventTarget = pathCanonicalizer.fileEventPathToDbTargetInfo(event.path);
            if (!eventTarget) {
                return;
            }

            if (eventTarget.isMetaEvent) {
                updateTarget(eventTarget.target, event.type, 0, 1);
            } else {
                updateTarget(eventTarget.target, event.type, 1, 0);
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
