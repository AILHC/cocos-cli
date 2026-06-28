import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IncomingHttpHeaders } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import { PreviewSettingsProvider } from '@runtime-preview/settings/preview-settings-provider';
import {
  startRuntimePreviewServer,
  type RuntimePreviewServerOptions,
} from '@runtime-preview/server/runtime-preview-server';
import type { RuntimeRefreshResult } from '@runtime-preview/refresh/runtime-refresh-coordinator';

function createRefreshResult(overrides: Partial<RuntimeRefreshResult> = {}): RuntimeRefreshResult {
  return {
    ok: true,
    refreshId: 'runtime-refresh-test',
    target: 'db://assets',
    reason: 'endpoint',
    changedAssetCount: 1,
    scriptCompile: {
      status: 'done',
      durationMs: 0,
    },
    durationMs: 0,
    ...overrides,
  };
}

async function createServerFixture(overrides: Partial<RuntimePreviewServerOptions> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'runtime-preview-express-server-'));
  const projectRoot = join(root, 'project');
  const engineRoot = join(root, 'engine');
  const projectLibraryRoot = join(projectRoot, 'library', 'cli');
  const projectProgrammingRoot = join(projectRoot, 'temp', 'cli', 'programming');

  await mkdir(join(projectLibraryRoot, 'ab'), { recursive: true });
  await mkdir(join(engineRoot, 'bin', '.cache', 'dev-cli', 'web'), { recursive: true });
  await mkdir(projectProgrammingRoot, { recursive: true });
  await writeFile(join(projectLibraryRoot, 'ab', 'abcdef.json'), '{"ok":true}', 'utf8');
  await writeFile(join(engineRoot, 'bin', '.cache', 'dev-cli', 'web', 'import-map.json'), '{"imports":{}}', 'utf8');

  const settingsProvider = overrides.settingsProvider ?? new PreviewSettingsProvider({
    loadPreviewSettings: async () => ({
      settings: {
        assets: {
          server: '',
          importBase: '',
          nativeBase: '',
        },
      },
      script2library: {},
      bundleConfigs: [],
    }),
  });

  const server = await startRuntimePreviewServer({
    projectRoot,
    engineRoot,
    projectLibraryRoot,
    projectProgrammingRoot,
    host: '127.0.0.1',
    port: 0,
    ...overrides,
    settingsProvider,
  });

  return { server, settingsProvider };
}

interface HttpGetResult {
  statusCode: number;
  headers: IncomingHttpHeaders;
  body: string;
}

function headerValue(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function getText(
  url: string,
  headers: Record<string, string> = {},
  options: { method?: string; body?: string } = {},
): Promise<HttpGetResult> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(url, { headers, method: options.method ?? 'GET' }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => {
        resolve({
          statusCode: response.statusCode ?? 0,
          headers: response.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        });
      });
    });
    request.on('error', reject);
    if (options.body !== undefined) {
      request.write(options.body);
    }
    request.end();
  });
}

