import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  createRuntimeAssetChangeWatcher,
  createRuntimeAssetStartupSnapshot,
} from '@runtime-preview/watch/runtime-asset-change-watcher';
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

  it('normalizes startup snapshot keys before diffing and rejects absolute or escaping keys', async () => {
    const projectRoot = 'E:/project';
    const store = createRuntimeAssetDirtyStore({ projectRoot });
    const watcher = createRuntimeAssetChangeWatcher({
      projectRoot,
      dirtyStore: store,
      startupSnapshot: {
        files: new Map([
          ['scripts\\a.ts', { mtimeMs: 1, size: 10 }],
          ['scripts/./unchanged.ts', { mtimeMs: 1, size: 10 }],
          ['../outside.ts', { mtimeMs: 1, size: 10 }],
          ['C:\\outside\\absolute.ts', { mtimeMs: 1, size: 10 }],
          ['/absolute.ts', { mtimeMs: 1, size: 10 }],
        ]),
      },
      snapshotFiles: async () => ({
        files: new Map([
          ['scripts/a.ts', { mtimeMs: 2, size: 11 }],
          ['scripts/unchanged.ts', { mtimeMs: 1, size: 10 }],
          ['../outside.ts', { mtimeMs: 2, size: 11 }],
          ['C:\\outside\\absolute.ts', { mtimeMs: 2, size: 11 }],
          ['/absolute.ts', { mtimeMs: 2, size: 11 }],
        ]),
      }),
      subscribe: async () => ({ unsubscribe: vi.fn() }),
    });

    await watcher.start();

    expect(store.drainDirtyTargets().targets).toEqual(['db://assets/scripts/a.ts']);
  });

  it('keeps startup skipped symlink diagnostics without recording dirty targets', async () => {
    const projectRoot = 'E:/project';
    const store = createRuntimeAssetDirtyStore({ projectRoot });
    const watcher = createRuntimeAssetChangeWatcher({
      projectRoot,
      dirtyStore: store,
      startupSnapshot: {
        files: new Map(),
        skippedSymlinks: ['scripts/link.ts'],
      },
      snapshotFiles: async () => ({
        files: new Map(),
        skippedSymlinks: ['scripts/link.ts', 'textures/link.png'],
      }),
      subscribe: async () => ({ unsubscribe: vi.fn() }),
    });

    await watcher.start();

    expect(store.peekDirtyTargets()).toEqual([]);
    expect(watcher.getStatus()).toMatchObject({
      startupSkippedSymlinkCount: 2,
      startupSkippedSymlinkSample: ['scripts/link.ts', 'textures/link.png'],
    });
  });

  it('skips symlinks while creating startup snapshots', async () => {
    vi.resetModules();
    const readdir = vi.fn(async () => [
      {
        name: 'real.ts',
        isDirectory: () => false,
        isFile: () => true,
        isSymbolicLink: () => false,
      },
      {
        name: 'link.ts',
        isDirectory: () => false,
        isFile: () => true,
        isSymbolicLink: () => true,
      },
    ]);
    const stat = vi.fn(async () => ({ isFile: () => true, mtimeMs: 1, size: 10 }));
    vi.doMock('node:fs/promises', () => ({
      readdir,
      stat,
      default: {
        readdir,
        stat,
      },
    }));

    try {
      const { createRuntimeAssetStartupSnapshot: createSnapshot } = await import(
        '../../../src/runtime-preview/watch/runtime-asset-change-watcher'
      );
      const snapshot = await createSnapshot('E:/project/assets');
      expect(snapshot.files.has('real.ts')).toBe(true);
      expect(snapshot.files.has('link.ts')).toBe(false);
      expect(snapshot.skippedSymlinks).toEqual(['link.ts']);
      expect(stat).toHaveBeenCalledTimes(1);
    } finally {
      vi.doUnmock('node:fs/promises');
      vi.resetModules();
    }
  });

  it('skips startup snapshot files that disappear before stat', async () => {
    vi.resetModules();
    const readdir = vi.fn(async () => [
        {
          name: 'gone.ts',
          isDirectory: () => false,
          isFile: () => true,
          isSymbolicLink: () => false,
        },
      ]);
    const stat = vi.fn(async () => {
        const error = new Error('gone') as NodeJS.ErrnoException;
        error.code = 'ENOENT';
        throw error;
      });
    vi.doMock('node:fs/promises', () => ({
      readdir,
      stat,
      default: {
        readdir,
        stat,
      },
    }));

    try {
      const { createRuntimeAssetStartupSnapshot: createSnapshot } = await import(
        '../../../src/runtime-preview/watch/runtime-asset-change-watcher'
      );
      const snapshot = await createSnapshot('E:/project/assets');
      expect(snapshot.files.size).toBe(0);
      expect(snapshot.skippedSymlinks).toEqual([]);
    } finally {
      vi.doUnmock('node:fs/promises');
      vi.resetModules();
    }
  });

  it('skips startup snapshot directories replaced before child readdir', async () => {
    vi.resetModules();
    const readdir = vi.fn(async (root: string) => {
      if (root.replace(/\\/g, '/').endsWith('/temp-dir')) {
        const error = new Error('not a directory') as NodeJS.ErrnoException;
        error.code = 'ENOTDIR';
        throw error;
      }
      return [
        {
          name: 'temp-dir',
          isDirectory: () => true,
          isFile: () => false,
          isSymbolicLink: () => false,
        },
      ];
    });
    const stat = vi.fn();
    vi.doMock('node:fs/promises', () => ({
      readdir,
      stat,
      default: {
        readdir,
        stat,
      },
    }));

    try {
      const { createRuntimeAssetStartupSnapshot: createSnapshot } = await import(
        '../../../src/runtime-preview/watch/runtime-asset-change-watcher'
      );
      const snapshot = await createSnapshot('E:/project/assets');
      expect(snapshot.files.size).toBe(0);
      expect(snapshot.skippedSymlinks).toEqual([]);
      expect(stat).not.toHaveBeenCalled();
    } finally {
      vi.doUnmock('node:fs/promises');
      vi.resetModules();
    }
  });

  it('records startup baseline source deletes as dirty targets', async () => {
    const projectRoot = 'E:/project';
    const store = createRuntimeAssetDirtyStore({ projectRoot });
    const watcher = createRuntimeAssetChangeWatcher({
      projectRoot,
      dirtyStore: store,
      startupSnapshot: {
        files: new Map([
          ['scripts/gone.ts', { mtimeMs: 1, size: 10 }],
          ['scripts/gone.ts.meta', { mtimeMs: 1, size: 10 }],
        ]),
      },
      snapshotFiles: async () => ({
        files: new Map(),
      }),
      subscribe: async () => ({ unsubscribe: vi.fn() }),
    });

    await watcher.start();

    expect(store.drainDirtyTargets().entries).toEqual([{
      target: 'db://assets/scripts/gone.ts',
      eventTypes: ['delete'],
      assetEventCount: 1,
      metaEventCount: 0,
    }]);
    expect(watcher.getStatus().startupDirtyTargetCount).toBe(1);
  });

  it('ignores startup baseline system files with the live watcher ignore contract', async () => {
    const projectRoot = 'E:/project';
    const store = createRuntimeAssetDirtyStore({ projectRoot });
    const watcher = createRuntimeAssetChangeWatcher({
      projectRoot,
      dirtyStore: store,
      startupSnapshot: {
        files: new Map([
          ['.DS_Store', { mtimeMs: 1, size: 10 }],
          ['textures/Thumbs.db', { mtimeMs: 1, size: 10 }],
        ]),
      },
      snapshotFiles: async () => ({
        files: new Map([
          ['.DS_Store', { mtimeMs: 2, size: 11 }],
          ['textures/Thumbs.db', { mtimeMs: 2, size: 11 }],
        ]),
      }),
      subscribe: async () => ({ unsubscribe: vi.fn() }),
    });

    await watcher.start();

    expect(store.peekDirtyTargets()).toEqual([]);
    expect(watcher.getStatus()).toMatchObject({
      startupDirtyTargetCount: 0,
      startupIgnoredMetaOnlyCount: 0,
    });
  });
});
