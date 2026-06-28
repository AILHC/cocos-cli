import { isAbsolute, relative, resolve } from 'node:path';

export type RuntimeAssetWatchEventType = 'create' | 'update' | 'delete';

export interface RuntimeAssetWatchEvent {
    type: RuntimeAssetWatchEventType;
    path: string;
}

export interface RuntimeAssetDirtyBatch {
    targets: string[];
    entries: Array<{ target: string; eventTypes: RuntimeAssetWatchEventType[] }>;
    eventCount: number;
    drainedAt: number;
}

export interface RuntimeAssetDirtyStore {
    recordFileEvent(event: RuntimeAssetWatchEvent): void;
    drainDirtyTargets(): RuntimeAssetDirtyBatch;
    requeueTargets(targets: string[]): void;
    peekDirtyTargets(limit?: number): string[];
    getDirtyTargetCount(): number;
    getEventCount(): number;
}

function isInsideOrSameRoot(filePath: string, root: string): boolean {
    const relativePath = relative(resolve(root), resolve(filePath));
    return !relativePath || (!relativePath.startsWith('..') && !isAbsolute(relativePath));
}

function toDbPath(path: string): string {
    return path.replace(/\\/g, '/').replace(/^\/+/, '');
}

function sourcePathForAssetEvent(path: string): string {
    return path.endsWith('.meta') ? path.slice(0, -'.meta'.length) : path;
}

function compareTargets(left: string, right: string): number {
    return left.localeCompare(right);
}

export function createRuntimeAssetDirtyStore(options: {
    projectRoot: string;
    now?: () => number;
}): RuntimeAssetDirtyStore {
    const now = options.now ?? Date.now;
    const assetsRoot = resolve(options.projectRoot, 'assets');
    const targets = new Map<string, Set<RuntimeAssetWatchEventType>>();
    let eventCount = 0;

    const normalizeTarget = (filePath: string): string | null => {
        const sourcePath = resolve(sourcePathForAssetEvent(filePath));
        if (!isInsideOrSameRoot(sourcePath, assetsRoot)) {
            return null;
        }

        const relativeAssetPath = toDbPath(relative(assetsRoot, sourcePath));
        return relativeAssetPath ? `db://assets/${relativeAssetPath}` : 'db://assets';
    };

    return {
        recordFileEvent(event: RuntimeAssetWatchEvent): void {
            const target = normalizeTarget(event.path);
            if (!target) {
                return;
            }

            eventCount += 1;
            const eventTypes = targets.get(target) ?? new Set<RuntimeAssetWatchEventType>();
            eventTypes.add(event.type);
            targets.set(target, eventTypes);
        },
        drainDirtyTargets(): RuntimeAssetDirtyBatch {
            const entries = Array.from(targets.entries())
                .map(([target, eventTypes]) => ({
                    target,
                    eventTypes: Array.from(eventTypes).sort() as RuntimeAssetWatchEventType[],
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
            for (const target of failedTargets) {
                if (target !== 'db://assets' && !target.startsWith('db://assets/')) {
                    continue;
                }

                const eventTypes = targets.get(target) ?? new Set<RuntimeAssetWatchEventType>();
                eventTypes.add('update');
                targets.set(target, eventTypes);
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
