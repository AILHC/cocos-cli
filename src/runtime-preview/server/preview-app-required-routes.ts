import { readFile, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { createRequire } from 'node:module';
import type { RuntimePreviewContext } from '../context/runtime-preview-context';
import type { RuntimePreviewLogger } from '../logging/runtime-preview-logger';
import {
    serveOnDemandFile,
    textResponse,
    type RuntimePreviewHttpResponse,
} from './serve-on-demand-file';

const nodeRequire = createRequire(__filename);
const scriptingEnginePrefix = '/scripting/engine/';
const scriptingEnginePreviewBase = 'bin/.cache/dev-cli/web/';
const scriptingPolyfillsPrefix = '/scripting/polyfills/';
const engineExternalPath = '/engine_external/';
const missingAssetPrefix = '/missing-asset/';
const scenePrefix = '/scene/';
const noopSocketIoClient = `
System.register([], function (_export) {
    function createNoopSocket() {
        return {
            on() { return this; },
            emit() { return this; },
            off() { return this; },
            close() { return this; },
            disconnect() { return this; },
        };
    }

    function io() {
        return createNoopSocket();
    }

    return {
        execute() {
            _export('default', io);
            _export('io', io);
        },
    };
});
`;

interface AssetDataRecord {
    url?: string;
}

interface PreviewSceneRecord {
    uuid: string;
    url: string;
    name?: string;
    bundle?: string;
}

export interface PreviewAppRouteOptions {
    requestPath?: string;
    method?: string;
    body?: string;
    logger?: RuntimePreviewLogger;
}

async function resolveExistingFile(absolutePath: string): Promise<string | null> {
    try {
        const fileStat = await stat(absolutePath);
        if (fileStat.isFile()) {
            return absolutePath;
        }
    } catch {
        // Try the next fact-backed file candidate.
    }

    return null;
}

function isPathInsideRoot(filePath: string, root: string): boolean {
    const resolvedRoot = resolve(root);
    const resolvedFile = resolve(filePath);
    const rootRelativePath = relative(resolvedRoot, resolvedFile);
    return Boolean(rootRelativePath) && !rootRelativePath.startsWith('..') && !isAbsolute(rootRelativePath);
}

async function resolveExistingFileInside(root: string, relativePath: string): Promise<string | null> {
    const normalized = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!normalized || normalized.split('/').includes('..')) {
        return null;
    }

    const absolutePath = resolve(root, ...normalized.split('/'));
    if (!isPathInsideRoot(absolutePath, root)) {
        return null;
    }

    return resolveExistingFile(absolutePath);
}

function getPackageRoot(packageName: string): string | null {
    try {
        return join(nodeRequire.resolve(`${packageName}/package.json`), '..');
    } catch {
        return null;
    }
}

function getProjectLibraryRoots(context: RuntimePreviewContext): string[] {
    const projectLibraryRoot = resolve(context.projectRoot, 'library');
    const cliLibraryRoot = join(projectLibraryRoot, 'cli');
    const configuredLibraryRoot = resolve(context.projectLibraryRoot);
    const roots = configuredLibraryRoot === projectLibraryRoot
        ? [cliLibraryRoot, context.projectLibraryRoot]
        : [context.projectLibraryRoot, cliLibraryRoot, projectLibraryRoot];

    return Array.from(new Set(roots.filter((value): value is string => Boolean(value))));
}

async function readJsonFile<T>(absolutePath: string): Promise<T | null> {
    try {
        return JSON.parse(await readFile(absolutePath, 'utf8')) as T;
    } catch {
        return null;
    }
}

async function loadAssetData(root: string): Promise<Record<string, AssetDataRecord> | null> {
    return readJsonFile<Record<string, AssetDataRecord>>(join(root, '.assets-data.json'));
}

function sceneNameFromUrl(url: string): string | undefined {
    const name = url.split('/').pop()?.replace(/\.scene$/, '');
    return name || undefined;
}

function sceneBundleFromUrl(url: string): string | undefined {
    if (!url.startsWith('db://assets/')) {
        return undefined;
    }

    const relativeAssetPath = url.slice('db://assets/'.length);
    return relativeAssetPath.split('/')[0] || undefined;
}

async function listPreviewScenes(context: RuntimePreviewContext): Promise<PreviewSceneRecord[]> {
    for (const root of getProjectLibraryRoots(context)) {
        const assetData = await loadAssetData(root);
        if (!assetData) {
            continue;
        }

        return Object.entries(assetData)
            .filter((entry): entry is [string, AssetDataRecord & { url: string }] => typeof entry[1]?.url === 'string' && entry[1].url.endsWith('.scene'))
            .map(([uuid, record]) => ({
                uuid,
                url: record.url,
                name: sceneNameFromUrl(record.url),
                bundle: sceneBundleFromUrl(record.url),
            }))
            .sort((left, right) => left.url.localeCompare(right.url));
    }

    return [];
}

