import { PLATFORMS } from '../share/platforms-options';
import { SchemaBuildOption, SchemaWechatGameBuildOption, SchemaWechatGamePackages } from '../../../api/builder/schema';

describe('wechatgame platform registration', () => {
    it('registers wechatgame as a built-in builder platform', () => {
        expect(PLATFORMS).toContain('wechatgame');
    });

    it('parses wechatgame package options through the public build schema', () => {
        const result = SchemaBuildOption.parse({
            platform: 'wechatgame',
            packages: {
                wechatgame: {
                    orientation: 'portrait',
                    appid: 'wx6ac3f5090a6b99c5',
                    separateEngine: false,
                    highPerformanceMode: true,
                },
            },
        });

        expect(result.platform).toBe('wechatgame');
        expect(result.packages?.wechatgame.orientation).toBe('portrait');
        expect(result.packages?.wechatgame.highPerformanceMode).toBe(true);
        expect((result.packages?.wechatgame as Record<string, unknown>).separateEngine).toBeUndefined();
    });

    it('defines wechatgame package schema defaults', () => {
        const parsed = SchemaWechatGamePackages.parse({});

        expect(parsed.orientation).toBe('portrait');
        expect(parsed.appid).toBe('');
        expect(parsed.highPerformanceMode).toBe(false);
    });

    it('exposes a dedicated wechatgame build option schema', () => {
        const parsed = SchemaWechatGameBuildOption.parse({
            platform: 'wechatgame',
            packages: {
                wechatgame: {
                    appid: 'wx6ac3f5090a6b99c5',
                    orientation: 'portrait',
                },
            },
        });

        expect(parsed.platform).toBe('wechatgame');
        expect(parsed.packages?.wechatgame.appid).toBe('wx6ac3f5090a6b99c5');
    });
});

describe('wechatgame platform config', () => {
    it('exposes builder config in the existing platform extension style', async () => {
        const config = (await import('../platforms/wechatgame/config')).default;

        expect(config.displayName).toBe('i18n:wechatgame.title');
        expect(config.platformType).toBe('WECHAT');
        expect(config.hooks).toBe('./hooks');
        expect(config.options?.appid.default).toBe('');
        expect(config.options?.orientation.default).toBe('portrait');
        expect(config.options?.highPerformanceMode.default).toBe(false);
        expect(Object.keys(config.options ?? {}).sort()).toEqual([
            'appid',
            'highPerformanceMode',
            'orientation',
        ]);
        expect(config.buildTemplateConfig).toBeUndefined();
        expect(config.customBuildStages).toBeUndefined();
    });
});

describe('wechatgame build hooks', () => {
    it('configures bundle build options for the WeChat mini-game runtime', async () => {
        const hooks = await import('../platforms/wechatgame/hooks');
        const options = {
            moveRemoteBundleScript: false,
            assetSerializeOptions: {},
            polyfills: {
                asyncFunctions: true,
            },
            buildScriptParam: {
                platform: 'WECHAT',
                importMapFormat: undefined,
                system: undefined,
            },
        } as any;

        hooks.onBeforeBundleInit(options);

        expect(options.moveRemoteBundleScript).toBe(true);
        expect(options.assetSerializeOptions.exportCCON).toBe(true);
        expect(options.assetSerializeOptions.useCCONB).toBe(false);
        expect(options.polyfills.asyncFunctions).toBe(false);
        expect(options.buildScriptParam.platform).toBe('WECHAT');
        expect(options.buildScriptParam.importMapFormat).toBe('commonjs');
        expect(options.buildScriptParam.system).toEqual({ preset: 'commonjs-like' });
    });
});
