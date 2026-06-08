import { isAbsolute, join, relative, resolve } from 'node:path';
import { stat } from 'node:fs/promises';
import type { RuntimePreviewContext } from '../context/runtime-preview-context';
import { resolveLibraryRequest } from '../library/resolve-library-request';
import type { RuntimePreviewLogger } from '../logging/runtime-preview-logger';
import {
    createRuntimePreviewGlobalImportMap,
    resolveProgrammingRequest,
} from '../programming/resolve-programming-request';
import type { PreviewSettingsProvider } from '../settings/preview-settings-provider';
import {
    serveOnDemandFile,
    textResponse,
    type RuntimePreviewHttpResponse,
} from './serve-on-demand-file';

export interface RuntimePreviewRouteContext {
    runtimeContext: RuntimePreviewContext;
    settingsProvider: PreviewSettingsProvider;
    capturedRuntimeUrls?: Array<{ url: string }>;
    logger?: RuntimePreviewLogger;
}

function decodePathname(requestPath: string): string | null {
    try {
        return decodeURIComponent(requestPath.split('?')[0].replace(/\\/g, '/'));
    } catch {
        return null;
    }
}

function getBundleNameFromConfigRoute(pathname: string): string | null {
    const match = /^\/(?:assets|remote)\/([^/]+)\/config(?:\.[^/.]+)?\.json$/.exec(pathname);
    return match?.[1] ?? null;
}

function getBundleNameFromIndexRoute(pathname: string): string | null {
    const match = /^\/(?:assets|remote)\/([^/]+)\/index(?:\.[^/.]+)?\.js$/.exec(pathname);
    return match?.[1] ?? null;
}

function getQueryExtnameUuid(pathname: string): string | null {
    const match = /^\/query-extname\/([^/]+)$/.exec(pathname);
    return match?.[1] ?? null;
}

