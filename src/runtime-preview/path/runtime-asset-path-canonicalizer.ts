import { existsSync as nodeExistsSync, realpathSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, relative, resolve } from 'node:path';

export interface RuntimeAssetPathCanonicalizerFs {
    existsSync(path: string): boolean;
    realpathSyncNative(path: string): string;
}

export type RuntimeAssetPathCanonicalizeReason = 'watch-event' | 'dirty-target' | 'refresh-target';

export interface RuntimeAssetPathCanonicalizeLogEntry {
    input: string;
    target: string;
    reason: RuntimeAssetPathCanonicalizeReason;
}

export interface RuntimeAssetFileEventTarget {
    target: string;
    isMetaEvent: boolean;
}

export type RuntimeAssetTargetNormalizeResult =
    | { ok: true; originalTarget: string; canonicalTarget: string; changed: boolean }
    | {
        ok: false;
        originalTarget: unknown;
        reason: 'non-string' | 'dot-segment' | 'outside-assets-root' | 'invalid-target';
        message: string;
    };

export interface RuntimeAssetPathCanonicalizer {
    fileEventPathToDbTarget(filePath: string): string | null;
    fileEventPathToDbTargetInfo(filePath: string): RuntimeAssetFileEventTarget | null;
    refreshTargetToDbTarget(
        target: unknown,
        reason?: RuntimeAssetPathCanonicalizeReason,
    ): RuntimeAssetTargetNormalizeResult;
}

const dbAssetsRoot = 'db://assets';
const dbAssetsPrefix = `${dbAssetsRoot}/`;
const metaSuffix = '.meta';

function toDbPath(path: string): string {
    return path.replace(/\\/g, '/').replace(/^\/+/, '');
}

function sourcePathForAssetEvent(path: string): string {
    return path.endsWith(metaSuffix) ? path.slice(0, -metaSuffix.length) : path;
}

function sourcePathInfoForAssetEvent(path: string): { sourcePath: string; isMetaEvent: boolean } {
    if (path.endsWith(metaSuffix)) {
        return { sourcePath: path.slice(0, -metaSuffix.length), isMetaEvent: true };
    }
    if (path.endsWith('.MET') && isLikelyShortAliasSegment(basename(path))) {
        return { sourcePath: path.slice(0, -'.MET'.length), isMetaEvent: true };
    }
    return { sourcePath: path, isMetaEvent: false };
}

function isInsideOrSameRoot(filePath: string, root: string): boolean {
    const relativePath = relative(resolve(root), resolve(filePath));
    return !relativePath || (!relativePath.startsWith('..') && !isAbsolute(relativePath));
}

function hasDotSegment(relativeDbPath: string): boolean {
    return relativeDbPath.split('/').some((segment) => segment === '.' || segment === '..');
}

function isLikelyShortAliasSegment(segment: string): boolean {
    return /~\d/i.test(segment);
}

function pathHasLikelyShortAliasSegment(path: string): boolean {
    return path.split(/[\\/]+/).some(isLikelyShortAliasSegment);
}

function createDefaultFs(): RuntimeAssetPathCanonicalizerFs {
    return {
        existsSync: nodeExistsSync,
        realpathSyncNative: (path) => realpathSync.native(path),
    };
}

