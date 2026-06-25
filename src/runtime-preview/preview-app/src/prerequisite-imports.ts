import {
    RuntimePreviewScriptLoadLimiterState,
    installRuntimePreviewScriptLoadLimiter,
} from './systemjs-load-limiter.js';

type RuntimePreviewImportMap = {
    imports?: Record<string, string>;
    scopes?: Record<string, Record<string, string>>;
};

type RuntimePreviewPrerequisiteTiming = {
    prerequisiteImportMs: number;
    validationMs: number;
    hook: RuntimePreviewScriptLoadLimiterState['hook'];
    concurrency: number;
    maxActive: number;
    queuePeak: number;
    completed: number;
    failed: number;
    retryCount: number;
};

export interface RuntimePreviewPrerequisiteImportOptions {
    system: SystemJS;
    installLimiter?: (system: SystemJS) => RuntimePreviewScriptLoadLimiterState;
    validateImportMap?: () => Promise<void>;
    now?: () => number;
}

export async function loadRuntimePreviewPrerequisiteImports(
    options: RuntimePreviewPrerequisiteImportOptions,
): Promise<void> {
    const system = options.system;
    const now = options.now ?? Date.now;
    const installLimiter = options.installLimiter ?? installRuntimePreviewScriptLoadLimiter;
    const validateImportMap = options.validateImportMap ?? validateRuntimePreviewPrerequisiteImportMap;
    const limiter = installLimiter(system);
    window.__RUNTIME_PREVIEW_SCRIPT_LOAD_LIMITER__ = limiter;

    try {
        const importStartedAt = now();
        await system.import('cce:/internal/x/prerequisite-imports');
        const prerequisiteImportMs = now() - importStartedAt;

        const validationStartedAt = now();
        await validateImportMap();
        const validationMs = now() - validationStartedAt;

        const timing = collectRuntimePreviewPrerequisiteTiming(limiter, prerequisiteImportMs, validationMs);
        window.__RUNTIME_PREVIEW_PREREQUISITE_TIMINGS__ = [
            ...(window.__RUNTIME_PREVIEW_PREREQUISITE_TIMINGS__ ?? []),
            timing,
        ];
        console.info(
            `[runtime-preview] prerequisite-imports:done prerequisiteImportMs=${timing.prerequisiteImportMs}`
            + ` validationMs=${timing.validationMs}`
            + ` hook=${timing.hook}`
            + ` concurrency=${timing.concurrency}`
            + ` maxActive=${timing.maxActive}`
            + ` queuePeak=${timing.queuePeak}`
            + ` completed=${timing.completed}`
            + ` failed=${timing.failed}`
            + ` retry=${timing.retryCount}`,
        );
    } catch (error) {
        console.error('[runtime-preview] prerequisite imports failed', error);
        throw error;
    }
}

export async function validateRuntimePreviewPrerequisiteImportMap(): Promise<void> {
    const importMapUrl = '/scripting/x/packer-driver/targets/preview/import-map.json';
    const response = await fetch(importMapUrl);
    if (!response.ok) {
        throw new Error(`Failed to load runtime preview import map: ${response.status}`);
    }

    const importMap = await response.json() as RuntimePreviewImportMap;
    const prerequisiteChunk = importMap.imports?.['cce:/internal/x/prerequisite-imports'];
    const prerequisiteScope = prerequisiteChunk ? importMap.scopes?.[prerequisiteChunk] : undefined;
    if (!prerequisiteChunk || !prerequisiteScope) {
        throw new Error('Runtime preview prerequisite import scope is missing.');
    }

    const importMapBase = new URL(importMapUrl, window.location.href);
    const prerequisiteChunkUrl = new URL(prerequisiteChunk, importMapBase);
    const chunkResponse = await fetch(prerequisiteChunkUrl.href);
    if (!chunkResponse.ok) {
        throw new Error(`Failed to load runtime preview prerequisite chunk: ${chunkResponse.status}`);
    }

    const prerequisiteChunkSource = await chunkResponse.text();
    const requiredSpecifiers = collectRuntimePreviewUnresolvedSpecifiers(prerequisiteChunkSource);
    for (const specifier of requiredSpecifiers) {
        const chunkImport = prerequisiteScope[specifier];
        if (!isRuntimePreviewChunkImport(chunkImport)) {
            throw new Error(`Runtime preview prerequisite scope is missing ${specifier}.`);
        }
    }
}

function collectRuntimePreviewPrerequisiteTiming(
    limiter: RuntimePreviewScriptLoadLimiterState,
    prerequisiteImportMs: number,
    validationMs: number,
): RuntimePreviewPrerequisiteTiming {
    return {
        prerequisiteImportMs,
        validationMs,
        hook: limiter.hook,
        concurrency: limiter.concurrency,
        maxActive: limiter.metrics.maxActive,
        queuePeak: limiter.metrics.queuePeak,
        completed: limiter.metrics.completed,
        failed: limiter.metrics.failed,
        retryCount: limiter.metrics.retryCount,
    };
}

function collectRuntimePreviewUnresolvedSpecifiers(source: string): string[] {
    const specifiers = new Set<string>();
    const pattern = /__unresolved_\d+/g;
    let match: RegExpExecArray | null = null;
    while ((match = pattern.exec(source))) {
        specifiers.add(match[0]);
    }

    return Array.from(specifiers)
        .sort((left, right) => Number(left.slice('__unresolved_'.length)) - Number(right.slice('__unresolved_'.length)));
}

function isRuntimePreviewChunkImport(value: unknown): value is string {
    return typeof value === 'string' && /^\.\/chunks\/[^/]+\/[^/]+\.js$/.test(value);
}
