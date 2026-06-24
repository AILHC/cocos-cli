export {};

const mockCopy = jest.fn();
const mockExistsSync = jest.fn();
const mockCopyPath = jest.fn();
const mockMoveAssetSource = jest.fn();
const mockRenamePath = jest.fn();
const mockQueryAsset = jest.fn();
const mockQueryAssetInfo = jest.fn();
const mockQueryAssetInfos = jest.fn();
const mockQueryUrl = jest.fn();
const mockAssetQueryUrl = jest.fn();
const mockRefresh = jest.fn(async (_pathOrUrlOrUUID: string) => 0);
const mockAddTask = jest.fn(async (func: Function, args: any[]) => await func(...args));
const mockGetCreateMenuByName = jest.fn();
const mockCreateAssetByHandler = jest.fn();
const mockSaveAssetByHandler = jest.fn();
const { dirname, join } = require('path') as typeof import('path');

jest.mock('fs-extra', () => ({
    copy: (...args: any[]) => mockCopy(...args),
    move: jest.fn(),
    remove: jest.fn(),
    rename: jest.fn(),
    existsSync: (...args: any[]) => mockExistsSync(...args),
}));

jest.mock('@cocos/asset-db', () => ({
    refresh: (pathOrUrlOrUUID: string) => mockRefresh(pathOrUrlOrUUID),
    reimport: jest.fn(),
    queryUrl: (...args: any[]) => mockQueryUrl(...args),
    Asset: class {},
}));

jest.mock('../utils', () => ({
    url2path: jest.fn((value) => {
        if (value === 'db://assets') {
            return 'D:/project/assets';
        }
        if (value.startsWith('db://assets/')) {
            return `D:/project/assets/${value.slice('db://assets/'.length)}`;
        }
        return value;
    }),
    ensureOutputData: jest.fn(),
    url2uuid: jest.fn((value) => value),
    pathToDbUrlIfAssetDBPath: jest.fn((value: string, assetDBInfo: Record<string, { name: string; target: string }>) => {
        if (!value || value.startsWith('db://')) {
            return value;
        }
        if (value.startsWith('assets/') || value === 'assets') {
            return value === 'assets' ? 'db://assets' : `db://assets/${value.slice('assets/'.length)}`;
        }
        if (value === 'D:/project/assets/resources/Image' || value === 'assets/resources/Image') {
            return 'db://assets/resources/Image';
        }
        if (value === 'D:/project/assets/resources/Image/snake_head.png') {
            return 'db://assets/resources/Image/snake_head.png';
        }
        return assetDBInfo.assets && value === assetDBInfo.assets.target ? 'db://assets' : value;
    }),
    dirnameForDbUrlOrPath: jest.fn((value: string) => {
        if (value.startsWith('db://')) {
            const index = value.lastIndexOf('/');
            return index <= 'db://assets'.length ? 'db://assets' : value.slice(0, index);
        }
        return value.replace(/[\\/][^\\/]*$/, '');
    }),
}));

jest.mock('../manager/filesystem', () => ({
    copyPath: (...args: any[]) => mockCopyPath(...args),
    moveAssetSource: (...args: any[]) => mockMoveAssetSource(...args),
    renamePath: (...args: any[]) => mockRenamePath(...args),
    removeAssetSource: jest.fn(),
    setFileSystemProvider: jest.fn(),
    resetFileSystemProvider: jest.fn(),
}));

jest.mock('../manager/asset-db', () => ({
    __esModule: true,
    default: {
        addTask: (func: Function, args: any[]) => mockAddTask(func, args),
        autoRefreshAssetLazy: jest.fn(),
        assetDBInfo: {},
        assetDBMap: {},
    },
}));

jest.mock('../manager/asset-handler', () => ({
    __esModule: true,
    default: {
        getCreateMenuByName: (...args: any[]) => mockGetCreateMenuByName(...args),
        createAsset: (...args: any[]) => mockCreateAssetByHandler(...args),
        saveAsset: (...args: any[]) => mockSaveAssetByHandler(...args),
    },
}));

jest.mock('../asset-config', () => ({
    __esModule: true,
    default: {
        data: {
            tempRoot: 'D:/project/temp',
            root: 'D:/project',
        },
    },
}));

jest.mock('../manager/query', () => ({
    __esModule: true,
    default: {
        queryAsset: (...args: any[]) => mockQueryAsset(...args),
        encodeAsset: jest.fn((asset) => ({ source: asset.source })),
        queryUrl: (...args: any[]) => mockAssetQueryUrl(...args),
        queryAssetInfo: (...args: any[]) => mockQueryAssetInfo(...args),
        queryAssetInfos: (...args: any[]) => mockQueryAssetInfos(...args),
    },
}));

jest.mock('../asset-handler/utils', () => ({
    mergeMeta: jest.fn(),
}));

