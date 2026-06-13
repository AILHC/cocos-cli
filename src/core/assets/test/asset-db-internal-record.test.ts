'use strict';

import { join } from 'path';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { ensureDir, existsSync, readJSONSync, writeJSONSync } from 'fs-extra';
import { TestGlobalEnv } from '../../../tests/global-env';

const { AssetDB, map: assetDBMap } = require('@cocos/asset-db/libs/asset-db') as typeof import('@cocos/asset-db/libs/asset-db');
const { CustomConsole } = require('@cocos/asset-db/libs/console') as typeof import('@cocos/asset-db/libs/console');
const { DependencyManager } = require('@cocos/asset-db/libs/dependency') as typeof import('@cocos/asset-db/libs/dependency');
const { InfoManager } = require('@cocos/asset-db/libs/info') as typeof import('@cocos/asset-db/libs/info');

interface IAssetConfigRuntime {
    configurationManager: typeof import('../../configuration').configurationManager;
    project: typeof import('../../project').default;
    Engine: typeof import('../../engine').Engine;
    assetConfig: typeof import('../asset-config').default;
}

async function makeTempProject() {
    const root = await mkdtemp(join(tmpdir(), 'asset-db-record-'));
    const projectRoot = join(root, 'project');
    const target = join(projectRoot, 'assets');
    const library = join(projectRoot, 'library');
    const temp = join(projectRoot, 'temp');
    await ensureDir(target);
    await ensureDir(library);
    await ensureDir(temp);

    return {
        root,
        projectRoot,
        target,
        library,
        temp,
    };
}

async function loadFreshRuntime(): Promise<IAssetConfigRuntime> {
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

describe('asset-db internal record current behavior', () => {
    afterEach(() => {
        delete assetDBMap.internal;
        jest.restoreAllMocks();
    });

    it('migrates old InfoManager record into current empty file shape', async () => {
        const fixture = await makeTempProject();
        try {
            const infoPath = join(fixture.library, '.internal-info.json');
            const oldInfoPath = infoPath.replace('.json', '1.0.0.json');
            writeJSONSync(oldInfoPath, {
                [join(fixture.target, 'a.ts')]: {
                    time: 1,
                    uuid: 'uuid-a',
                },
                [join(fixture.target, 'missing.ts')]: {
                    time: 2,
                    uuid: 'uuid-missing',
                    missing: true,
                },
            }, { spaces: 2 });

            const manager = new InfoManager(new CustomConsole(0), fixture.target);
            await manager.setRecordJSON(infoPath);
            manager.saveImmediate();
            manager.destroy();

            const output = readJSONSync(infoPath);
            expect(existsSync(oldInfoPath)).toBe(false);
            expect(output).toHaveProperty('version', '1.0.1');
            // Current registry package drops old info entries while migrating to 1.0.1.
            expect(output).toHaveProperty('map', {});
            expect(output).toHaveProperty('missing', {});
        } finally {
            await rm(fixture.root, { recursive: true, force: true });
        }
    });

    it('migrates old DependencyManager record into current data shape', async () => {
        const fixture = await makeTempProject();
        try {
            const dependencyPath = join(fixture.library, '.internal-dependency.json');
            writeJSONSync(dependencyPath, {
                path: {
                    [join(fixture.projectRoot, 'assets', 'a.ts')]: [
                        join(fixture.projectRoot, 'assets', 'b.ts'),
                    ],
                },
                uuid: {
                    [join(fixture.projectRoot, 'assets', 'a.ts')]: ['uuid-b'],
                },
            }, { spaces: 2 });

            const manager = new DependencyManager(new CustomConsole(0), fixture.target);
            await manager.setRecordJSON(dependencyPath);
            manager.saveImmediate();
            manager.destroy();

            const output = readJSONSync(dependencyPath);
            const relativeAsset = 'a.ts';
            const relativeDependency = 'b.ts';
            expect(output).toHaveProperty('version', '1.0.0');
            expect(output).toHaveProperty('data.path');
            expect(output).toHaveProperty('data.uuid');
            expect(output.data.path[relativeAsset]).toContain(relativeDependency);
            expect(output.data.uuid[relativeAsset]).toContain('uuid-b');
            expect(output).not.toHaveProperty('path');
            expect(output).not.toHaveProperty('uuid');
        } finally {
            await rm(fixture.root, { recursive: true, force: true });
        }
    });

    it('sets current internal record file paths during AssetDB.prepareStart', async () => {
        const fixture = await makeTempProject();
        try {
            const db = new AssetDB({
                name: 'internal',
                target: fixture.target,
                library: fixture.library,
                temp: fixture.temp,
                level: 0,
                ignoreFiles: [],
                readonly: true,
            });

            const infoSpy = jest.spyOn(db.infoManager, 'setRecordJSON').mockResolvedValue(undefined);
            const dataSpy = jest.spyOn(db.dataManager, 'setRecordJSON').mockResolvedValue(undefined);
            const dependencySpy = jest.spyOn(db.dependencyManager, 'setRecordJSON').mockResolvedValue(undefined);

            await (db as any).prepareStart();

            expect(infoSpy).toHaveBeenCalledWith(join(fixture.library, '.internal-info.json'));
            expect(dataSpy).toHaveBeenCalledWith(join(fixture.library, '.internal-data.json'));
            expect(dependencySpy).toHaveBeenCalledWith(join(fixture.library, '.internal-dependency.json'));
        } finally {
            delete assetDBMap.internal;
            await rm(fixture.root, { recursive: true, force: true });
        }
    });

    it('keeps CLI internal.library current behavior at project library root', async () => {
        const runtime = await loadFreshRuntime();
        await runtime.configurationManager.initialize(TestGlobalEnv.projectRoot);
        await runtime.project.open(TestGlobalEnv.projectRoot);
        await runtime.Engine.init(TestGlobalEnv.engineRoot);
        await runtime.assetConfig.init();

        expect(runtime.assetConfig.data.assetDBList.find((assetDB) => assetDB.name === 'internal')?.library)
            .toBe(join(TestGlobalEnv.projectRoot, 'library'));
    });
});
