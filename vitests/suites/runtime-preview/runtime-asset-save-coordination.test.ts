import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { IAssetSavedEvent } from '../../../src/core/assets/@types/public';
import { createRuntimeAssetSaveCoordinator } from '../../../src/runtime-preview/refresh/runtime-asset-save-coordinator';
import { createRuntimeRefreshCoordinator } from '../../../src/runtime-preview/refresh/runtime-refresh-coordinator';
import { createRuntimeAssetDirtyStore } from '../../../src/runtime-preview/watch/runtime-asset-dirty-store';

class TestAssetSaveSource {
  private readonly listeners = new Set<(event: IAssetSavedEvent) => void | Promise<void>>();

  onAssetSaved(listener: (event: IAssetSavedEvent) => void | Promise<void>): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async save(event: IAssetSavedEvent, success = true): Promise<void> {
    if (!success) {
      throw new Error('save failed');
    }
    await Promise.all(Array.from(this.listeners, (listener) => listener(event)));
  }
}

function createSavedEvent(generation: number): IAssetSavedEvent {
  return {
    generation,
    asset: {
      name: 'scene.scene',
      source: 'db://assets/scene.scene',
      loadUrl: 'db://assets/scene',
      url: 'db://assets/scene.scene',
      file: 'E:/project/assets/scene.scene',
      uuid: 'scene-uuid',
      importer: 'scene',
      imported: true,
      invalid: false,
      type: 'cc.SceneAsset',
      isDirectory: false,
      library: { '.json': 'E:/project/library/scene.json' },
    },
    sourceFileGeneration: { mtimeMs: 100, size: 20 },
    metaFileGeneration: { mtimeMs: 101, size: 10 },
  };
}

describe('runtime AssetDB save coordination', () => {
  it('uses the imported generation once, preserves external watcher refresh, and unsubscribes on close', async () => {
    const projectRoot = 'E:/project';
    const dirtyStore = createRuntimeAssetDirtyStore({ projectRoot });
    const refreshTarget = vi.fn(async () => 1);
    const invalidateSettings = vi.fn();
    const clearImportReplacement = vi.fn();
    const refreshCoordinator = createRuntimeRefreshCoordinator({
      projectRoot,
      refreshTarget,
      waitForIdle: vi.fn(async () => undefined),
      invalidateSettings,
      clearImportReplacement,
      dirtyProvider: {
        drainDirtyTargets: () => dirtyStore.drainDirtyTargets(),
        requeueTargets: (targets) => dirtyStore.requeueTargets(targets),
        getStatus: () => ({
          enabled: true,
          running: true,
          eventCount: dirtyStore.getEventCount(),
          dirtyTargetCount: dirtyStore.getDirtyTargetCount(),
          sampleTargets: dirtyStore.peekDirtyTargets(),
        }),
      },
    });
    const source = new TestAssetSaveSource();
    const handle = createRuntimeAssetSaveCoordinator({
      source,
      refreshCoordinator,
      dirtyStore,
    });
    const savedEvent = createSavedEvent(1);

    await source.save(savedEvent);
    await source.save(savedEvent);

    expect(refreshTarget).not.toHaveBeenCalled();
    expect(invalidateSettings).toHaveBeenCalledTimes(1);
    expect(clearImportReplacement).toHaveBeenCalledTimes(1);

    dirtyStore.recordFileEvent({
      type: 'update',
      path: join(projectRoot, 'assets', 'scene.scene'),
      fileGeneration: savedEvent.sourceFileGeneration,
    });
    const duplicateWatcherRefresh = await refreshCoordinator.refresh({ reason: 'endpoint' });
    expect(duplicateWatcherRefresh.targets).toEqual([]);
    expect(refreshTarget).not.toHaveBeenCalled();

    dirtyStore.recordFileEvent({
      type: 'update',
      path: join(projectRoot, 'assets', 'scene.scene'),
      fileGeneration: { mtimeMs: 200, size: 21 },
    });
    const externalRefresh = await refreshCoordinator.refresh({ reason: 'endpoint' });
    expect(externalRefresh.ok).toBe(true);
    expect(refreshTarget).toHaveBeenCalledTimes(1);
    expect(refreshTarget).toHaveBeenCalledWith('db://assets/scene.scene');

    await expect(source.save(createSavedEvent(2), false)).rejects.toThrow('save failed');
    expect(invalidateSettings).toHaveBeenCalledTimes(2);

    await handle.close();
    await handle.close();
    await source.save(createSavedEvent(3));
    expect(invalidateSettings).toHaveBeenCalledTimes(2);
  });
});
