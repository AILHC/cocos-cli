import { resolve } from 'node:path';
import { stat } from 'node:fs/promises';
import type { RuntimePreviewContext } from '../context/runtime-preview-context';

export interface ResolvedRuntimePreviewFile {
    absolutePath: string;
}

export interface ResolveLibraryRequestOptions {
    allowedRequestPaths?: Iterable<string>;
}

function decodePathname(requestPath: string): string | null {
    try {
        return decodeURIComponent(requestPath.split('?')[0].replace(/\\/g, '/'));
    } catch {
        return null;
    }
}

function toLibraryRouteTail(requestPath: string): string | null {
    const pathname = decodePathname(requestPath);
    if (!pathname) {
        return null;
    }

    const match = /^\/(?:assets|remote)\/[^/]+\/(?:import|native)\/(.+)$/.exec(pathname);
    if (!match) {
        return null;
    }

    const tail = match[1];
    if (!tail || tail.split('/').includes('..')) {
        return null;
    }
    return tail;
}

function normalizeAllowedRequestPath(requestPath: string): string | null {
    const pathname = decodePathname(requestPath);
    if (!pathname || pathname.split('/').includes('..')) {
        return null;
    }
    return pathname;
}

function isAllowedRequestPath(requestPath: string, allowedRequestPaths?: Iterable<string>): boolean {
    if (!allowedRequestPaths) {
        return false;
    }

    const normalizedRequestPath = normalizeAllowedRequestPath(requestPath);
    if (!normalizedRequestPath) {
        return false;
    }

    for (const allowedRequestPath of allowedRequestPaths) {
        if (normalizeAllowedRequestPath(allowedRequestPath) === normalizedRequestPath) {
            return true;
        }
    }

    return false;
}

export async function resolveLibraryRequest(
    context: RuntimePreviewContext,
    requestPath: string,
    options: ResolveLibraryRequestOptions = {},
): Promise<ResolvedRuntimePreviewFile | null> {
    if (!isAllowedRequestPath(requestPath, options.allowedRequestPaths)) {
        return null;
    }

    const routeTail = toLibraryRouteTail(requestPath);
    if (!routeTail) {
        return null;
    }

    const candidateRoots = [
        context.projectLibraryRoot,
        context.internalLibraryRoot,
    ].filter((root): root is string => Boolean(root));

    for (const root of candidateRoots) {
        const absolutePath = resolve(root, ...routeTail.split('/'));
        try {
            const fileStat = await stat(absolutePath);
            if (fileStat.isFile()) {
                return { absolutePath };
            }
        } catch {
            // Try the next fact-backed candidate root.
        }
    }

    return null;
}