describe('runtime preview express server adapter', () => {
  it('serves file responses with Express validators and supports ETag revalidation', async () => {
    const { server } = await createServerFixture();
    try {
      const url = `${server.url}/assets/resources/import/ab/abcdef.json`;
      const first = await getText(url);
      expect(first.statusCode).toBe(200);
      expect(headerValue(first.headers, 'content-type')).toContain('application/json');
      expect(headerValue(first.headers, 'cache-control')).toBe('public, max-age=0');
      expect(headerValue(first.headers, 'etag')).toBeTruthy();
      expect(headerValue(first.headers, 'last-modified')).toBeTruthy();
      expect(headerValue(first.headers, 'x-powered-by')).toBeUndefined();
      expect(JSON.parse(first.body)).toEqual({ ok: true });

      const second = await getText(url, {
        'If-None-Match': headerValue(first.headers, 'etag')!,
      });
      expect(second.statusCode).toBe(304);
      expect(second.body).toBe('');
    } finally {
      await server.close();
    }
  });

  it('allows engine files under dot path segments required by preview', async () => {
    const { server } = await createServerFixture();
    try {
      const response = await fetch(`${server.url}/scripting/engine/bin/.cache/dev-cli/web/import-map.json`);
      expect(response.status).toBe(200);
      expect(response.headers.get('etag')).toBeTruthy();
      expect(await response.json()).toEqual({ imports: {} });
    } finally {
      await server.close();
    }
  });

  it('keeps preview error POST body limit as plain 413', async () => {
    const { server } = await createServerFixture();
    try {
      const response = await fetch(`${server.url}/preview-error`, {
        method: 'POST',
        body: 'x'.repeat(64 * 1024 + 1),
      });
      expect(response.status).toBe(413);
      expect(response.headers.get('content-type')).toContain('text/plain');
      expect(response.headers.get('x-powered-by')).toBeNull();
      expect(await response.text()).toContain('Runtime preview request body is too large.');
    } finally {
      await server.close();
    }
  });

  it('passes normal preview-error POST body through the HTTP adapter to the logger', async () => {
    const { server } = await createServerFixture();
    try {
      const response = await fetch(`${server.url}/preview-error`, {
        method: 'POST',
        body: JSON.stringify({ message: 'preview boot failed' }),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true });
      expect(await readFile(server.logFilePath, 'utf8')).toContain(
        'browser:preview-error {"message":"preview boot failed"}',
      );
    } finally {
      await server.close();
    }
  });

  it('keeps preview-error POST body parsing when content-type is omitted', async () => {
    const { server } = await createServerFixture();
    try {
      const response = await getText(
        `${server.url}/preview-error`,
        { 'Content-Length': String('{"message":"raw"}'.length) },
        { method: 'POST', body: '{"message":"raw"}' },
      );
      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toEqual({ ok: true });
      expect(await readFile(server.logFilePath, 'utf8')).toContain('browser:preview-error {"message":"raw"}');
    } finally {
      await server.close();
    }
  });

  it('serves dynamic body responses through Express validators', async () => {
    const { server } = await createServerFixture();
    try {
      const response = await fetch(`${server.url}/settings.js`);
      expect(response.status).toBe(200);
      expect(response.headers.get('etag')).toBeTruthy();
      expect(response.headers.get('last-modified')).toBeNull();
      expect(response.headers.get('x-powered-by')).toBeNull();

      const conditionalResponse = await getText(`${server.url}/settings.js`, {
        'If-None-Match': response.headers.get('etag')!,
      });
      expect(conditionalResponse.statusCode).toBe(304);
      expect(conditionalResponse.body).toBe('');
    } finally {
      await server.close();
    }
  });

  it('keeps health route shape', async () => {
    const { server } = await createServerFixture();
    try {
      const response = await fetch(`${server.url}/__runtime-preview/health`);
      expect(response.status).toBe(200);
      expect(response.headers.get('x-powered-by')).toBeNull();
      const body = await response.json();
      expect(body).toMatchObject({
        ok: true,
        projectRoot: expect.any(String),
        engineRoot: expect.any(String),
        projectLibraryRoot: expect.any(String),
        projectProgrammingRoot: expect.any(String),
        logFilePath: expect.any(String),
      });
    } finally {
      await server.close();
    }
  });

  it('handles runtime refresh endpoint before generic routing', async () => {
    const refresh = vi.fn(async () => createRefreshResult());
    const { server } = await createServerFixture({
      refreshCoordinator: { refresh },
    });
    try {
      const response = await fetch(`${server.url}/__runtime-preview/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ target: 'db://assets/resources' }),
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        ok: true,
        target: 'db://assets',
      });
      expect(refresh).toHaveBeenCalledWith({ reason: 'endpoint', target: 'db://assets/resources' });
    } finally {
      await server.close();
    }
  });

  it('rejects malformed runtime refresh JSON bodies', async () => {
    const refresh = vi.fn(async () => createRefreshResult());
    const { server } = await createServerFixture({
      refreshCoordinator: { refresh },
    });
    try {
      const response = await fetch(`${server.url}/__runtime-preview/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"target"',
      });

      expect(response.status).toBe(400);
      expect(await response.text()).toBe('Invalid runtime refresh JSON body.');
      expect(refresh).not.toHaveBeenCalled();
    } finally {
      await server.close();
    }
  });

  it('returns 405 for non-POST runtime refresh requests', async () => {
    const refresh = vi.fn(async () => createRefreshResult());
    const { server } = await createServerFixture({
      refreshCoordinator: { refresh },
    });
    try {
      const response = await fetch(`${server.url}/__runtime-preview/refresh`);

      expect(response.status).toBe(405);
      expect(await response.text()).toBe('Runtime refresh endpoint only supports POST.');
      expect(refresh).not.toHaveBeenCalled();
    } finally {
      await server.close();
    }
  });

  it('returns 405 for non-POST runtime refresh requests before parsing malformed JSON bodies', async () => {
    const refresh = vi.fn(async () => createRefreshResult());
    const { server } = await createServerFixture({
      refreshCoordinator: { refresh },
    });
    try {
      const response = await getText(
        `${server.url}/__runtime-preview/refresh`,
        {
          'Content-Type': 'application/json',
          'Content-Length': String('{"target"'.length),
        },
        { method: 'GET', body: '{"target"' },
      );

      expect(response.statusCode).toBe(405);
      expect(response.body).toBe('Runtime refresh endpoint only supports POST.');
      expect(refresh).not.toHaveBeenCalled();
    } finally {
      await server.close();
    }
  });

  it('rejects non-object runtime refresh JSON bodies', async () => {
    const refresh = vi.fn(async () => createRefreshResult());
    const { server } = await createServerFixture({
      refreshCoordinator: { refresh },
    });
    try {
      const response = await fetch(`${server.url}/__runtime-preview/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '[]',
      });

      expect(response.status).toBe(400);
      expect(await response.text()).toBe('Runtime refresh JSON body must be an object.');
      expect(refresh).not.toHaveBeenCalled();
    } finally {
      await server.close();
    }
  });

  it('returns 413 for oversized runtime refresh JSON bodies', async () => {
    const refresh = vi.fn(async () => createRefreshResult());
    const { server } = await createServerFixture({
      refreshCoordinator: { refresh },
    });
    try {
      const response = await fetch(`${server.url}/__runtime-preview/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ target: 'x'.repeat(64 * 1024) }),
      });

      expect(response.status).toBe(413);
      expect(await response.text()).toContain('Runtime preview request body is too large.');
      expect(refresh).not.toHaveBeenCalled();
    } finally {
      await server.close();
    }
  });

  it('returns operation failures as HTTP 200 JSON ok false', async () => {
    const refresh = vi.fn(async () => createRefreshResult({
      ok: false,
      error: 'refresh failed',
      changedAssetCount: null,
      scriptCompile: { status: 'skipped', durationMs: 0 },
    }));
    const { server } = await createServerFixture({
      refreshCoordinator: { refresh },
    });
    try {
      const response = await fetch(`${server.url}/__runtime-preview/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        ok: false,
        error: 'refresh failed',
      });
    } finally {
      await server.close();
    }
  });

  it('runs prepare and refresh before root settings/render when refresh-on-reload is enabled', async () => {
    const order: string[] = [];
    const refresh = vi.fn(async () => {
      order.push('refresh');
      return createRefreshResult({ reason: 'reload' });
    });
    const prepareRuntimePreview = vi.fn(async () => {
      order.push('prepare');
    });
    const settingsProvider = new PreviewSettingsProvider({
      loadPreviewSettings: async () => {
        order.push('settings');
        return {
          settings: { assets: { server: '', importBase: '', nativeBase: '' } },
          script2library: {},
          bundleConfigs: [],
        };
      },
    });
    const { server } = await createServerFixture({
      refreshOnReload: true,
      prepareRuntimePreview,
      refreshCoordinator: { refresh },
      settingsProvider,
    });
    try {
      const response = await fetch(`${server.url}/`);
      const html = await response.text();

      expect(response.status).toBe(200);
      expect(order).toEqual(['prepare', 'refresh', 'settings']);
      expect(refresh).toHaveBeenCalledWith({ reason: 'reload' });
      expect(html).toContain('lastRefresh');
    } finally {
      await server.close();
    }
  });

  it('does not refresh root by default when refresh-on-reload is disabled', async () => {
    const refresh = vi.fn(async () => createRefreshResult({ reason: 'reload' }));
    const prepareRuntimePreview = vi.fn(async () => undefined);
    const { server } = await createServerFixture({
      refreshCoordinator: { refresh },
      prepareRuntimePreview,
    });
    try {
      const response = await fetch(`${server.url}/`);

      expect(response.status).toBe(200);
      expect(refresh).not.toHaveBeenCalled();
      expect(prepareRuntimePreview).not.toHaveBeenCalled();
    } finally {
      await server.close();
    }
  });

  it('keeps root HTML 200 and exposes reload refresh failure state', async () => {
    const refresh = vi.fn(async () => createRefreshResult({
      ok: false,
      reason: 'reload',
      error: 'reload failed',
      changedAssetCount: null,
      scriptCompile: { status: 'skipped', durationMs: 0 },
    }));
    const { server } = await createServerFixture({
      refreshOnReload: true,
      refreshCoordinator: { refresh },
    });
    try {
      const response = await fetch(`${server.url}/`);
      const html = await response.text();

      expect(response.status).toBe(200);
      expect(html).toContain('refreshOnReloadFailure');
      expect(html).toContain('reload failed');
    } finally {
      await server.close();
    }
  });

  it('passes the final server URL to prepareRuntimePreview for endpoint refreshes', async () => {
    const refresh = vi.fn(async () => createRefreshResult());
    const prepareRuntimePreview = vi.fn(async () => undefined);
    const { server } = await createServerFixture({
      prepareRuntimePreview,
      refreshCoordinator: { refresh },
    });
    try {
      const response = await fetch(`${server.url}/__runtime-preview/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });

      expect(response.status).toBe(200);
      expect(prepareRuntimePreview).toHaveBeenCalledWith(server.url);
    } finally {
      await server.close();
    }
  });

  it('starts asset watcher when watchAssets is enabled and closes it with the server', async () => {
    const start = vi.fn(async () => undefined);
    const stop = vi.fn(async () => undefined);
    const { server } = await createServerFixture({
      watchAssets: true,
      assetChangeWatcherFactory: () => ({
        start,
        stop,
        getStatus: () => ({
          enabled: true,
          running: true,
          assetsRoot: 'E:/project/assets',
          eventCount: 0,
          dirtyTargetCount: 0,
          sampleTargets: [],
        }),
      }),
    });

    expect(start).toHaveBeenCalledTimes(1);
    await server.close();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('can defer asset watcher start until preview preparation is complete', async () => {
    const start = vi.fn(async () => undefined);
    const stop = vi.fn(async () => undefined);
    const { server } = await createServerFixture({
      watchAssets: true,
      deferAssetWatcherStart: true,
      assetChangeWatcherFactory: () => ({
        start,
        stop,
        getStatus: () => ({
          enabled: true,
          running: true,
          assetsRoot: 'E:/project/assets',
          eventCount: 0,
          dirtyTargetCount: 0,
          sampleTargets: [],
        }),
      }),
    });

    try {
      expect(start).not.toHaveBeenCalled();
      await server.startAssetWatcher();
      await server.startAssetWatcher();
      expect(start).toHaveBeenCalledTimes(1);
    } finally {
      await server.close();
    }
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('does not root-refresh on reload when watcher dirty-set is empty', async () => {
    const refreshTarget = vi.fn(async () => 1);
    const { server } = await createServerFixture({
      refreshOnReload: true,
      watchAssets: true,
      refreshTarget,
      assetDirtyStoreFactory: () => ({
        recordFileEvent: vi.fn(),
        drainDirtyTargets: () => ({ targets: [], entries: [], eventCount: 0, drainedAt: Date.now() }),
        requeueTargets: vi.fn(),
        peekDirtyTargets: () => [],
        getDirtyTargetCount: () => 0,
        getEventCount: () => 0,
      }),
      assetChangeWatcherFactory: () => ({
        start: async () => undefined,
        stop: async () => undefined,
        getStatus: () => ({
          enabled: true,
          running: true,
          assetsRoot: 'E:/project/assets',
          eventCount: 0,
          dirtyTargetCount: 0,
          sampleTargets: [],
        }),
      }),
    });

    try {
      const response = await fetch(server.url);
      const html = await response.text();

      expect(response.status).toBe(200);
      expect(html).toContain('dirty-set');
      expect(refreshTarget).not.toHaveBeenCalledWith('db://assets');
    } finally {
      await server.close();
    }
  });

  it('injects watcher start failure into root html without failing root', async () => {
    const { server } = await createServerFixture({
      watchAssets: true,
      assetChangeWatcherFactory: () => ({
        start: async () => undefined,
        stop: async () => undefined,
        getStatus: () => ({
          enabled: true,
          running: false,
          assetsRoot: 'E:/project/assets',
          error: 'native watcher unavailable',
          eventCount: 0,
          dirtyTargetCount: 0,
          sampleTargets: [],
        }),
      }),
    });

    try {
      const response = await fetch(server.url);
      const html = await response.text();

      expect(response.status).toBe(200);
      expect(html).toContain('native watcher unavailable');
    } finally {
      await server.close();
    }
  });
});
