import { readFile, readdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { basename, extname, join, relative } from 'node:path';

type EngineConstructor = new (...args: never[]) => unknown;

interface EngineLike {
  assetManager: {
    downloader: {
      limited: boolean;
      register: (
        map: Record<string, (url: string, options: Record<string, unknown>, onComplete: (err: Error | null, data?: unknown) => void) => void>,
      ) => void;
    };
    init: (options?: Record<string, unknown>) => void;
  };
  resources: {
    init: (config: EditorLibraryBundleConfig) => void;
    load: (
      path: string,
      type: EngineConstructor | null,
      onComplete: (err: Error | null, data: unknown) => void,
    ) => void;
  };
}

interface AssetInfoMetadata {
  map: Record<string, { uuid: string }>;
}

interface AssetDataRecord {
  url: string;
  value?: {
    depends?: string[];
  };
}

export interface EditorLibraryBundleConfig {
  importBase: string;
  nativeBase: string;
  base: string;
  name: 'resources';
  deps: string[];
  uuids: string[];
  paths: Record<string, [string, string] | [string, string, true]>;
  scenes: Record<string, string>;
  packs: Record<string, string[]>;
  versions: { import: string[]; native: string[] };
  redirect: string[];
  debug: true;
  types: string[];
  extensionMap: Record<string, string[]>;
}

export interface EditorLibraryResourceSample {
  uuid: string;
  resourcePath: string;
  type: string;
  sourceUrl: string;
}

export interface EditorLibraryFileIndex {
  libraryRoot: string;
  byRuntimeUrl: Map<string, string>;
  importExtensionsByUuid: Map<string, string>;
}

export interface EditorLibraryResourcesBundle {
  config: EditorLibraryBundleConfig;
  fileIndex: EditorLibraryFileIndex;
  samples: {
    jsonAsset?: EditorLibraryResourceSample;
    imageAsset?: EditorLibraryResourceSample;
    texture2D?: EditorLibraryResourceSample;
    spriteFrame?: EditorLibraryResourceSample;
    spriteAtlas?: EditorLibraryResourceSample;
    spineAtlas?: EditorLibraryResourceSample;
    skeletonData?: EditorLibraryResourceSample;
    ttfFont?: EditorLibraryResourceSample;
    bitmapFont?: EditorLibraryResourceSample;
    textAsset?: EditorLibraryResourceSample;
  };
}

export interface BuildEditorLibraryResourcesBundleOptions {
  buildFileIndex?: boolean;
}

export interface EditorLibraryHostIO {
  downloadedUrls: string[];
  queryExtnameUrls: string[];
}

export interface EditorLibraryTtfDiagnostic {
  serializedTtfUuids: string[];
  nativeTtfFiles: string[];
  resourcesMappedTtfUuids: string[];
}

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, 'utf8')) as T;
}

async function walkFiles(root: string, dir = root): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkFiles(root, fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }

  return files;
}

function toRuntimeUrl(libraryRoot: string, file: string): string {
  return `/${relative(libraryRoot, file).replace(/\\/g, '/')}`;
}

function toSerializedJsonPath(libraryRoot: string, uuid: string): string {
  return join(libraryRoot, uuid.slice(0, 2), `${uuid}.json`);
}

function toResourcePath(projectAssetPath: string): string | null {
  const normalized = projectAssetPath.replace(/\\/g, '/');
  const marker = 'assets/resources/';
  const index = normalized.indexOf(marker);
  if (index === -1) {
    return null;
  }

  const relativePathWithSubAsset = normalized.slice(index + marker.length);
  const relativePath = relativePathWithSubAsset.replace(/@[^/]+$/, '');
  const extension = extname(relativePath);
  if (!extension) {
    return null;
  }

  return relativePath.slice(0, -extension.length);
}

function rememberSample(
  samples: EditorLibraryResourcesBundle['samples'],
  sample: EditorLibraryResourceSample,
): void {
  if (sample.type === 'cc.JsonAsset') {
    samples.jsonAsset ??= sample;
  } else if (sample.type === 'cc.ImageAsset') {
    samples.imageAsset ??= sample;
  } else if (sample.type === 'cc.Texture2D') {
    samples.texture2D ??= sample;
  } else if (sample.type === 'cc.SpriteFrame') {
    if (!samples.spriteFrame || sample.sourceUrl.includes('.png@')) {
      samples.spriteFrame = sample;
    }
  } else if (sample.type === 'cc.SpriteAtlas') {
    samples.spriteAtlas ??= sample;
  } else if (sample.type === 'cc.Asset' && sample.sourceUrl.endsWith('.atlas')) {
    samples.spineAtlas ??= sample;
  } else if (sample.type === 'sp.SkeletonData') {
    samples.skeletonData ??= sample;
  } else if (sample.type === 'cc.TTFFont') {
    samples.ttfFont ??= sample;
  } else if (sample.type === 'cc.BitmapFont') {
    samples.bitmapFont ??= sample;
  } else if (sample.type === 'cc.TextAsset') {
    samples.textAsset ??= sample;
  }
}

