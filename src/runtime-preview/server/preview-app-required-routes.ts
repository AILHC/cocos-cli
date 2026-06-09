import { stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { createRequire } from 'node:module';
import type { RuntimePreviewContext } from '../context/runtime-preview-context';
import type { RuntimePreviewLogger } from '../logging/runtime-preview-logger';
import {
    serveOnDemandFile,
    textResponse,
    type RuntimePreviewHttpResponse,
} from './serve-on-demand-file';
import {
    getRequestedScene,
    listPreviewScenes,
    resolveRuntimePreviewStartScene,
    resolveSceneJsonFile,
} from './preview-scenes';

const nodeRequire = createRequire(__filename);
const scriptingEnginePrefix = '/scripting/engine/';
const scriptingEnginePreviewBase = 'bin/.cache/dev-cli/web/';
const scriptingPolyfillsPrefix = '/scripting/polyfills/';
const engineExternalPath = '/engine_external/';
const missingAssetPrefix = '/missing-asset/';
const scenePrefix = '/scene/';
const effectSettingsPath = '/src/effect.bin';
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

async function resolveEffectSettingsFile(context: RuntimePreviewContext, pathname: string): Promise<string | null> {
    if (pathname !== effectSettingsPath) {
        return null;
    }

    return resolveExistingFileInside(context.projectRoot, 'temp/asset-db/effect/effect.bin');
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

    const effectSettingsFile = await resolveEffectSettingsFile(context, pathname);
    if (effectSettingsFile) {
        return serveOnDemandFile({ absolutePath: effectSettingsFile });
    }

    if (pathname === '/socket.io/socket.io.js') {
        return textResponse(200, noopSocketIoClient, 'application/javascript; charset=utf-8');
    }

    if (pathname === '/scene-list') {
        const scenes = await listPreviewScenes(context);
        const currentScene = await resolveRuntimePreviewStartScene(context, getRequestedScene(options.requestPath), context.scene);
        const body = JSON.stringify({
            scenes,
            currentScene,
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
