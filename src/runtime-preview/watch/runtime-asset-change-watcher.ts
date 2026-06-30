import { readdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import * as parcelWatcher from '@parcel/watcher';
import type { RuntimeAssetDirtyStore, RuntimeAssetWatchEvent } from './runtime-asset-dirty-store';

type ParcelEvent = { type: 'create' | 'update' | 'delete'; path: string };
type ParcelSubscription = { unsubscribe: () => Promise<void> | void };
const runtimeAssetWatchIgnoreGlobs = [
    '**/.DS_Store',
    '**/Thumbs.db',
];

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
    startupDirtyTargetCount: number;
    startupIgnoredMetaOnlyCount: number;
    startupSampleTargets: string[];
    startupIgnoredMetaOnlySample: string[];
    startupSkippedSymlinkCount: number;
    startupSkippedSymlinkSample: string[];
}

export interface RuntimeAssetStartupSnapshot {
    files: Map<string, { mtimeMs: number; size: number }>;
    skippedSymlinks?: string[];
}

export interface RuntimeAssetChangeWatcher {
    start(): Promise<void>;
    stop(): Promise<void>;
    getStatus(): RuntimeAssetWatcherStatus;
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function toSnapshotKey(input: string): string | null {
    if (!input || /^[a-zA-Z]:[\\/]/.test(input) || /^[a-zA-Z]:/.test(input) || input.startsWith('/') || input.startsWith('\\')) {
        return null;
    }
    const parts: string[] = [];
    for (const part of input.replace(/\\/g, '/').split('/')) {
        if (!part || part === '.') {
            continue;
        }
        if (part === '..') {
            return null;
        }
        parts.push(part);
    }
    return parts.length > 0 ? parts.join('/') : null;
}

function toDbAssetTarget(relativeAssetPath: string): string {
    return `db://assets/${relativeAssetPath}`;
}

function shouldIgnoreRuntimeAssetSnapshotKey(key: string): boolean {
    const fileName = key.split('/').pop();
    return fileName === '.DS_Store' || fileName === 'Thumbs.db';
}

function isChanged(
    before: { mtimeMs: number; size: number } | undefined,
    after: { mtimeMs: number; size: number } | undefined,
): boolean {
    if (!before || !after) {
        return before !== after;
    }
    return before.mtimeMs !== after.mtimeMs || before.size !== after.size;
}

async function walkSnapshotFiles(
    assetsRoot: string,
    currentRoot: string,
    files: Map<string, { mtimeMs: number; size: number }>,
    skippedSymlinks: string[],
): Promise<void> {
    let entries;
    try {
        entries = await readdir(currentRoot, { withFileTypes: true });
    } catch (error: any) {
        if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
            return;
        }
        throw error;
    }

    for (const entry of entries) {
        const absolutePath = join(currentRoot, entry.name);
        const key = toSnapshotKey(relative(assetsRoot, absolutePath));
        if (key && shouldIgnoreRuntimeAssetSnapshotKey(key)) {
            continue;
        }
        if (entry.isSymbolicLink?.()) {
            if (key) {
                skippedSymlinks.push(key);
            }
            continue;
        }
        if (entry.isDirectory()) {
            await walkSnapshotFiles(assetsRoot, absolutePath, files, skippedSymlinks);
            continue;
        }
        if (!entry.isFile()) {
            continue;
        }

        let fileStat;
        try {
            fileStat = await stat(absolutePath);
        } catch (error: any) {
            if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
                continue;
            }
            throw error;
        }
        if (key) {
            files.set(key, {
                mtimeMs: fileStat.mtimeMs,
                size: fileStat.size,
            });
        }
    }
}

export async function createRuntimeAssetStartupSnapshot(assetsRoot: string): Promise<RuntimeAssetStartupSnapshot> {
    const files = new Map<string, { mtimeMs: number; size: number }>();
    const skippedSymlinks: string[] = [];
    await walkSnapshotFiles(assetsRoot, assetsRoot, files, skippedSymlinks);
    return { files, skippedSymlinks };
}

function normalizeSnapshotFiles(
    files: Map<string, { mtimeMs: number; size: number }>,
): Map<string, { mtimeMs: number; size: number }> {
    const normalizedFiles = new Map<string, { mtimeMs: number; size: number }>();
    for (const [rawKey, value] of files.entries()) {
        const key = toSnapshotKey(rawKey);
        if (key && !shouldIgnoreRuntimeAssetSnapshotKey(key)) {
            normalizedFiles.set(key, value);
        }
    }
    return normalizedFiles;
}

function normalizeSkippedSymlinkKeys(...samples: Array<readonly string[] | undefined>): string[] {
    const keys = new Set<string>();
    for (const sample of samples) {
        for (const rawKey of sample ?? []) {
            const key = toSnapshotKey(rawKey);
            if (key) {
                keys.add(key);
            }
        }
    }
    return Array.from(keys).sort((left, right) => left.localeCompare(right));
}

