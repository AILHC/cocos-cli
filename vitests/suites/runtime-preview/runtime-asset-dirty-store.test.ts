import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createRuntimeAssetDirtyStore } from '@runtime-preview/watch/runtime-asset-dirty-store';
import { createRuntimeAssetChangeWatcher } from '@runtime-preview/watch/runtime-asset-change-watcher';

describe('runtime asset dirty store', () => {
  const projectRoot = 'E:/project';
  const assetsRoot = join(projectRoot, 'assets');

  it('maps asset files under assets root to db urls', () => {
    const store = createRuntimeAssetDirtyStore({ projectRoot });
    store.recordFileEvent({ type: 'update', path: join(assetsRoot, 'resources', 'data.json') });
    expect(store.drainDirtyTargets().targets).toEqual(['db://assets/resources/data.json']);
  });

  it('maps .meta events to the source asset target', () => {
    const store = createRuntimeAssetDirtyStore({ projectRoot });
    store.recordFileEvent({ type: 'update', path: join(assetsRoot, 'resources', 'data.json.meta') });
    store.recordFileEvent({ type: 'update', path: join(assetsRoot, 'resources', 'data.json') });
    expect(store.drainDirtyTargets().targets).toEqual(['db://assets/resources/data.json']);
  });

  it('keeps deleted source paths as file targets so AssetDB can remove stale records', () => {
    const store = createRuntimeAssetDirtyStore({ projectRoot });
    store.recordFileEvent({ type: 'delete', path: join(assetsRoot, 'resources', 'gone.prefab') });
    expect(store.drainDirtyTargets().targets).toEqual(['db://assets/resources/gone.prefab']);
  });

  it('maps deleted .meta paths to the source asset target', () => {
    const store = createRuntimeAssetDirtyStore({ projectRoot });
    store.recordFileEvent({ type: 'delete', path: join(assetsRoot, 'resources', 'gone.prefab.meta') });
    expect(store.drainDirtyTargets().entries).toEqual([
      {
        target: 'db://assets/resources/gone.prefab',
        eventTypes: ['delete'],
        assetEventCount: 0,
        metaEventCount: 1,
      },
    ]);
  });

  it('represents rename as old delete plus new create targets', () => {
    const store = createRuntimeAssetDirtyStore({ projectRoot });
    store.recordFileEvent({ type: 'delete', path: join(assetsRoot, 'old-name.json') });
    store.recordFileEvent({ type: 'create', path: join(assetsRoot, 'new-name.json') });
    expect(store.drainDirtyTargets().entries).toEqual([
      {
        target: 'db://assets/new-name.json',
        eventTypes: ['create'],
        assetEventCount: 1,
        metaEventCount: 0,
      },
      {
        target: 'db://assets/old-name.json',
        eventTypes: ['delete'],
        assetEventCount: 1,
        metaEventCount: 0,
      },
    ]);
  });

  it('dedupes create-delete races and keeps event type history', () => {
    const store = createRuntimeAssetDirtyStore({ projectRoot });
    store.recordFileEvent({ type: 'create', path: join(assetsRoot, 'temp.json') });
    store.recordFileEvent({ type: 'delete', path: join(assetsRoot, 'temp.json') });
    expect(store.drainDirtyTargets().entries).toEqual([
      {
        target: 'db://assets/temp.json',
        eventTypes: ['create', 'delete'],
        assetEventCount: 2,
        metaEventCount: 0,
      },
    ]);
  });

  it('tracks source and meta event counts per target', () => {
    const store = createRuntimeAssetDirtyStore({ projectRoot });
    store.recordFileEvent({ type: 'update', path: join(assetsRoot, 'resources', 'data.json') });
    store.recordFileEvent({ type: 'update', path: join(assetsRoot, 'resources', 'data.json.meta') });
    expect(store.drainDirtyTargets().entries).toEqual([
      {
        target: 'db://assets/resources/data.json',
        eventTypes: ['update'],
        assetEventCount: 1,
        metaEventCount: 1,
      },
    ]);
  });

  it('ignores paths outside project assets', () => {
    const store = createRuntimeAssetDirtyStore({ projectRoot });
    store.recordFileEvent({ type: 'update', path: join(projectRoot, 'library', 'x.json') });
    expect(store.drainDirtyTargets().targets).toEqual([]);
  });

  it('drains atomically and can requeue failed targets', () => {
    const store = createRuntimeAssetDirtyStore({ projectRoot });
    store.recordFileEvent({ type: 'update', path: join(assetsRoot, 'a.json') });
    const batch = store.drainDirtyTargets();
    expect(batch.targets).toEqual(['db://assets/a.json']);
    expect(store.drainDirtyTargets().targets).toEqual([]);
    store.requeueTargets(batch.targets);
    expect(store.drainDirtyTargets().targets).toEqual(['db://assets/a.json']);
  });

  it('returns stable dirty target samples without draining', () => {
    const store = createRuntimeAssetDirtyStore({ projectRoot });
    store.recordFileEvent({ type: 'update', path: join(assetsRoot, 'b.json') });
    store.recordFileEvent({ type: 'update', path: join(assetsRoot, 'a.json') });
    expect(store.peekDirtyTargets(1)).toEqual(['db://assets/a.json']);
    expect(store.drainDirtyTargets().targets).toEqual(['db://assets/a.json', 'db://assets/b.json']);
  });

  it('records synthetic dirty targets through the same drain ordering contract', () => {
    const store = createRuntimeAssetDirtyStore({ projectRoot });
    store.recordDirtyTarget({
      target: 'db://assets/scripts/damage_system.ts',
      eventType: 'update',
      assetEventCount: 1,
    });
    store.recordFileEvent({ type: 'update', path: join(assetsRoot, 'a.json') });

    expect(store.peekDirtyTargets(5)).toEqual([
      'db://assets/a.json',
      'db://assets/scripts/damage_system.ts',
    ]);
    expect(store.drainDirtyTargets().entries).toEqual([
      {
        target: 'db://assets/a.json',
        eventTypes: ['update'],
        assetEventCount: 1,
        metaEventCount: 0,
      },
      {
        target: 'db://assets/scripts/damage_system.ts',
        eventTypes: ['update'],
        assetEventCount: 1,
        metaEventCount: 0,
      },
    ]);
  });

  it('keeps delete event type when source and meta are deleted together', () => {
    const store = createRuntimeAssetDirtyStore({ projectRoot });
    store.recordFileEvent({ type: 'delete', path: join(assetsRoot, 'resources', 'gone.ts') });
    store.recordFileEvent({ type: 'delete', path: join(assetsRoot, 'resources', 'gone.ts.meta') });
    expect(store.drainDirtyTargets().entries).toEqual([
      {
        target: 'db://assets/resources/gone.ts',
        eventTypes: ['delete'],
        assetEventCount: 1,
        metaEventCount: 1,
      },
    ]);
  });

  it('records startup baseline source diffs as dirty targets and counts meta diffs separately', async () => {
    const store = createRuntimeAssetDirtyStore({ projectRoot });
    const unsubscribe = vi.fn();
    const watcher = createRuntimeAssetChangeWatcher({
      projectRoot,
      dirtyStore: store,
      startupSnapshot: {
        files: new Map([
          ['scripts/damage_system.ts', { mtimeMs: 1, size: 100 }],
          ['scripts/damage_system.ts.meta', { mtimeMs: 1, size: 10 }],
        ]),
      },
      snapshotFiles: async () => ({
        files: new Map([
          ['scripts/damage_system.ts', { mtimeMs: 2, size: 101 }],
          ['scripts/damage_system.ts.meta', { mtimeMs: 2, size: 11 }],
        ]),
      }),
      subscribe: async () => ({ unsubscribe }),
    });

    await watcher.start();

    expect(store.peekDirtyTargets()).toEqual(['db://assets/scripts/damage_system.ts']);
    expect(watcher.getStatus()).toMatchObject({
      startupDirtyTargetCount: 1,
      startupIgnoredMetaOnlyCount: 1,
      startupSampleTargets: ['db://assets/scripts/damage_system.ts'],
      startupIgnoredMetaOnlySample: ['scripts/damage_system.ts.meta'],
    });
  });

  it('does not record startup baseline meta-only changes as dirty targets', async () => {
    const store = createRuntimeAssetDirtyStore({ projectRoot });
    const watcher = createRuntimeAssetChangeWatcher({
      projectRoot,
      dirtyStore: store,
      startupSnapshot: {
        files: new Map([
          ['scripts/damage_system.ts', { mtimeMs: 1, size: 100 }],
          ['scripts/damage_system.ts.meta', { mtimeMs: 1, size: 10 }],
        ]),
      },
      snapshotFiles: async () => ({
        files: new Map([
          ['scripts/damage_system.ts', { mtimeMs: 1, size: 100 }],
          ['scripts/damage_system.ts.meta', { mtimeMs: 2, size: 11 }],
        ]),
      }),
      subscribe: async () => ({ unsubscribe: vi.fn() }),
    });

    await watcher.start();

    expect(store.peekDirtyTargets()).toEqual([]);
    expect(watcher.getStatus()).toMatchObject({
      startupDirtyTargetCount: 0,
      startupIgnoredMetaOnlyCount: 1,
      startupSampleTargets: [],
      startupIgnoredMetaOnlySample: ['scripts/damage_system.ts.meta'],
    });
  });
});
