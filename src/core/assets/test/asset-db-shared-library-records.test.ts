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

describe('asset-db sidecar record path configuration', () => {
    beforeEach(() => {
        jest.resetModules();
        delete process.env.COCOS_CLI_SHARED_LIBRARY_OUTPUT;
    });

    it('uses shared project library output with CLI sidecar records by default', async () => {
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

    it('keeps assets output isolated and records under library/cli when shared output is explicitly disabled', async () => {
        process.env.COCOS_CLI_SHARED_LIBRARY_OUTPUT = '0';
        const runtime = await loadFreshRuntime();
        await runtime.configurationManager.initialize(TestGlobalEnv.projectRoot);
        await runtime.project.open(TestGlobalEnv.projectRoot);
        await runtime.Engine.init(TestGlobalEnv.engineRoot);
        await runtime.assetConfig.init();

        const assetsDb = runtime.assetConfig.data.assetDBList.find((db) => db.name === 'assets');
        expect(assetsDb?.library).toBe(join(TestGlobalEnv.projectRoot, 'library', 'cli'));
        expect(assetsDb?.records).toEqual({
            info: join(TestGlobalEnv.projectRoot, 'library', 'cli', '.assets-info.json'),
            data: join(TestGlobalEnv.projectRoot, 'library', 'cli', '.assets-data.json'),
            dependency: join(TestGlobalEnv.projectRoot, 'library', 'cli', '.assets-dependency.json'),
            cache: join(TestGlobalEnv.projectRoot, 'library', 'cli', '.assets'),
        });
    });

    afterEach(() => {
        delete process.env.COCOS_CLI_SHARED_LIBRARY_OUTPUT;
    });
});