async function queryImportReplacementExtension(context: RuntimePreviewContext, uuid: string): Promise<string> {
    if (!/^[0-9a-fA-F-]+$/.test(uuid)) {
        return '';
    }

    for (const root of [context.projectLibraryRoot, context.internalLibraryRoot].filter((value): value is string => Boolean(value))) {
        const bucket = join(root, uuid.slice(0, 2));
        for (const extension of ['.cconb', '.ccon']) {
            try {
                const fileStat = await stat(join(bucket, `${uuid}${extension}`));
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

function createDummyBundleIndexScript(bundleName: string): string {
    return `/* Runtime preview dummy bundle index for ${bundleName}. */`;
}

async function resolveExistingFile(absolutePath: string): Promise<string | null> {
    try {
        const fileStat = await stat(absolutePath);
        if (fileStat.isFile()) {
            return absolutePath;
        }
    } catch {
        return null;
    }

    return null;
}

function isPathInsideRoot(filePath: string, root: string): boolean {
    const resolvedRoot = resolve(root);
    const resolvedFile = resolve(filePath);
    const rootRelativePath = relative(resolvedRoot, resolvedFile);
    return Boolean(rootRelativePath) && !rootRelativePath.startsWith('..') && !isAbsolute(rootRelativePath);
}

function getPluginScriptAllowedRoots(context: RuntimePreviewContext): string[] {
    return Array.from(new Set([
        context.cliProgrammingRoot,
        context.projectProgrammingRoot,
        context.projectLibraryRoot,
        join(context.projectRoot, 'temp', 'cli', 'programming'),
        join(context.projectRoot, 'temp', 'programming'),
        join(context.projectRoot, 'library'),
    ].filter((value): value is string => Boolean(value))));
}

function getPluginScriptRequestPath(pathname: string): string | null {
    const prefix = '/plugins/';
    if (!pathname.startsWith(prefix)) {
        return null;
    }

    const scriptPath = pathname.slice(prefix.length);
    if (!scriptPath || scriptPath.split('/').includes('..')) {
        return null;
    }

    return scriptPath;
}

async function resolvePluginScriptLibraryFile(
    context: RuntimePreviewContext,
    scriptLibraryPath: string,
): Promise<string | null> {
    const normalized = scriptLibraryPath.replace(/\\/g, '/');
    if (!normalized || normalized.split('/').includes('..')) {
        return null;
    }
    if (!normalized.endsWith('.js')) {
        return null;
    }

    if (isAbsolute(scriptLibraryPath)) {
        const allowedRoots = getPluginScriptAllowedRoots(context);
        if (!allowedRoots.some((root) => isPathInsideRoot(scriptLibraryPath, root))) {
            return null;
        }

        return resolveExistingFile(scriptLibraryPath);
    }

    const programmingRoots = [context.cliProgrammingRoot, context.projectProgrammingRoot].filter((value): value is string => Boolean(value));
    const candidates = [
        ...programmingRoots.map((root) => resolve(root, 'packer-driver', 'targets', 'editor', 'chunks', ...normalized.split('/'))),
        ...programmingRoots.map((root) => resolve(root, 'packer-driver', 'targets', 'editor', ...normalized.split('/'))),
        resolve(context.projectLibraryRoot, ...normalized.split('/')),
    ];

    for (const candidate of candidates) {
        const resolved = await resolveExistingFile(candidate);
        if (resolved) {
            return resolved;
        }
    }

    return null;
}

export async function handleRuntimePreviewRequest(
    context: RuntimePreviewRouteContext,
    requestPath: string,
): Promise<RuntimePreviewHttpResponse> {
    const pathname = decodePathname(requestPath);
    if (!pathname || pathname.split('/').includes('..')) {
        return textResponse(400, `Invalid runtime preview request: ${requestPath}`);
    }

    if (pathname === '/settings.js') {
        const startedAt = Date.now();
        await context.logger?.write('settings:generation:start');
        let settings;
        try {
            settings = await context.settingsProvider.getPreviewSettings();
        } catch (error) {
            const durationMs = Date.now() - startedAt;
            const errorMessage = error instanceof Error ? error.message : String(error);
            await context.logger?.write(`settings:generation:error durationMs=${durationMs} error=${errorMessage}`);
            throw error;
        }
        await context.logger?.write(`settings:generation:done durationMs=${Date.now() - startedAt}`);
        return textResponse(200, settings.settingsJsSource, 'application/javascript; charset=utf-8');
    }

    const bundleName = getBundleNameFromConfigRoute(pathname);
    if (bundleName) {
        const settings = await context.settingsProvider.getPreviewSettings();
        const bundleConfig = settings.bundleConfigs.find((config) => config.name === bundleName);
        if (!bundleConfig) {
            return textResponse(404, `No runtime preview bundle config for ${bundleName}`);
        }
        return textResponse(200, JSON.stringify(bundleConfig), 'application/json; charset=utf-8');
    }

    const bundleIndexName = getBundleNameFromIndexRoute(pathname);
    if (bundleIndexName) {
        const settings = await context.settingsProvider.getPreviewSettings();
        const bundleConfig = settings.bundleConfigs.find((config) => config.name === bundleIndexName);
        if (!bundleConfig) {
            return textResponse(404, `No runtime preview bundle index for ${bundleIndexName}`);
        }
        return textResponse(200, createDummyBundleIndexScript(bundleIndexName), 'application/javascript; charset=utf-8');
    }

    const queryExtnameUuid = getQueryExtnameUuid(pathname);
    if (queryExtnameUuid) {
        return textResponse(200, await queryImportReplacementExtension(context.runtimeContext, queryExtnameUuid));
    }

    if (pathname === '/scripting/import-map-global') {
        return textResponse(200, JSON.stringify(createRuntimePreviewGlobalImportMap()), 'application/json; charset=utf-8');
    }

    const pluginScriptPath = getPluginScriptRequestPath(pathname);
    if (pluginScriptPath) {
        const settings = await context.settingsProvider.getPreviewSettings();
        const scriptLibraryPath = settings.scriptRuntimeMap.script2library[pluginScriptPath];
        if (!scriptLibraryPath) {
            return textResponse(404, `No runtime preview script library mapping for ${pluginScriptPath}`);
        }

        const scriptLibraryFile = await resolvePluginScriptLibraryFile(context.runtimeContext, scriptLibraryPath);
        if (!scriptLibraryFile) {
            return textResponse(404, `No runtime preview script library file for ${pluginScriptPath}`);
        }

        return serveOnDemandFile({ absolutePath: scriptLibraryFile });
    }

    const programmingFile = await resolveProgrammingRequest(context.runtimeContext, pathname);
    if (programmingFile) {
        return serveOnDemandFile(programmingFile);
    }

    const capturedRuntimeUrls = context.capturedRuntimeUrls?.map((entry) => entry.url);
    const bundleConfigs = capturedRuntimeUrls ? undefined : (await context.settingsProvider.getPreviewSettings()).bundleConfigs;
    const libraryFile = await resolveLibraryRequest(context.runtimeContext, pathname, {
        allowedRequestPaths: capturedRuntimeUrls,
        bundleConfigs,
    });
    if (libraryFile) {
        return serveOnDemandFile(libraryFile);
    }

    return textResponse(404, `No runtime preview route handled: ${pathname}`);
}
