import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { VirtualAsset } from '@cocos/asset-db/libs/asset';

const { AssetDB, map: assetDBMap } = require('@cocos/asset-db/libs/asset-db') as typeof import('@cocos/asset-db/libs/asset-db');
const { Importer } = require('@cocos/asset-db/libs/importer') as typeof import('@cocos/asset-db/libs/importer');

const PROBE_IMPORTER = 'readonly-source-meta-probe';
const PROBE_EXTENSION = '.probe';
const IMPORTER_DEFAULT = 'filled-in-memory';

class SourceMetaProbeImporter extends Importer {
    constructor() {
        super();
        this._name = PROBE_IMPORTER;
        this._version = '1.0.0';
        this._versionCode = 1;
    }

    async import(asset: VirtualAsset): Promise<boolean> {
        asset.meta.userData.importerDefault = IMPORTER_DEFAULT;
        asset.setData('importerDefault', IMPORTER_DEFAULT);
        await asset.saveToLibrary('.json', JSON.stringify({ importerDefault: IMPORTER_DEFAULT }));
        return true;
    }
}

interface AssetDbProbeResult {
    originalMeta: string;
    persistedMeta: string;
    libraryOutput: string;
    dataRecord: Record<string, {
        url: string;
        value: Record<string, unknown>;
        versionCode: number;
    }>;
    infoRecord: {
        map: Record<string, unknown>;
    };
}

async function runAssetDbProbe(options: {
    name: 'internal' | 'assets';
    readonly: boolean;
    uuid: string;
}): Promise<AssetDbProbeResult> {
    const root = await mkdtemp(join(tmpdir(), 'asset-db-readonly-source-meta-'));
    const target = join(root, 'target');
    const library = join(root, 'library');
    const temp = join(root, 'temp');
    const source = join(target, `sample${PROBE_EXTENSION}`);
    const metaPath = `${source}.meta`;
    const originalMeta = `${JSON.stringify({
        ver: '0.0.0',
        importer: PROBE_IMPORTER,
        imported: false,
        uuid: options.uuid,
        files: [],
        subMetas: {},
        userData: {},
    }, null, 2)}\n`;

    await mkdir(target, { recursive: true });
    await writeFile(source, 'source', 'utf8');
    await writeFile(metaPath, originalMeta, 'utf8');

    const db = new AssetDB({
        name: options.name,
        target,
        library,
        temp,
        level: 0,
        ignoreFiles: [],
        readonly: options.readonly,
    });
    db.importerManager.add(SourceMetaProbeImporter, [PROBE_EXTENSION]);

    try {
        await db.start();
        expect(db.getAsset(options.uuid)?.meta.userData.importerDefault).toBe(IMPORTER_DEFAULT);
    } finally {
        await db.stop();
        delete assetDBMap[options.name];
    }

    try {
        const recordPrefix = options.name === 'internal' ? '.internal' : '.assets';
        const infoRecordName = options.name === 'internal'
            ? '.internal-info1.0.0.json'
            : '.assets-info.json';
        return {
            originalMeta,
            persistedMeta: await readFile(metaPath, 'utf8'),
            libraryOutput: await readFile(join(library, options.uuid.slice(0, 2), `${options.uuid}.json`), 'utf8'),
            dataRecord: JSON.parse(await readFile(join(library, `${recordPrefix}-data.json`), 'utf8')),
            infoRecord: JSON.parse(await readFile(join(library, infoRecordName), 'utf8')),
        };
    } finally {
        await rm(root, { recursive: true, force: true });
    }
}

describe('asset-db readonly source meta persistence', () => {
    it('keeps an existing readonly source meta unchanged while persisting library output and records', async () => {
        const uuid = '12345678-1234-4234-8234-123456789abc';
        const result = await runAssetDbProbe({ name: 'internal', readonly: true, uuid });

        expect(result.persistedMeta).toBe(result.originalMeta);
        expect(JSON.parse(result.libraryOutput)).toEqual({ importerDefault: IMPORTER_DEFAULT });
        expect(result.dataRecord[uuid]).toEqual(expect.objectContaining({
            url: 'db://internal/sample.probe',
            value: expect.any(Object),
        }));
        expect(Object.keys(result.infoRecord.map).some((path) => path.endsWith('sample.probe.meta'))).toBe(true);
    });

    it('keeps writable source meta persistence behavior', async () => {
        const uuid = '22345678-1234-4234-8234-123456789abc';
        const result = await runAssetDbProbe({ name: 'assets', readonly: false, uuid });
        const persistedMeta = JSON.parse(result.persistedMeta);

        expect(result.persistedMeta).not.toBe(result.originalMeta);
        expect(persistedMeta.userData.importerDefault).toBe(IMPORTER_DEFAULT);
        expect(persistedMeta.imported).toBe(true);
        expect(persistedMeta.files).toContain('.json');
        expect(JSON.parse(result.libraryOutput)).toEqual({ importerDefault: IMPORTER_DEFAULT });
        expect(result.dataRecord[uuid].value.importerDefault).toBe(IMPORTER_DEFAULT);
    });
});
