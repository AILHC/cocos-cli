import { join, resolve } from 'node:path';

const repoRoot = resolve(__dirname, '../../../..');
const distBuilderRoot = join(repoRoot, 'dist/core/builder');

describe('final platform package registration', () => {
    it('discovers Android and Web Mobile from final dist package metadata', async () => {
        const { PluginManager } = require(join(distBuilderRoot, 'manager/plugin.js')) as typeof import('../manager/plugin');
        const manager = new PluginManager();

        await manager.init();

        const pool = (manager as any).platformRegisterInfoPool as Map<string, {
            path: string;
            hooks?: string;
            config: { options?: Record<string, { default?: unknown }> };
        }>;
        expect(pool.has('google-play')).toBe(true);
        expect(pool.has('fb-instant-games')).toBe(false);

        const android = pool.get('android');
        const webMobile = pool.get('web-mobile');
        expect(android?.path).toBe(join(distBuilderRoot, 'platforms/android'));
        expect(android?.hooks).toBe(join(distBuilderRoot, 'platforms/android/src/hooks'));
        expect(android?.config.options?.apiLevel.default).toBe(35);
        expect(webMobile?.path).toBe(join(distBuilderRoot, 'platforms/web-mobile'));
        expect(webMobile?.hooks).toBe(join(distBuilderRoot, 'platforms/web-mobile/src/hooks'));
        expect(webMobile?.config.options?.useWebGPU.default).toBe(false);
    });

    it('dispatches minimal hooks loaded through the migrated package paths', async () => {
        const androidHooks = require(join(distBuilderRoot, 'platforms/android/src/hooks.js')) as {
            onAfterBundleDataTask(options: unknown, bundles: Array<{ configOutPutName: string }>, cache: unknown): Promise<void>;
        };
        const bundles = [{ configOutPutName: '' }];
        await androidHooks.onAfterBundleDataTask({}, bundles, {});
        expect(bundles[0].configOutPutName).toBe('cc.config');

        const webMobileHooks = require(join(distBuilderRoot, 'platforms/web-mobile/src/hooks.js')) as {
            onAfterBundleInit(options: any): void;
        };
        const options = {
            packages: { 'web-mobile': { useWebGPU: true } },
            buildScriptParam: { flags: {} },
            includeModules: [],
            assetSerializeOptions: { 'cc.EffectAsset': {} },
        };
        webMobileHooks.onAfterBundleInit(options);
        expect(options.buildScriptParam).toMatchObject({
            system: { preset: 'web' },
            flags: { WEBGPU: true },
        });
        expect(options.includeModules).toContain('gfx-webgpu');
        expect(options.assetSerializeOptions['cc.EffectAsset']).toMatchObject({ glsl4: true });
    });
});
