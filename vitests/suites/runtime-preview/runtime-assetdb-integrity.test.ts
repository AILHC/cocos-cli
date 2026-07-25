import { describe, expect, it, vi } from 'vitest';
import { inspectBuilderAssetDbIntegrity } from '@runtime-preview/refresh/runtime-assetdb-integrity';

function createAsset(uuid: string, url = `db://assets/${uuid}.json`) {
  return {
    uuid,
    url,
    parent: null,
    isDirectory: () => false,
    _assetDB: { options: { name: 'assets' } },
  };
}

describe('runtime AssetDB integrity inspection', () => {
  it('uses the builder cached UUID set and validates fields required by Bundle.initAssetPaths', () => {
    const validAsset = createAsset('valid');
    const staleAsset = {
      ...createAsset('stale', 'db://assets/model/mesh.fbx@mesh'),
      parent: createAsset('parent', 'db://assets/model/mesh.fbx'),
    };
    const getAssetInfo = vi.fn((uuid: string) => uuid === 'valid'
      ? { uuid, url: validAsset.url, loadUrl: 'valid', type: 'cc.JsonAsset' }
      : null);

    const result = inspectBuilderAssetDbIntegrity({
      assets: [validAsset, staleAsset],
      getAssetInfo,
      queryAllAssets: vi.fn(),
    });

    expect(result).toMatchObject({
      ok: false,
      checkedUuidCount: 2,
      invalidUuidCount: 1,
      samples: [{
        uuid: 'stale',
        assetUrl: 'db://assets/model/mesh.fbx@mesh',
        parentUuid: 'parent',
        parentUrl: 'db://assets/model/mesh.fbx',
        database: 'assets',
        missingFields: ['assetInfo'],
      }],
    });
  });

  it('keeps the total invalid count while bounding diagnostic samples', () => {
    const assets = Array.from({ length: 25 }, (_, index) => createAsset(`stale-${index}`));

    const result = inspectBuilderAssetDbIntegrity({
      assets,
      getAssetInfo: vi.fn(() => null),
      queryAllAssets: vi.fn(),
    }, { sampleLimit: 3 });

    expect(result.invalidUuidCount).toBe(25);
    expect(result.samples).toHaveLength(3);
    expect(result.sampleLimit).toBe(3);
  });
});
