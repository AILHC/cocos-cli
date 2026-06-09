import { join, resolve } from 'node:path';
import { readFile, stat } from 'node:fs/promises';
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

interface AssetDataRecord {
    url?: string;
    value?: {
        depends?: unknown;
    };
}

const assetDataCache = new Map<string, Promise<Record<string, AssetDataRecord> | null>>();
const assetProofCache = new Map<string, Promise<Set<string>>>();

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

    const match = /^([0-9a-fA-F-]{32,36}(?:@[0-9a-fA-F]+)?)(?:\.(?:json|ccon|cconb))?$/.exec(fileName);
    return match?.[1] ?? null;
}

function getUuidFromNativeTail(tail: string): string | null {
    const segments = tail.split('/');
    const fileName = segments.at(-1);
    if (!fileName) {
        return null;
    }

    const match = /^([0-9a-fA-F-]{32,36}(?:@[0-9a-fA-F]+)?)\.(?:png|jpg|jpeg)$/i.exec(fileName);
    if (match?.[1]) {
        return match[1];
    }

    const uuidSegment = segments.find((segment) => /^[0-9a-fA-F-]{32,36}(?:@[0-9a-fA-F]+)?$/.test(segment));
    if (uuidSegment) {
        return uuidSegment;
    }

    return null;
}

function getMetadataRoots(context: RuntimePreviewContext): string[] {
    return Array.from(new Set([
        context.projectLibraryRoot,
        join(context.projectRoot, 'library', 'cli'),
        join(context.projectRoot, 'library'),
        context.internalLibraryRoot,
    ].filter((value): value is string => Boolean(value))));
}

async function readAssetDataFile(filePath: string): Promise<Record<string, AssetDataRecord> | null> {
    let cached = assetDataCache.get(filePath);
    if (!cached) {
        cached = readFile(filePath, 'utf8')
            .then((source) => JSON.parse(source) as Record<string, AssetDataRecord>)
            .catch(() => null);
        assetDataCache.set(filePath, cached);
    }
    return cached;
}

async function loadRootAssetData(root: string): Promise<Record<string, AssetDataRecord> | null> {
    return await readAssetDataFile(join(root, '.assets-data.json'))
        ?? await readAssetDataFile(join(root, '.internal-data.json'));
}

function buildAssetProofSet(assetData: Record<string, AssetDataRecord> | null): Set<string> {
    const proofSet = new Set<string>();
    if (!assetData) {
        return proofSet;
    }

    for (const [uuid, record] of Object.entries(assetData)) {
        if (record?.url) {
            proofSet.add(uuid);
        }

        const depends = record.value?.depends;
        if (Array.isArray(depends)) {
            depends.forEach((dependency) => {
                if (typeof dependency === 'string') {
                    proofSet.add(dependency);
                }
            });
        }
    }

    return proofSet;
}

async function loadRootAssetProofSet(root: string): Promise<Set<string>> {
    let cached = assetProofCache.get(root);
    if (!cached) {
        cached = loadRootAssetData(root).then(buildAssetProofSet);
        assetProofCache.set(root, cached);
    }

    return cached;
}

async function isAssetDataBackedGeneralRequest(context: RuntimePreviewContext, route: LibraryRoute): Promise<boolean> {
    if (route.bundleName !== 'general') {
        return false;
    }

    const uuid = route.artifactKind === 'import'
        ? getUuidFromImportTail(route.tail)
        : getUuidFromNativeTail(route.tail);
    if (!uuid) {
        return false;
    }

    for (const root of getMetadataRoots(context)) {
        const proofSet = await loadRootAssetProofSet(root);
        if (proofSet.has(uuid)) {
            return true;
        }
    }

    return false;
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

async function isAllowedRequestPath(context: RuntimePreviewContext, requestPath: string, options: ResolveLibraryRequestOptions): Promise<boolean> {
    const route = parseLibraryRoute(requestPath);
    if (!route) {
        return false;
    }

    const { allowedRequestPaths } = options;
    if (!allowedRequestPaths) {
        return isBundleConfigBackedRequest(route, options.bundleConfigs)
            || await isAssetDataBackedGeneralRequest(context, route);
    }

    return isCapturedRequestPath(requestPath, allowedRequestPaths);
}

export async function resolveLibraryRequest(
    context: RuntimePreviewContext,
    requestPath: string,
    options: ResolveLibraryRequestOptions = {},
): Promise<ResolvedRuntimePreviewFile | null> {
    if (!await isAllowedRequestPath(context, requestPath, options)) {
        return null;
    }

    const route = parseLibraryRoute(requestPath);
    if (!route) {
        return null;
    }

    const candidateRoots = [
        context.projectLibraryRoot,
        join(context.projectRoot, 'library', 'cli'),
        join(context.projectRoot, 'library'),
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
