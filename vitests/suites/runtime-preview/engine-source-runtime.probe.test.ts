import { describe, expect, it } from 'vitest';
import { loadEngineSourceEntry } from '@shared/engine-source';

describe('engine source runtime probe', () => {
  it('loads real engine source entry and exposes asset runtime APIs', async () => {
    const engine = await loadEngineSourceEntry();

    expect(engine.cc).toBeTruthy();
    expect(engine.cc.assetManager).toBeTruthy();
    expect(typeof engine.cc.assetManager.init).toBe('function');
    expect(engine.cc.resources).toBeTruthy();
    expect(typeof engine.cc.resources.load).toBe('function');
    expect(engine.cc.JsonAsset).toBeTruthy();
  });
});
