import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IncomingHttpHeaders } from 'node:http';
import { describe, expect, it } from 'vitest';
import { PreviewSettingsProvider } from '@runtime-preview/settings/preview-settings-provider';
import { startRuntimePreviewServer } from '@runtime-preview/server/runtime-preview-server';

async function createServerFixture() {
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

  const server = await startRuntimePreviewServer({
    projectRoot,
    engineRoot,
    projectLibraryRoot,
    projectProgrammingRoot,
    host: '127.0.0.1',
    port: 0,
    settingsProvider: new PreviewSettingsProvider({
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
    }),
  });

  return { server };
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
});
