import { getFixturePaths } from './fixture-paths';

export interface EngineSourceRuntime {
  cc: {
    assetManager?: { init?: unknown };
    resources?: { load?: unknown };
    Asset?: unknown;
    JsonAsset?: unknown;
    ImageAsset?: unknown;
    Texture2D?: unknown;
    SpriteFrame?: unknown;
  };
}

export async function loadEngineSourceEntry(): Promise<EngineSourceRuntime> {
  getFixturePaths();
  const cc = await import('cc');
  return { cc };
}
