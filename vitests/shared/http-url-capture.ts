import { createServer, type Server } from 'node:http';
import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { join, normalize } from 'node:path';
import { getFixturePaths } from './fixture-paths';
import { loadEngineSourceEntry } from './engine-source';
import {
  buildEditorLibraryResourcesBundle,
  loadResource,
} from './editor-library-bundle';

export interface CapturedRuntimeUrl {
  url: string;
  routeCategory: 'query-extname' | 'import';
  sourceOperation: string;
  expectedArtifactKind: 'extension-replacement' | 'serialized-json';
  probe: 'http-base';
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('HTTP capture server did not expose a TCP address.'));
        return;
      }
      resolve(address.port);
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

function resolveLibraryImportFile(libraryRoot: string, routeTail: string): string | null {
  const normalizedTail = normalize(routeTail.replace(/\\/g, '/'));
  if (!normalizedTail || normalizedTail.startsWith('..') || normalizedTail.split(/[\\/]/).includes('..')) {
    return null;
  }

  const absolutePath = normalize(join(libraryRoot, normalizedTail));
  const normalizedRoot = normalize(libraryRoot);
  if (!absolutePath.startsWith(normalizedRoot)) {
    return null;
  }

  return absolutePath;
}

function queryImportReplacementExtension(libraryRoot: string, uuid: string): string {
  const bucket = join(libraryRoot, uuid.slice(0, 2));
  if (existsSync(join(bucket, `${uuid}.cconb`))) {
    return '.cconb';
  }
  if (existsSync(join(bucket, `${uuid}.ccon`))) {
    return '.ccon';
  }
  return '';
}

function createCaptureServer(libraryRoot: string, capturedRuntimeUrls: CapturedRuntimeUrl[]): Server {
  return createServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
    const pathName = requestUrl.pathname;

    if (pathName.startsWith('/query-extname/')) {
      capturedRuntimeUrls.push({
        url: pathName,
        routeCategory: 'query-extname',
        sourceOperation: 'resources.load(JsonAsset)',
        expectedArtifactKind: 'extension-replacement',
        probe: 'http-base',
      });
      const uuid = pathName.slice('/query-extname/'.length);
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end(queryImportReplacementExtension(libraryRoot, uuid));
      return;
    }

    const importPrefix = '/assets/resources/import/';
    if (pathName.startsWith(importPrefix)) {
      capturedRuntimeUrls.push({
        url: pathName,
        routeCategory: 'import',
        sourceOperation: 'resources.load(JsonAsset)',
        expectedArtifactKind: 'serialized-json',
        probe: 'http-base',
      });
      const file = resolveLibraryImportFile(libraryRoot, pathName.slice(importPrefix.length));
      if (!file) {
        response.writeHead(400, { 'content-type': 'text/plain' });
        response.end(`Invalid import route: ${pathName}`);
        return;
      }

      try {
        const fileStat = await stat(file);
        if (!fileStat.isFile()) {
          throw new Error('not a file');
        }
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(await readFile(file, 'utf8'));
      } catch {
        response.writeHead(404, { 'content-type': 'text/plain' });
        response.end(`No frozen library file for ${pathName}`);
      }
      return;
    }

    response.writeHead(404, { 'content-type': 'text/plain' });
    response.end(`Unhandled route: ${pathName}`);
  });
}

function installHttpJsonDownloader(cc: any): void {
  const handler = (url: string, _options: Record<string, unknown>, onComplete: (err: Error | null, data?: unknown) => void): void => {
    fetch(url)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status} for ${url}`);
        }
        return response.json();
      })
      .then((json) => onComplete(null, json))
      .catch((err: Error) => onComplete(err));
  };

  cc.assetManager.downloader.limited = false;
  cc.assetManager.downloader.register({
    '.json': handler,
    '.ccon': handler,
  });
}

function installHttpQueryExtnameXHR(origin: string): void {
  class RuntimePreviewXMLHttpRequest {
    public status = 0;
    public response = '';
    public onload: (() => void) | null = null;
    private url = '';

    public open(_method: string, url: string): void {
      this.url = new URL(url, origin).href;
    }

    public send(): void {
      fetch(this.url)
        .then(async (response) => {
          this.status = response.status;
          this.response = await response.text();
        })
        .finally(() => this.onload?.());
    }
  }

  Object.assign(globalThis, {
    XMLHttpRequest: RuntimePreviewXMLHttpRequest,
  });
}

export async function captureJsonAssetHttpRuntimeUrls(): Promise<CapturedRuntimeUrl[]> {
  const paths = getFixturePaths();
  const engine = await loadEngineSourceEntry();
  const { config, samples } = await buildEditorLibraryResourcesBundle(paths.editorLibraryRef, { buildFileIndex: false });
  const capturedRuntimeUrls: CapturedRuntimeUrl[] = [];
  const server = createCaptureServer(paths.editorLibraryRef, capturedRuntimeUrls);
  const port = await listen(server);
  const origin = `http://127.0.0.1:${port}`;

  try {
    installHttpJsonDownloader(engine.cc);
    installHttpQueryExtnameXHR(origin);

    engine.cc.assetManager.init({
      importBase: `${origin}/assets/general/import`,
      nativeBase: `${origin}/assets/general/native`,
    });
    engine.cc.resources.init({
      ...config,
      base: origin,
      importBase: '/assets/resources/import',
      nativeBase: '/assets/resources/native',
    });

    if (!samples.jsonAsset) {
      throw new Error('No JsonAsset sample found in frozen editor library.');
    }

    await loadResource(engine.cc, samples.jsonAsset.resourcePath, engine.cc.JsonAsset);
    return capturedRuntimeUrls;
  } finally {
    await close(server);
  }
}
