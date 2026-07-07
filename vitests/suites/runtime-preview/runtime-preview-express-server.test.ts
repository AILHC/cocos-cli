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

  it('returns deterministic pre-ready responses without dirty refresh before preview ready', async () => {
    const refresh = vi.fn(async () => createRefreshResult({ reason: 'reload' }));
    const prepareRuntimePreview = vi.fn(async () => undefined);
    const loadPreviewSettings = vi.fn(async () => ({
      settings: {
        assets: {
          server: '',
          importBase: '',
          nativeBase: '',
        },
      },
      script2library: {},
      bundleConfigs: [
        {
          name: 'resources',
        },
      ],
    }));
    const readiness = {
      isReady: vi.fn(() => false),
      describe: vi.fn(() => ({
        settingsReady: false,
        assetWatcherReady: false,
        artifactsInspected: false,
      })),
    };
    const { server } = await createServerFixture({
      refreshOnReload: true,
      refreshCoordinator: { refresh },
      prepareRuntimePreview,
      settingsProvider: new PreviewSettingsProvider({ loadPreviewSettings }),
      readiness,
    });

    try {
      const root = await fetch(`${server.url}/`);
      expect(root.status).toBe(503);
      expect(root.headers.get('content-type')).toContain('text/plain');
      expect(await root.text()).toContain('Runtime preview is preparing');
      expect(refresh).not.toHaveBeenCalled();
      expect(prepareRuntimePreview).not.toHaveBeenCalled();

      const settings = await fetch(`${server.url}/settings.js`);
      expect(settings.status).toBe(503);
      expect(settings.headers.get('content-type')).toContain('text/plain');
      expect(await settings.text()).toContain('Runtime preview is preparing');

      const bundleConfig = await fetch(`${server.url}/assets/resources/config.json`);
      expect(bundleConfig.status).toBe(503);
      expect(bundleConfig.headers.get('content-type')).toContain('text/plain');
      expect(await bundleConfig.text()).toContain('Runtime preview is preparing');
      expect(loadPreviewSettings).not.toHaveBeenCalled();

      const endpointRefresh = await fetch(`${server.url}/__runtime-preview/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      expect(endpointRefresh.status).toBe(503);
      expect(endpointRefresh.headers.get('content-type')).toContain('text/plain');
      expect(await endpointRefresh.text()).toContain('Runtime preview is preparing');
      expect(refresh).not.toHaveBeenCalled();
      expect(prepareRuntimePreview).not.toHaveBeenCalled();

      const getRefresh = await fetch(`${server.url}/__runtime-preview/refresh`);
      expect(getRefresh.status).toBe(503);
      expect(getRefresh.headers.get('content-type')).toContain('text/plain');
      expect(await getRefresh.text()).toContain('Runtime preview is preparing');
      expect(refresh).not.toHaveBeenCalled();
      expect(prepareRuntimePreview).not.toHaveBeenCalled();
    } finally {
      await server.close();
    }
  });

  it('serves readiness status and health before preview ready', async () => {
    const readiness = {
      isReady: vi.fn(() => false),
      describe: vi.fn(() => ({
        settingsReady: true,
        assetWatcherReady: false,
        artifactsInspected: false,
      })),
    };
    const { server } = await createServerFixture({ readiness });

    try {
      const status = await fetch(`${server.url}/__runtime-preview/status`);
      expect(status.status).toBe(200);
      expect(status.headers.get('content-type')).toContain('application/json');
      expect(await status.json()).toEqual({
        ready: false,
        settingsReady: true,
        assetWatcherReady: false,
        artifactsInspected: false,
      });

      const health = await fetch(`${server.url}/__runtime-preview/health`);
      expect(health.status).toBe(200);
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

  it('does not trust compileError-shaped payloads from refresh fallback errors', async () => {
    const compileError = {
      phase: 'refresh',
      message: 'Unexpected token',
      name: 'SyntaxError',
      location: {
        assetUrl: 'db://assets/scripts/broken.ts',
        line: 4,
        column: 2,
      },
      refreshId: 'runtime-refresh-test',
      outputState: 'lastGoodDueToFailure',
    };
    const thrown = Object.assign(new Error('refresh adapter failed'), { compileError });
    const refresh = vi.fn(async () => {
      throw thrown;
    });
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
      const body = await response.json();
      expect(body).toMatchObject({
        ok: false,
        error: 'refresh adapter failed',
        scriptCompile: {
          status: 'skipped',
        },
      });
      expect(body.outputState).toBeUndefined();
      expect(body.compileError).toBeUndefined();
      expect(body.scriptCompile.diagnostic).toBeUndefined();
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

  it('returns minimal compile error page on reload noUsableOutput without runtime scripts', async () => {
    const refresh = vi.fn(async () => createRefreshResult({
      ok: false,
      reason: 'reload',
      error: 'Script compile failed: assets/scripts/broken.ts:7:11 Unexpected token',
      changedAssetCount: null,
      outputState: 'noUsableOutput',
      compileError: {
        phase: 'reload-refresh',
        message: 'Unexpected <token>',
        location: {
          relativeFilePath: 'assets/scripts/broken.ts',
          line: 7,
          column: 11,
        },
        codeFrame: '> 7 | const value = <bad>;\n    |              ^',
      },
      scriptCompile: {
        status: 'failed',
        durationMs: 8,
      },
    }));
    const { server } = await createServerFixture({
      refreshOnReload: true,
      refreshCoordinator: { refresh },
    });
    try {
      const response = await fetch(`${server.url}/`);
      const html = await response.text();

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/html');
      expect(html).toContain('Runtime Preview Compile Error');
      expect(html).toContain('assets/scripts/broken.ts:7:11');
      expect(html).toContain('Unexpected &lt;token&gt;');
      expect(html).toContain('&gt; 7 | const value = &lt;bad&gt;');
      expect(html).toContain('Current change was not applied. Preview has no usable script output.');
      expect(html).toContain('refreshOnReloadFailure');
      expect(html).not.toContain('type="systemjs-importmap"');
      expect(html).not.toContain('/scripting/import-map-global');
      expect(html).not.toContain('/scripting/systemjs/system.js');
      expect(html).not.toContain('/static/runtime-preview/preview-app/main.js');
    } finally {
      await server.close();
    }
  });

  it('returns minimal compile error page for startup noUsableOutput without refresh-on-reload', async () => {
    const startupCompileFailure = vi.fn(() => createRefreshResult({
      ok: false,
      reason: 'reload',
      error: 'Script compile failed: assets/scripts/Broken.ts:2047:0 Invalid left-hand side',
      changedAssetCount: null,
      outputState: 'noUsableOutput',
      compileError: {
        phase: 'startup',
        target: 'preview',
        message: 'Invalid left-hand side in assignment expression.',
        location: {
          relativeFilePath: 'assets/scripts/Broken.ts',
          line: 2047,
          column: 0,
        },
        codeFrame: '> 2047 | window.TestRefresh() = function (){\n       | ^',
        outputState: 'noUsableOutput',
      },
      scriptCompile: {
        status: 'failed',
        durationMs: 0,
      },
    }));
    const { server } = await createServerFixture({
      startupCompileFailure,
    });
    try {
      const response = await fetch(`${server.url}/`);
      const html = await response.text();

      expect(response.status).toBe(200);
      expect(startupCompileFailure).toHaveBeenCalled();
      expect(html).toContain('Runtime Preview Compile Error');
      expect(html).toContain('assets/scripts/Broken.ts:2047:0');
      expect(html).toContain('Invalid left-hand side in assignment expression.');
      expect(html).toContain('window.TestRefresh() = function ()');
      expect(html).toContain('Current change was not applied. Preview has no usable script output.');
      expect(html).not.toContain('type="systemjs-importmap"');
      expect(html).not.toContain('/scripting/systemjs/system.js');
    } finally {
      await server.close();
    }
  });

  it('clears startup noUsableOutput after a successful endpoint refresh', async () => {
    let startupFailure: RuntimeRefreshResult | null = createRefreshResult({
      ok: false,
      reason: 'reload',
      error: 'Script compile failed: assets/scripts/Broken.ts:2047:0 Invalid left-hand side',
      changedAssetCount: null,
      outputState: 'noUsableOutput',
      compileError: {
        phase: 'startup',
        target: 'preview',
        message: 'Invalid left-hand side in assignment expression.',
        location: {
          relativeFilePath: 'assets/scripts/Broken.ts',
          line: 2047,
          column: 0,
        },
        outputState: 'noUsableOutput',
      },
    });
    const startupCompileFailure = vi.fn(() => startupFailure);
    const clearStartupCompileFailure = vi.fn(() => {
      startupFailure = null;
    });
    const refresh = vi.fn(async () => createRefreshResult({ ok: true }));
    const verifyProgrammingOutput = vi.fn(async () => undefined);
    const { server } = await createServerFixture({
      startupCompileFailure,
      clearStartupCompileFailure,
      verifyProgrammingOutput,
      refreshCoordinator: { refresh },
    });
    try {
      const refreshResponse = await fetch(`${server.url}/__runtime-preview/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      const rootResponse = await fetch(`${server.url}/`);
      const html = await rootResponse.text();

      expect(refreshResponse.status).toBe(200);
      expect(refresh).toHaveBeenCalled();
      expect(verifyProgrammingOutput).toHaveBeenCalled();
      expect(clearStartupCompileFailure).toHaveBeenCalledTimes(1);
      expect(rootResponse.status).toBe(200);
      expect(html).not.toContain('Runtime Preview Compile Error');
      expect(html).toContain('type="systemjs-importmap"');
    } finally {
      await server.close();
    }
  });

  it('keeps startup noUsableOutput when a successful endpoint refresh cannot verify output', async () => {
    const startupFailure = createRefreshResult({
      ok: false,
      reason: 'reload',
      error: 'Script compile failed: assets/scripts/Broken.ts:2047:0 Invalid left-hand side',
      changedAssetCount: null,
      outputState: 'noUsableOutput',
      compileError: {
        phase: 'startup',
        target: 'preview',
        message: 'Invalid left-hand side in assignment expression.',
        location: {
          relativeFilePath: 'assets/scripts/Broken.ts',
          line: 2047,
          column: 0,
        },
        outputState: 'noUsableOutput',
      },
    });
    const startupCompileFailure = vi.fn(() => startupFailure);
    const clearStartupCompileFailure = vi.fn();
    const verifyProgrammingOutput = vi.fn(async () => {
      throw new Error('preview output is still missing');
    });
    const refresh = vi.fn(async () => createRefreshResult({ ok: true }));
    const { server } = await createServerFixture({
      startupCompileFailure,
      clearStartupCompileFailure,
      verifyProgrammingOutput,
      refreshCoordinator: { refresh },
    });
    try {
      const refreshResponse = await fetch(`${server.url}/__runtime-preview/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      const rootResponse = await fetch(`${server.url}/`);
      const html = await rootResponse.text();

      expect(refreshResponse.status).toBe(200);
      expect(refresh).toHaveBeenCalled();
      expect(verifyProgrammingOutput).toHaveBeenCalled();
      expect(clearStartupCompileFailure).not.toHaveBeenCalled();
      expect(rootResponse.status).toBe(200);
      expect(html).toContain('Runtime Preview Compile Error');
      expect(html).toContain('assets/scripts/Broken.ts:2047:0');
    } finally {
      await server.close();
    }
  });

  it('tries refresh-on-reload before showing a stale startup noUsableOutput page', async () => {
    let startupFailure: RuntimeRefreshResult | null = createRefreshResult({
      ok: false,
      reason: 'reload',
      error: 'Script compile failed: assets/scripts/Broken.ts:2047:0 Invalid left-hand side',
      changedAssetCount: null,
      outputState: 'noUsableOutput',
      compileError: {
        phase: 'startup',
        target: 'preview',
        message: 'Invalid left-hand side in assignment expression.',
        location: {
          relativeFilePath: 'assets/scripts/Broken.ts',
          line: 2047,
          column: 0,
        },
        outputState: 'noUsableOutput',
      },
    });
    const startupCompileFailure = vi.fn(() => startupFailure);
    const clearStartupCompileFailure = vi.fn(() => {
      startupFailure = null;
    });
    const verifyProgrammingOutput = vi.fn(async () => undefined);
    const refresh = vi.fn(async () => createRefreshResult({
      ok: true,
      reason: 'reload',
      outputState: 'latest',
    }));
    const { server } = await createServerFixture({
      refreshOnReload: true,
      startupCompileFailure,
      clearStartupCompileFailure,
      verifyProgrammingOutput,
      refreshCoordinator: { refresh },
    });
    try {
      const response = await fetch(`${server.url}/`);
      const html = await response.text();

      expect(response.status).toBe(200);
      expect(refresh).toHaveBeenCalledWith({ reason: 'reload' });
      expect(verifyProgrammingOutput).toHaveBeenCalled();
      expect(clearStartupCompileFailure).toHaveBeenCalledTimes(1);
      expect(html).not.toContain('Runtime Preview Compile Error');
      expect(html).toContain('type="systemjs-importmap"');
    } finally {
      await server.close();
    }
  });

  it('shows the latest reload compile failure when startup noUsableOutput is still active', async () => {
    const startupFailure = createRefreshResult({
      ok: false,
      reason: 'reload',
      error: 'Script compile failed: assets/scripts/OldBroken.ts:2047:0 Old syntax error',
      changedAssetCount: null,
      outputState: 'noUsableOutput',
      compileError: {
        phase: 'startup',
        target: 'preview',
        message: 'Old syntax error',
        location: {
          relativeFilePath: 'assets/scripts/OldBroken.ts',
          line: 2047,
          column: 0,
        },
        outputState: 'noUsableOutput',
      },
    });
    const refresh = vi.fn(async () => createRefreshResult({
      ok: false,
      reason: 'reload',
      error: 'Script compile failed: assets/scripts/NewBroken.ts:88:4 New syntax error',
      changedAssetCount: 1,
      outputState: 'lastGoodDueToFailure',
      compileError: {
        phase: 'reload-refresh',
        target: 'preview',
        message: 'New syntax error',
        location: {
          relativeFilePath: 'assets/scripts/NewBroken.ts',
          line: 88,
          column: 4,
        },
        codeFrame: '> 88 | const value = <bad>',
        outputState: 'lastGoodDueToFailure',
      },
      scriptCompile: {
        status: 'failed',
        durationMs: 3,
        error: 'Script compile failed: assets/scripts/NewBroken.ts:88:4 New syntax error',
      },
    }));
    const { server } = await createServerFixture({
      refreshOnReload: true,
      startupCompileFailure: () => startupFailure,
      refreshCoordinator: { refresh },
    });
    try {
      const response = await fetch(`${server.url}/`);
      const html = await response.text();

      expect(response.status).toBe(200);
      expect(refresh).toHaveBeenCalledWith({ reason: 'reload' });
      expect(html).toContain('Runtime Preview Compile Error');
      expect(html).toContain('assets/scripts/NewBroken.ts:88:4');
      expect(html).toContain('New syntax error');
      expect(html).toContain('&gt; 88 | const value = &lt;bad&gt;');
      expect(html).not.toContain('OldBroken.ts');
      expect(html).toContain('Current change was not applied. Preview has no usable script output.');
      expect(html).not.toContain('type="systemjs-importmap"');
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
        recordDirtyTarget: vi.fn(),
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

  it('shares one path canonicalizer across dirty-store and watcher factories', async () => {
    let dirtyStoreCanonicalizer: unknown;
    let watcherCanonicalizer: unknown;
    const { server } = await createServerFixture({
      watchAssets: true,
      deferAssetWatcherStart: true,
      assetDirtyStoreFactory: ({ pathCanonicalizer }) => {
        dirtyStoreCanonicalizer = pathCanonicalizer;
        return {
          recordFileEvent: vi.fn(),
          recordDirtyTarget: vi.fn(),
          drainDirtyTargets: () => ({ targets: [], entries: [], eventCount: 0, drainedAt: Date.now() }),
          requeueTargets: vi.fn(),
          peekDirtyTargets: () => [],
          getDirtyTargetCount: () => 0,
          getEventCount: () => 0,
        };
      },
      assetChangeWatcherFactory: ({ pathCanonicalizer }) => ({
        start: async () => {
          watcherCanonicalizer = pathCanonicalizer;
        },
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
      await server.startAssetWatcher();
      expect(dirtyStoreCanonicalizer).toBe(watcherCanonicalizer);
    } finally {
      await server.close();
    }
  });

  it('bounds runtime path canonicalization log samples per server lifecycle', async () => {
    const { server } = await createServerFixture({
      watchAssets: true,
      assetPathCanonicalizerFs: {
        existsSync: (path) => /[\\/]assets(?:[\\/]RESOUR~1|[\\/]resources)?$/.test(path.replace(/\\/g, '/')),
        realpathSyncNative: (path) => path.replace(/\\/g, '/').replace('/assets/RESOUR~1', '/assets/resources'),
      },
      assetDirtyStoreFactory: ({ projectRoot, pathCanonicalizer }) => {
        for (let index = 0; index < 10; index += 1) {
          pathCanonicalizer.refreshTargetToDbTarget(
            `db://assets/RESOUR~1/file-${index}.json`,
            'dirty-target',
          );
        }
        return {
          recordFileEvent: vi.fn(),
          recordDirtyTarget: vi.fn(),
          drainDirtyTargets: () => ({ targets: [], entries: [], eventCount: 0, drainedAt: Date.now() }),
          requeueTargets: vi.fn(),
          peekDirtyTargets: () => [],
          getDirtyTargetCount: () => 0,
          getEventCount: () => 0,
        };
      },
    });

    try {
      const logSource = await readFile(server.logFilePath, 'utf8');
      const loggerWrites = logSource.split(/\r?\n/);
      const canonicalLogs = loggerWrites.filter((line) => line.includes('runtime-path-canonicalize'));
      expect(canonicalLogs).toHaveLength(5);
      expect(canonicalLogs[0]).toContain('reason=dirty-target');
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
