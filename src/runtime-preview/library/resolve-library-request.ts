import { resolve } from 'node:path';
import { stat } from 'node:fs/promises';
import type { RuntimePreviewContext } from '../context/runtime-preview-context';

export interface ResolvedRuntimePreviewFile {
    absolutePath: string;
}

export interface ResolveLibraryRequestOptions {
    allowedRequestPaths?: Iterable<string>;
    bundleConfigs?: Array<Record<string, any>>;
}

function decodePathname(requestPath: string): string | null {
    try {
        return decodeURIComponent(requestPath.split('?')[0].replace(/\\/g, '/'));
    } catch {
        return null;
    }
}

interface LibraryRoute {
    bundleName: string;
    artifactKind: 'import' | 'native';
    tail: string;
}

function parseLibraryRoute(requestPath: string): LibraryRoute | null {
    const pathname = decodePathname(requestPath);
    if (!pathname) {
        return null;
    }

    const match = /^\/(?:assets|remote)\/([^/]+)\/(import|native)\/(.+)$/.exec(pathname);
    if (!match) {
        return null;
    }

    const tail = match[3];
    if (!tail || tail.split('/').includes('..')) {
        return null;
    }
    return {
        bundleName: match[1],
        artifactKind: match[2] as 'import' | 'native',
        tail,
    };
}

function normalizeAllowedRequestPath(requestPath: string): string | null {
    const pathname = decodePathname(requestPath);
    if (!pathname || pathname.split('/').includes('..')) {
        return null;
    }
    return pathname;
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

function getUuidFromImportTail(tail: string): string | null {
    const fileName = tail.split('/').pop();
    if (!fileName) {
        return null;
    }

    const match = /^([0-9a-fA-F-]{32,36})(?:\.(?:json|ccon|cconb))?$/.exec(fileName);
    return match?.[1] ?? null;
}

function getUuidFromNativeTail(tail: string): string | null {
    const segments = tail.split('/');
    const fileName = segments.at(-1);
    if (!fileName) {
        return null;
    }

    const match = /^([0-9a-fA-F-]{32,36})\.(?:png|jpg|jpeg)$/i.exec(fileName);
    if (match?.[1]) {
        return match[1];
    }

    const uuidSegment = segments.find((segment) => /^[0-9a-fA-F-]{32,36}$/.test(segment));
    if (uuidSegment) {
        return uuidSegment;
    }

    return null;
}

function isBundleConfigBackedRequest(route: LibraryRoute, bundleConfigs?: Array<Record<string, any>>): boolean {
    if (!bundleConfigs) {
        return false;
    }

    const routeUuid = route.artifactKind === 'import'
        ? getUuidFromImportTail(route.tail)
        : getUuidFromNativeTail(route.tail);
    const previewAppGeneralBundleConfig = route.bundleName === 'general'
        ? bundleConfigs.find((config) => Boolean(
            ['resources', 'internal'].includes(config.name)
            && routeUuid
            && config.paths
            && Object.prototype.hasOwnProperty.call(config.paths, routeUuid),
        ))
        : undefined;
    const bundleConfig = bundleConfigs.find((config) => config.name === route.bundleName)
        ?? previewAppGeneralBundleConfig;
    if (!bundleConfig) {
        return false;
    }

    if (route.artifactKind === 'import') {
        if (typeof bundleConfig.importBase === 'string' && !['', 'import'].includes(bundleConfig.importBase)) {
            return false;
        }

        const uuid = getUuidFromImportTail(route.tail);
        if (!uuid) {
            return false;
        }

        return Boolean(bundleConfig.paths && Object.prototype.hasOwnProperty.call(bundleConfig.paths, uuid));
    }

    if (route.artifactKind === 'native') {
        if (typeof bundleConfig.nativeBase === 'string' && !['', 'native'].includes(bundleConfig.nativeBase)) {
            return false;
        }

        const uuid = getUuidFromNativeTail(route.tail);
        if (!uuid) {
            return false;
        }

        return Boolean(bundleConfig.paths && Object.prototype.hasOwnProperty.call(bundleConfig.paths, uuid));
    }

    return false;
}

function isAllowedRequestPath(requestPath: string, options: ResolveLibraryRequestOptions): boolean {
    const route = parseLibraryRoute(requestPath);
    if (!route) {
        return false;
    }

    const { allowedRequestPaths } = options;
    if (!allowedRequestPaths) {
        return isBundleConfigBackedRequest(route, options.bundleConfigs);
    }

    return isCapturedRequestPath(requestPath, allowedRequestPaths);
}

export async function resolveLibraryRequest(
    context: RuntimePreviewContext,
    requestPath: string,
    options: ResolveLibraryRequestOptions = {},
): Promise<ResolvedRuntimePreviewFile | null> {
    if (!isAllowedRequestPath(requestPath, options)) {
        return null;
    }

    const route = parseLibraryRoute(requestPath);
    if (!route) {
        return null;
    }

    const candidateRoots = [
        context.projectLibraryRoot,
        context.internalLibraryRoot,
    ].filter((root): root is string => Boolean(root));

    for (const root of candidateRoots) {
        const absolutePath = resolve(root, ...route.tail.split('/'));
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