async function resolveSceneJsonFile(context: RuntimePreviewContext, uuid: string): Promise<string | null> {
    if (!/^[0-9a-fA-F-]+$/.test(uuid)) {
        return null;
    }

    for (const root of getProjectLibraryRoots(context)) {
        const assetData = await loadAssetData(root);
        if (!assetData?.[uuid]?.url?.endsWith('.scene')) {
            continue;
        }

        const file = await resolveExistingFileInside(root, `${uuid.slice(0, 2)}/${uuid}.json`);
        if (file) {
            return file;
        }
    }

    return null;
}

async function resolveScriptingEngineFile(context: RuntimePreviewContext, pathname: string): Promise<string | null> {
    if (!pathname.startsWith(scriptingEnginePrefix)) {
        return null;
    }

    const relativePath = pathname.slice(scriptingEnginePrefix.length);
    if (!relativePath.startsWith(scriptingEnginePreviewBase)) {
        return null;
    }

    return resolveExistingFileInside(context.engineRoot, relativePath);
}

async function resolvePolyfillsFile(pathname: string): Promise<string | null> {
    if (!pathname.startsWith(scriptingPolyfillsPrefix)) {
        return null;
    }

    const relativePath = pathname.slice(scriptingPolyfillsPrefix.length);
    for (const packageName of ['@cocos/build-polyfills', '@editor/build-polyfills']) {
        const packageRoot = getPackageRoot(packageName);
        if (!packageRoot) {
            continue;
        }

        const file = await resolveExistingFileInside(join(packageRoot, 'prebuilt', 'preview'), relativePath);
        if (file) {
            return file;
        }
    }

    return null;
}

async function resolveEngineExternalFile(context: RuntimePreviewContext, pathname: string, requestPath?: string): Promise<string | null | false> {
    if (pathname !== engineExternalPath) {
        return null;
    }

    const url = new URL(requestPath ?? pathname, 'http://runtime-preview.local');
    const externalUrl = url.searchParams.get('url');
    if (!externalUrl?.startsWith('external:')) {
        return false;
    }

    const externalRelativePath = externalUrl.slice('external:'.length);
    if (!externalRelativePath || externalRelativePath.split(/[\\/]/).includes('..')) {
        return false;
    }

    return resolveExistingFileInside(context.engineRoot, `native/external/${externalRelativePath}`);
}

function getSceneUuid(pathname: string): string | null {
    if (!pathname.startsWith(scenePrefix) || !pathname.endsWith('.json')) {
        return null;
    }

    const uuid = pathname.slice(scenePrefix.length, -'.json'.length);
    return uuid && /^[0-9a-fA-F-]+$/.test(uuid) ? uuid : null;
}

function getMissingAssetUuid(pathname: string): string | null {
    if (!pathname.startsWith(missingAssetPrefix)) {
        return null;
    }

    const requestId = pathname.slice(missingAssetPrefix.length);
    const uuid = requestId.split('@')[0];
    return uuid || null;
}

export async function handlePreviewAppRequiredRoute(
    context: RuntimePreviewContext,
    pathname: string,
    options: PreviewAppRouteOptions = {},
): Promise<RuntimePreviewHttpResponse | null> {
    const engineExternalFile = await resolveEngineExternalFile(context, pathname, options.requestPath);
    if (engineExternalFile === false) {
        return textResponse(400, 'Invalid runtime preview engine external request.');
    }
    if (engineExternalFile) {
        return serveOnDemandFile({ absolutePath: engineExternalFile });
    }

    const scriptingEngineFile = await resolveScriptingEngineFile(context, pathname);
    if (scriptingEngineFile) {
        return serveOnDemandFile({ absolutePath: scriptingEngineFile });
    }

    const polyfillsFile = await resolvePolyfillsFile(pathname);
    if (polyfillsFile) {
        return serveOnDemandFile({ absolutePath: polyfillsFile });
    }

    if (pathname === '/socket.io/socket.io.js') {
        return textResponse(200, noopSocketIoClient, 'application/javascript; charset=utf-8');
    }

    if (pathname === '/scene-list') {
        const scenes = await listPreviewScenes(context);
        const body = JSON.stringify({
            scenes,
            currentScene: scenes[0]?.uuid ?? '',
        });
        return textResponse(200, body, 'application/json; charset=utf-8');
    }

    const sceneUuid = getSceneUuid(pathname);
    if (sceneUuid) {
        const sceneJsonFile = await resolveSceneJsonFile(context, sceneUuid);
        if (!sceneJsonFile) {
            return textResponse(404, JSON.stringify({ error: 'Scene asset JSON not found', uuid: sceneUuid }), 'application/json; charset=utf-8');
        }

        return serveOnDemandFile({ absolutePath: sceneJsonFile });
    }

    const missingAssetUuid = getMissingAssetUuid(pathname);
    if (missingAssetUuid) {
        return textResponse(200, JSON.stringify({
            uuid: missingAssetUuid,
            missing: true,
            source: 'runtime-preview-cli',
        }), 'application/json; charset=utf-8');
    }

    if (pathname === '/preview-error') {
        const method = options.method?.toUpperCase() ?? 'GET';
        if (method === 'POST') {
            await options.logger?.write(`browser:preview-error ${options.body ?? ''}`);
        }
        return textResponse(200, JSON.stringify({ ok: true }), 'application/json; charset=utf-8');
    }

    return null;
}
