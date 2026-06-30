// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AssetActionEnum } from '@cocos/asset-db/libs/asset';

const scriptingMock = vi.hoisted(() => ({
  compileScripts: vi.fn(async () => undefined),
}));

vi.mock('@cocos/asset-db', () => ({
  Asset: class Asset {},
  VirtualAsset: class VirtualAsset {},
}));

vi.mock('../../../src/core/scripting', () => ({
  default: scriptingMock,
}));

vi.mock('../../../src/core/assets/asset-handler/utils', () => ({
  openCode: vi.fn(),
}));

vi.mock('../../../src/core/assets/asset-handler/assets/utils/script-compiler', () => ({
  transformPluginScript: vi.fn(async () => ({ code: '' })),
}));

function createScriptAsset() {
  return {
    uuid: 'script-uuid',
    source: 'D:/project/assets/scripts/TestApi.ts',
    action: AssetActionEnum.change,
    userData: {},
    meta: {
      importer: 'typescript',
      userData: {},
    },
  };
}

describe('JavaScript asset handler startup batching', () => {
  afterEach(() => {
    delete (globalThis as any).__cocosCliAssetDbStartupScriptImporting;
    scriptingMock.compileScripts.mockClear();
  });

  it('defers per-asset script compile while AssetDB startup batch import is running', async () => {
    vi.resetModules();
    const { Asset } = await import('@cocos/asset-db');
    const { JavascriptHandler } = await import('../../../src/core/assets/asset-handler/assets/javascript');
    const asset = Object.assign(new Asset(), createScriptAsset());
    (globalThis as any).__cocosCliAssetDbStartupScriptImporting = true;

    await expect(JavascriptHandler.importer.import(asset as any)).resolves.toBe(true);

    expect(scriptingMock.compileScripts).not.toHaveBeenCalled();
  });

  it('keeps immediate script compile outside AssetDB startup batch import', async () => {
    vi.resetModules();
    const { Asset } = await import('@cocos/asset-db');
    const { JavascriptHandler } = await import('../../../src/core/assets/asset-handler/assets/javascript');
    const asset = Object.assign(new Asset(), createScriptAsset());

    await expect(JavascriptHandler.importer.import(asset as any)).resolves.toBe(true);

    expect(scriptingMock.compileScripts).toHaveBeenCalledWith([{
      type: AssetActionEnum.change,
      uuid: 'script-uuid',
      filePath: 'D:/project/assets/scripts/TestApi.ts',
      importer: 'typescript',
      userData: {},
    }]);
  });
});
