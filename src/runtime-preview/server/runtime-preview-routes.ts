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
import {
    renderRuntimePreviewEntry,
    resolveRuntimePreviewStaticFile,
    RuntimePreviewTemplateRenderError,
} from './preview-entry-template';
import { handlePreviewAppRequiredRoute } from './preview-app-required-routes';
import {
    getRequestedScene,
    resolveRuntimePreviewStartScene,
} from './preview-scenes';
import {
    createImportReplacementExtensionResolver,
    type ImportReplacementExtensionResolver,
} from './import-replacement-extension-cache';
import {
    injectRuntimeRefreshEntry,
    type RuntimeRefreshClientState,
} from './runtime-refresh-entry-injection';

export type { RuntimeRefreshClientState };

export interface RuntimePreviewRouteContext {
    runtimeContext: RuntimePreviewContext;
    settingsProvider: PreviewSettingsProvider;
    capturedRuntimeUrls?: Array<{ url: string }>;
    logger?: RuntimePreviewLogger;
    method?: string;
    body?: string;
    importReplacementExtensionResolver?: ImportReplacementExtensionResolver;
    runtimeRefreshState?: RuntimeRefreshClientState | null;
}

function decodePathname(requestPath: string): string | null {
    try {
        return decodeURIComponent(requestPath.split('?')[0]).replace(/\\/g, '/');
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

const prerequisiteImportsModURL = 'cce:/internal/x/prerequisite-imports';

function createBundlePrerequisiteIndexScript(bundleName: string): string {
    const virtualModuleId = `virtual:///prerequisite-imports/${bundleName}`;
    return `
// Runtime preview bundle prerequisite marker.
System.register(
    ${JSON.stringify(virtualModuleId)},
    [${JSON.stringify(prerequisiteImportsModURL)}],
    function () {
        return {
            setters: [function () {}],
            execute: function () {},
        };
    },
);
`;
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

function getProjectTemplateRuntimePreviewFile(pathname: string, context: RuntimePreviewContext): string | null {
    if (!pathname.startsWith('/') || pathname === '/' || pathname.includes('..')) {
        return null;
    }
    const normalized = pathname.slice(1).replace(/\\/g, '/');
    if (normalized.includes('/')) {
        return null;
    }
    if (!normalized.endsWith('.js')) {
        return null;
    }
    if (normalized.endsWith('.ejs')) {
        return null;
    }
    return resolve(context.projectRoot, 'preview-template', normalized);
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

export async function tryHandleRuntimePreviewRequest(
    context: RuntimePreviewRouteContext,
    requestPath: string,
): Promise<RuntimePreviewHttpResponse | null> {
    const pathname = decodePathname(requestPath);
    if (!pathname || pathname.split('/').includes('..')) {
        return textResponse(400, `Invalid runtime preview request: ${requestPath}`);
    }

    if (pathname === '/') {
        try {
            return textResponse(
                200,
                injectRuntimeRefreshEntry(
                    await renderRuntimePreviewEntry(
                        context.runtimeContext,
                        context.settingsProvider,
                        requestPath,
                    ),
                    context.runtimeRefreshState,
                ),
                'text/html; charset=utf-8',
            );
        } catch (error) {
            if (error instanceof RuntimePreviewTemplateRenderError) {
                const line = error.message;
                await context.logger?.write(line);
                return textResponse(500, line, 'text/plain; charset=utf-8');
            }
            throw error;
        }
    }

    const projectTemplateRootRequest = getProjectTemplateRuntimePreviewFile(pathname, context.runtimeContext);
    const projectTemplateRootFile = projectTemplateRootRequest
        ? await resolveExistingFile(projectTemplateRootRequest)
        : null;
    if (projectTemplateRootFile) {
        return serveOnDemandFile({ absolutePath: projectTemplateRootFile });
    }

    const runtimePreviewStaticFile = await resolveRuntimePreviewStaticFile(pathname);
    if (runtimePreviewStaticFile) {
        return serveOnDemandFile(runtimePreviewStaticFile);
    }

    const previewAppRequiredRoute = await handlePreviewAppRequiredRoute(context.runtimeContext, pathname, {
        requestPath,
        method: context.method,
        body: context.body,
        logger: context.logger,
    });
    if (previewAppRequiredRoute) {
        return previewAppRequiredRoute;
    }

    if (pathname === '/settings.js') {
        const startedAt = Date.now();
        await context.logger?.write('settings:generation:start');
        let settings;
        try {
            const startScene = await resolveRuntimePreviewStartScene(
                context.runtimeContext,
                getRequestedScene(requestPath),
                context.runtimeContext.scene,
            );
            settings = await context.settingsProvider.getPreviewSettings(startScene ? { startScene } : undefined);
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
        return textResponse(200, createBundlePrerequisiteIndexScript(bundleIndexName), 'application/javascript; charset=utf-8');
    }

    const queryExtnameUuid = getQueryExtnameUuid(pathname);
    if (queryExtnameUuid) {
        const resolver = context.importReplacementExtensionResolver
            ?? createImportReplacementExtensionResolver(context.runtimeContext);
        return textResponse(200, await resolver.query(queryExtnameUuid));
    }

    if (pathname === '/scripting/import-map-global') {
        return textResponse(
            200,
            JSON.stringify(createRuntimePreviewGlobalImportMap()),
            'application/json; charset=utf-8',
        );
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
    const libraryFile = await resolveLibraryRequest(context.runtimeContext, pathname, {
        allowedRequestPaths: capturedRuntimeUrls,
    });
    if (libraryFile) {
        return serveOnDemandFile(libraryFile);
    }

    return null;
}

export async function handleRuntimePreviewRequest(
    context: RuntimePreviewRouteContext,
    requestPath: string,
): Promise<RuntimePreviewHttpResponse> {
    return (await tryHandleRuntimePreviewRequest(context, requestPath))
        ?? textResponse(404, `No runtime preview route handled: ${decodePathname(requestPath) ?? requestPath}`);
}
