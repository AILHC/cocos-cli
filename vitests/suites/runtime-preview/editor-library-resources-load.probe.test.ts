import { describe, expect, it } from 'vitest';
import { getFixturePaths } from '@shared/fixture-paths';
import { loadEngineSourceEntry } from '@shared/engine-source';
import {
  buildEditorLibraryResourcesBundle,
  inspectEditorLibraryTtfDiagnostic,
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

  it('loads ImageAsset through real engine resources.load from frozen editor library native dependency', async () => {
    const paths = getFixturePaths();
    const engine = await loadEngineSourceEntry();
    const { config, samples, fileIndex } = await buildEditorLibraryResourcesBundle(paths.editorLibraryRef);

    expect(samples.imageAsset?.resourcePath).toBeTruthy();
    expect(config.paths[samples.imageAsset!.uuid]).toEqual([
      samples.imageAsset!.resourcePath,
      'cc.ImageAsset',
    ]);

    const hostIO = installEditorLibraryHostIO(engine.cc, fileIndex);
    engine.cc.assetManager.init({ importBase: '', nativeBase: '' });
    engine.cc.resources.init(config);

    const asset = await loadResource(engine.cc, samples.imageAsset!.resourcePath, engine.cc.ImageAsset);

    expect(asset).toBeInstanceOf(engine.cc.ImageAsset);
    expect(hostIO.downloadedUrls.some((url) => (
      new RegExp(`${samples.imageAsset!.uuid}\\.(?:png|jpg|jpeg)$`).test(url)
    ))).toBe(true);
  });

  it('loads image, texture, and sprite frame dependencies through real engine resources.load', async () => {
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

  it('loads serialized SpriteAtlas converted from a frozen Plist source asset', async () => {
    const paths = getFixturePaths();
    const engine = await loadEngineSourceEntry();
    const { config, samples, fileIndex } = await buildEditorLibraryResourcesBundle(paths.editorLibraryRef);

    expect(samples.spriteAtlas?.resourcePath).toBeTruthy();
    expect(samples.spriteAtlas?.sourceUrl).toContain('.plist');
    expect(engine.cc.SpriteAtlas).toBeTypeOf('function');

    const hostIO = installEditorLibraryHostIO(engine.cc, fileIndex);
    engine.cc.assetManager.init({ importBase: '', nativeBase: '' });
    engine.cc.resources.init(config);

    const asset = await loadResource(engine.cc, samples.spriteAtlas!.resourcePath, engine.cc.SpriteAtlas);

    expect(asset).toBeInstanceOf(engine.cc.SpriteAtlas);
    expect(hostIO.downloadedUrls.some((url) => url.endsWith(`${samples.spriteAtlas!.uuid}.json`))).toBe(true);
    expect(hostIO.downloadedUrls.some((url) => url.endsWith('.plist'))).toBe(false);
  });

  it('documents that Spine atlas samples share a resources path with SkeletonData', async () => {
    const paths = getFixturePaths();
    const engine = await loadEngineSourceEntry();
    const { config, samples, fileIndex } = await buildEditorLibraryResourcesBundle(paths.editorLibraryRef);

    expect(samples.spineAtlas?.resourcePath).toBeTruthy();
    expect(samples.spineAtlas?.sourceUrl).toMatch(/\.atlas$/);
    expect(samples.skeletonData?.resourcePath).toBe(samples.spineAtlas!.resourcePath);
    expect(engine.cc.Asset).toBeTypeOf('function');

    const hostIO = installEditorLibraryHostIO(engine.cc, fileIndex);
    engine.cc.assetManager.init({ importBase: '', nativeBase: '' });
    engine.cc.resources.init(config);

    const asset = await loadResource(engine.cc, samples.spineAtlas!.resourcePath, engine.cc.Asset);
    const diagnostic = {
      sourceOperation: 'resources.load(spineAtlasPath, Asset)',
      missingReason: 'cc.Asset is a base class; Config.getInfoWithPath(path, Asset) also matches sp.SkeletonData when both share the same resources path',
      triggerCondition: 'add a frozen .atlas sample with an independent resources path or a more specific engine asset type',
      atlasUuid: samples.spineAtlas!.uuid,
      resolvedUuid: (asset as { uuid: string }).uuid,
      downloadedUrls: hostIO.downloadedUrls,
    };

    expect(diagnostic).toMatchObject({
      sourceOperation: 'resources.load(spineAtlasPath, Asset)',
      atlasUuid: samples.spineAtlas!.uuid,
      resolvedUuid: samples.skeletonData!.uuid,
    });
    expect(diagnostic.downloadedUrls.some((url) => url.endsWith(`${samples.skeletonData!.uuid}.json`))).toBe(true);
  });

  it('loads Spine SkeletonData from a frozen editor library json sample', async () => {
    const paths = getFixturePaths();
    const engine = await loadEngineSourceEntry();
    const { config, samples, fileIndex } = await buildEditorLibraryResourcesBundle(paths.editorLibraryRef);

    expect(samples.skeletonData?.resourcePath).toBeTruthy();
    expect(samples.skeletonData?.sourceUrl).toMatch(/\.json$/);
    expect(engine.cc.SpineSkeletonData).toBeTypeOf('function');

    const hostIO = installEditorLibraryHostIO(engine.cc, fileIndex);
    engine.cc.assetManager.init({ importBase: '', nativeBase: '' });
    engine.cc.resources.init(config);

    const asset = await loadResource(engine.cc, samples.skeletonData!.resourcePath, engine.cc.SpineSkeletonData);

    expect(asset).toBeInstanceOf(engine.cc.SpineSkeletonData);
    expect(hostIO.downloadedUrls.some((url) => url.endsWith(`${samples.skeletonData!.uuid}.json`))).toBe(true);
  });

  it('documents that frozen editor library has no resources-loadable TTFFont sample', async () => {
    const paths = getFixturePaths();
    const { samples } = await buildEditorLibraryResourcesBundle(paths.editorLibraryRef, { buildFileIndex: false });
    const ttfDiagnostic = await inspectEditorLibraryTtfDiagnostic(paths.editorLibraryRef);

    const diagnostic = {
      sourceOperation: 'resources.load(TTFFont)',
      missingReason: 'frozen editor library has serialized TTFFont files but no assets/resources mapping in .assets-info1.0.0.json or .assets-data.json',
      triggerCondition: 'add or locate a TTFFont asset under assets/resources in the frozen project fixture',
      sample: samples.ttfFont ?? null,
      ...ttfDiagnostic,
    };

    expect(diagnostic).toMatchObject({
      sourceOperation: 'resources.load(TTFFont)',
      sample: null,
      serializedTtfUuids: [
        '0835f102-5471-47a3-9a76-01c07ac9cdb2',
        '0ed97c56-390e-4dd1-96b7-e7f2d93a98ed',
        'b23391b6-52eb-46a6-8da1-6244d9d315fb',
        'b5475517-23b9-4873-bc1a-968d96616081',
      ],
      resourcesMappedTtfUuids: [],
    });
    expect(diagnostic.nativeTtfFiles).toEqual([
      '/08/0835f102-5471-47a3-9a76-01c07ac9cdb2/OpenSans-Regular.ttf',
      '/0e/0ed97c56-390e-4dd1-96b7-e7f2d93a98ed/OpenSans-Italic.ttf',
      '/b2/b23391b6-52eb-46a6-8da1-6244d9d315fb/OpenSans-BoldItalic.ttf',
      '/b5/b5475517-23b9-4873-bc1a-968d96616081/OpenSans-Bold.ttf',
    ]);
  });
});
