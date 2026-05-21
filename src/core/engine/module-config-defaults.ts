import bundledRenderConfig from './features/render-config.json';
import { getEngineRenderConfig } from './dynamic-metadata';
import type { IEngineModuleProjectConfig } from './@types/config';
import type { ICroppingConfig, IFeatureItem, IFlags, IModuleItem, ModuleRenderConfig } from './@types/modules';

export const DEFAULT_ENGINE_MODULE_CONFIG_KEY = 'defaultConfig';
export const DEFAULT_ENGINE_MODULE_CONFIG_NAME = '\u9ed8\u8ba4\u914d\u7f6e';
export const DEFAULT_NO_DEPRECATED_FEATURES = {
    value: false,
    version: '',
} as const;

export interface IEngineModuleSettingsDefaults {
    globalConfigKey: string;
    configs: Record<string, ICroppingConfig>;
}

export interface IEngineModuleProjectDefaults {
    globalConfigKey: string;
    configs: Record<string, IEngineModuleProjectConfig>;
}

function isFeatureGroup(moduleItem: IModuleItem): moduleItem is Extract<IModuleItem, { options: Record<string, IFeatureItem> }> {
    return 'options' in moduleItem;
}

function normalizeFlagDefault(value: unknown): boolean | number {
    return typeof value === 'number' ? value : Boolean(value);
}

function collectFlagDefaults(featureItem: Partial<IFeatureItem>): IFlags | undefined {
    const flags = Object.fromEntries(
        Object.entries(featureItem.flags ?? {}).map(([key, flag]) => [
            key,
            normalizeFlagDefault(flag.default),
        ])
    );

    return Object.keys(flags).length ? flags : undefined;
}

function assignFlagDefaults(target: IFlags, flagDefaults?: IFlags) {
    if (!flagDefaults) {
        return;
    }

    for (const [key, value] of Object.entries(flagDefaults)) {
        if (!(key in target)) {
            target[key] = value;
        }
    }
}

function buildDefaultModuleConfig(renderConfig: ModuleRenderConfig): {
    flags: IFlags;
    includeModules: string[];
} {
    const flags: IFlags = {};
    const includeModules: string[] = [];

    for (const [featureKey, moduleItem] of Object.entries(renderConfig.features)) {
        if (isFeatureGroup(moduleItem)) {
            for (const [optionKey, optionItem] of Object.entries(moduleItem.options)) {
                const flagDefaults = collectFlagDefaults(optionItem);
                const enabled = Boolean(optionItem.default);

                if (enabled) {
                    includeModules.push(optionKey);
                }

                assignFlagDefaults(flags, flagDefaults);
            }
            continue;
        }

        const flagDefaults = collectFlagDefaults(moduleItem);
        const enabled = Boolean(moduleItem.default);

        if (enabled) {
            includeModules.push(featureKey);
        }

        assignFlagDefaults(flags, flagDefaults);
    }

    return {
        flags,
        includeModules,
    };
}

function loadRenderConfig(engineRoot: string): ModuleRenderConfig {
    try {
        return getEngineRenderConfig(engineRoot);
    } catch (error) {
        console.warn('[Engine] Failed to load engine render-config from repository, fallback to bundled copy.', error);
        return bundledRenderConfig as unknown as ModuleRenderConfig;
    }
}

export function createDefaultEngineModuleSettings(engineRoot: string): IEngineModuleSettingsDefaults {
    const moduleDefaults = buildDefaultModuleConfig(loadRenderConfig(engineRoot));

    return {
        globalConfigKey: DEFAULT_ENGINE_MODULE_CONFIG_KEY,
        configs: {
            [DEFAULT_ENGINE_MODULE_CONFIG_KEY]: {
                name: DEFAULT_ENGINE_MODULE_CONFIG_NAME,
                flags: moduleDefaults.flags,
                includeModules: moduleDefaults.includeModules,
                noDeprecatedFeatures: {
                    ...DEFAULT_NO_DEPRECATED_FEATURES,
                },
            },
        },
    };
}

export function createDefaultEngineModuleProjectDefaults(engineRoot: string): IEngineModuleProjectDefaults {
    const settingsDefaults = createDefaultEngineModuleSettings(engineRoot);

    return {
        globalConfigKey: settingsDefaults.globalConfigKey,
        configs: Object.fromEntries(
            Object.entries(settingsDefaults.configs).map(([key, value]) => [
                key,
                {
                    name: value.name,
                    includeModules: [...value.includeModules],
                    flags: value.flags ? { ...value.flags } : undefined,
                    noDeprecatedFeatures: value.noDeprecatedFeatures ? { ...value.noDeprecatedFeatures } : undefined,
                } satisfies IEngineModuleProjectConfig,
            ])
        ),
    };
}
