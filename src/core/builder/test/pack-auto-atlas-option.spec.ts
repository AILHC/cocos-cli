jest.mock('../../base/i18n', () => {
    const mock = {
        t(key: string) { return key; },
        transI18nName(name: string) { return name; },
        setLanguage() {},
        registerLanguagePatch() {},
        _lang: 'en',
    };
    return { __esModule: true, default: mock };
});

jest.mock('../share/builder-config', () => ({
    __esModule: true,
    default: {
        projectRoot: 'test-project',
        projectTempDir: 'project-temp',
        commonOptionConfigs: {},
    },
}));

jest.mock('../worker/builder/manager/asset-library', () => ({
    buildAssetLibrary: {},
}));

jest.mock('../worker/builder/asset-handler/script', () => ({
    ScriptBuilder: class {},
}));

jest.mock('../manager/plugin', () => ({
    pluginManager: {
        platformConfig: {},
    },
}));

jest.mock('../../scripting', () => ({
    __esModule: true,
    default: {
        queryCCEModuleMap: jest.fn(() => ({})),
    },
}));

jest.mock('../../assets/manager/asset', () => ({
    __esModule: true,
    default: {},
}));

jest.mock('../../assets/manager/query', () => ({
    __esModule: true,
    default: {},
}));

jest.mock('../../configuration', () => ({
    configurationRegistry: { register: jest.fn() },
}));

jest.mock('../../../global', () => ({
    GlobalPaths: {
        workspace: 'test-workspace',
        staticDir: 'test-static',
    },
}));

jest.mock('cc', () => ({
    EffectAsset: class {},
    Material: class {},
}));

jest.mock('cc/editor/serialization', () => ({
    CCON: class {},
}));

describe('BundleManager packAutoAtlas option', () => {
    beforeEach(() => {
        jest.resetModules();
    });

    async function createManager(packAutoAtlas?: boolean) {
        const { BundleManager } = await import('../worker/builder/asset-handler/bundle');
        const manager = Object.create(BundleManager.prototype) as any;
        manager.options = {};
        if (packAutoAtlas !== undefined) {
            manager.options.packAutoAtlas = packAutoAtlas;
        }
        manager.packImage = jest.fn(async () => undefined);
        manager.compressImage = jest.fn(async () => undefined);
        manager.outputAssets = jest.fn(async () => undefined);
        return manager;
    }

    it('skips automatic atlas packing when packAutoAtlas is false', async () => {
        const manager = await createManager(false);

        await manager.buildAsset();

        expect(manager.packImage).not.toHaveBeenCalled();
        expect(manager.compressImage).toHaveBeenCalledTimes(1);
        expect(manager.outputAssets).toHaveBeenCalledTimes(1);
    });

    it('runs automatic atlas packing when packAutoAtlas is true', async () => {
        const manager = await createManager(true);

        await manager.buildAsset();

        expect(manager.packImage).toHaveBeenCalledTimes(1);
        expect(manager.compressImage).toHaveBeenCalledTimes(1);
        expect(manager.outputAssets).toHaveBeenCalledTimes(1);
    });

    it('runs automatic atlas packing when packAutoAtlas is omitted', async () => {
        const manager = await createManager();

        await manager.buildAsset();

        expect(manager.packImage).toHaveBeenCalledTimes(1);
        expect(manager.compressImage).toHaveBeenCalledTimes(1);
        expect(manager.outputAssets).toHaveBeenCalledTimes(1);
    });
});
