import { mkdtemp, rm } from 'node:fs/promises';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRuntimePreviewRouter } from '../../../src/runtime-preview/server/runtime-preview-server';
import { startRuntimePreviewSession } from '../../../src/runtime-preview/session/runtime-preview-session';
import { ServerService, serverService } from '../../../src/server/server';

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Test server did not expose a TCP address.'));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

function canListen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createNetServer();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
  });
}

afterEach(async () => {
  await serverService.stop().catch(() => undefined);
  vi.restoreAllMocks();
});

describe('runtime preview lifecycle rollback', () => {
  it('rolls back a watcher-start failure after asset-save subscription setup', async () => {
    const root = await mkdtemp(join(tmpdir(), 'runtime-preview-router-rollback-'));
    const stopWatcher = vi.fn(async () => undefined);
    const unsubscribe = vi.fn();
    const onAssetSaved = vi.fn(() => unsubscribe);
    try {
      await expect(createRuntimePreviewRouter({
        projectRoot: root,
        engineRoot: join(root, 'engine'),
        projectLibraryRoot: join(root, 'library'),
        projectProgrammingRoot: join(root, 'programming'),
        serverUrl: 'http://127.0.0.1:9527',
        watchAssets: true,
        assetSaveSource: { onAssetSaved },
        assetChangeWatcherFactory: () => ({
          start: async () => {
            throw new Error('watcher start failed');
          },
          stop: stopWatcher,
          getStatus: () => ({
            enabled: true,
            running: false,
            assetsRoot: join(root, 'assets'),
            eventCount: 0,
            dirtyTargetCount: 0,
            sampleTargets: [],
            startupDirtyTargetCount: 0,
            startupIgnoredMetaOnlyCount: 0,
            startupSampleTargets: [],
            startupIgnoredMetaOnlySample: [],
            startupSkippedSymlinkCount: 0,
            startupSkippedSymlinkSample: [],
          }),
        }),
      })).rejects.toThrow('watcher start failed');

      expect(onAssetSaved).toHaveBeenCalledTimes(1);
      expect(unsubscribe).toHaveBeenCalledTimes(1);
      expect(stopWatcher).toHaveBeenCalledTimes(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('continues all cleanup phases and closes the server after one phase fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'runtime-preview-session-cleanup-'));
    const port = await getFreePort();
    const stopServer = vi.spyOn(serverService, 'stop');
    try {
      const session = await startRuntimePreviewSession({
        projectRoot: root,
        engineRoot: join(root, 'engine'),
        projectLibraryRoot: join(root, 'library'),
        projectProgrammingRoot: join(root, 'programming'),
        port,
      });
      const order: string[] = [];
      session.registerCleanup('runtime', async () => {
        order.push('runtime');
        throw new Error('runtime close failed');
      });
      session.registerCleanup('scene', async () => {
        order.push('scene');
      });
      session.registerCleanup('project', async () => {
        order.push('project');
      });

      const firstClose = session.close();
      const secondClose = session.close();
      expect(secondClose).toBe(firstClose);
      await expect(firstClose).rejects.toBeInstanceOf(AggregateError);
      expect(order).toEqual(['runtime', 'scene', 'project']);
      expect(stopServer).toHaveBeenCalledTimes(1);
      expect(await canListen(port)).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('retains a failed server owner so stop can be retried', async () => {
    const service = new ServerService();
    const close = vi.fn((callback: (error?: Error) => void) => {
      queueMicrotask(() => callback(close.mock.calls.length === 1 ? new Error('first stop failed') : undefined));
    });
    (service as any).server = { close, listening: true };

    await expect(service.stop()).rejects.toThrow('first stop failed');
    expect((service as any).server).toBeDefined();
    await expect(service.stop()).resolves.toBeUndefined();
    expect(close).toHaveBeenCalledTimes(2);
    expect((service as any).server).toBeUndefined();
  });
});
