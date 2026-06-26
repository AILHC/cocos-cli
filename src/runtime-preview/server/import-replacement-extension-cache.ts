import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { RuntimePreviewContext } from '../context/runtime-preview-context';

export interface ImportReplacementExtensionResolver {
    query(uuid: string): Promise<string>;
    clear(): void;
}

export interface ImportReplacementExtensionResolverOptions {
    statFile?: (absolutePath: string) => Promise<{ isFile(): boolean }>;
}

function getLookupRoots(context: RuntimePreviewContext): string[] {
    return Array.from(new Set([
        context.projectLibraryRoot,
        ...context.extensionLibraryRoots.map((entry) => entry.root),
        context.internalLibraryRoot,
    ].filter((value): value is string => Boolean(value))));
}

async function resolveImportReplacementExtension(
    context: RuntimePreviewContext,
    uuid: string,
    statFile: (absolutePath: string) => Promise<{ isFile(): boolean }>,
): Promise<string> {
    if (!/^[0-9a-fA-F-]+$/.test(uuid)) {
        return '';
    }

    for (const root of getLookupRoots(context)) {
        const bucket = join(root, uuid.slice(0, 2));
        for (const extension of ['.cconb', '.ccon']) {
            try {
                const fileStat = await statFile(join(bucket, `${uuid}${extension}`));
                if (fileStat.isFile()) {
                    return extension;
                }
            } catch {
                // Try the next import payload extension candidate.
            }
        }
    }

    return '';
}

export function createImportReplacementExtensionResolver(
    context: RuntimePreviewContext,
    options: ImportReplacementExtensionResolverOptions = {},
): ImportReplacementExtensionResolver {
    const statFile = options.statFile ?? stat;
    const cache = new Map<string, Promise<string>>();
    let generation = 0;
    return {
        query(uuid: string): Promise<string> {
            const cached = cache.get(uuid);
            if (cached) {
                return cached;
            }

            const queryGeneration = generation;
            const result = resolveImportReplacementExtension(context, uuid, statFile);
            cache.set(uuid, result);
            result.then((extension) => {
                if (queryGeneration !== generation) {
                    return;
                }
                if (!extension && cache.get(uuid) === result) {
                    cache.delete(uuid);
                }
            }, () => {
                if (queryGeneration === generation && cache.get(uuid) === result) {
                    cache.delete(uuid);
                }
            });
            return result;
        },
        clear(): void {
            generation += 1;
            cache.clear();
        },
    };
}
