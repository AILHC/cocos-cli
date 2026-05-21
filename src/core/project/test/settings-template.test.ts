import type { IFeatureItem, IFlags, IModuleItem, ModuleRenderConfig } from '../../engine/@types/modules';
import { getEngineRenderConfig } from '../../engine/dynamic-metadata';
import { createDefaultEngineSettings } from '../script/settings-template';
import { TestGlobalEnv } from '../../../tests/global-env';

function isFeatureGroup(moduleItem: IModuleItem): moduleItem is Extract<IModuleItem, { options: Record<string, IFeatureItem> }> {
    return 'options' in moduleItem;
}

function collectFlagDefaults(featureItem: Partial<IFeatureItem>): IFlags | undefined {
    const flags = Object.fromEntries(
        Object.entries(featureItem.flags ?? {}).map(([key, value]) => [
            key,
            typeof value.default === 'number' ? value.default : Boolean(value.default),
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

function buildExpectedModuleDefaults(renderConfig: ModuleRenderConfig): {
    flags: IFlags;
    includeModules: string[];
} {
    const flags: IFlags = {};
    const includeModules: string[] = [];

    for (const [featureKey, moduleItem] of Object.entries(renderConfig.features)) {
        if (isFeatureGroup(moduleItem)) {
            for (const [optionKey, optionItem] of Object.entries(moduleItem.options)) {
                const defaultFlags = collectFlagDefaults(optionItem);
                const enabled = Boolean(optionItem.default);
                if (enabled) {
                    includeModules.push(optionKey);
                }

                assignFlagDefaults(flags, defaultFlags);
            }
            continue;
        }

        const defaultFlags = collectFlagDefaults(moduleItem);
        const enabled = Boolean(moduleItem.default);
        if (enabled) {
            includeModules.push(featureKey);
        }

        assignFlagDefaults(flags, defaultFlags);

    }

    return {
        flags,
        includeModules,
    };
}

describe('engine settings template', () => {
    it('should derive default engine module settings from render-config', () => {
        const renderConfig = getEngineRenderConfig(TestGlobalEnv.engineRoot);
        const expectedDefaults = buildExpectedModuleDefaults(renderConfig);
        const settings = createDefaultEngineSettings(TestGlobalEnv.engineRoot);
        const defaultConfig = settings.modules.configs.defaultConfig;

        expect(settings.modules.globalConfigKey).toBe('defaultConfig');
        expect(defaultConfig).not.toHaveProperty('cache');
        expect(defaultConfig.flags).toEqual(expectedDefaults.flags);
        expect(defaultConfig.includeModules).toEqual(expectedDefaults.includeModules);
        expect(defaultConfig.noDeprecatedFeatures).toEqual({
            value: false,
            version: '',
        });
    });
});
