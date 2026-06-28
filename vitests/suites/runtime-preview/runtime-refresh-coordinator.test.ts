import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createRuntimeRefreshCoordinator } from '@runtime-preview/refresh/runtime-refresh-coordinator';

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function createCoordinatorFixture() {
  let now = 1_000;
  const calls: string[] = [];
  const writes: string[] = [];
  const projectRoot = join('C:', 'project').replace(/\\/g, '/');
  const refreshTarget = vi.fn(async (target: string) => {
    calls.push(`refresh:${target}`);
    return 2;
  });
  const waitForIdle = vi.fn(async () => {
    calls.push('idle');
  });
  const invalidateSettings = vi.fn(() => {
    calls.push('settings');
  });
  const clearImportReplacement = vi.fn(() => {
    calls.push('import-replacement');
  });
  const logger = {
    write: vi.fn(async (line: string) => {
      writes.push(line);
    }),
  };
  const coordinator = createRuntimeRefreshCoordinator({
    projectRoot,
    refreshTarget,
    waitForIdle,
    invalidateSettings,
    clearImportReplacement,
    logger,
    now: () => now,
    reloadDedupeMs: 500,
  });

  return {
    coordinator,
    projectRoot,
    refreshTarget,
    waitForIdle,
    invalidateSettings,
    clearImportReplacement,
    calls,
    writes,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('runtime refresh coordinator', () => {
  it('refreshes db://assets when target is omitted', async () => {
    const { coordinator, refreshTarget } = createCoordinatorFixture();

    const result = await coordinator.refresh({ reason: 'endpoint' });

    expect(result).toMatchObject({
      ok: true,
      target: 'db://assets',
      reason: 'endpoint',
      changedAssetCount: 2,
      scriptCompile: { status: 'done' },
    });
    expect(refreshTarget).toHaveBeenCalledWith('db://assets');
  });

  it('converts absolute project assets paths to db://assets URLs', async () => {
    const { coordinator, projectRoot, refreshTarget } = createCoordinatorFixture();
    const target = join(projectRoot, 'assets', 'resources', 'config.json');

    const result = await coordinator.refresh({ reason: 'endpoint', target });

    expect(result.ok).toBe(true);
    expect(result.target).toBe('db://assets/resources/config.json');
    expect(refreshTarget).toHaveBeenCalledWith('db://assets/resources/config.json');
  });

  it('rejects paths outside project assets without refreshing', async () => {
    const { coordinator, refreshTarget, waitForIdle, invalidateSettings, clearImportReplacement } = createCoordinatorFixture();

    const result = await coordinator.refresh({ reason: 'endpoint', target: join('C:', 'outside', 'config.json') });

    expect(result.ok).toBe(false);
    expect(result.target).toBe('db://assets');
    expect(result.error).toContain('outside project assets root');
    expect(refreshTarget).not.toHaveBeenCalled();
    expect(waitForIdle).not.toHaveBeenCalled();
    expect(invalidateSettings).not.toHaveBeenCalled();
    expect(clearImportReplacement).not.toHaveBeenCalled();
  });

  it('rejects null and non-string targets without refreshing', async () => {
    const { coordinator, refreshTarget, waitForIdle } = createCoordinatorFixture();

    const nullResult = await coordinator.refresh({ reason: 'endpoint', target: null });
    const numberResult = await coordinator.refresh({ reason: 'endpoint', target: 123 });

    expect(nullResult).toMatchObject({
      ok: false,
      target: 'db://assets',
      reason: 'endpoint',
    });
    expect(nullResult.error).toContain('must be a string');
    expect(numberResult).toMatchObject({
      ok: false,
      target: 'db://assets',
      reason: 'endpoint',
    });
    expect(numberResult.error).toContain('must be a string');
    expect(refreshTarget).not.toHaveBeenCalled();
    expect(waitForIdle).not.toHaveBeenCalled();
  });

  it('rejects db URL dot segment traversal without refreshing', async () => {
    const { coordinator, refreshTarget, waitForIdle } = createCoordinatorFixture();

    for (const target of ['db://assets/../x', 'db://assets/foo/../../x']) {
      const result = await coordinator.refresh({ reason: 'endpoint', target });

      expect(result).toMatchObject({
        ok: false,
        target: 'db://assets',
        reason: 'endpoint',
      });
      expect(result.error).toContain('dot segment');
    }
    expect(refreshTarget).not.toHaveBeenCalled();
    expect(waitForIdle).not.toHaveBeenCalled();
  });

  it('dedupes reload refresh shortly after endpoint success', async () => {
    const { coordinator, refreshTarget, waitForIdle, advance } = createCoordinatorFixture();

    const endpoint = await coordinator.refresh({ reason: 'endpoint' });
    advance(100);
    const reload = await coordinator.refresh({ reason: 'reload' });

    expect(endpoint.ok).toBe(true);
    expect(reload).toMatchObject({
      ok: true,
      target: 'db://assets',
      reason: 'reload',
      changedAssetCount: null,
      scriptCompile: { status: 'skipped' },
    });
    expect(refreshTarget).toHaveBeenCalledTimes(1);
    expect(waitForIdle).toHaveBeenCalledTimes(1);
  });

  it('dedupes in-flight refresh work while preserving each caller reason', async () => {
    const deferredRefresh = createDeferred<number>();
    const { coordinator, refreshTarget } = createCoordinatorFixture();
    refreshTarget.mockReturnValueOnce(deferredRefresh.promise);

    const endpointPromise = coordinator.refresh({ reason: 'endpoint' });
    const reloadPromise = coordinator.refresh({ reason: 'reload' });
    deferredRefresh.resolve(4);

    const [endpoint, reload] = await Promise.all([endpointPromise, reloadPromise]);

    expect(refreshTarget).toHaveBeenCalledTimes(1);
    expect(endpoint).toMatchObject({
      ok: true,
      reason: 'endpoint',
      changedAssetCount: 4,
    });
    expect(reload).toMatchObject({
      ok: true,
      reason: 'reload',
      changedAssetCount: 4,
    });
  });

  it('returns ok false when refresh operation fails without throwing', async () => {
    const { coordinator, refreshTarget, waitForIdle } = createCoordinatorFixture();
    refreshTarget.mockRejectedValueOnce(new Error('refresh failed'));

    const result = await coordinator.refresh({ reason: 'endpoint' });

    expect(result).toMatchObject({
      ok: false,
      target: 'db://assets',
      reason: 'endpoint',
      changedAssetCount: null,
      scriptCompile: { status: 'skipped' },
      error: 'refresh failed',
    });
    expect(waitForIdle).not.toHaveBeenCalled();
  });

  it('marks scriptCompile failed when waitForIdle fails', async () => {
    const { coordinator, waitForIdle, invalidateSettings, clearImportReplacement } = createCoordinatorFixture();
    waitForIdle.mockRejectedValueOnce(new Error('compile failed'));

    const result = await coordinator.refresh({ reason: 'endpoint' });

    expect(result).toMatchObject({
      ok: false,
      changedAssetCount: 2,
      scriptCompile: {
        status: 'failed',
        error: 'compile failed',
      },
      error: 'compile failed',
    });
    expect(invalidateSettings).not.toHaveBeenCalled();
    expect(clearImportReplacement).not.toHaveBeenCalled();
  });

  it('returns ok false when settings invalidation fails after script compile is done', async () => {
    const { coordinator, invalidateSettings, clearImportReplacement } = createCoordinatorFixture();
    invalidateSettings.mockImplementationOnce(() => {
      throw new Error('invalidate failed');
    });

    const result = await coordinator.refresh({ reason: 'endpoint' });

    expect(result).toMatchObject({
      ok: false,
      target: 'db://assets',
      changedAssetCount: 2,
      scriptCompile: { status: 'done' },
      error: 'invalidate failed',
    });
    expect(clearImportReplacement).not.toHaveBeenCalled();
  });

  it('returns ok false when import replacement clearing fails after script compile is done', async () => {
    const { coordinator, invalidateSettings, clearImportReplacement } = createCoordinatorFixture();
    clearImportReplacement.mockImplementationOnce(() => {
      throw new Error('clear failed');
    });

    const result = await coordinator.refresh({ reason: 'endpoint' });

    expect(result).toMatchObject({
      ok: false,
      target: 'db://assets',
      changedAssetCount: 2,
      scriptCompile: { status: 'done' },
      error: 'clear failed',
    });
    expect(invalidateSettings).toHaveBeenCalledTimes(1);
  });

  it('refreshes dirty targets instead of root when a dirty provider is available', async () => {
    const refreshTarget = vi.fn(async () => 1);
    let dirtyTargetCount = 2;
    let drained = false;
    const dirtyProvider = {
      drainDirtyTargets: vi.fn(() => {
        if (drained) {
          return { targets: [], entries: [], eventCount: 0, drainedAt: 1001 };
        }
        drained = true;
        dirtyTargetCount = 0;
        return {
          targets: ['db://assets/a.json', 'db://assets/b.json'],
          entries: [
            { target: 'db://assets/a.json', eventTypes: ['update'] },
            { target: 'db://assets/b.json', eventTypes: ['update'] },
          ],
          eventCount: 3,
          drainedAt: 1000,
        };
      }),
      requeueTargets: vi.fn(),
      getStatus: vi.fn(() => ({
        enabled: true,
        running: true,
        assetsRoot: 'E:/project/assets',
        eventCount: 3,
        dirtyTargetCount,
        sampleTargets: dirtyTargetCount > 0 ? ['db://assets/a.json'] : [],
      })),
    };
    const coordinator = createRuntimeRefreshCoordinator({
      projectRoot: 'E:/project',
      refreshTarget,
      waitForIdle: vi.fn(async () => undefined),
      invalidateSettings: vi.fn(),
      clearImportReplacement: vi.fn(),
      dirtyProvider,
    });

    const result = await coordinator.refresh({ reason: 'endpoint' });

    expect(result.ok).toBe(true);
    expect(result.target).toBe('dirty-set');
    expect(result.targets).toEqual(['db://assets/a.json', 'db://assets/b.json']);
    expect(refreshTarget).toHaveBeenCalledTimes(2);
    expect(refreshTarget).not.toHaveBeenCalledWith('db://assets');
  });

  it('skips refresh when watcher is running and dirty-set is empty', async () => {
    const refreshTarget = vi.fn(async () => 1);
    const coordinator = createRuntimeRefreshCoordinator({
      projectRoot: 'E:/project',
      refreshTarget,
      waitForIdle: vi.fn(async () => undefined),
      invalidateSettings: vi.fn(),
      clearImportReplacement: vi.fn(),
      dirtyProvider: {
        drainDirtyTargets: () => ({ targets: [], entries: [], eventCount: 0, drainedAt: 1000 }),
        requeueTargets: vi.fn(),
        getStatus: () => ({
          enabled: true,
          running: true,
          assetsRoot: 'E:/project/assets',
          eventCount: 0,
          dirtyTargetCount: 0,
          sampleTargets: [],
        }),
      },
    });

    const result = await coordinator.refresh({ reason: 'reload' });

    expect(result.ok).toBe(true);
    expect(result.scriptCompile.status).toBe('skipped');
    expect(result.target).toBe('dirty-set');
    expect(result.targets).toEqual([]);
    expect(refreshTarget).not.toHaveBeenCalled();
  });

  it('requeues dirty targets that fail to refresh', async () => {
    const requeueTargets = vi.fn();
    const coordinator = createRuntimeRefreshCoordinator({
      projectRoot: 'E:/project',
      refreshTarget: vi.fn(async (target: string) => {
        if (target.endsWith('bad.json')) {
          throw new Error('refresh failed');
        }
        return 1;
      }),
      waitForIdle: vi.fn(async () => undefined),
      invalidateSettings: vi.fn(),
      clearImportReplacement: vi.fn(),
      dirtyProvider: {
        drainDirtyTargets: () => ({
          targets: ['db://assets/good.json', 'db://assets/bad.json'],
          entries: [
            { target: 'db://assets/good.json', eventTypes: ['update'] },
            { target: 'db://assets/bad.json', eventTypes: ['update'] },
          ],
          eventCount: 2,
          drainedAt: 1000,
        }),
        requeueTargets,
        getStatus: () => ({
          enabled: true,
          running: true,
          assetsRoot: 'E:/project/assets',
          eventCount: 2,
          dirtyTargetCount: 2,
          sampleTargets: ['db://assets/good.json', 'db://assets/bad.json'],
        }),
      },
    });

    const result = await coordinator.refresh({ reason: 'endpoint' });

    expect(result.ok).toBe(false);
    expect(result.failedTargets).toEqual([{ target: 'db://assets/bad.json', error: 'refresh failed' }]);
    expect(requeueTargets).toHaveBeenCalledWith(['db://assets/bad.json']);
  });

  it('settles missing dirty targets without requeueing poison entries', async () => {
    const requeueTargets = vi.fn();
    const waitForIdle = vi.fn(async () => undefined);
    const invalidateSettings = vi.fn();
    const clearImportReplacement = vi.fn();
    let dirtyTargetCount = 1;
    let drained = false;
    const coordinator = createRuntimeRefreshCoordinator({
      projectRoot: 'E:/project',
      refreshTarget: vi.fn(async () => {
        throw new Error('can not find asset db://assets/temp.json');
      }),
      waitForIdle,
      invalidateSettings,
      clearImportReplacement,
      dirtyProvider: {
        drainDirtyTargets: () => {
          if (drained) {
            return { targets: [], entries: [], eventCount: 0, drainedAt: 1001 };
          }
          drained = true;
          dirtyTargetCount = 0;
          return {
            targets: ['db://assets/temp.json'],
            entries: [{ target: 'db://assets/temp.json', eventTypes: ['create', 'delete'] }],
            eventCount: 2,
            drainedAt: 1000,
          };
        },
        requeueTargets,
        getStatus: () => ({
          enabled: true,
          running: true,
          assetsRoot: 'E:/project/assets',
          eventCount: 2,
          dirtyTargetCount,
          sampleTargets: dirtyTargetCount > 0 ? ['db://assets/temp.json'] : [],
        }),
      },
    });

    const result = await coordinator.refresh({ reason: 'reload' });

    expect(result.ok).toBe(true);
    expect(result.scriptCompile.status).toBe('skipped');
    expect(result.settledTargets).toEqual([{
      target: 'db://assets/temp.json',
      error: 'can not find asset db://assets/temp.json',
    }]);
    expect(requeueTargets).not.toHaveBeenCalled();
    expect(waitForIdle).not.toHaveBeenCalled();
    expect(invalidateSettings).not.toHaveBeenCalled();
    expect(clearImportReplacement).not.toHaveBeenCalled();
  });

  it('returns watcher failure for no-target refresh when watcher is enabled but not running', async () => {
    const refreshTarget = vi.fn(async () => 1);
    const coordinator = createRuntimeRefreshCoordinator({
      projectRoot: 'E:/project',
      refreshTarget,
      waitForIdle: vi.fn(async () => undefined),
      invalidateSettings: vi.fn(),
      clearImportReplacement: vi.fn(),
      dirtyProvider: {
        drainDirtyTargets: vi.fn(),
        requeueTargets: vi.fn(),
        getStatus: () => ({
          enabled: true,
          running: false,
          assetsRoot: 'E:/project/assets',
          error: 'native watcher unavailable',
          eventCount: 0,
          dirtyTargetCount: 0,
          sampleTargets: [],
        }),
      },
    });

    const result = await coordinator.refresh({ reason: 'endpoint' });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('native watcher unavailable');
    expect(refreshTarget).not.toHaveBeenCalled();
  });

  it('dedupes concurrent dirty-set refresh requests with one shared multi-pass run', async () => {
    const deferredRefresh = createDeferred<number>();
    const refreshTarget = vi.fn(async () => deferredRefresh.promise);
    const batches = [
      {
        targets: ['db://assets/a.json'],
        entries: [{ target: 'db://assets/a.json', eventTypes: ['update'] }],
        eventCount: 1,
        drainedAt: 1000,
      },
      { targets: [], entries: [], eventCount: 0, drainedAt: 1001 },
    ];
    const drainDirtyTargets = vi.fn(() => batches.shift()!);
    const coordinator = createRuntimeRefreshCoordinator({
      projectRoot: 'E:/project',
      refreshTarget,
      waitForIdle: vi.fn(async () => undefined),
      invalidateSettings: vi.fn(),
      clearImportReplacement: vi.fn(),
      dirtyProvider: {
        drainDirtyTargets,
        requeueTargets: vi.fn(),
        getStatus: () => ({
          enabled: true,
          running: true,
          assetsRoot: 'E:/project/assets',
          eventCount: 1,
          dirtyTargetCount: batches[0]?.targets.length ?? 0,
          sampleTargets: batches[0]?.targets.slice(0, 5) ?? [],
        }),
      },
    });

    const first = coordinator.refresh({ reason: 'reload' });
    const second = coordinator.refresh({ reason: 'endpoint' });
    deferredRefresh.resolve(1);
    await Promise.all([first, second]);

    expect(drainDirtyTargets).toHaveBeenCalledTimes(2);
    expect(refreshTarget).toHaveBeenCalledTimes(1);
  });

  it('awaits an in-flight dirty-set refresh even when watcher fails during the first run', async () => {
    const deferredRefresh = createDeferred<number>();
    let statusCallCount = 0;
    const refreshTarget = vi.fn(async () => deferredRefresh.promise);
    const batches = [
      {
        targets: ['db://assets/a.json'],
        entries: [{ target: 'db://assets/a.json', eventTypes: ['update'] }],
        eventCount: 1,
        drainedAt: 1000,
      },
      { targets: [], entries: [], eventCount: 0, drainedAt: 1001 },
    ];
    const drainDirtyTargets = vi.fn(() => batches.shift()!);
    const coordinator = createRuntimeRefreshCoordinator({
      projectRoot: 'E:/project',
      refreshTarget,
      waitForIdle: vi.fn(async () => undefined),
      invalidateSettings: vi.fn(),
      clearImportReplacement: vi.fn(),
      dirtyProvider: {
        drainDirtyTargets,
        requeueTargets: vi.fn(),
        getStatus: () => {
          statusCallCount += 1;
          const running = statusCallCount === 1 || batches.length === 0;
          return {
            enabled: true,
            running,
            assetsRoot: 'E:/project/assets',
            ...(running ? {} : { error: 'native watcher failed mid-refresh' }),
            eventCount: 1,
            dirtyTargetCount: batches[0]?.targets.length ?? 0,
            sampleTargets: batches[0]?.targets.slice(0, 5) ?? [],
          };
        },
      },
    });

    const first = coordinator.refresh({ reason: 'reload' });
    await Promise.resolve();
    const second = coordinator.refresh({ reason: 'endpoint' });
    deferredRefresh.resolve(1);
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult).toMatchObject({
      ok: true,
      reason: 'reload',
      target: 'dirty-set',
    });
    expect(secondResult).toMatchObject({
      ok: true,
      reason: 'endpoint',
      target: 'dirty-set',
      targets: ['db://assets/a.json'],
    });
    expect(secondResult.refreshId).not.toBe(firstResult.refreshId);
    expect(refreshTarget).toHaveBeenCalledTimes(1);
    expect(drainDirtyTargets).toHaveBeenCalledTimes(2);
  });

  it('refreshes dirty targets recorded while a pass is running before returning', async () => {
    const batches = [
      {
        targets: ['db://assets/a.json'],
        entries: [{ target: 'db://assets/a.json', eventTypes: ['update'] }],
        eventCount: 1,
        drainedAt: 1000,
      },
      {
        targets: ['db://assets/b.json'],
        entries: [{ target: 'db://assets/b.json', eventTypes: ['update'] }],
        eventCount: 1,
        drainedAt: 1001,
      },
      { targets: [], entries: [], eventCount: 0, drainedAt: 1002 },
    ];
    const drainDirtyTargets = vi.fn(() => batches.shift()!);
    const coordinator = createRuntimeRefreshCoordinator({
      projectRoot: 'E:/project',
      refreshTarget: vi.fn(async () => 1),
      waitForIdle: vi.fn(async () => undefined),
      invalidateSettings: vi.fn(),
      clearImportReplacement: vi.fn(),
      dirtyProvider: {
        drainDirtyTargets,
        requeueTargets: vi.fn(),
        getStatus: () => ({
          enabled: true,
          running: true,
          assetsRoot: 'E:/project/assets',
          eventCount: 1,
          dirtyTargetCount: batches[0]?.targets.length ?? 0,
          sampleTargets: batches[0]?.targets.slice(0, 5) ?? [],
        }),
      },
      maxDirtyRefreshPasses: 3,
    });

    const result = await coordinator.refresh({ reason: 'reload' });

    expect(result.ok).toBe(true);
    expect(result.targets).toEqual(['db://assets/a.json', 'db://assets/b.json']);
    expect(result.passes).toHaveLength(2);
    expect(drainDirtyTargets).toHaveBeenCalledTimes(3);
  });

  it('fails with pending dirty targets when pass limit is reached', async () => {
    const coordinator = createRuntimeRefreshCoordinator({
      projectRoot: 'E:/project',
      refreshTarget: vi.fn(async () => 1),
      waitForIdle: vi.fn(async () => undefined),
      invalidateSettings: vi.fn(),
      clearImportReplacement: vi.fn(),
      dirtyProvider: {
        drainDirtyTargets: vi.fn(() => ({
          targets: ['db://assets/churn.json'],
          entries: [{ target: 'db://assets/churn.json', eventTypes: ['update'] }],
          eventCount: 1,
          drainedAt: Date.now(),
        })),
        requeueTargets: vi.fn(),
        getStatus: () => ({
          enabled: true,
          running: true,
          assetsRoot: 'E:/project/assets',
          eventCount: 1,
          dirtyTargetCount: 1,
          sampleTargets: ['db://assets/churn.json'],
        }),
      },
      maxDirtyRefreshPasses: 2,
    });

    const result = await coordinator.refresh({ reason: 'reload' });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('dirty-set did not become stable');
    expect(result.pendingDirtyTargetCount).toBe(1);
    expect(result.pendingSampleTargets).toEqual(['db://assets/churn.json']);
  });
});
