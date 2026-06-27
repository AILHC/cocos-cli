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
});
