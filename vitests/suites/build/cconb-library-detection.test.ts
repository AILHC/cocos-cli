import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('cc/editor/serialization', () => ({
  encodeCCONBinary: vi.fn(),
}), { virtual: true });

let hasCCONFormatAssetInLibrary: (asset: any) => boolean;
let getCCONFormatAssetInLibrary: (asset: any) => string;

function createAsset(files: string[], library = 'E:/project/library/1f/asset-uuid') {
  return {
    library,
    meta: {
      files,
    },
  } as any;
}

describe('builder CCON library detection', () => {
  beforeAll(async () => {
    const cconb = await import('../../../src/core/builder/worker/builder/utils/cconb');
    hasCCONFormatAssetInLibrary = cconb.hasCCONFormatAssetInLibrary;
    getCCONFormatAssetInLibrary = cconb.getCCONFormatAssetInLibrary;
  });

  it('recognizes cconb library files as CCON assets', () => {
    const asset = createAsset(['.cconb']);

    expect(hasCCONFormatAssetInLibrary(asset)).toBe(true);
    expect(getCCONFormatAssetInLibrary(asset)).toBe('E:/project/library/1f/asset-uuid.cconb');
  });

  it('keeps legacy bin CCON library file support', () => {
    const asset = createAsset(['.bin']);

    expect(hasCCONFormatAssetInLibrary(asset)).toBe(true);
    expect(getCCONFormatAssetInLibrary(asset)).toBe('E:/project/library/1f/asset-uuid.bin');
  });

  it('does not treat json library files as CCON assets', () => {
    const asset = createAsset(['.json']);

    expect(hasCCONFormatAssetInLibrary(asset)).toBe(false);
    expect(getCCONFormatAssetInLibrary(asset)).toBe('');
  });
});
