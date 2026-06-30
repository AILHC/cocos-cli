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

  it('injects compile error panel code and escaped serialized diagnostic state', () => {
    const injected = injectRuntimeRefreshEntry('<html><body></body></html>', {
      refreshOnReloadFailure: createRefreshResult({
        ok: false,
        reason: 'reload',
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
          codeFrame: 'const value = <bad>;',
        },
        scriptCompile: {
          status: 'failed',
          durationMs: 4,
        },
      }),
    });

    expect(injected).toContain('runtime-preview-compile-error-panel');
    expect(injected).toContain('Script compile failed');
    expect(injected).toContain('Current change was not applied. Preview has no usable script output.');
    expect(injected).toContain('renderRuntimePreviewCompileErrorPanel');
    expect(injected).toContain('assets/scripts/broken.ts');
    expect(injected).toContain('Unexpected \\u003ctoken>');
    expect(injected).toContain('const value = \\u003cbad>;');
    expect(injected).not.toContain('Unexpected <token>');
    expect(injected).not.toContain('const value = <bad>;');
  });
});
