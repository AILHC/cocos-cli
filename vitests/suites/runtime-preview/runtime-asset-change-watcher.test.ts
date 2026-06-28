import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createRuntimeAssetChangeWatcher } from '@runtime-preview/watch/runtime-asset-change-watcher';
import { createRuntimeAssetDirtyStore } from '@runtime-preview/watch/runtime-asset-dirty-store';

describe('runtime asset change watcher', () => {
  it('subscribes to project assets root and records events', async () => {
    const projectRoot = 'E:/project';
    const store = createRuntimeAssetDirtyStore({ projectRoot });
    let callback: ((error: Error | null, events: Array<{ type: 'create' | 'update' | 'delete'; path: string }>) => void) | undefined;
    const subscribe = vi.fn(async (_root, cb) => {
      callback = cb;
      return { unsubscribe: vi.fn(async () => undefined) };
    });
    const watcher = createRuntimeAssetChangeWatcher({
      projectRoot,
      dirtyStore: store,
      subscribe,
    });

    await watcher.start();
    expect(subscribe).toHaveBeenCalledWith(
      join(projectRoot, 'assets'),
      expect.any(Function),
      expect.objectContaining({ ignore: expect.any(Array) }),
    );

    callback?.(null, [{ type: 'update', path: join(projectRoot, 'assets', 'a.json') }]);
    expect(watcher.getStatus().running).toBe(true);
    expect(watcher.getStatus().sampleTargets).toEqual(['db://assets/a.json']);
    expect(store.drainDirtyTargets().targets).toEqual(['db://assets/a.json']);
  });

  it('records start failure without throwing when failSoft is enabled', async () => {
    const store = createRuntimeAssetDirtyStore({ projectRoot: 'E:/project' });
    const watcher = createRuntimeAssetChangeWatcher({
      projectRoot: 'E:/project',
      dirtyStore: store,
      subscribe: async () => { throw new Error('native watcher unavailable'); },
      failSoft: true,
    });
    await watcher.start();
    expect(watcher.getStatus()).toMatchObject({
      running: false,
      error: 'native watcher unavailable',
    });
  });

  it('unsubscribes on stop', async () => {
    const unsubscribe = vi.fn(async () => undefined);
    const store = createRuntimeAssetDirtyStore({ projectRoot: 'E:/project' });
    const watcher = createRuntimeAssetChangeWatcher({
      projectRoot: 'E:/project',
      dirtyStore: store,
      subscribe: async () => ({ unsubscribe }),
    });
    await watcher.start();
    await watcher.stop();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(watcher.getStatus().running).toBe(false);
  });
});
