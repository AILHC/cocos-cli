'use strict';

import { join } from 'path';
import { ensureDir, existsSync, readJSONSync, remove, writeJSONSync } from 'fs-extra';
import { TestGlobalEnv } from '../../../tests/global-env';

interface IAssetConfigRuntime {
    configurationManager: typeof import('../../configuration').configurationManager;
    project: typeof import('../../project').default;
    Engine: typeof import('../../engine').Engine;
    assetConfig: typeof import('../asset-config').default;
    assetDBManager: typeof import('../manager/asset-db').default;
    assetHandlerManager: typeof import('../manager/asset-handler').default;
}

const configPath = join(TestGlobalEnv.projectRoot, 'cocos.config.json');
const originalConfig = readJSONSync(configPath);
const legacyTemplateRoot = join(TestGlobalEnv.projectRoot, '.creator', 'asset-template');

function createImportConfig(customTemplateRoot: string) {
    return {
        globList: ['!**/*.tmp', '!**/*.bak'],
        restoreAssetDBFromCache: true,
        createTemplateRoot: customTemplateRoot,
        fbx: {
            material: {
                smart: true,
            },
        },
    };
}

function writeProjectImportConfig(importConfig: Record<string, unknown>) {
    const nextConfig = JSON.parse(JSON.stringify(originalConfig));
    nextConfig.import = importConfig;
    writeJSONSync(configPath, nextConfig, { spaces: 4 });
}

async function loadFreshRuntime(): Promise<IAssetConfigRuntime> {
    jest.resetModules();
    const { configurationManager } = require('../../configuration') as typeof import('../../configuration');
    const project = (require('../../project') as typeof import('../../project')).default;
    const { Engine } = require('../../engine') as typeof import('../../engine');
    const assetConfig = (require('../asset-config') as typeof import('../asset-config')).default;
    const assetDBManager = (require('../manager/asset-db') as typeof import('../manager/asset-db')).default;
    const assetHandlerManager = (require('../manager/asset-handler') as typeof import('../manager/asset-handler')).default;

    return {
        configurationManager,
        project,
        Engine,
        assetConfig,
        assetDBManager,
        assetHandlerManager,
    };
}

describe('asset import config sync', () => {
    afterEach(async () => {
        writeJSONSync(configPath, JSON.parse(JSON.stringify(originalConfig)), { spaces: 4 });
        await remove(legacyTemplateRoot);
        const creatorRoot = join(TestGlobalEnv.projectRoot, '.creator');
        if (existsSync(creatorRoot)) {
            const entries = require('fs').readdirSync(creatorRoot);
            for (const entry of entries) {
                if (entry.startsWith('custom-template-root-')) {
                    await remove(join(creatorRoot, entry));
                }
            }
        }
    });

    it('should sync project import config into the runtime asset config and asset-db state', async () => {
        const customTemplateRoot = `.creator/custom-template-root-${Date.now()}`;
        writeProjectImportConfig(createImportConfig(customTemplateRoot));

        const runtime = await loadFreshRuntime();
        await runtime.configurationManager.initialize(TestGlobalEnv.projectRoot);
        await runtime.project.open(TestGlobalEnv.projectRoot);
        await runtime.Engine.init(TestGlobalEnv.engineRoot);
        await ensureDir(join(TestGlobalEnv.projectRoot, 'library'));
        await runtime.assetConfig.init();
        await runtime.assetDBManager.init();

        await expect(runtime.assetConfig.getProject<string[]>('globList')).resolves.toEqual(['!**/*.tmp', '!**/*.bak']);
        await expect(runtime.assetConfig.getProject<boolean>('restoreAssetDBFromCache')).resolves.toEqual(true);
        await expect(runtime.assetConfig.getProject<string>('createTemplateRoot')).resolves.toEqual(customTemplateRoot);
        await expect(runtime.assetConfig.getProject<boolean>('fbx.material.smart')).resolves.toBe(false);

        expect(runtime.assetConfig.data.globList).toEqual(['!**/*.tmp', '!**/*.bak']);
        expect(runtime.assetConfig.data.restoreAssetDBFromCache).toBe(true);
        expect(runtime.assetConfig.data.createTemplateRoot).toBe(join(TestGlobalEnv.projectRoot, customTemplateRoot));
        expect(runtime.assetConfig.data.assetDBList.find((assetDB) => assetDB.name === 'internal')?.library)
            .toBe(join(TestGlobalEnv.projectRoot, 'library'));
        expect((runtime.assetDBManager as any).constructor.useCache).toBe(true);
        expect(runtime.assetDBManager.assetDBInfo.assets.globList).toEqual(['!**/*.tmp', '!**/*.bak']);
    });

    it('should use the configured template root when preparing the TypeScript create menu', async () => {
        const customTemplateRoot = `.creator/custom-template-root-${Date.now()}`;
        writeProjectImportConfig(createImportConfig(customTemplateRoot));

        const runtime = await loadFreshRuntime();
        await runtime.configurationManager.initialize(TestGlobalEnv.projectRoot);
        await runtime.project.open(TestGlobalEnv.projectRoot);
        await runtime.Engine.init(TestGlobalEnv.engineRoot);
        await runtime.assetConfig.init();
        await runtime.assetDBManager.init();

        const configuredGuideFile = join(TestGlobalEnv.projectRoot, customTemplateRoot, 'typescript', 'Custom Script Template Help Documentation.url');
        const legacyGuideFile = join(legacyTemplateRoot, 'typescript', 'Custom Script Template Help Documentation.url');

        await runtime.assetHandlerManager.getCreateMenuByName('typescript');

        expect(existsSync(configuredGuideFile)).toBe(true);
        expect(existsSync(legacyGuideFile)).toBe(false);
    });
});
