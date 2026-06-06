import { describe, expect, it } from 'vitest';
import { getFixturePaths } from '@shared/fixture-paths';
import { loadEngineSourceEntry } from '@shared/engine-source';
import {
  buildEditorLibraryResourcesBundle,
  installEditorLibraryHostIO,
  loadResource,
} from '@shared/editor-library-bundle';

describe('editor library resources.load probe', () => {
  it('loads JsonAsset through real engine resources.load from frozen editor library', async () => {
    const paths = getFixturePaths();
    const engine = await loadEngineSourceEntry();
    const { config, samples, fileIndex } = await buildEditorLibraryResourcesBundle(paths.editorLibraryRef);

    expect(samples.jsonAsset?.resourcePath).toBeTruthy();
    expect(config.name).toBe('resources');
    expect(config.paths[samples.jsonAsset!.uuid]).toEqual([
      samples.jsonAsset!.resourcePath,
      'cc.JsonAsset',
    ]);

    const hostIO = installEditorLibraryHostIO(engine.cc, fileIndex);
    engine.cc.assetManager.init({ importBase: '', nativeBase: '' });
    engine.cc.resources.init(config);

    const asset = await loadResource(engine.cc, samples.jsonAsset!.resourcePath, engine.cc.JsonAsset);

    expect(asset).toBeInstanceOf(engine.cc.JsonAsset);
    expect(asset.json).toBeTruthy();
    expect(hostIO.downloadedUrls.some((url) => url.endsWith(`${samples.jsonAsset!.uuid}.json`))).toBe(true);
    expect(hostIO.queryExtnameUrls).toContain(`/query-extname/${samples.jsonAsset!.uuid}`);
  });

  it.todo('loads image, texture, and sprite frame dependencies after host image boundary and HTTP URL capture are wired', async () => {
    const paths = getFixturePaths();
    const engine = await loadEngineSourceEntry();
    const { config, samples, fileIndex } = await buildEditorLibraryResourcesBundle(paths.editorLibraryRef);

    expect(samples.imageAsset?.resourcePath).toBeTruthy();
    expect(samples.texture2D?.resourcePath).toBeTruthy();
    expect(samples.spriteFrame?.resourcePath).toBeTruthy();

    const hostIO = installEditorLibraryHostIO(engine.cc, fileIndex);
    engine.cc.assetManager.init({ importBase: '', nativeBase: '' });
    engine.cc.resources.init(config);

    const image = await loadResource(engine.cc, samples.imageAsset!.resourcePath, engine.cc.ImageAsset);
    const texture = await loadResource(engine.cc, samples.texture2D!.resourcePath, engine.cc.Texture2D);
    const spriteFrame = await loadResource(engine.cc, samples.spriteFrame!.resourcePath, engine.cc.SpriteFrame);

    expect(image).toBeInstanceOf(engine.cc.ImageAsset);
    expect(texture).toBeInstanceOf(engine.cc.Texture2D);
    expect(spriteFrame).toBeInstanceOf(engine.cc.SpriteFrame);
    expect(hostIO.downloadedUrls.some((url) => url.endsWith('.png'))).toBe(true);
    expect(hostIO.downloadedUrls.some((url) => url.includes(`${samples.texture2D!.uuid}.json`))).toBe(true);
    expect(hostIO.downloadedUrls.some((url) => url.includes(`${samples.spriteFrame!.uuid}.json`))).toBe(true);
  });
});