export async function buildEditorLibraryResourcesBundle(
  libraryRoot: string,
  options: BuildEditorLibraryResourcesBundleOptions = {},
): Promise<EditorLibraryResourcesBundle> {
  const assetInfo = await readJson<AssetInfoMetadata>(join(libraryRoot, '.assets-info1.0.0.json'));
  const assetData = await readJson<Record<string, AssetDataRecord>>(join(libraryRoot, '.assets-data.json'));
  const byRuntimeUrl = new Map<string, string>();
  const importExtensionsByUuid = new Map<string, string>();

  if (options.buildFileIndex ?? true) {
    const files = await walkFiles(libraryRoot);
    for (const file of files) {
      byRuntimeUrl.set(toRuntimeUrl(libraryRoot, file), file);
      const name = basename(file);
      if (name.endsWith('.cconb')) {
        importExtensionsByUuid.set(name.slice(0, -'.cconb'.length), '.cconb');
      } else if (name.endsWith('.ccon')) {
        importExtensionsByUuid.set(name.slice(0, -'.ccon'.length), '.ccon');
      }
    }
  }

  const config: EditorLibraryBundleConfig = {
    importBase: '',
    nativeBase: '',
    base: '',
    name: 'resources',
    deps: [],
    uuids: [],
    paths: Object.create(null),
    scenes: Object.create(null),
    packs: Object.create(null),
    versions: { import: [], native: [] },
    redirect: [],
    debug: true,
    types: [],
    extensionMap: Object.create(null),
  };
  const samples: EditorLibraryResourcesBundle['samples'] = {};

  const addAssetPath = async (uuid: string | undefined, projectAssetPath: string): Promise<void> => {
    if (!uuid || config.paths[uuid]) {
      return;
    }

    const resourcePath = toResourcePath(projectAssetPath);
    if (!resourcePath) {
      return;
    }

    const serializedJsonPath = toSerializedJsonPath(libraryRoot, uuid);
    if (!existsSync(serializedJsonPath)) {
      return;
    }

    const serialized = await readJson<{ __type__?: string }>(serializedJsonPath);
    if (!serialized.__type__) {
      return;
    }

    const sample = {
      uuid,
      resourcePath,
      type: serialized.__type__,
      sourceUrl: projectAssetPath,
    };
    config.uuids.push(uuid);
    config.paths[uuid] = uuid.includes('@')
      ? [resourcePath, serialized.__type__, true]
      : [resourcePath, serialized.__type__];
    rememberSample(samples, sample);

    const extension = importExtensionsByUuid.get(uuid);
    if (extension) {
      config.extensionMap[extension] ??= [];
      config.extensionMap[extension].push(uuid);
    }
  };

  for (const [projectAssetPath, info] of Object.entries(assetInfo.map)) {
    await addAssetPath(info.uuid, projectAssetPath);
  }

  for (const [uuid, record] of Object.entries(assetData)) {
    await addAssetPath(uuid, record.url);
  }

  for (const [uuid, record] of Object.entries(assetData)) {
    if (!record.value?.depends?.length || !config.paths[uuid]) {
      continue;
    }
    for (const dependencyUuid of record.value.depends) {
      if (config.paths[dependencyUuid] && !config.uuids.includes(dependencyUuid)) {
        config.uuids.push(dependencyUuid);
      }
    }
  }

  config.uuids.sort();

  return {
    config,
    samples,
    fileIndex: {
      libraryRoot,
      byRuntimeUrl,
      importExtensionsByUuid,
    },
  };
}

export async function inspectEditorLibraryTtfDiagnostic(libraryRoot: string): Promise<EditorLibraryTtfDiagnostic> {
  const assetInfo = await readJson<AssetInfoMetadata>(join(libraryRoot, '.assets-info1.0.0.json'));
  const assetData = await readJson<Record<string, AssetDataRecord>>(join(libraryRoot, '.assets-data.json'));
  const files = await walkFiles(libraryRoot);
  const serializedTtfUuids: string[] = [];
  const nativeTtfFiles: string[] = [];

  for (const file of files) {
    if (file.toLowerCase().endsWith('.ttf')) {
      nativeTtfFiles.push(toRuntimeUrl(libraryRoot, file));
      continue;
    }

    if (!file.endsWith('.json')) {
      continue;
    }

    const serialized = await readJson<{ __type__?: string }>(file);
    if (serialized.__type__ === 'cc.TTFFont') {
      serializedTtfUuids.push(basename(file, '.json'));
    }
  }

  const ttfUuidSet = new Set(serializedTtfUuids);
  const resourcesMappedTtfUuids = new Set<string>();
  for (const [projectAssetPath, info] of Object.entries(assetInfo.map)) {
    if (ttfUuidSet.has(info.uuid) && toResourcePath(projectAssetPath)) {
      resourcesMappedTtfUuids.add(info.uuid);
    }
  }
  for (const [uuid, record] of Object.entries(assetData)) {
    if (ttfUuidSet.has(uuid) && toResourcePath(record.url)) {
      resourcesMappedTtfUuids.add(uuid);
    }
  }

  return {
    serializedTtfUuids: serializedTtfUuids.sort(),
    nativeTtfFiles: nativeTtfFiles.sort(),
    resourcesMappedTtfUuids: [...resourcesMappedTtfUuids].sort(),
  };
}

