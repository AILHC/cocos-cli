import { isAbsolute, relative, resolve } from 'node:path';
import { stat } from 'node:fs/promises';
import type { RuntimePreviewContext } from '../context/runtime-preview-context';

export interface ResolvedRuntimePreviewFile {
    absolutePath: string;
}

export interface ResolveLibraryRequestOptions {
    allowedRequestPaths?: Iterable<string>;
}

function getRawUrlPathname(requestPath: string): string | null {
    if (requestPath.includes('\0')) {
        return null;
    }

    let pathname = requestPath.split('#', 1)[0].split('?', 1)[0];
    const absoluteUrlMatch = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^/]*(.*)$/.exec(pathname);
    if (absoluteUrlMatch) {
        pathname = absoluteUrlMatch[1] || '/';
    }
    if (!pathname.startsWith('/')) {
        return null;
    }
    return pathname;
}

interface LibraryRoute {
    bundleName: string;
    artifactKind: 'import' | 'native';
    tail: string;
}

function parseLibraryRoute(requestPath: string): LibraryRoute | null {
    const pathname = getRawUrlPathname(requestPath);
    if (!pathname) {
        return null;
    }

    const match = /^\/(?:assets|remote)\/([^/]+)\/(import|native)(?:\/(.*))?$/.exec(pathname);
    if (!match) {
        return null;
    }

    if (!match[3]) {
        return null;
    }

    let tail = '';
    try {
        tail = decodeURIComponent(match[3]);
    } catch {
        return null;
    }
    if (!isSafeLibraryTail(tail)) {
        return null;
    }

    return {
        bundleName: match[1],
        artifactKind: match[2] as 'import' | 'native',
        tail,
    };
}

function isSafeLibraryTail(tail: string): boolean {
    if (!tail || tail.includes('\0') || tail.includes('\\')) {
        return false;
    }
    if (isAbsolute(tail) || /^[a-zA-Z]:/.test(tail) || tail.startsWith('//')) {
        return false;
    }
    const segments = tail.split('/');
    return segments.every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

function normalizeAllowedRequestPath(requestPath: string): string | null {
    const pathname = getRawUrlPathname(requestPath);
    if (!pathname) {
        return null;
    }

    let decodedPathname = '';
    try {
        decodedPathname = decodeURIComponent(pathname);
    } catch {
        return null;
    }
    if (decodedPathname.includes('\\') || decodedPathname.split('/').includes('..')) {
        return null;
    }
    return decodedPathname;
}

function isCapturedRequestPath(requestPath: string, allowedRequestPaths: Iterable<string>): boolean {
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

function getLibraryLookupRoots(context: RuntimePreviewContext): string[] {
    return Array.from(new Set([
        context.projectLibraryRoot,
        ...context.extensionLibraryRoots.map((entry) => entry.root),
        context.internalLibraryRoot,
    ].filter((value): value is string => Boolean(value))));
}

export async function resolveLibraryRequest(
    context: RuntimePreviewContext,
    requestPath: string,
    options: ResolveLibraryRequestOptions = {},
): Promise<ResolvedRuntimePreviewFile | null> {
    const route = parseLibraryRoute(requestPath);
    if (!route) {
        return null;
    }

    if (options.allowedRequestPaths && !isCapturedRequestPath(requestPath, options.allowedRequestPaths)) {
        return null;
    }

    for (const root of getLibraryLookupRoots(context)) {
        const rootAbs = resolve(root);
        const absolutePath = resolve(rootAbs, ...route.tail.split('/'));
        const rootRelativePath = relative(rootAbs, absolutePath);
        if (rootRelativePath === '' || rootRelativePath.startsWith('..') || isAbsolute(rootRelativePath)) {
            continue;
        }
        try {
            const fileStat = await stat(absolutePath);
            if (fileStat.isFile()) {
                return { absolutePath };
            }
        } catch {
            // Try the next explicit root.
        }
    }

    return null;
}
