import { join } from 'node:path';
import { stat } from 'node:fs/promises';
import type { RuntimePreviewContext } from '../context/runtime-preview-context';
import { resolveLibraryRequest } from '../library/resolve-library-request';
import { resolveProgrammingRequest } from '../programming/resolve-programming-request';
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

export async function handleRuntimePreviewRequest(
    context: RuntimePreviewRouteContext,
    requestPath: string,
): Promise<RuntimePreviewHttpResponse> {
    const pathname = decodePathname(requestPath);
    if (!pathname || pathname.split('/').includes('..')) {
        return textResponse(400, `Invalid runtime preview request: ${requestPath}`);
    }

    if (pathname === '/settings.js') {
        const settings = await context.settingsProvider.getPreviewSettings();
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