function normalizeRequestUrl(url: string): string {
  return new URL(url, 'http://runtime-preview.local').pathname;
}

function readPngSize(file: string): { width: number; height: number } | null {
  const buffer = readFileSync(file);
  if (
    buffer.length < 24
    || buffer[0] !== 0x89
    || buffer[1] !== 0x50
    || buffer[2] !== 0x4e
    || buffer[3] !== 0x47
  ) {
    return null;
  }

  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

function installImageSize(image: HTMLImageElement, file: string): void {
  const size = readPngSize(file);
  if (!size) {
    return;
  }

  Object.defineProperties(image, {
    width: { value: size.width, configurable: true },
    height: { value: size.height, configurable: true },
    naturalWidth: { value: size.width, configurable: true },
    naturalHeight: { value: size.height, configurable: true },
  });
}

function installQueryExtnameXHR(hostIO: EditorLibraryHostIO, fileIndex: EditorLibraryFileIndex): void {
  class RuntimePreviewXMLHttpRequest {
    public status = 0;
    public response = '';
    public onload: (() => void) | null = null;
    private url = '';

    public open(_method: string, url: string): void {
      this.url = normalizeRequestUrl(url);
    }

    public send(): void {
      hostIO.queryExtnameUrls.push(this.url);
      const uuid = this.url.slice('/query-extname/'.length);
      this.status = 200;
      this.response = fileIndex.importExtensionsByUuid.get(uuid) ?? '';
      queueMicrotask(() => this.onload?.());
    }
  }

  Object.assign(globalThis, {
    XMLHttpRequest: RuntimePreviewXMLHttpRequest,
  });
}

export function installEditorLibraryHostIO(cc: EngineLike, fileIndex: EditorLibraryFileIndex): EditorLibraryHostIO {
  const hostIO: EditorLibraryHostIO = {
    downloadedUrls: [],
    queryExtnameUrls: [],
  };
  const readText = async (url: string): Promise<string> => {
    const requestUrl = normalizeRequestUrl(url);
    hostIO.downloadedUrls.push(requestUrl);
    const file = fileIndex.byRuntimeUrl.get(requestUrl);
    if (!file) {
      throw new Error(`No frozen library file for runtime URL: ${requestUrl}`);
    }
    return readFile(file, 'utf8');
  };
  const textHandler = (url: string, _options: Record<string, unknown>, onComplete: (err: Error | null, data?: unknown) => void): void => {
    readText(url).then((content) => onComplete(null, content)).catch((err: Error) => onComplete(err));
  };
  const jsonHandler = (url: string, _options: Record<string, unknown>, onComplete: (err: Error | null, data?: unknown) => void): void => {
    readText(url)
      .then((content) => onComplete(null, JSON.parse(content) as unknown))
      .catch((err: Error) => onComplete(err));
  };
  const imageHandler = (url: string, _options: Record<string, unknown>, onComplete: (err: Error | null, data?: unknown) => void): void => {
    const requestUrl = normalizeRequestUrl(url);
    hostIO.downloadedUrls.push(requestUrl);
    const file = fileIndex.byRuntimeUrl.get(requestUrl);
    if (!file) {
      onComplete(new Error(`No frozen library file for runtime URL: ${requestUrl}`));
      return;
    }
    const image = new Image();
    installImageSize(image, file);
    image.src = requestUrl;
    onComplete(null, image);
  };

  installQueryExtnameXHR(hostIO, fileIndex);
  cc.assetManager.downloader.limited = false;
  cc.assetManager.downloader.register({
    '.json': jsonHandler,
    '.ccon': jsonHandler,
    '.png': imageHandler,
    '.jpg': imageHandler,
    '.jpeg': imageHandler,
    '.plist': textHandler,
    '.atlas': textHandler,
  });

  return hostIO;
}

export function loadResource<T>(
  cc: EngineLike,
  resourcePath: string,
  type: EngineConstructor,
): Promise<T> {
  return new Promise((resolve, reject) => {
    cc.resources.load(resourcePath, type, (err, data) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(data as T);
    });
  });
}