jest.mock('../../base/i18n', () => ({
    __esModule: true,
    default: {
        t: (key: string) => key,
    },
}));

describe('asset operation filesystem bridge', () => {
    function setAssetDBInfo(target = 'D:/project/assets') {
        const assetDBManager = require('../manager/asset-db').default as typeof import('../manager/asset-db').default;
        assetDBManager.assetDBInfo.assets = {
            name: 'assets',
            target,
            readonly: false,
            temp: 'D:/project/temp/assets',
            library: 'D:/project/library',
            level: 0,
            globList: [],
            ignoreFiles: [],
            visible: true,
            state: 'none',
            preImportExtList: [],
        };
    }

    beforeEach(() => {
        jest.clearAllMocks();
        const assetDBManager = require('../manager/asset-db').default as typeof import('../manager/asset-db').default;
        Object.keys(assetDBManager.assetDBInfo).forEach((key) => delete assetDBManager.assetDBInfo[key]);
        mockAssetQueryUrl.mockImplementation((value: string) => {
            const normalized = value.replace(/\\/g, '/');
            if (normalized.startsWith('D:/project/assets/')) {
                return `db://assets/${normalized.slice('D:/project/assets/'.length)}`;
            }
            if (normalized === 'D:/project/assets') {
                return 'db://assets';
            }
            return '';
        });
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('renameAsset should delegate rename steps to filesystem bridge', async () => {
        const { assetOperation } = require('../manager/operation') as typeof import('../manager/operation');
        const source = 'D:/project/assets/source.txt';
        const target = join(dirname(source), 'renamed.txt');
        const temp = join(dirname(target), '.rename_temp');
        const asset = {
            source,
            _parent: null,
            isDirectory: () => false,
            _assetDB: {
                options: {
                    readonly: false,
                },
            },
            url: 'db://assets/source.txt',
        };

        mockQueryAsset.mockReturnValue(asset);
        mockExistsSync.mockImplementation((path: string) => path === source);
        mockRenamePath.mockResolvedValue(undefined);

        await assetOperation.renameAsset(source, 'renamed.txt');

        expect(mockRenamePath.mock.calls).toEqual([
            [`${source}.meta`, `${temp}.meta`],
            [source, temp],
            [`${temp}.meta`, `${target}.meta`],
            [temp, target],
        ]);
    });

    it('moveAsset should delegate source move to filesystem bridge', async () => {
        const { assetOperation } = require('../manager/operation') as typeof import('../manager/operation');
        const source = 'D:/project/assets/source.txt';
        const target = 'D:/project/assets/folder/source.txt';
        const asset = {
            source,
            _parent: null,
            isDirectory: () => false,
            _assetDB: {
                options: {
                    readonly: false,
                },
            },
            url: 'db://assets/source.txt',
        };

        mockQueryAsset.mockReturnValue(asset);
        mockQueryUrl.mockReturnValue('db://assets/folder/source.txt');
        mockExistsSync.mockReturnValue(false);
        mockMoveAssetSource.mockResolvedValue(undefined);
        jest.spyOn(assetOperation, 'refreshAsset').mockResolvedValue(0);

        await assetOperation.moveAsset(source, target);

        expect(mockMoveAssetSource).toHaveBeenCalledWith(source, target, undefined);
    });

    it('importAsset should delegate copy to filesystem bridge', async () => {
        const { assetOperation } = require('../manager/operation') as typeof import('../manager/operation');
        const source = 'D:/outside/source.txt';
        const target = 'D:/project/assets/source.txt';
        const assetInfo = {
            isDirectory: false,
            url: 'db://assets/source.txt',
        };

        mockCopyPath.mockResolvedValue(undefined);
        mockQueryAssetInfo.mockReturnValue(assetInfo);
        jest.spyOn(assetOperation, 'refreshAsset').mockResolvedValue(0);

        const result = await assetOperation.importAsset(source, target, { overwrite: true });

        expect(mockCopyPath).toHaveBeenCalledWith(source, target, { overwrite: true });
        expect(mockCopy).not.toHaveBeenCalled();
        expect(result).toEqual([assetInfo]);
    });

    it('refreshAsset should normalize an absolute asset-db path before refreshing', async () => {
        const { assetOperation } = require('../manager/operation') as typeof import('../manager/operation');
        setAssetDBInfo();

        await assetOperation.refreshAsset('D:/project/assets/resources/Image');

        expect(mockRefresh).toHaveBeenCalledWith('db://assets/resources/Image');
    });

    it('refreshAsset should normalize a database-name relative asset path before refreshing', async () => {
        const { assetOperation } = require('../manager/operation') as typeof import('../manager/operation');
        setAssetDBInfo();

        await assetOperation.refreshAsset('assets/resources/Image');

        expect(mockRefresh).toHaveBeenCalledWith('db://assets/resources/Image');
    });

    it('importAsset should refresh an existing file in the asset DB when source and target are the same path', async () => {
        const { assetOperation } = require('../manager/operation') as typeof import('../manager/operation');
        const target = 'D:/project/assets/resources/Image/snake_head.png';
        const assetInfo = {
            isDirectory: false,
            url: 'db://assets/resources/Image/snake_head.png',
        };

        setAssetDBInfo();
        mockQueryAssetInfo.mockReturnValue(assetInfo);

        const result = await assetOperation.importAsset(target, target, { overwrite: true });

        expect(mockCopyPath).not.toHaveBeenCalled();
        expect(mockRefresh).toHaveBeenCalledWith('db://assets/resources/Image/snake_head.png');
        expect(mockQueryAssetInfo).toHaveBeenCalledWith('db://assets/resources/Image/snake_head.png');
        expect(result).toEqual([assetInfo]);
    });

    it('importAsset should copy external files to the physical target and refresh the db url', async () => {
        const { assetOperation } = require('../manager/operation') as typeof import('../manager/operation');
        const source = 'D:/outside/snake_head.png';
        const target = 'D:/project/assets/resources/Image/snake_head.png';
        const assetInfo = {
            isDirectory: false,
            url: 'db://assets/resources/Image/snake_head.png',
        };

        setAssetDBInfo();
        mockCopyPath.mockResolvedValue(undefined);
        mockQueryAssetInfo.mockReturnValue(assetInfo);

        const result = await assetOperation.importAsset(source, target, { overwrite: true });

        expect(mockCopyPath).toHaveBeenCalledWith(source, target, { overwrite: true });
        expect(mockRefresh).toHaveBeenCalledWith('db://assets/resources/Image/snake_head.png');
        expect(mockQueryAssetInfo).toHaveBeenCalledWith('db://assets/resources/Image/snake_head.png');
        expect(result).toEqual([assetInfo]);
    });

    it('createAssetByType should resolve a database-name relative directory before creating', async () => {
        const { assetOperation } = require('../manager/operation') as typeof import('../manager/operation');
        setAssetDBInfo();
        mockGetCreateMenuByName.mockResolvedValue([{
            name: 'default',
            label: 'TypeScript',
            fullFileName: 'NewComponent.ts',
            handler: 'typescript',
            template: 'typescript-template',
        }]);
        const target = join('D:/project/assets/Script', 'Food.ts');
        mockCreateAssetByHandler.mockResolvedValue(target);
        mockQueryAsset.mockReturnValue({
            source: target,
            imported: true,
            invalid: false,
        });

        await assetOperation.createAssetByType('typescript', 'assets/Script', 'Food');

        expect(mockCreateAssetByHandler).toHaveBeenCalledWith(expect.objectContaining({
            handler: 'typescript',
            target,
            template: 'typescript-template',
        }));
    });

    it('createAssetByType should not duplicate the extension when baseName already includes it', async () => {
        const { assetOperation } = require('../manager/operation') as typeof import('../manager/operation');
        setAssetDBInfo();
        mockGetCreateMenuByName.mockResolvedValue([{
            name: 'default',
            label: 'TypeScript',
            fullFileName: 'NewComponent.ts',
            handler: 'typescript',
        }]);
        const target = join('D:/project/assets/Script', 'Food.ts');
        mockCreateAssetByHandler.mockResolvedValue(target);
        mockQueryAsset.mockReturnValue({
            source: target,
            imported: true,
            invalid: false,
        });

        await assetOperation.createAssetByType('typescript', 'assets/Script', 'Food.ts');

        expect(mockCreateAssetByHandler).toHaveBeenCalledWith(expect.objectContaining({
            target,
        }));
    });

    it('saveAsset should reject incomplete TypeScript content before writing', async () => {
        const { assetOperation } = require('../manager/operation') as typeof import('../manager/operation');
        const reimport = jest.fn();
        const asset = {
            source: 'D:/project/assets/scripts/Board.ts',
            uuid: 'script-uuid',
            imported: true,
            invalid: false,
            meta: {
                importer: 'typescript',
            },
            _assetDB: {
                options: {
                    readonly: false,
                },
                reimport,
            },
        };
        mockQueryAsset.mockReturnValue(asset);

        await expect(assetOperation.saveAsset(
            'db://assets/scripts/Board.ts',
            "import { _decorator } from 'cc';\nexport class Board {\n"
        )).rejects.toThrow('Invalid script content');

        expect(mockSaveAssetByHandler).not.toHaveBeenCalled();
        expect(reimport).not.toHaveBeenCalled();
    });

    it('saveAsset should keep valid TypeScript content writable', async () => {
        const { assetOperation } = require('../manager/operation') as typeof import('../manager/operation');
        const reimport = jest.fn();
        const asset = {
            source: 'D:/project/assets/scripts/Board.ts',
            uuid: 'script-uuid',
            imported: true,
            invalid: false,
            meta: {
                importer: 'typescript',
            },
            _assetDB: {
                options: {
                    readonly: false,
                },
                reimport,
            },
        };
        const content = "import { _decorator } from 'cc';\nexport class Board {}\n";
        mockQueryAsset.mockReturnValue(asset);
        mockSaveAssetByHandler.mockResolvedValue(true);

        await assetOperation.saveAsset('db://assets/scripts/Board.ts', content);

        expect(mockSaveAssetByHandler).toHaveBeenCalledWith(asset, content);
        expect(reimport).toHaveBeenCalledWith('script-uuid');
    });

    it('saveAsset should reject invalid scene JSON before writing', async () => {
        const { assetOperation } = require('../manager/operation') as typeof import('../manager/operation');
        const reimport = jest.fn();
        const asset = {
            source: 'D:/project/assets/scenes/GameScene.scene',
            uuid: 'scene-uuid',
            imported: true,
            invalid: false,
            meta: {
                importer: 'scene',
            },
            _assetDB: {
                options: {
                    readonly: false,
                },
                reimport,
            },
        };
        mockQueryAsset.mockReturnValue(asset);

        await expect(assetOperation.saveAsset(
            'db://assets/scenes/GameScene.scene',
            'test content'
        )).rejects.toThrow('Invalid scene/prefab asset content');

        expect(mockSaveAssetByHandler).not.toHaveBeenCalled();
        expect(reimport).not.toHaveBeenCalled();
    });

    it('saveAsset should reject incomplete prefab JSON before writing', async () => {
        const { assetOperation } = require('../manager/operation') as typeof import('../manager/operation');
        const reimport = jest.fn();
        const asset = {
            source: 'D:/project/assets/prefabs/Hero.prefab',
            uuid: 'prefab-uuid',
            imported: true,
            invalid: false,
            meta: {
                importer: 'prefab',
            },
            _assetDB: {
                options: {
                    readonly: false,
                },
                reimport,
            },
        };
        mockQueryAsset.mockReturnValue(asset);

        await expect(assetOperation.saveAsset(
            'db://assets/prefabs/Hero.prefab',
            '[{"__type__":"cc.Prefab"'
        )).rejects.toThrow('Invalid scene/prefab asset content');

        expect(mockSaveAssetByHandler).not.toHaveBeenCalled();
        expect(reimport).not.toHaveBeenCalled();
    });

    it('saveAsset should keep valid scene and prefab JSON writable', async () => {
        const { assetOperation } = require('../manager/operation') as typeof import('../manager/operation');
        const reimport = jest.fn();
        const sceneAsset = {
            source: 'D:/project/assets/scenes/GameScene.scene',
            uuid: 'scene-uuid',
            imported: true,
            invalid: false,
            meta: {
                importer: 'scene',
            },
            _assetDB: {
                options: {
                    readonly: false,
                },
                reimport,
            },
        };
        const sceneContent = JSON.stringify([
            { __type__: 'cc.SceneAsset', _name: 'GameScene', scene: { __id__: 1 } },
            { __type__: 'cc.Scene', _name: 'GameScene', _id: 'scene-uuid' },
        ]);
        mockQueryAsset.mockReturnValue(sceneAsset);
        mockSaveAssetByHandler.mockResolvedValue(true);

        await assetOperation.saveAsset('db://assets/scenes/GameScene.scene', sceneContent);

        expect(mockSaveAssetByHandler).toHaveBeenCalledWith(sceneAsset, sceneContent);
        expect(reimport).toHaveBeenCalledWith('scene-uuid');

        jest.clearAllMocks();

        const prefabReimport = jest.fn();
        const prefabAsset = {
            source: 'D:/project/assets/prefabs/Hero.prefab',
            uuid: 'prefab-uuid',
            imported: true,
            invalid: false,
            meta: {
                importer: 'prefab',
            },
            _assetDB: {
                options: {
                    readonly: false,
                },
                reimport: prefabReimport,
            },
        };
        const prefabContent = JSON.stringify([
            { __type__: 'cc.Prefab', _name: 'Hero', data: { __id__: 1 } },
            { __type__: 'cc.Node', _name: 'Hero' },
        ]);
        mockQueryAsset.mockReturnValue(prefabAsset);
        mockSaveAssetByHandler.mockResolvedValue(true);

        await assetOperation.saveAsset('db://assets/prefabs/Hero.prefab', prefabContent);

        expect(mockSaveAssetByHandler).toHaveBeenCalledWith(prefabAsset, prefabContent);
        expect(prefabReimport).toHaveBeenCalledWith('prefab-uuid');
    });
});
