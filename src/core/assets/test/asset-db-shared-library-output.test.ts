import { join } from 'path';
import { TestGlobalEnv } from '../../../tests/global-env';

async function loadFreshRuntime() {
    jest.resetModules();
    const { configurationManager } = require('../../configuration') as typeof import('../../configuration');
    const project = (require('../../project') as typeof import('../../project')).default;
    const { Engine } = require('../../engine') as typeof import('../../engine');
    const assetConfig = (require('../asset-config') as typeof import('../asset-config')).default;

    return {
        configurationManager,
        project,
        Engine,
        assetConfig,
    };
}

describe('asset-db shared library output gate', () => {
    beforeEach(() => {
        jest.resetModules();
        delete process.env.COCOS_CLI_SHARED_LIBRARY_OUTPUT;
    });

    it('does not share project library output by default', async () => {
        const runtime = await loadFreshRuntime();
        await runtime.configurationManager.initialize(TestGlobalEnv.projectRoot);
        await runtime.project.open(TestGlobalEnv.projectRoot);
        await runtime.Engine.init(TestGlobalEnv.engineRoot);
        await runtime.assetConfig.init();

        const assetsDb = runtime.assetConfig.data.assetDBList.find((db) => db.name === 'assets');
        expect(assetsDb?.library).toBe(join(TestGlobalEnv.projectRoot, 'library', 'cli'));
    });

    it('shares project library output only when the explicit gate is enabled', async () => {
        process.env.COCOS_CLI_SHARED_LIBRARY_OUTPUT = '1';
        const runtime = await loadFreshRuntime();
        await runtime.configurationManager.initialize(TestGlobalEnv.projectRoot);
        await runtime.project.open(TestGlobalEnv.projectRoot);
        await runtime.Engine.init(TestGlobalEnv.engineRoot);
        await runtime.assetConfig.init();

        const assetsDb = runtime.assetConfig.data.assetDBList.find((db) => db.name === 'assets');
        expect(assetsDb?.library).toBe(join(TestGlobalEnv.projectRoot, 'library'));
        expect(assetsDb?.records).toEqual({
            info: join(TestGlobalEnv.projectRoot, 'library', '.cli-assets-info.json'),
            data: join(TestGlobalEnv.projectRoot, 'library', '.cli-assets-data.json'),
            dependency: join(TestGlobalEnv.projectRoot, 'library', '.cli-assets-dependency.json'),
            cache: join(TestGlobalEnv.projectRoot, 'library', '.cli-assets'),
        });
    });
});
