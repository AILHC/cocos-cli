import { createServer, type Server } from 'node:http';
import { describe, expect, it } from 'vitest';
import { collectBrowserConsoleEvidence } from '@shared/playwright-console-listener';
import { classifyRuntimePreviewStrictAcceptanceFailures } from '@shared/runtime-preview-acceptance';

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('test server did not expose a TCP port'));
        return;
      }
      resolve(address.port);
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

describe('playwright runtime preview console listener', () => {
  it('classifies strict acceptance failures without failing on warnings', () => {
    expect(classifyRuntimePreviewStrictAcceptanceFailures({
      readyTimedOut: false,
      consoleMessages: [
        { type: 'warning' },
      ],
      unhandledRejections: [],
      pageErrors: [],
      failedRequests: [],
      badResponses: [],
    })).toEqual([]);

    expect(classifyRuntimePreviewStrictAcceptanceFailures({
      readyTimedOut: true,
      consoleMessages: [
        { type: 'error' },
        { type: 'warning' },
      ],
      unhandledRejections: ['rejection'],
      pageErrors: ['pageerror'],
      failedRequests: [{ url: '/missing.js' }],
      badResponses: [{ url: '/missing.json', status: 404 }],
    })).toEqual([
      'ready timed out',
      'pageErrors=1',
      'unhandledRejections=1',
      'failedRequests=1',
      'badResponses=1',
      'consoleErrors=1',
    ]);
  });

  it('collects browser console errors into diagnostic evidence', async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(`
        <!doctype html>
        <script>
          console.error('playwright-listener-test-error');
          window.__RUNTIME_PREVIEW_READY = { scene: 'diagnostic' };
        </script>
      `);
    });

    const port = await listen(server);
    try {
      const evidence = await collectBrowserConsoleEvidence({
        url: `http://127.0.0.1:${port}/`,
        runtimeServerOrigin: `http://127.0.0.1:${port}`,
        readyTimeoutMs: 10_000,
        stableWindowMs: 200,
      });

      expect(evidence.ready).toEqual({ scene: 'diagnostic' });
      expect(evidence.consoleMessages).toEqual([
        expect.objectContaining({
          type: 'error',
          text: 'playwright-listener-test-error',
        }),
      ]);
    } finally {
      await close(server);
    }
  }, 30_000);
});
