import { Engine, IEngine } from '../index';
import { join } from 'path';
import { EngineLoader } from 'cc/loader.js';
import { TestGlobalEnv } from '../../../tests/global-env';
import type { IEngineProjectConfig } from '../@types/config';
import { configurationManager } from '../../configuration';
import { MessageType } from '../../configuration/script/interface';
import { CUSTOM_PIPELINE_MODULE, deriveGraphicsConfigFromModules } from '../graphics-config';

[
    'cc',
    'cc/editor/populate-internal-constants',
    'cc/editor/serialization',
    'cc/editor/new-gen-anim',
    'cc/editor/embedded-player',
    'cc/editor/reflection-probe',
    'cc/editor/lod-group-utils',
    'cc/editor/material',
    'cc/editor/2d-misc',
    'cc/editor/offline-mappings',
    'cc/editor/custom-pipeline',
    'cc/editor/animation-clip-migration',
    'cc/editor/exotic-animation',
    'cc/editor/new-gen-anim',
    'cc/editor/offline-mappings',
    'cc/editor/embedded-player',
    'cc/editor/color-utils',
].forEach((module) => {
    jest.mock(module, () => {
        return EngineLoader.getEngineModuleById(module);
    }, { virtual: true });
});

function cloneConfig<T>(config: T): T {
    return JSON.parse(JSON.stringify(config));
}

function replaceEngineProjectConfig(config: Partial<IEngineProjectConfig>): void {
    const currentConfig = Engine['_configInstance'].getAll()!;
    for (const key of Object.keys(currentConfig)) {
        delete currentConfig[key];
    }
    Object.assign(currentConfig, cloneConfig(config));
    configurationManager.emit(MessageType.Reload, config);
}

/**
 * Engine 类的测试 - 验证是否需要 mock
 */
describe('Engine', () => {
    let engine: IEngine;

    beforeEach(async () => {
        await configurationManager.initialize(TestGlobalEnv.projectRoot);
        // 在每个测试用例之前初始化 engine
        engine = await Engine.init(TestGlobalEnv.engineRoot);
    });

    it('test engine initEngine', async () => {
        await engine.initEngine({
            importBase: join(TestGlobalEnv.projectRoot, 'library'),
            nativeBase: join(TestGlobalEnv.projectRoot, 'library'),
            writablePath: join(TestGlobalEnv.projectRoot, 'temp'),
        });
        // @ts-ignore
        expect(cc).toBeDefined();
        // @ts-ignore
        expect(ccm).toBeDefined();
    }, 1000 * 60 * 50);

    it('getConfig should expose the selected module config at top level', () => {
        const config = Engine.getConfig() as ReturnType<typeof Engine.getConfig> & IEngineProjectConfig;
        const selectedConfigKey = config.globalConfigKey || Object.keys(config.configs || {})[0];

        expect(selectedConfigKey).toBeDefined();
        expect(config.configs?.[selectedConfigKey]).toBeDefined();
        expect(config.includeModules).toEqual(config.configs![selectedConfigKey].includeModules);
        expect(config.flags).toEqual(config.configs![selectedConfigKey].flags);
        expect(config.noDeprecatedFeatures).toEqual(config.configs![selectedConfigKey].noDeprecatedFeatures);
        const expectedGraphics = deriveGraphicsConfigFromModules(config.includeModules);
        expect(config.graphics).toEqual(expectedGraphics);
        expect(config.customPipeline).toBe(expectedGraphics.pipeline === CUSTOM_PIPELINE_MODULE);
        expect(config.macroConfig?.CUSTOM_PIPELINE_NAME).toBe('Builtin');
    });

    it('getConfig should normalize includeModules from graphics settings', async () => {
        const configInstance = Engine['_configInstance'];
        const originalProjectConfig = cloneConfig(configInstance.getAll() ?? {});

        try {
            replaceEngineProjectConfig({
                ...originalProjectConfig,
                graphics: {
                    pipeline: 'custom-pipeline',
                    'custom-pipeline-post-process': true,
                },
            });

            expect(Engine.getConfig().graphics).toEqual({
                pipeline: 'custom-pipeline',
                'custom-pipeline-post-process': true,
            });
            expect(Engine.getConfig().includeModules).toContain('custom-pipeline');
            expect(Engine.getConfig().includeModules).toContain('custom-pipeline-post-process');
            expect(Engine.getConfig().includeModules).not.toContain('legacy-pipeline');
            expect(Engine.getConfig().customPipeline).toBe(true);

            replaceEngineProjectConfig({
                ...originalProjectConfig,
                graphics: {
                    pipeline: 'legacy-pipeline',
                    'custom-pipeline-post-process': true,
                },
            });

            expect(Engine.getConfig().graphics).toEqual({
                pipeline: 'legacy-pipeline',
                'custom-pipeline-post-process': true,
            });
            expect(Engine.getConfig().includeModules).toContain('legacy-pipeline');
            expect(Engine.getConfig().includeModules).not.toContain('custom-pipeline');
            expect(Engine.getConfig().includeModules).not.toContain('custom-pipeline-post-process');
            expect(Engine.getConfig().customPipeline).toBe(false);
        } finally {
            replaceEngineProjectConfig(originalProjectConfig);
        }
    }, 30000);

    it('getConfig should preserve module-derived pipeline when graphics is partially saved', async () => {
        const configInstance = Engine['_configInstance'];
        const originalProjectConfig = cloneConfig(configInstance.getAll() ?? {});
        const baseModules = Engine.getConfig().includeModules.filter((module) => {
            return module !== 'custom-pipeline'
                && module !== 'legacy-pipeline'
                && module !== 'custom-pipeline-post-process';
        });

        try {
            const customPipelineConfig = {
                ...originalProjectConfig,
                includeModules: [...baseModules, 'custom-pipeline'],
                graphics: {
                    'custom-pipeline-post-process': true,
                },
            };
            replaceEngineProjectConfig(customPipelineConfig);

            expect(Engine.getConfig().graphics).toEqual({
                pipeline: 'custom-pipeline',
                'custom-pipeline-post-process': true,
            });
            expect(Engine.getConfig().includeModules).toContain('custom-pipeline');
            expect(Engine.getConfig().includeModules).toContain('custom-pipeline-post-process');
            expect(Engine.getConfig().includeModules).not.toContain('legacy-pipeline');

            replaceEngineProjectConfig({
                ...customPipelineConfig,
                includeModules: [...baseModules, 'legacy-pipeline'],
            });

            expect(Engine.getConfig().graphics).toEqual({
                pipeline: 'legacy-pipeline',
                'custom-pipeline-post-process': true,
            });
            expect(Engine.getConfig().includeModules).toContain('legacy-pipeline');
            expect(Engine.getConfig().includeModules).not.toContain('custom-pipeline');
            expect(Engine.getConfig().includeModules).not.toContain('custom-pipeline-post-process');
        } finally {
            replaceEngineProjectConfig(originalProjectConfig);
        }
    }, 30000);

    it('getConfig should return updated config after configuration reload', async () => {
        const configInstance = Engine['_configInstance'];
        const originalProjectConfig = cloneConfig(configInstance.getAll() ?? {});
        const nextWidth = (Engine.getConfig().designResolution?.width || 0) + 1;

        try {
            replaceEngineProjectConfig({
                ...originalProjectConfig,
                designResolution: {
                    ...Engine.getConfig().designResolution,
                    width: nextWidth,
                },
            });

            expect(Engine.getConfig().designResolution.width).toBe(nextWidth);
        } finally {
            replaceEngineProjectConfig(originalProjectConfig);
        }
    }, 30000);
});
