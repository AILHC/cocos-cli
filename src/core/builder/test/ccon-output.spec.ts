import { pathExists, readFile, readJSON, remove } from 'fs-extra';
import { tmpdir } from 'os';
import { join } from 'path';
import { getDesiredCCONExtensionMap, outputCCONFormat } from '../worker/builder/utils/cconb';
import { AssetSerializeOptions } from '../@types/protected';

jest.mock('cc/editor/serialization', () => ({
    encodeCCONBinary: jest.fn(() => Buffer.from([1, 2, 3])),
    encodeCCONJson: jest.fn((ccon, chunkURLs) => ({
        version: 1,
        document: ccon.document,
        chunks: chunkURLs,
    })),
}));

function makeSerializeOptions(options: Partial<AssetSerializeOptions> = {}): AssetSerializeOptions {
    return {
        'cc.EffectAsset': {
            glsl1: true,
            glsl3: true,
            glsl4: false,
        },
        ...options,
    };
}

describe('CCON output format', () => {
    const tempDir = join(tmpdir(), `cocos-cli-ccon-output-${process.pid}`);

    afterEach(async () => {
        await remove(tempDir);
    });

    it('keeps CCONB as the default output extension', () => {
        expect(getDesiredCCONExtensionMap(makeSerializeOptions())).toBe('.cconb');
        expect(getDesiredCCONExtensionMap(makeSerializeOptions({ exportCCON: false, useCCONB: false }))).toBe('.cconb');
    });

    it('uses CCON extension when the platform exports CCON without forcing CCONB', () => {
        expect(getDesiredCCONExtensionMap(makeSerializeOptions({ exportCCON: true }))).toBe('.ccon');
        expect(getDesiredCCONExtensionMap(makeSerializeOptions({ exportCCON: true, useCCONB: false }))).toBe('.ccon');
        expect(getDesiredCCONExtensionMap(makeSerializeOptions({ exportCCON: true, useCCONB: true }))).toBe('.cconb');
    });

    it('writes CCONB as a single binary file by default', async () => {
        const fullBaseName = join(tempDir, 'asset');

        await outputCCONFormat({ document: {}, chunks: [] }, fullBaseName, makeSerializeOptions());

        expect(await readFile(`${fullBaseName}.cconb`)).toEqual(Buffer.from([1, 2, 3]));
        expect(await pathExists(`${fullBaseName}.json`)).toBe(false);
    });

    it('writes CCON as json plus named chunk files', async () => {
        const fullBaseName = join(tempDir, 'asset');

        await outputCCONFormat({
            document: { value: 1 },
            chunks: [
                Buffer.from([7, 8]),
                Buffer.from([9]),
            ],
        }, fullBaseName, makeSerializeOptions({ exportCCON: true, useCCONB: false }));

        expect(await readJSON(`${fullBaseName}.json`)).toEqual({
            version: 1,
            document: { value: 1 },
            chunks: ['.0.bin', '.1.bin'],
        });
        expect(await readFile(`${fullBaseName}.0.bin`)).toEqual(Buffer.from([7, 8]));
        expect(await readFile(`${fullBaseName}.1.bin`)).toEqual(Buffer.from([9]));
        expect(await pathExists(`${fullBaseName}.cconb`)).toBe(false);
    });
});
