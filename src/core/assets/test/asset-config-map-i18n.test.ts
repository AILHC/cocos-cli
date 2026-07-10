import i18n from '../../base/i18n';
import { assetManager } from '..';
import assetHandlerManager from '../manager/asset-handler';
import type { AssetHandler, IUerDataConfigItem } from '../@types/protected/asset-handler';

describe('asset config map i18n', () => {
    beforeAll(() => {
        i18n.registerLanguagePatch('en', 'assets.assetConfigMapTest', {
            asset: 'Localized Asset',
            description: 'Localized Description',
            mode: 'Import Mode',
            modeHelp: 'Mode Help',
            fast: 'Fast Mode',
            nested: 'Nested Setting',
            nestedHelp: 'Nested Help',
            lazyAsset: 'Lazy Asset',
        });
        i18n.registerLanguagePatch('zh', 'assets.assetConfigMapTest', {
            asset: 'ZH Asset',
            description: 'ZH Description',
            mode: 'ZH Mode',
            modeHelp: 'ZH Mode Help',
            fast: 'ZH Fast',
            nested: 'ZH Nested',
            nestedHelp: 'ZH Nested Help',
            lazyAsset: 'ZH Lazy Asset',
        });
    });

    beforeEach(async () => {
        resetAssetHandlerManager();
        await i18n.setLanguage('en');
    });

    afterEach(async () => {
        resetAssetHandlerManager();
        await i18n.setLanguage('en');
    });

    it('localizes asset display fields and nested userDataConfig without mutating raw handler config', async () => {
        const rawUserDataConfig = createUserDataConfig();
        addAssetHandler(createAssetHandler('localized-asset', {
            displayName: 'i18n:assets.assetConfigMapTest.asset',
            description: 'i18n:assets.assetConfigMapTest.description',
            userDataConfig: {
                default: rawUserDataConfig,
            },
        }));

        const configMap = await assetManager.queryAssetConfigMap();
        const config = configMap['localized-asset'];
        const modeConfig = config.userDataConfig?.mode;
        const arrayChild = (modeConfig?.itemConfigs as IUerDataConfigItem[])[0];
        const objectChild = (config.userDataConfig?.texture.itemConfigs as Record<string, IUerDataConfigItem>).wrapMode;

        expect(config.displayName).toBe('Localized Asset');
        expect(config.description).toBe('Localized Description');
        expect(modeConfig?.label).toBe('Import Mode');
        expect(modeConfig?.description).toBe('Mode Help');
        expect(modeConfig?.render?.items?.[0].label).toBe('Fast Mode');
        expect(arrayChild.label).toBe('Nested Setting');
        expect(arrayChild.description).toBe('Nested Help');
        expect(objectChild.label).toBe('Nested Setting');
        expect(config.userDataConfig?.unknown.label).toBe('assets.assetConfigMapTest.missing');

        expect(config.userDataConfig).not.toBe(rawUserDataConfig);
        expect(rawUserDataConfig.mode.label).toBe('i18n:assets.assetConfigMapTest.mode');
        expect(rawUserDataConfig.mode.render?.items?.[0].label).toBe('i18n:assets.assetConfigMapTest.fast');
        expect((rawUserDataConfig.mode.itemConfigs as IUerDataConfigItem[])[0].label).toBe('i18n:assets.assetConfigMapTest.nested');
    });

    it('returns language-specific labels from the existing queryAssetConfigMap path', async () => {
        addAssetHandler(createAssetHandler('localized-asset', {
            displayName: 'i18n:assets.assetConfigMapTest.asset',
            userDataConfig: {
                default: createUserDataConfig(),
            },
        }));

        await i18n.setLanguage('zh');
        const configMap = await assetManager.queryAssetConfigMap();

        expect(configMap['localized-asset'].displayName).toBe('ZH Asset');
        expect(configMap['localized-asset'].userDataConfig?.mode.label).toBe('ZH Mode');
        expect(configMap['localized-asset'].userDataConfig?.mode.render?.items?.[0].label).toBe('ZH Fast');
    });

    it('keeps raw i18n keys available through queryRawAssetConfigMap', async () => {
        const rawUserDataConfig = createUserDataConfig();
        addAssetHandler(createAssetHandler('localized-asset', {
            displayName: 'i18n:assets.assetConfigMapTest.asset',
            description: 'i18n:assets.assetConfigMapTest.description',
            userDataConfig: {
                default: rawUserDataConfig,
            },
        }));

        const rawConfigMap = await assetHandlerManager.queryRawAssetConfigMap();

        expect(rawConfigMap['localized-asset'].displayName).toBe('i18n:assets.assetConfigMapTest.asset');
        expect(rawConfigMap['localized-asset'].description).toBe('i18n:assets.assetConfigMapTest.description');
        expect(rawConfigMap['localized-asset'].userDataConfig).toBe(rawUserDataConfig);
        expect(rawConfigMap['localized-asset'].userDataConfig?.mode.label).toBe('i18n:assets.assetConfigMapTest.mode');
    });

    it('activates lazy asset handlers before building the config map', async () => {
        assetHandlerManager.register('asset-config-map-test', [{
            name: 'lazy-asset',
            extensions: ['.lazy'],
            load: async () => createAssetHandler('lazy-asset', {
                displayName: 'i18n:assets.assetConfigMapTest.lazyAsset',
            }),
        }] as any, true);

        const configMap = await assetManager.queryAssetConfigMap();

        expect(configMap['lazy-asset'].displayName).toBe('Lazy Asset');
        expect(assetHandlerManager.name2handler['lazy-asset']).toBeDefined();
    });
});

function resetAssetHandlerManager(): void {
    const manager = assetHandlerManager as any;
    assetHandlerManager.clear();
    manager.type2handler = {};
    manager.name2importer = {};
    manager._userDataCache = {};
    manager._defaultUserData = {};
}

function addAssetHandler(handler: AssetHandler): void {
    assetHandlerManager.name2handler[handler.name] = handler;
}

function createAssetHandler(
    name: string,
    overrides: Partial<AssetHandler> = {}
): AssetHandler {
    return {
        name,
        importer: {
            version: '1.0.0',
            import: async () => true,
        },
        ...overrides,
    } as AssetHandler;
}

function createUserDataConfig(): Record<string, IUerDataConfigItem> {
    return {
        mode: {
            label: 'i18n:assets.assetConfigMapTest.mode',
            description: 'i18n:assets.assetConfigMapTest.modeHelp',
            default: 'fast',
            render: {
                ui: 'ui-select',
                items: [
                    { label: 'i18n:assets.assetConfigMapTest.fast', value: 'fast' },
                ],
            },
            itemConfigs: [
                {
                    key: 'nested',
                    label: 'i18n:assets.assetConfigMapTest.nested',
                    description: 'i18n:assets.assetConfigMapTest.nestedHelp',
                    default: true,
                    render: { ui: 'ui-checkbox' },
                },
            ],
        },
        texture: {
            label: 'Texture',
            default: {},
            itemConfigs: {
                wrapMode: {
                    label: 'i18n:assets.assetConfigMapTest.nested',
                    default: 'repeat',
                    render: { ui: 'ui-input' },
                },
            },
        },
        unknown: {
            label: 'i18n:assets.assetConfigMapTest.missing',
            default: '',
            render: { ui: 'ui-input' },
        },
    };
}
