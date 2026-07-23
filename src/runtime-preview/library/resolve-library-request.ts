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
    isRoot: boolean;
    tail: string;
}

const canonicalUuidPattern = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const canonicalArtifactUuidPattern = `${canonicalUuidPattern}(?:@[0-9a-f]+)*`;
const rootLibraryArtifactPattern = new RegExp(
    `^([0-9a-f]{2})/(${canonicalArtifactUuidPattern})(?:\\.[0-9a-f]+)?\\.[a-z0-9]+$`,
    'i',
);
const rootLibraryTtfPattern = new RegExp(
    `^([0-9a-f]{2})/(${canonicalArtifactUuidPattern})(?:\\.[0-9a-f]+)?/[^/]+\\.ttf$`,
    'i',
);

function isCanonicalRootLibraryTail(tail: string): boolean {
    const match = rootLibraryArtifactPattern.exec(tail) ?? rootLibraryTtfPattern.exec(tail);
    return Boolean(match && match[1].toLowerCase() === match[2].slice(0, 2).toLowerCase());
}

function parseLibraryRoute(requestPath: string): LibraryRoute | null {
    const pathname = getRawUrlPathname(requestPath);
    if (!pathname) {
        return null;
    }

    const namespacedMatch = /^\/(?:assets|remote)\/[^/]+\/(?:import|native)(?:\/(.*))?$/.exec(pathname);
    const rootTail = pathname.slice(1);
    const encodedTail = namespacedMatch?.[1] ?? rootTail;
    if (!encodedTail) {
        return null;
    }

    let tail = '';
    try {
        tail = decodeURIComponent(encodedTail);
    } catch {
        return null;
    }
    if (!isSafeLibraryTail(tail)) {
        return null;
    }
    if (!namespacedMatch && !isCanonicalRootLibraryTail(tail)) {
        return null;
    }

    return {
        isRoot: !namespacedMatch,
        tail,
    };
}

export function isCanonicalRootLibraryRequest(requestPath: string): boolean {
    return parseLibraryRoute(requestPath)?.isRoot === true;
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
