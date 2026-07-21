import { mkdtempSync, removeSync, writeJSONSync } from 'fs-extra';
import { tmpdir } from 'os';
import { join } from 'path';

jest.mock('../../base/i18n', () => ({
    __esModule: true,
    default: {
        t(key: string) { return key; },
        transI18nName(name: string) { return name; },
        setLanguage() {},
        registerLanguagePatch() {},
        _lang: 'en',
    },
}));

jest.mock('../share/builder-config', () => ({
    __esModule: true,
    default: {
        projectRoot: 'test-project',
        projectTempDir: 'project-temp',
        commonOptionConfigs: {},
    },
}));

jest.mock('../worker/builder/manager/asset-library', () => ({
    buildAssetLibrary: {
        assets: [],
        getAsset: jest.fn((uuid: string) => ({ uuid })),
    },
}));

jest.mock('../worker/builder/asset-handler/script', () => ({ ScriptBuilder: class {} }));
jest.mock('../manager/plugin', () => ({ pluginManager: { platformConfig: {} } }));
jest.mock('../../scripting', () => ({
    __esModule: true,
    default: { queryCCEModuleMap: jest.fn(() => ({})) },
}));
jest.mock('../../assets/manager/asset', () => ({ __esModule: true, default: {} }));
jest.mock('../../assets/manager/query', () => ({ __esModule: true, default: {} }));
jest.mock('../../configuration', () => ({ configurationRegistry: { register: jest.fn() } }));
jest.mock('../../../global', () => ({
    GlobalPaths: { workspace: 'test-workspace', staticDir: 'test-static' },
}));
jest.mock('cc', () => ({ EffectAsset: class {}, Material: class {} }));
jest.mock('cc/editor/serialization', () => ({ CCON: class {} }));

describe('BundleManager runtime preview internal assets', () => {
    const roots: string[] = [];

    afterEach(() => {
        for (const root of roots.splice(0)) {
            removeSync(root);
        }
        jest.clearAllMocks();
    });

    async function collectInternalAssets(featureFilteredEngine?: boolean): Promise<string[]> {
        const engineRoot = mkdtempSync(join(tmpdir(), 'runtime-preview-engine-features-'));
        roots.push(engineRoot);
        writeJSONSync(join(engineRoot, 'cc.config.json'), {
            features: {
                base: {
                    dependentAssets: ['base-asset'],
                },
                '2d': {
                    dependentAssets: ['2d-asset'],
                    dependentModules: ['base'],
                },
                'physics-cannon': {
                    dependentAssets: ['ba21476f-2866-4f81-9c4d-6e359316e448'],
                },
            },
        });

        const { BundleManager } = await import('../worker/builder/asset-handler/bundle');
        const manager = Object.create(BundleManager.prototype) as any;
        const internalAssets: string[] = [];
        manager.options = {
            preview: true,
            featureFilteredEngine,
            includeModules: ['2d'],
            engineInfo: { typescript: { path: engineRoot } },
            physicsConfig: {},
        };
        manager.bundleMap = {
            internal: {
                addRootAsset: (asset: { uuid: string }) => internalAssets.push(asset.uuid),
            },
        };
        manager.bundles = [];
        manager.cache = { scenes: [], scriptUuids: [], assetUuids: [] };
        manager._pacAssets = [];
        manager.updateProcess = jest.fn();

        await manager.initBundleRootAssets();
        return internalAssets;
    }

    it('limits runtime preview builtin assets to the feature-filtered engine modules', async () => {
        await expect(collectInternalAssets(true)).resolves.toEqual(['2d-asset', 'base-asset']);
    });

    it('keeps all builtin assets for ordinary full-engine preview', async () => {
        await expect(collectInternalAssets()).resolves.toEqual([
            'base-asset',
            '2d-asset',
            'ba21476f-2866-4f81-9c4d-6e359316e448',
        ]);
    });
});