export function createRuntimeAssetChangeWatcher(options: {
    projectRoot: string;
    dirtyStore: RuntimeAssetDirtyStore;
    subscribe?: Subscribe;
    startupSnapshot?: RuntimeAssetStartupSnapshot;
    snapshotFiles?: (assetsRoot: string) => Promise<RuntimeAssetStartupSnapshot>;
    failSoft?: boolean;
    logger?: { write: (line: string) => Promise<void> | void };
}): RuntimeAssetChangeWatcher {
    const assetsRoot = join(options.projectRoot, 'assets');
    const subscribe = options.subscribe ?? parcelWatcher.subscribe;
    const failSoft = options.failSoft ?? true;
    let subscription: ParcelSubscription | null = null;
    let error: string | undefined;
    let startupDirtyTargetCount = 0;
    let startupIgnoredMetaOnlyCount = 0;
    let startupSampleTargets: string[] = [];
    let startupIgnoredMetaOnlySample: string[] = [];
    let startupSkippedSymlinkCount = 0;
    let startupSkippedSymlinkSample: string[] = [];

    const writeLog = async (line: string): Promise<void> => {
        await options.logger?.write(`runtime-asset-watch ${line}`);
    };

    const applyStartupBaselineDiff = async (): Promise<void> => {
        if (!options.startupSnapshot || !options.snapshotFiles) {
            return;
        }

        const afterSnapshot = await options.snapshotFiles(assetsRoot);
        const beforeFiles = normalizeSnapshotFiles(options.startupSnapshot.files);
        const afterFiles = normalizeSnapshotFiles(afterSnapshot.files);
        const sourceDiffs = new Map<string, 'update' | 'delete'>();
        const metaDiffs: string[] = [];
        const keys = new Set<string>();

        for (const key of beforeFiles.keys()) {
            keys.add(key);
        }
        for (const key of afterFiles.keys()) {
            keys.add(key);
        }

        for (const key of keys) {
            const before = beforeFiles.get(key);
            const after = afterFiles.get(key);
            if (!isChanged(before, after)) {
                continue;
            }
            if (key.endsWith('.meta')) {
                metaDiffs.push(key);
            } else {
                sourceDiffs.set(key, after ? 'update' : 'delete');
            }
        }

        const targets = Array.from(sourceDiffs.entries())
            .sort(([left], [right]) => left.localeCompare(right));
        for (const [sourceKey, eventType] of targets) {
            options.dirtyStore.recordDirtyTarget({
                target: toDbAssetTarget(sourceKey),
                eventType,
                assetEventCount: 1,
                metaEventCount: 0,
            });
        }

        startupDirtyTargetCount = targets.length;
        startupIgnoredMetaOnlyCount = metaDiffs.length;
        startupSampleTargets = targets
            .map(([sourceKey]) => toDbAssetTarget(sourceKey))
            .slice(0, 5);
        startupIgnoredMetaOnlySample = metaDiffs
            .sort((left, right) => left.localeCompare(right))
            .slice(0, 5);
        const skippedSymlinkKeys = normalizeSkippedSymlinkKeys(
            options.startupSnapshot.skippedSymlinks,
            afterSnapshot.skippedSymlinks,
        );
        startupSkippedSymlinkCount = skippedSymlinkKeys.length;
        startupSkippedSymlinkSample = skippedSymlinkKeys.slice(0, 5);

        await writeLog([
            `startup-baseline dirtyTargets=${startupDirtyTargetCount}`,
            `ignoredMetaOnly=${startupIgnoredMetaOnlyCount}`,
            `skippedSymlinks=${startupSkippedSymlinkCount}`,
            `sample=${startupSampleTargets.join(',')}`,
            `ignoredSample=${startupIgnoredMetaOnlySample.join(',')}`,
            `skippedSymlinkSample=${startupSkippedSymlinkSample.join(',')}`,
        ].join(' '));
    };

    const getStatus = (): RuntimeAssetWatcherStatus => ({
        enabled: true,
        running: !!subscription && !error,
        assetsRoot,
        error,
        eventCount: options.dirtyStore.getEventCount(),
        dirtyTargetCount: options.dirtyStore.getDirtyTargetCount(),
        sampleTargets: options.dirtyStore.peekDirtyTargets(5),
        startupDirtyTargetCount,
        startupIgnoredMetaOnlyCount,
        startupSampleTargets,
        startupIgnoredMetaOnlySample,
        startupSkippedSymlinkCount,
        startupSkippedSymlinkSample,
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
                            ...runtimeAssetWatchIgnoreGlobs,
                        ],
                    },
                );
                await applyStartupBaselineDiff();
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
