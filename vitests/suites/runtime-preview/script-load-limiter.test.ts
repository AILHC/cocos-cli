import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  installRuntimePreviewScriptLoadLimiter,
  isRuntimePreviewProjectChunkUrl,
  isScriptLoadFailure,
} from '../../../src/runtime-preview/preview-app/src/systemjs-load-limiter';

function createPreviewChunkUrl(name: string): string {
  return `http://127.0.0.1:19530/scripting/x/packer-driver/targets/preview/chunks/aa/${name}.js`;
}

function stubRuntimePreviewWindow(search: string, scriptLoadConcurrency?: number): void {
  vi.stubGlobal('window', {
    location: {
      href: `http://127.0.0.1:19530/${search}`,
      search,
    },
    __RUNTIME_PREVIEW_SCRIPT_LOAD_CONCURRENCY__: scriptLoadConcurrency,
  });
}

describe('runtime preview SystemJS script load limiter', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('matches only preview project chunk URLs', () => {
    expect(isRuntimePreviewProjectChunkUrl(
      'http://127.0.0.1:19530/scripting/x/packer-driver/targets/preview/chunks/aa/a.js',
    )).toBe(true);
    expect(isRuntimePreviewProjectChunkUrl(
      '/scripting/x/packer-driver/targets/preview/chunks/aa/a.js',
    )).toBe(true);
    expect(isRuntimePreviewProjectChunkUrl(
      'http://127.0.0.1:19530/scripting/engine/bin/.cache/dev-cli/web/bundled/index.js',
    )).toBe(false);
    expect(isRuntimePreviewProjectChunkUrl(
      'http://127.0.0.1:19530/scripting/x/packer-driver/targets/editor/chunks/aa/a.js',
    )).toBe(false);
    expect(isRuntimePreviewProjectChunkUrl(
      'http://127.0.0.1:19530/scripting/x/packer-driver/targets/preview/import-map.json',
    )).toBe(false);
  });

  it('does not limit non-preview URLs', async () => {
    const calls: string[] = [];
    const system = {
      instantiate: vi.fn(async (url: string) => {
        calls.push(url);
        return `loaded:${url}`;
      }),
    };
    const limiter = installRuntimePreviewScriptLoadLimiter(system, { concurrency: 1, retry: 0 });

    await Promise.all([
      system.instantiate('/settings.js', undefined),
      system.instantiate('/scripting/engine/bin/.cache/dev-cli/web/bundled/index.js', undefined),
    ]);

    expect(calls).toEqual([
      '/settings.js',
      '/scripting/engine/bin/.cache/dev-cli/web/bundled/index.js',
    ]);
    expect(limiter.metrics.bypassed).toBe(2);
    expect(limiter.metrics.enqueued).toBe(0);
    expect(limiter.metrics.completed).toBe(0);
  });

  it('does not exceed configured concurrency', async () => {
    let active = 0;
    let maxObservedActive = 0;
    const system = {
      instantiate: vi.fn(async (url: string) => {
        active += 1;
        maxObservedActive = Math.max(maxObservedActive, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return `loaded:${url}`;
      }),
    };
    const limiter = installRuntimePreviewScriptLoadLimiter(system, { concurrency: 2, retry: 0 });
    const urls = Array.from({ length: 8 }, (_, index) => createPreviewChunkUrl(String(index)));

    await Promise.all(urls.map((url) => system.instantiate(url, undefined)));

    expect(maxObservedActive).toBeLessThanOrEqual(2);
    expect(limiter.metrics.maxActive).toBeLessThanOrEqual(2);
    expect(limiter.metrics.queuePeak).toBeGreaterThan(0);
    expect(limiter.metrics.completed).toBe(8);
    expect(limiter.metrics.failed).toBe(0);
  });

  it('installs idempotently', async () => {
    const originalInstantiate = vi.fn(async (url: string) => `loaded:${url}`);
    const system = {
      instantiate: originalInstantiate,
    };

    const first = installRuntimePreviewScriptLoadLimiter(system, { concurrency: 2, retry: 0 });
    const patchedInstantiate = system.instantiate;
    const second = installRuntimePreviewScriptLoadLimiter(system, { concurrency: 4, retry: 1 });

    expect(second).toBe(first);
    expect(system.instantiate).toBe(patchedInstantiate);
    expect(first.concurrency).toBe(2);
    await system.instantiate(createPreviewChunkUrl('a'), undefined);
    expect(originalInstantiate).toHaveBeenCalledTimes(1);
  });

  it('uses injected runtime preview scriptLoadConcurrency when URL query is absent', () => {
    stubRuntimePreviewWindow('', 24);
    const system = {
      instantiate: vi.fn(async (url: string) => `loaded:${url}`),
    };

    const limiter = installRuntimePreviewScriptLoadLimiter(system, { retry: 0 });

    expect(limiter.concurrency).toBe(24);
  });

  it('prefers URL query concurrency over injected runtime preview config', () => {
    stubRuntimePreviewWindow('?runtimePreviewScriptLoadConcurrency=12', 24);
    const system = {
      instantiate: vi.fn(async (url: string) => `loaded:${url}`),
    };

    const limiter = installRuntimePreviewScriptLoadLimiter(system, { retry: 0 });

    expect(limiter.concurrency).toBe(12);
  });

  it('retries script load failure only', async () => {
    const url = createPreviewChunkUrl('a');
    const loadFailure = new Error(`Error loading ${url} from parent`);
    const executionFailure = new Error('module execute failed');

    expect(isScriptLoadFailure(loadFailure, url)).toBe(true);
    expect(isScriptLoadFailure(new Error(`GET ${url} net::ERR_INSUFFICIENT_RESOURCES`), url)).toBe(true);
    expect(isScriptLoadFailure(executionFailure, url)).toBe(false);
  });

  it('does not retry module execution failures', async () => {
    const executionFailure = new Error('module execute failed');
    const originalInstantiate = vi.fn(async () => {
      throw executionFailure;
    });
    const system = {
      instantiate: originalInstantiate,
    };
    installRuntimePreviewScriptLoadLimiter(system, { concurrency: 1, retry: 2 });

    await expect(system.instantiate(createPreviewChunkUrl('a'), undefined)).rejects.toBe(executionFailure);
    expect(originalInstantiate).toHaveBeenCalledTimes(1);
  });

  it('retries classified script load failures', async () => {
    const url = createPreviewChunkUrl('a');
    const originalInstantiate = vi.fn()
      .mockRejectedValueOnce(new Error(`Error loading ${url} from parent`))
      .mockResolvedValueOnce(`loaded:${url}`);
    const system = {
      instantiate: originalInstantiate,
    };
    const limiter = installRuntimePreviewScriptLoadLimiter(system, { concurrency: 1, retry: 1 });

    await expect(system.instantiate(url, undefined)).resolves.toBe(`loaded:${url}`);

    expect(originalInstantiate).toHaveBeenCalledTimes(2);
    expect(limiter.metrics.retryCount).toBe(1);
    expect(limiter.metrics.completed).toBe(1);
    expect(limiter.metrics.failed).toBe(0);
  });
});
