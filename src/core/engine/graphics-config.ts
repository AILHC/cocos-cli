import type { IEngineConfig, IEngineGraphicsConfig, IEngineGraphicsPipeline } from './@types/config';

export const CUSTOM_PIPELINE_MODULE: IEngineGraphicsPipeline = 'custom-pipeline';
export const LEGACY_PIPELINE_MODULE: IEngineGraphicsPipeline = 'legacy-pipeline';
export const CUSTOM_PIPELINE_POST_PROCESS_MODULE = 'custom-pipeline-post-process';
export const CUSTOM_PIPELINE_NAME_KEY = 'CUSTOM_PIPELINE_NAME';
export const DEFAULT_CUSTOM_PIPELINE_NAME = 'Builtin';

export function hasOwnConfigKey(object: object | undefined, key: string): boolean {
    return !!object && Object.prototype.hasOwnProperty.call(object, key);
}

export function ensureCustomPipelineMacroConfig(
    macroConfig: IEngineConfig['macroConfig']
): NonNullable<IEngineConfig['macroConfig']> {
    return {
        ...(macroConfig ?? {}),
        [CUSTOM_PIPELINE_NAME_KEY]: macroConfig?.[CUSTOM_PIPELINE_NAME_KEY] ?? DEFAULT_CUSTOM_PIPELINE_NAME,
    };
}

export function deriveGraphicsConfigFromModules(includeModules: string[] = []): IEngineGraphicsConfig {
    const hasCustomPipeline = includeModules.includes(CUSTOM_PIPELINE_MODULE);
    const hasLegacyPipeline = includeModules.includes(LEGACY_PIPELINE_MODULE);
    const pipeline = hasLegacyPipeline && !hasCustomPipeline
        ? LEGACY_PIPELINE_MODULE
        : CUSTOM_PIPELINE_MODULE;

    return {
        pipeline,
        [CUSTOM_PIPELINE_POST_PROCESS_MODULE]: includeModules.includes(CUSTOM_PIPELINE_POST_PROCESS_MODULE),
    };
}

export function deriveGraphicsConfigFromCustomPipeline(
    customPipeline: boolean | undefined,
    includeModules: string[] = []
): IEngineGraphicsConfig {
    return {
        ...deriveGraphicsConfigFromModules(includeModules),
        pipeline: customPipeline === false ? LEGACY_PIPELINE_MODULE : CUSTOM_PIPELINE_MODULE,
    };
}

export function mergeGraphicsConfigWithModules(
    includeModules: string[] = [],
    graphics: IEngineGraphicsConfig = {}
): IEngineGraphicsConfig {
    return {
        ...deriveGraphicsConfigFromModules(includeModules),
        ...graphics,
    };
}

export function normalizeIncludeModulesWithGraphics(
    includeModules: string[] = [],
    graphics: IEngineGraphicsConfig = {}
): string[] {
    const pipeline = graphics.pipeline ?? deriveGraphicsConfigFromModules(includeModules).pipeline;
    const useCustomPipeline = pipeline !== LEGACY_PIPELINE_MODULE;
    const modules = includeModules.filter((module) => {
        return module !== CUSTOM_PIPELINE_MODULE
            && module !== LEGACY_PIPELINE_MODULE
            && module !== CUSTOM_PIPELINE_POST_PROCESS_MODULE;
    });

    modules.push(useCustomPipeline ? CUSTOM_PIPELINE_MODULE : LEGACY_PIPELINE_MODULE);

    if (useCustomPipeline && graphics[CUSTOM_PIPELINE_POST_PROCESS_MODULE]) {
        modules.push(CUSTOM_PIPELINE_POST_PROCESS_MODULE);
    }

    return Array.from(new Set(modules));
}