export function createRuntimeAssetPathCanonicalizer(options: {
    projectRoot: string;
    fs?: RuntimeAssetPathCanonicalizerFs;
    onCanonicalize?: (entry: RuntimeAssetPathCanonicalizeLogEntry) => void;
}): RuntimeAssetPathCanonicalizer {
    const fs = options.fs ?? createDefaultFs();
    const rawAssetsRoot = resolve(options.projectRoot, 'assets');
    const directoryRealpathCache = new Map<string, string>();
    const missingDirectoryCache = new Map<string, string | null>();

    const tryExists = (path: string): boolean => {
        try {
            return fs.existsSync(path);
        } catch {
            return false;
        }
    };

    const tryRealpath = (path: string): string | null => {
        try {
            return resolve(fs.realpathSyncNative(path));
        } catch {
            return null;
        }
    };

    const canonicalizeDirectory = (directoryPath: string): string | null => {
        const absoluteDirectory = resolve(directoryPath);
        const cached = directoryRealpathCache.get(absoluteDirectory);
        if (cached) {
            if ((pathHasLikelyShortAliasSegment(absoluteDirectory) || cached !== absoluteDirectory) && tryExists(absoluteDirectory)) {
                const realpath = tryRealpath(absoluteDirectory) ?? absoluteDirectory;
                directoryRealpathCache.set(absoluteDirectory, realpath);
                return realpath;
            }
            return cached;
        }
        if (missingDirectoryCache.has(absoluteDirectory)) {
            if (pathHasLikelyShortAliasSegment(absoluteDirectory) && tryExists(absoluteDirectory)) {
                missingDirectoryCache.delete(absoluteDirectory);
                const realpath = tryRealpath(absoluteDirectory) ?? absoluteDirectory;
                directoryRealpathCache.set(absoluteDirectory, realpath);
                return realpath;
            }
            return missingDirectoryCache.get(absoluteDirectory) ?? null;
        }

        if (tryExists(absoluteDirectory)) {
            const realpath = tryRealpath(absoluteDirectory) ?? absoluteDirectory;
            directoryRealpathCache.set(absoluteDirectory, realpath);
            return realpath;
        }

        const parent = dirname(absoluteDirectory);
        if (parent === absoluteDirectory) {
            missingDirectoryCache.set(absoluteDirectory, null);
            return null;
        }

        const canonicalParent = canonicalizeDirectory(parent);
        const canonicalDirectory = canonicalParent
            ? resolve(canonicalParent, relative(parent, absoluteDirectory))
            : null;
        if (!pathHasLikelyShortAliasSegment(absoluteDirectory)) {
            missingDirectoryCache.set(absoluteDirectory, canonicalDirectory);
        }
        return canonicalDirectory;
    };

    const canonicalAssetsRoot = canonicalizeDirectory(rawAssetsRoot) ?? rawAssetsRoot;

    const canonicalizeAbsolutePath = (inputPath: string): string => {
        const absolutePath = resolve(inputPath);
        const parent = dirname(absolutePath);
        const canonicalParent = parent === absolutePath ? null : canonicalizeDirectory(parent);
        const parentBasedPath = canonicalParent
            ? resolve(canonicalParent, relative(parent, absolutePath))
            : absolutePath;

        const baseName = basename(absolutePath);
        const shouldTryExactRealpath = tryExists(absolutePath)
            && (baseName.includes('~') || extname(baseName) === '');
        if (shouldTryExactRealpath) {
            const realpath = tryRealpath(absolutePath);
            if (realpath) {
                return realpath;
            }
        }

        return parentBasedPath;
    };

    const dbTargetFromCanonicalPath = (canonicalPath: string): string | null => {
        if (!isInsideOrSameRoot(canonicalPath, canonicalAssetsRoot)) {
            return null;
        }

        const relativeAssetPath = toDbPath(relative(canonicalAssetsRoot, canonicalPath));
        return relativeAssetPath ? `${dbAssetsRoot}/${relativeAssetPath}` : dbAssetsRoot;
    };

    const dbTargetFromAbsolutePath = (inputPath: string): string | null => (
        dbTargetFromCanonicalPath(canonicalizeAbsolutePath(inputPath))
    );

    const dbSourceTargetFromAbsolutePath = (inputPath: string): string | null => {
        const canonicalPath = canonicalizeAbsolutePath(inputPath);
        const canonicalSource = sourcePathInfoForAssetEvent(canonicalPath);
        const recanonicalizedSourcePath = canonicalizeAbsolutePath(canonicalSource.sourcePath);
        const sourceLeaf = basename(recanonicalizedSourcePath);
        const targetSourcePath = !tryExists(recanonicalizedSourcePath) && isLikelyShortAliasSegment(sourceLeaf)
            ? dirname(recanonicalizedSourcePath)
            : recanonicalizedSourcePath;
        return dbTargetFromCanonicalPath(targetSourcePath);
    };

    const rawDbTargetFromAbsolutePath = (inputPath: string): string | null => {
        const absolutePath = resolve(inputPath);
        if (!isInsideOrSameRoot(absolutePath, rawAssetsRoot)) {
            return null;
        }

        const relativeAssetPath = toDbPath(relative(rawAssetsRoot, absolutePath));
        return relativeAssetPath ? `${dbAssetsRoot}/${relativeAssetPath}` : dbAssetsRoot;
    };

    const emitCanonicalizeLog = (
        input: string,
        target: string,
        reason: RuntimeAssetPathCanonicalizeReason,
    ): void => {
        options.onCanonicalize?.({ input, target, reason });
    };

    return {
        fileEventPathToDbTarget(filePath: string): string | null {
            return this.fileEventPathToDbTargetInfo(filePath)?.target ?? null;
        },

        fileEventPathToDbTargetInfo(filePath: string): RuntimeAssetFileEventTarget | null {
            const rawEventPath = resolve(filePath);
            const canonicalEventPath = canonicalizeAbsolutePath(rawEventPath);
            const canonicalSource = sourcePathInfoForAssetEvent(canonicalEventPath);
            const target = dbSourceTargetFromAbsolutePath(canonicalEventPath);
            const rawSourcePath = resolve(sourcePathForAssetEvent(filePath));
            const rawTarget = rawDbTargetFromAbsolutePath(rawSourcePath);
            if (target && rawTarget && target !== rawTarget) {
                emitCanonicalizeLog(filePath, target, 'watch-event');
            }
            return target ? { target, isMetaEvent: canonicalSource.isMetaEvent } : null;
        },

        refreshTargetToDbTarget(
            target: unknown,
            reason: RuntimeAssetPathCanonicalizeReason = 'refresh-target',
        ): RuntimeAssetTargetNormalizeResult {
            if (target === undefined || target === '') {
                return {
                    ok: true,
                    originalTarget: '',
                    canonicalTarget: dbAssetsRoot,
                    changed: false,
                };
            }

            if (typeof target !== 'string') {
                return {
                    ok: false,
                    originalTarget: target,
                    reason: 'non-string',
                    message: 'Runtime refresh target must be a string or undefined.',
                };
            }

            const trimmedTarget = target.trim();
            if (!trimmedTarget) {
                return {
                    ok: true,
                    originalTarget: target,
                    canonicalTarget: dbAssetsRoot,
                    changed: target !== dbAssetsRoot,
                };
            }

            if (trimmedTarget === dbAssetsRoot || trimmedTarget.startsWith(dbAssetsPrefix)) {
                if (trimmedTarget === dbAssetsRoot) {
                    return {
                        ok: true,
                        originalTarget: target,
                        canonicalTarget: dbAssetsRoot,
                        changed: target !== dbAssetsRoot,
                    };
                }

                const relativeDbPath = trimmedTarget.slice(dbAssetsPrefix.length);
                if (hasDotSegment(relativeDbPath)) {
                    return {
                        ok: false,
                        originalTarget: target,
                        reason: 'dot-segment',
                        message: `Runtime refresh target must not contain dot segments: ${trimmedTarget}`,
                    };
                }

                const absolutePath = resolve(rawAssetsRoot, ...relativeDbPath.split('/').filter(Boolean));
                const canonicalTarget = dbSourceTargetFromAbsolutePath(absolutePath);
                if (!canonicalTarget) {
                    return {
                        ok: false,
                        originalTarget: target,
                        reason: 'outside-assets-root',
                        message: `Runtime refresh target is outside project assets root: ${trimmedTarget}`,
                    };
                }

                const changed = canonicalTarget !== trimmedTarget;
                if (changed) {
                    emitCanonicalizeLog(trimmedTarget, canonicalTarget, reason);
                }
                return {
                    ok: true,
                    originalTarget: target,
                    canonicalTarget,
                    changed,
                };
            }

            if (!isAbsolute(trimmedTarget)) {
                return {
                    ok: false,
                    originalTarget: target,
                    reason: 'invalid-target',
                    message: `Runtime refresh target is not under db://assets: ${trimmedTarget}`,
                };
            }

            const canonicalTarget = dbSourceTargetFromAbsolutePath(trimmedTarget);
            if (!canonicalTarget) {
                return {
                    ok: false,
                    originalTarget: target,
                    reason: 'outside-assets-root',
                    message: `Runtime refresh target is outside project assets root: ${trimmedTarget}`,
                };
            }

            const rawTarget = rawDbTargetFromAbsolutePath(trimmedTarget);
            if (rawTarget && canonicalTarget !== rawTarget) {
                emitCanonicalizeLog(trimmedTarget, canonicalTarget, reason);
            }
            return {
                ok: true,
                originalTarget: target,
                canonicalTarget,
                changed: true,
            };
        },
    };
}
