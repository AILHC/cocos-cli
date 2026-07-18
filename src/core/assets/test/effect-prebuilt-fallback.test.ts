import { mkdir, rm, writeFile } from 'fs/promises';
import { existsSync, statSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const mockRoot = join(tmpdir(), 'cocos-cli-effect-prebuilt-fallback');
const mockTempRoot = join(mockRoot, 'temp', 'cli', 'asset-db');
const mockAssetDBList: any[] = [];
const mockForEach = jest.fn();

jest.mock('@cocos/asset-db', () => ({
    Asset: class {},
    AssetDB: class {},
    forEach: (callback: (database: any) => void) => mockForEach(callback),
}));

jest.mock('cc', () => ({
    EffectAsset: class {},
}));

jest.mock('cc/editor/custom-pipeline', () => ({
    BinaryOutputArchive: class {
        buffer = Buffer.from([1, 2, 3, 4]);
    },
    LayoutGraphData: class {},
    VisibilityGraph: class {
        mergeEffect = jest.fn();
    },
    LayoutGraphInfo: class {
        lg = {};
        addEffect = jest.fn();
        build = jest.fn().mockReturnValue(false);
    },
    saveLayoutGraphData: jest.fn(),
    buildLayoutGraphData: jest.fn(),
    getLayoutGraphDataVersion: jest.fn().mockReturnValue(1),
}), { virtual: true });

jest.mock('../effect-compiler', () => ({
    buildEffect: jest.fn(),
    options: {},
    addChunk: jest.fn(),
}));

jest.mock('../asset-handler/utils', () => ({
    getDependUUIDList: jest.fn().mockReturnValue([]),
    openCode: jest.fn(),
}));

jest.mock('../asset-config', () => ({
    __esModule: true,
    default: {
        data: {
            tempRoot: mockTempRoot,
            assetDBList: mockAssetDBList,
        },
    },
}));

import { compileEffect } from '../asset-handler';
import { autoGenEffectBinInfo } from '../asset-handler/assets/effect';

describe('effect.bin fallback generation', () => {
    beforeAll(() => {
        (globalThis as any).cc = {
            deserialize: jest.fn().mockReturnValue({}),
        };
    });

    beforeEach(async () => {
        await rm(mockRoot, { recursive: true, force: true });
        await mkdir(mockRoot, { recursive: true });
        mockAssetDBList.length = 0;
        mockForEach.mockReset();
        mockForEach.mockImplementation(() => undefined);
        autoGenEffectBinInfo.waitingGenEffectBin = false;
    });

    afterAll(async () => {
        await rm(mockRoot, { recursive: true, force: true });
    });

    it('generates a non-empty file from imported effect records', async () => {
        const library = join(mockRoot, 'library', 'imported-effect');
        await mkdir(join(mockRoot, 'library'), { recursive: true });
        await writeFile(`${library}.json`, '{}', 'utf8');
        mockForEach.mockImplementation((callback: (database: any) => void) => callback({
            path2asset: new Map([
                ['db://assets/imported.effect', {
                    meta: { importer: 'effect' },
                    imported: true,
                    library,
                }],
            ]),
        }));

        await compileEffect(true);

        expect(existsSync(autoGenEffectBinInfo.effectBinPath)).toBe(true);
        expect(statSync(autoGenEffectBinInfo.effectBinPath).size).toBeGreaterThan(0);
    });

    it('generates a non-empty file from prebuilt internal meta and library data', async () => {
        const target = join(mockRoot, 'internal');
        const libraryRoot = join(mockRoot, 'library');
        const uuid = 'ab123456-0000-0000-0000-000000000000';
        const metaPath = join(target, 'effects', 'builtin.effect.meta');
        const library = join(libraryRoot, uuid.substring(0, 2), uuid);
        await mkdir(join(target, 'effects'), { recursive: true });
        await mkdir(join(libraryRoot, uuid.substring(0, 2)), { recursive: true });
        await writeFile(metaPath, JSON.stringify({ importer: 'effect', imported: true, uuid }), 'utf8');
        await writeFile(`${library}.json`, '{}', 'utf8');
        mockAssetDBList.push({ target, library: libraryRoot });

        await compileEffect(true);

        expect(existsSync(autoGenEffectBinInfo.effectBinPath)).toBe(true);
        expect(statSync(autoGenEffectBinInfo.effectBinPath).size).toBeGreaterThan(0);
    });

    it('fails acceptance when no effect input can produce effect.bin', async () => {
        await expect(compileEffect(true)).rejects.toThrow('effect.bin was not generated');
    });
});
