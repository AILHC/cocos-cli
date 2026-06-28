import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createRuntimeAssetDirtyStore } from '@runtime-preview/watch/runtime-asset-dirty-store';

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
      { target: 'db://assets/resources/gone.prefab', eventTypes: ['delete'] },
    ]);
  });

  it('represents rename as old delete plus new create targets', () => {
    const store = createRuntimeAssetDirtyStore({ projectRoot });
    store.recordFileEvent({ type: 'delete', path: join(assetsRoot, 'old-name.json') });
    store.recordFileEvent({ type: 'create', path: join(assetsRoot, 'new-name.json') });
    expect(store.drainDirtyTargets().entries).toEqual([
      { target: 'db://assets/new-name.json', eventTypes: ['create'] },
      { target: 'db://assets/old-name.json', eventTypes: ['delete'] },
    ]);
  });

  it('dedupes create-delete races and keeps event type history', () => {
    const store = createRuntimeAssetDirtyStore({ projectRoot });
    store.recordFileEvent({ type: 'create', path: join(assetsRoot, 'temp.json') });
    store.recordFileEvent({ type: 'delete', path: join(assetsRoot, 'temp.json') });
    expect(store.drainDirtyTargets().entries).toEqual([
      { target: 'db://assets/temp.json', eventTypes: ['create', 'delete'] },
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
});
