import { BundleCompressionTypes } from '../share/bundle-utils';
import { isCompressionTypeSupported, shouldOutputProjectBundleWithExplicitConfigs, transformBundleConfigCustomByPlatformType } from '../worker/builder/asset-handler/bundle/bundle-output';

describe('bundle output selection with explicit bundle configs', () => {
    const supportedCompressionTypes = [
        BundleCompressionTypes.NONE,
        BundleCompressionTypes.MERGE_DEP,
        BundleCompressionTypes.MERGE_ALL_JSON,
        BundleCompressionTypes.SUBPACKAGE,
    ];

    it('does not output project subpackage bundles as Cocos bundles when bundleConfigs are explicit', () => {
        expect(shouldOutputProjectBundleWithExplicitConfigs({
            compressionType: BundleCompressionTypes.SUBPACKAGE,
            isRemote: false,
        }, supportedCompressionTypes, 'miniGame')).toBe(false);
    });

    it('keeps project remote bundles enabled for mini-game platforms when bundleConfigs are explicit', () => {
        expect(shouldOutputProjectBundleWithExplicitConfigs({
            compressionType: BundleCompressionTypes.MERGE_ALL_JSON,
            isRemote: true,
        }, supportedCompressionTypes, 'miniGame')).toBe(true);
    });

    it('does not apply mini-game explicit bundle output behavior to web platforms', () => {
        expect(shouldOutputProjectBundleWithExplicitConfigs({
            compressionType: BundleCompressionTypes.MERGE_ALL_JSON,
            isRemote: true,
        }, supportedCompressionTypes, 'web')).toBe(false);
    });

    it('does not enable ordinary project bundles just because bundleConfigs are explicit', () => {
        expect(shouldOutputProjectBundleWithExplicitConfigs({
            compressionType: BundleCompressionTypes.MERGE_DEP,
            isRemote: false,
        }, supportedCompressionTypes, 'miniGame')).toBe(false);
    });

    it('does not output unsupported compression types', () => {
        expect(isCompressionTypeSupported(BundleCompressionTypes.ZIP, supportedCompressionTypes)).toBe(false);
        expect(shouldOutputProjectBundleWithExplicitConfigs({
            compressionType: BundleCompressionTypes.ZIP,
            isRemote: true,
        }, supportedCompressionTypes, 'miniGame')).toBe(false);
    });
});

describe('bundle config platform type expansion', () => {
    it('only applies a bundle platform group to registered platforms of the same type', () => {
        const result = transformBundleConfigCustomByPlatformType({
            bundleA: {
                displayName: 'bundleA',
                configs: {
                    native: {
                        preferredOptions: {
                            compressionType: BundleCompressionTypes.MERGE_DEP,
                            isRemote: false,
                        },
                    },
                    miniGame: {
                        configMode: 'overwrite',
                        overwriteSettings: {
                            wechatgame: {
                                compressionType: BundleCompressionTypes.SUBPACKAGE,
                                isRemote: false,
                            },
                        },
                    },
                    web: {
                        preferredOptions: {
                            compressionType: BundleCompressionTypes.NONE,
                            isRemote: true,
                        },
                    },
                },
            },
        } as any, {
            wechatgame: {
                platformType: 'miniGame',
                platformName: 'WeChat',
                supportOptions: {
                    compressionType: [
                        BundleCompressionTypes.NONE,
                        BundleCompressionTypes.MERGE_DEP,
                        BundleCompressionTypes.MERGE_ALL_JSON,
                        BundleCompressionTypes.SUBPACKAGE,
                    ],
                },
            },
            'web-mobile': {
                platformType: 'web',
                platformName: 'Web Mobile',
                supportOptions: {
                    compressionType: [
                        BundleCompressionTypes.NONE,
                        BundleCompressionTypes.MERGE_DEP,
                    ],
                },
            },
            windows: {
                platformType: 'native',
                platformName: 'Windows',
                supportOptions: {
                    compressionType: [
                        BundleCompressionTypes.MERGE_DEP,
                    ],
                },
            },
        } as any);

        expect(result.bundleA.wechatgame).toEqual({
            compressionType: BundleCompressionTypes.SUBPACKAGE,
            isRemote: false,
        });
        expect(result.bundleA['web-mobile']).toEqual({
            compressionType: BundleCompressionTypes.NONE,
            isRemote: true,
        });
        expect(result.bundleA.windows).toEqual({
            compressionType: BundleCompressionTypes.MERGE_DEP,
            isRemote: false,
        });
    });
});
