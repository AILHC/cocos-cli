'use strict';

import { join } from 'path';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { ensureDir, existsSync, readJSONSync, writeJSONSync } from 'fs-extra';
import { TestGlobalEnv } from '../../../tests/global-env';

const { AssetDB, map: assetDBMap } = require('@cocos/asset-db/libs/asset-db') as typeof import('@cocos/asset-db/libs/asset-db');
const { CustomConsole } = require('@cocos/asset-db/libs/console') as typeof import('@cocos/asset-db/libs/console');
const { DataManager } = require('@cocos/asset-db/libs/data') as typeof import('@cocos/asset-db/libs/data');
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

describe('asset-db internal record editor parity', () => {
    afterEach(() => {
        delete assetDBMap.internal;
        jest.restoreAllMocks();
    });

    it('keeps internal InfoManager record in editor 1.0.0 file shape', async () => {
        const fixture = await makeTempProject();
        try {
            const currentInfoPath = join(fixture.library, '.internal-info.json');
            const infoPath = join(fixture.library, '.internal-info1.0.0.json');
            writeJSONSync(infoPath, {
                version: '1.0.0',
                map: {
                    [join(fixture.target, 'a.ts')]: {
                        time: 1,
                        uuid: 'uuid-a',
                    },
                },
                missing: {
                    'uuid-missing': {
                        path: join(fixture.target, 'missing.ts'),
                        time: 2,
                        removeTime: 3,
                    },
                },
            }, { spaces: 2 });

            const manager = new InfoManager(new CustomConsole(0), fixture.target);
            await manager.setRecordJSON(infoPath);
            manager.add(join(fixture.target, 'b.ts'), 4, 'uuid-b');
            manager.saveImmediate();
            manager.destroy();

            const output = readJSONSync(infoPath);
            expect(existsSync(currentInfoPath)).toBe(false);
            expect(output).toHaveProperty('version', '1.0.0');
            expect(output.map[join(fixture.target, 'a.ts')]).toEqual({ time: 1, uuid: 'uuid-a' });
            expect(output.map[join(fixture.target, 'b.ts')]).toEqual({ time: 4, uuid: 'uuid-b' });
            expect(output.missing['uuid-missing']).toEqual({
                path: join(fixture.target, 'missing.ts'),
                time: 2,
                removeTime: 3,
            });
        } finally {
            await rm(fixture.root, { recursive: true, force: true });
        }
    });

    it('keeps internal DependencyManager record in editor path uuid shape', async () => {
        const fixture = await makeTempProject();
        try {
            const dependencyPath = join(fixture.library, '.internal-dependency.json');
            writeJSONSync(dependencyPath, {
                path: {
                    [join(fixture.target, 'a.ts')]: [
                        join(fixture.target, 'b.ts'),
                    ],
                },
                uuid: {
                    [join(fixture.target, 'a.ts')]: ['uuid-b'],
                },
            }, { spaces: 2 });

            const manager = new DependencyManager(new CustomConsole(0), fixture.target);
            await manager.setRecordJSON(dependencyPath);
            manager.add('path', join(fixture.target, 'c.ts'), join(fixture.target, 'd.ts'));
            manager.add('uuid', join(fixture.target, 'c.ts'), 'uuid-d');
            manager.saveImmediate();
            manager.destroy();

            const output = readJSONSync(dependencyPath);
            expect(output).toHaveProperty('path');
            expect(output).toHaveProperty('uuid');
            expect(output.path[join(fixture.target, 'a.ts')]).toContain(join(fixture.target, 'b.ts'));
            expect(output.path[join(fixture.target, 'c.ts')]).toContain(join(fixture.target, 'd.ts'));
            expect(output.uuid[join(fixture.target, 'a.ts')]).toContain('uuid-b');
            expect(output.uuid[join(fixture.target, 'c.ts')]).toContain('uuid-d');
            expect(output).not.toHaveProperty('data');
            expect(output).not.toHaveProperty('version');
        } finally {
            await rm(fixture.root, { recursive: true, force: true });
        }
    });

    it('preserves existing internal DataManager record values in editor shape', async () => {
        const fixture = await makeTempProject();
        try {
            const dataPath = join(fixture.library, '.internal-data.json');
            const asset = {
                uuid: 'uuid-a',
                url: 'db://internal/a',
                versionCode: 3,
            } as any;
            writeJSONSync(dataPath, {
                'uuid-a': {
                    url: 'db://internal/a',
                    value: {
                        depends: ['old-dependency'],
                    },
                    versionCode: 1,
                },
            }, { spaces: 2 });

            const manager = new DataManager(new CustomConsole(0));
            await manager.setRecordJSON(dataPath);
            manager.empty(asset);
            manager.setValue(asset, 'depends', ['new-dependency']);
            manager.update(asset);
            manager.saveImmediate();

            const output = readJSONSync(dataPath);
            expect(output['uuid-a']).toEqual({
                url: 'db://internal/a',
                value: {
                    depends: ['old-dependency'],
                },
                versionCode: 1,
            });
        } finally {
            await rm(fixture.root, { recursive: true, force: true });
        }
    });

    it('keeps non-internal DataManager record current mutation behavior', async () => {
        const fixture = await makeTempProject();
        try {
            const dataPath = join(fixture.library, '.assets-data.json');
            const asset = {
                uuid: 'uuid-a',
                url: 'db://assets/a',
                versionCode: 3,
            } as any;
            writeJSONSync(dataPath, {
                'uuid-a': {
                    url: 'db://assets/a',
                    value: {
                        depends: ['old-dependency'],
                    },
                    versionCode: 1,
                },
            }, { spaces: 2 });

            const manager = new DataManager(new CustomConsole(0));
            await manager.setRecordJSON(dataPath);
            manager.empty(asset);
            manager.setValue(asset, 'depends', ['new-dependency']);
            manager.saveImmediate();

            const output = readJSONSync(dataPath);
            expect(output['uuid-a']).toEqual({
                url: 'db://assets/a',
                value: {
                    depends: ['new-dependency'],
                },
                versionCode: 3,
            });
        } finally {
            await rm(fixture.root, { recursive: true, force: true });
        }
    });

    it('keeps non-internal DependencyManager record in current data shape', async () => {
        const fixture = await makeTempProject();
        try {
            const dependencyPath = join(fixture.library, '.assets-dependency.json');
            writeJSONSync(dependencyPath, {
                path: {
                    [join(fixture.target, 'a.ts')]: [
                        join(fixture.target, 'b.ts'),
                    ],
                },
                uuid: {
                    [join(fixture.target, 'a.ts')]: ['uuid-b'],
                },
            }, { spaces: 2 });

            const manager = new DependencyManager(new CustomConsole(0), fixture.target);
            await manager.setRecordJSON(dependencyPath);
            manager.saveImmediate();
            manager.destroy();

            const output = readJSONSync(dependencyPath);
            expect(output).toHaveProperty('version', '1.0.0');
            expect(output).toHaveProperty('data.path');
            expect(output).toHaveProperty('data.uuid');
            expect(output.data.path['a.ts']).toContain('b.ts');
            expect(output.data.uuid['a.ts']).toContain('uuid-b');
        } finally {
            await rm(fixture.root, { recursive: true, force: true });
        }
    });

    it('sets editor internal record file paths during AssetDB.prepareStart', async () => {
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

            expect(infoSpy).toHaveBeenCalledWith(join(fixture.library, '.internal-info1.0.0.json'));
            expect(dataSpy).toHaveBeenCalledWith(join(fixture.library, '.internal-data.json'));
            expect(dependencySpy).toHaveBeenCalledWith(join(fixture.library, '.internal-dependency.json'));
        } finally {
            delete assetDBMap.internal;
            await rm(fixture.root, { recursive: true, force: true });
        }
    });

    it('keeps non-internal record file paths during AssetDB.prepareStart', async () => {
        const fixture = await makeTempProject();
        try {
            const db = new AssetDB({
                name: 'assets',
                target: fixture.target,
                library: fixture.library,
                temp: fixture.temp,
                level: 0,
                ignoreFiles: [],
                readonly: false,
            });

            const infoSpy = jest.spyOn(db.infoManager, 'setRecordJSON').mockResolvedValue(undefined);
            const dataSpy = jest.spyOn(db.dataManager, 'setRecordJSON').mockResolvedValue(undefined);
            const dependencySpy = jest.spyOn(db.dependencyManager, 'setRecordJSON').mockResolvedValue(undefined);

            await (db as any).prepareStart();

            expect(infoSpy).toHaveBeenCalledWith(join(fixture.library, '.assets-info.json'));
            expect(dataSpy).toHaveBeenCalledWith(join(fixture.library, '.assets-data.json'));
            expect(dependencySpy).toHaveBeenCalledWith(join(fixture.library, '.assets-dependency.json'));
        } finally {
            delete assetDBMap.assets;
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
