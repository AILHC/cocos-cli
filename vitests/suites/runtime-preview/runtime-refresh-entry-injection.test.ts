import { describe, expect, it } from 'vitest';
import { injectRuntimeRefreshEntry } from '@runtime-preview/server/runtime-refresh-entry-injection';
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

describe('runtime refresh entry injection', () => {
  it('injects refresh state and installer before the closing body tag', () => {
    const html = '<html><body><main>preview</main></body></html>';
    const injected = injectRuntimeRefreshEntry(html, {
      lastRefresh: createRefreshResult({ refreshId: 'runtime-refresh-body' }),
    });

    expect(injected).toContain('window.__RUNTIME_PREVIEW_REFRESH_STATE__');
    expect(injected).toContain('"refreshId":"runtime-refresh-body"');
    expect(injected).toContain('btn-runtime-refresh');
    expect(injected).toContain('runtime-preview-refresh-fixed');
    expect(injected).toContain('runtime-preview-refresh-toast');
    expect(injected).toContain('/__runtime-preview/refresh');
    expect(injected.indexOf('window.__RUNTIME_PREVIEW_REFRESH_STATE__')).toBeLessThan(injected.indexOf('</body>'));
  });

  it('appends the installer when the html has no body tag', () => {
    const html = '<main>preview without body</main>';
    const injected = injectRuntimeRefreshEntry(html, {
      refreshOnReloadFailure: createRefreshResult({
        ok: false,
        reason: 'reload',
        error: 'reload failed',
      }),
    });

    expect(injected.startsWith(html)).toBe(true);
    expect(injected).toContain('window.__RUNTIME_PREVIEW_REFRESH_STATE__');
    expect(injected).toContain('refreshOnReloadFailure');
    expect(injected).toContain('reload failed');
    expect(injected).toContain('function installRuntimeRefresh');
    expect(injected).toContain('runtime-preview-refresh-toast');
  });
});
