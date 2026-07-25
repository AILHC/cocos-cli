import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  createRuntimeRefreshCoordinator,
  type RuntimeRefreshCoordinatorOptions,
} from '@runtime-preview/refresh/runtime-refresh-coordinator';
import { createRuntimeAssetPathCanonicalizer } from '@runtime-preview/path/runtime-asset-path-canonicalizer';
import type { ScriptCompileDiagnostic } from '../../../src/core/scripting/compile-error-diagnostics';

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function createCoordinatorFixture(
  overrides: Partial<RuntimeRefreshCoordinatorOptions> = {},
) {
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
    ...overrides,
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

function createShortPathCanonicalizer(projectRoot = 'C:/project') {
  const existingPaths = new Set([
    `${projectRoot}/assets`,
    `${projectRoot}/assets/resources`,
    `${projectRoot}/assets/resources/cfg`,
    `${projectRoot}/assets/RESOUR~1`,
    `${projectRoot}/assets/RESOUR~1/cfg`,
  ]);
  const realpathMap = new Map([
    [`${projectRoot}/assets`, `${projectRoot}/assets`],
    [`${projectRoot}/assets/resources`, `${projectRoot}/assets/resources`],
    [`${projectRoot}/assets/resources/cfg`, `${projectRoot}/assets/resources/cfg`],
    [`${projectRoot}/assets/RESOUR~1`, `${projectRoot}/assets/resources`],
    [`${projectRoot}/assets/RESOUR~1/cfg`, `${projectRoot}/assets/resources/cfg`],
  ]);
  return createRuntimeAssetPathCanonicalizer({
    projectRoot,
    fs: {
      existsSync: (path) => existingPaths.has(path.replace(/\\/g, '/')),
      realpathSyncNative: (path) => realpathMap.get(path.replace(/\\/g, '/')) ?? path,
    },
  });
}

function createSingleDirtyProvider(target = 'db://assets/config.json') {
  let drained = false;
  return {
    drainDirtyTargets: vi.fn(() => {
      if (drained) {
        return { targets: [], entries: [], eventCount: 0, drainedAt: Date.now() };
      }
      drained = true;
      return {
        targets: [target],
        entries: [{ target, eventTypes: ['update'] as const }],
        eventCount: 1,
        drainedAt: Date.now(),
      };
    }),
    requeueTargets: vi.fn(),
    getStatus: () => ({
      enabled: true,
      running: true,
      assetsRoot: 'C:/project/assets',
      error: undefined,
      eventCount: 1,
      dirtyTargetCount: drained ? 0 : 1,
      sampleTargets: drained ? [] : [target],
    }),
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

  it('passes the AssetDB integrity gate after a normal dirty-set refresh without root refresh', async () => {
    const verifyAssetDbIntegrity = vi.fn(async () => ({
      ok: true,
      checkedUuidCount: 12,
      invalidUuidCount: 0,
      samples: [],
      sampleLimit: 20,
    }));
    const { coordinator, refreshTarget, invalidateSettings, clearImportReplacement } = createCoordinatorFixture({
      dirtyProvider: createSingleDirtyProvider(),
      verifyAssetDbIntegrity,
    });

    const result = await coordinator.refresh({ reason: 'reload' });

    expect(result.ok).toBe(true);
    expect(result.assetDbIntegrity).toMatchObject({
      status: 'passed',
      initial: {
        phase: 'post-incremental-refresh',
        checkedUuidCount: 12,
        invalidUuidCount: 0,
      },
    });
    expect(refreshTarget).toHaveBeenCalledTimes(1);
    expect(refreshTarget).toHaveBeenCalledWith('db://assets/config.json');
    expect(invalidateSettings).toHaveBeenCalledTimes(1);
    expect(clearImportReplacement).toHaveBeenCalledTimes(1);
  });

  it('runs one db://assets recovery refresh and re-stabilizes when the first integrity check fails', async () => {
    const verifyAssetDbIntegrity = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        checkedUuidCount: 12,
        invalidUuidCount: 1,
        samples: [{
          uuid: 'stale-uuid',
          assetUrl: 'db://assets/stale.prefab',
          database: 'assets',
          missingFields: ['assetInfo'],
        }],
        sampleLimit: 20,
      })
      .mockResolvedValueOnce({
        ok: true,
        checkedUuidCount: 12,
        invalidUuidCount: 0,
        samples: [],
        sampleLimit: 20,
      });
    const { coordinator, refreshTarget, waitForIdle, invalidateSettings } = createCoordinatorFixture({
      dirtyProvider: createSingleDirtyProvider(),
      verifyAssetDbIntegrity,
    });

    const result = await coordinator.refresh({ reason: 'reload' });

    expect(result.ok).toBe(true);
    expect(result.assetDbIntegrity).toMatchObject({
      status: 'recovered',
      initial: {
        phase: 'post-incremental-refresh',
        invalidUuidCount: 1,
        samples: [{ uuid: 'stale-uuid', queryPhase: 'post-incremental-refresh' }],
      },
      recovery: {
        attempted: true,
        action: 'refresh-db-assets',
        target: 'db://assets',
      },
      final: {
        phase: 'post-root-refresh',
        invalidUuidCount: 0,
      },
    });
    expect(refreshTarget.mock.calls.map(([target]) => target)).toEqual([
      'db://assets/config.json',
      'db://assets',
    ]);
    expect(waitForIdle).toHaveBeenCalledTimes(2);
    expect(invalidateSettings).toHaveBeenCalledTimes(1);
  });

  it('stops settings invalidation when integrity still fails after the single root refresh', async () => {
    const invalidCheck = {
      ok: false,
      checkedUuidCount: 12,
      invalidUuidCount: 1,
      samples: [{
        uuid: 'stale-uuid',
        assetUrl: 'db://assets/stale.prefab',
        parentUuid: 'parent-uuid',
        parentUrl: 'db://assets/stale.fbx',
        database: 'assets',
        missingFields: ['assetInfo'],
      }],
      sampleLimit: 20,
    };
    const verifyAssetDbIntegrity = vi.fn()
      .mockResolvedValueOnce(invalidCheck)
      .mockResolvedValueOnce(invalidCheck);
    const { coordinator, refreshTarget, invalidateSettings, clearImportReplacement } = createCoordinatorFixture({
      dirtyProvider: createSingleDirtyProvider(),
      verifyAssetDbIntegrity,
    });

    const result = await coordinator.refresh({ reason: 'reload' });

    expect(result).toMatchObject({
      ok: false,
      failureType: 'asset-db-integrity',
      assetDbIntegrity: {
        status: 'failed',
        recovery: {
          attempted: true,
          target: 'db://assets',
        },
        final: {
          phase: 'post-root-refresh',
          invalidUuidCount: 1,
          samples: [{
            uuid: 'stale-uuid',
            parentUuid: 'parent-uuid',
            queryPhase: 'post-root-refresh',
          }],
        },
      },
    });
    expect(result.error).toContain('stale-uuid');
    expect(refreshTarget).toHaveBeenCalledTimes(2);
    expect(invalidateSettings).not.toHaveBeenCalled();
    expect(clearImportReplacement).not.toHaveBeenCalled();
  });

  it('does not retry when the single AssetDB root recovery refresh fails', async () => {
    const refreshTarget = vi.fn(async (target: string) => {
      if (target === 'db://assets') {
        throw new Error('root refresh failed');
      }
      return 1;
    });
    const verifyAssetDbIntegrity = vi.fn(async () => ({
      ok: false,
      checkedUuidCount: 1,
      invalidUuidCount: 1,
      samples: [{ uuid: 'stale-uuid', missingFields: ['assetInfo'] }],
      sampleLimit: 20,
    }));
    const { coordinator, invalidateSettings } = createCoordinatorFixture({
      dirtyProvider: createSingleDirtyProvider(),
      refreshTarget,
      verifyAssetDbIntegrity,
    });

    const result = await coordinator.refresh({ reason: 'reload' });

    expect(result).toMatchObject({
      ok: false,
      failureType: 'asset-db-integrity',
      assetDbIntegrity: {
        recovery: {
          attempted: true,
          error: 'root refresh failed',
        },
      },
    });
    expect(refreshTarget.mock.calls.map(([target]) => target)).toEqual([
      'db://assets/config.json',
      'db://assets',
    ]);
    expect(verifyAssetDbIntegrity).toHaveBeenCalledTimes(1);
    expect(invalidateSettings).not.toHaveBeenCalled();
  });

  it('canonicalizes absolute short path refresh targets before refreshing AssetDB', async () => {
    const { coordinator, refreshTarget } = createCoordinatorFixture({
      pathCanonicalizer: createShortPathCanonicalizer(),
    });

    const result = await coordinator.refresh({
      reason: 'endpoint',
      target: 'C:/project/assets/RESOUR~1/cfg/a.json',
    });

    expect(result.ok).toBe(true);
    expect(result.target).toBe('db://assets/resources/cfg/a.json');
    expect(refreshTarget).toHaveBeenCalledWith('db://assets/resources/cfg/a.json');
  });

  it('canonicalizes db short path refresh targets before refreshing AssetDB', async () => {
    const { coordinator, refreshTarget } = createCoordinatorFixture({
      pathCanonicalizer: createShortPathCanonicalizer(),
    });

    const result = await coordinator.refresh({
      reason: 'endpoint',
      target: 'db://assets/RESOUR~1/cfg/a.json',
    });

    expect(result.ok).toBe(true);
    expect(result.target).toBe('db://assets/resources/cfg/a.json');
    expect(refreshTarget).toHaveBeenCalledWith('db://assets/resources/cfg/a.json');
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

  it('keeps dot segment rejection when a path canonicalizer is present', async () => {
    const { coordinator, refreshTarget } = createCoordinatorFixture({
      pathCanonicalizer: createShortPathCanonicalizer(),
    });

    for (const target of ['db://assets/../x', 'db://assets/foo/../../x']) {
      const result = await coordinator.refresh({ reason: 'endpoint', target });

      expect(result.ok).toBe(false);
      expect(result.error).toContain('dot segment');
    }
    expect(refreshTarget).not.toHaveBeenCalled();
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
    expect(result.outputState).toBeUndefined();
    expect(result.compileError).toBeUndefined();
    expect(result.scriptCompile.diagnostic).toBeUndefined();
    expect(waitForIdle).not.toHaveBeenCalled();
  });

  it('marks scriptCompile failed when waitForIdle fails', async () => {
    const { coordinator, waitForIdle, invalidateSettings, clearImportReplacement } = createCoordinatorFixture();
    waitForIdle.mockRejectedValueOnce(new Error('compile failed'));

    const result = await coordinator.refresh({ reason: 'endpoint' });

    expect(result).toMatchObject({
      ok: false,
      changedAssetCount: 2,
      outputState: 'lastGoodDueToFailure',
      scriptCompile: {
        status: 'failed',
        error: 'Script compile failed: unknown compile failed',
      },
      error: 'Script compile failed: unknown compile failed',
    });
    expect(result.scriptCompile.diagnostic).toBe(result.compileError);
    expect(invalidateSettings).not.toHaveBeenCalled();
    expect(clearImportReplacement).not.toHaveBeenCalled();
  });

  it('returns ok:false when last compile failure exists even if waitForIdle resolves', async () => {
    const diagnostic: ScriptCompileDiagnostic = {
      phase: 'refresh',
      message: 'Unexpected token',
      name: 'SyntaxError',
      location: {
        filePath: 'C:\\project\\assets\\scripts\\player.ts',
        relativeFilePath: 'assets\\scripts\\player.ts',
        assetUrl: 'db://assets/scripts/player.ts',
        line: 3,
        column: 8,
      },
      refreshId: 'runtime-refresh-1',
      outputState: 'lastGoodDueToFailure',
    };
    const getCompileFailureGeneration = vi.fn(() => 7);
    const getLastCompileFailure = vi.fn(({ sinceGeneration }: { sinceGeneration?: number } = {}) => {
      if (sinceGeneration === 7) {
        return {
          message: diagnostic.message,
          diagnostic,
          createdAt: 1200,
          generation: 8,
        };
      }
      return null;
    });
    const { coordinator, waitForIdle, invalidateSettings, clearImportReplacement } = createCoordinatorFixture({
      getCompileFailureGeneration,
      getLastCompileFailure,
    });

    const result = await coordinator.refresh({
      reason: 'endpoint',
      target: 'db://assets/scripts/player.ts',
    });

    expect(waitForIdle).toHaveBeenCalledWith({ sinceFailureGeneration: 7 });
    expect(getLastCompileFailure).toHaveBeenCalledWith({ sinceGeneration: 7 });
    expect(result).toMatchObject({
      ok: false,
      target: 'db://assets/scripts/player.ts',
      changedAssetCount: 2,
      outputState: 'lastGoodDueToFailure',
      scriptCompile: {
        status: 'failed',
        error: 'Script compile failed: assets\\scripts\\player.ts:3:8 Unexpected token',
      },
      error: 'Script compile failed: assets\\scripts\\player.ts:3:8 Unexpected token',
    });
    expect(result.compileError).toBe(diagnostic);
    expect(result.scriptCompile.diagnostic).toBe(diagnostic);
    expect(invalidateSettings).not.toHaveBeenCalled();
    expect(clearImportReplacement).not.toHaveBeenCalled();
  });

  it('returns structured compile failure when refreshTarget throws syntax error', async () => {
    const error = new SyntaxError('Unexpected token (4:2)') as SyntaxError & {
      filename?: string;
      loc?: { line: number; column: number };
    };
    error.filename = 'C:\\project\\assets\\scripts\\broken.ts';
    error.loc = { line: 4, column: 2 };
    const diagnostic: ScriptCompileDiagnostic = {
      phase: 'refresh',
      message: 'Unexpected token',
      name: 'SyntaxError',
      location: {
        filePath: 'C:\\project\\assets\\scripts\\broken.ts',
        relativeFilePath: 'assets\\scripts\\broken.ts',
        assetUrl: 'db://assets/scripts/broken.ts',
        line: 4,
        column: 2,
      },
      refreshId: 'runtime-refresh-1',
      outputState: 'lastGoodDueToFailure',
    };
    const getLastCompileFailure = vi.fn(({ sinceGeneration }: { sinceGeneration?: number } = {}) => {
      if (sinceGeneration === 0) {
        return {
          message: diagnostic.message,
          diagnostic,
          createdAt: 1200,
          generation: 1,
        };
      }
      return null;
    });
    const { coordinator, refreshTarget, waitForIdle } = createCoordinatorFixture({
      getCompileFailureGeneration: vi.fn(() => 0),
      getLastCompileFailure,
    });
    refreshTarget.mockRejectedValueOnce(error);

    const result = await coordinator.refresh({
      reason: 'endpoint',
      target: 'db://assets/scripts/broken.ts',
    });

    expect(getLastCompileFailure).toHaveBeenCalledWith({ sinceGeneration: 0 });
    expect(result.ok).toBe(false);
    expect(result.outputState).toBe('lastGoodDueToFailure');
    expect(result.scriptCompile.status).toBe('failed');
    expect(result.scriptCompile.error).toBe(result.error);
    expect(result.scriptCompile.diagnostic).toBe(result.compileError);
    expect(result.compileError).toMatchObject({
      phase: 'refresh',
      message: 'Unexpected token',
      name: 'SyntaxError',
      location: {
        relativeFilePath: 'assets\\scripts\\broken.ts',
        assetUrl: 'db://assets/scripts/broken.ts',
        line: 4,
        column: 2,
      },
      refreshId: 'runtime-refresh-1',
      outputState: 'lastGoodDueToFailure',
    });
    expect(result.error).toBe('Script compile failed: assets\\scripts\\broken.ts:4:2 Unexpected token');
    expect(waitForIdle).not.toHaveBeenCalled();
  });

  it('does not let old compile failure generation fail current refresh', async () => {
    const diagnostic: ScriptCompileDiagnostic = {
      phase: 'refresh',
      message: 'old failure',
      location: {
        assetUrl: 'db://assets/scripts/old.ts',
      },
      outputState: 'lastGoodDueToFailure',
    };
    const getLastCompileFailure = vi.fn(({ sinceGeneration }: { sinceGeneration?: number } = {}) => {
      if (sinceGeneration === undefined) {
        return {
          message: diagnostic.message,
          diagnostic,
          createdAt: 900,
          generation: 3,
        };
      }
      return null;
    });
    const { coordinator, invalidateSettings, clearImportReplacement } = createCoordinatorFixture({
      getCompileFailureGeneration: vi.fn(() => 3),
      getLastCompileFailure,
    });

    const result = await coordinator.refresh({ reason: 'endpoint' });

    expect(getLastCompileFailure).toHaveBeenCalledWith({ sinceGeneration: 3 });
    expect(result).toMatchObject({
      ok: true,
      target: 'db://assets',
      scriptCompile: { status: 'done' },
    });
    expect(result.compileError).toBeUndefined();
    expect(invalidateSettings).toHaveBeenCalledTimes(1);
    expect(clearImportReplacement).toHaveBeenCalledTimes(1);
  });

  it('returns structured compile failure when programming output verification fails', async () => {
    const verifyProgrammingOutput = vi.fn(async () => {
      throw new Error('prerequisite scope is missing');
    });
    const { coordinator, invalidateSettings, clearImportReplacement } = createCoordinatorFixture({
      getCompileFailureGeneration: vi.fn(() => 2),
      verifyProgrammingOutput,
    });

    const result = await coordinator.refresh({ reason: 'reload', target: 'db://assets/scripts/main.ts' });

    expect(verifyProgrammingOutput).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      ok: false,
      target: 'db://assets/scripts/main.ts',
      outputState: 'lastGoodDueToFailure',
      scriptCompile: {
        status: 'failed',
        error: 'Script compile failed: unknown prerequisite scope is missing',
      },
      compileError: {
        phase: 'reload-refresh',
        message: 'prerequisite scope is missing',
        location: {
          assetUrl: 'db://assets/scripts/main.ts',
        },
        refreshId: 'runtime-refresh-1',
        outputState: 'lastGoodDueToFailure',
      },
      error: 'Script compile failed: unknown prerequisite scope is missing',
    });
    expect(result.scriptCompile.diagnostic).toBe(result.compileError);
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
    const withDeferredScriptCompile = vi.fn(async <T>(operation: () => Promise<T>) => operation());
    const flushDeferredScriptCompile = vi.fn(async () => undefined);
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
      withDeferredScriptCompile,
      flushDeferredScriptCompile,
      dirtyProvider,
    });

    const result = await coordinator.refresh({ reason: 'endpoint' });

    expect(result.ok).toBe(true);
    expect(result.target).toBe('dirty-set');
    expect(result.targets).toEqual(['db://assets/a.json', 'db://assets/b.json']);
    expect(refreshTarget).toHaveBeenCalledTimes(2);
    expect(refreshTarget).not.toHaveBeenCalledWith('db://assets');
    expect(withDeferredScriptCompile).toHaveBeenCalledTimes(2);
    expect(flushDeferredScriptCompile).toHaveBeenCalledTimes(1);
  });

  it('canonicalizes drained dirty targets again before refreshing AssetDB', async () => {
    const refreshTarget = vi.fn(async () => 1);
    const coordinator = createRuntimeRefreshCoordinator({
      projectRoot: 'C:/project',
      pathCanonicalizer: createShortPathCanonicalizer(),
      refreshTarget,
      waitForIdle: vi.fn(async () => undefined),
      invalidateSettings: vi.fn(),
      clearImportReplacement: vi.fn(),
      dirtyProvider: {
        drainDirtyTargets: vi.fn()
          .mockReturnValueOnce({
            targets: [
              'db://assets/RESOUR~1/cfg/a.json',
              'db://assets/resources/cfg/a.json',
            ],
            entries: [
              { target: 'db://assets/RESOUR~1/cfg/a.json', eventTypes: ['update'], assetEventCount: 1, metaEventCount: 0 },
              { target: 'db://assets/resources/cfg/a.json', eventTypes: ['update'], assetEventCount: 0, metaEventCount: 1 },
            ],
            eventCount: 2,
            drainedAt: 1000,
          })
          .mockReturnValueOnce({ targets: [], entries: [], eventCount: 0, drainedAt: 1001 }),
        requeueTargets: vi.fn(),
        getStatus: () => ({
          enabled: true,
          running: true,
          assetsRoot: 'C:/project/assets',
          eventCount: 0,
          dirtyTargetCount: 0,
          sampleTargets: [],
        }),
      },
    });

    const result = await coordinator.refresh({ reason: 'reload' });

    expect(result.ok).toBe(true);
    expect(result.targets).toEqual(['db://assets/resources/cfg/a.json']);
    expect(result.passes?.[0]?.targets).toEqual(['db://assets/resources/cfg/a.json']);
    expect(refreshTarget).toHaveBeenCalledTimes(1);
    expect(refreshTarget).toHaveBeenCalledWith('db://assets/resources/cfg/a.json');
  });

  it('fails invalid drained dirty targets without refreshing AssetDB', async () => {
    const refreshTarget = vi.fn(async () => 1);
    const requeueTargets = vi.fn();
    const coordinator = createRuntimeRefreshCoordinator({
      projectRoot: 'C:/project',
      pathCanonicalizer: createShortPathCanonicalizer(),
      refreshTarget,
      waitForIdle: vi.fn(async () => undefined),
      invalidateSettings: vi.fn(),
      clearImportReplacement: vi.fn(),
      dirtyProvider: {
        drainDirtyTargets: vi.fn().mockReturnValueOnce({
          targets: ['db://assets/../x'],
          entries: [{ target: 'db://assets/../x', eventTypes: ['update'] }],
          eventCount: 1,
          drainedAt: 1000,
        }),
        requeueTargets,
        getStatus: () => ({
          enabled: true,
          running: true,
          assetsRoot: 'C:/project/assets',
          eventCount: 0,
          dirtyTargetCount: 0,
          sampleTargets: [],
        }),
      },
    });

    const result = await coordinator.refresh({ reason: 'reload' });

    expect(result.ok).toBe(false);
    expect(result.failedTargets).toEqual([{
      target: 'db://assets/../x',
      error: 'Runtime refresh target must not contain dot segments: db://assets/../x',
    }]);
    expect(refreshTarget).not.toHaveBeenCalled();
    expect(requeueTargets).not.toHaveBeenCalled();
  });

  it('skips refresh when watcher is running and dirty-set is empty', async () => {
    const refreshTarget = vi.fn(async () => 1);
    const withDeferredScriptCompile = vi.fn(async <T>(operation: () => Promise<T>) => operation());
    const flushDeferredScriptCompile = vi.fn(async () => undefined);
    const coordinator = createRuntimeRefreshCoordinator({
      projectRoot: 'E:/project',
      refreshTarget,
      waitForIdle: vi.fn(async () => undefined),
      invalidateSettings: vi.fn(),
      clearImportReplacement: vi.fn(),
      withDeferredScriptCompile,
      flushDeferredScriptCompile,
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
    expect(withDeferredScriptCompile).not.toHaveBeenCalled();
    expect(flushDeferredScriptCompile).not.toHaveBeenCalled();
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
    expect(result.error).toBe('Runtime refresh failed for 1 dirty target(s).');
    expect(result.scriptCompile.status).toBe('done');
    expect(result.compileError).toBeUndefined();
    expect(result.failedTargets).toEqual([{ target: 'db://assets/bad.json', error: 'refresh failed' }]);
    expect(requeueTargets).toHaveBeenCalledWith(['db://assets/bad.json']);
  });

  it('refreshes parent directory and waits for scripting after a deleted script target is missing', async () => {
    const refreshTarget = vi.fn(async (target: string) => {
      if (target === 'db://assets/scripts/gone.ts') {
        throw new Error('can not find asset db://assets/scripts/gone.ts');
      }
      if (target === 'db://assets/scripts') {
        return 1;
      }
      throw new Error(`unexpected target ${target}`);
    });
    const waitForIdle = vi.fn(async () => undefined);
    const coordinator = createRuntimeRefreshCoordinator({
      projectRoot: 'E:/project',
      refreshTarget,
      waitForIdle,
      invalidateSettings: vi.fn(),
      clearImportReplacement: vi.fn(),
      verifyProgrammingOutput: vi.fn(async () => undefined),
      dirtyProvider: {
        drainDirtyTargets: vi.fn()
          .mockReturnValueOnce({
            targets: ['db://assets/scripts/gone.ts'],
            entries: [{
              target: 'db://assets/scripts/gone.ts',
              eventTypes: ['delete'],
              assetEventCount: 1,
              metaEventCount: 0,
            }],
            eventCount: 1,
            drainedAt: 1000,
          })
          .mockReturnValueOnce({ targets: [], entries: [], eventCount: 0, drainedAt: 1001 }),
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
    expect(result.targets).toEqual(['db://assets/scripts/gone.ts', 'db://assets/scripts']);
    expect(result.passes?.[0]?.targets).toEqual(['db://assets/scripts/gone.ts']);
    expect(result.passes?.[0]?.parentFallbackTargets).toEqual(['db://assets/scripts']);
    expect(result.settledTargets).toEqual([{
      target: 'db://assets/scripts/gone.ts',
      error: 'can not find asset db://assets/scripts/gone.ts',
    }]);
    expect(refreshTarget).toHaveBeenCalledWith('db://assets/scripts/gone.ts');
    expect(refreshTarget).toHaveBeenCalledWith('db://assets/scripts');
    expect(waitForIdle).toHaveBeenCalledTimes(1);
    expect(result.scriptCompile.status).toBe('done');
  });

  it('dedupes parent refresh for multiple missing deleted script targets in the same directory', async () => {
    const refreshTarget = vi.fn(async (target: string) => {
      if (target === 'db://assets/scripts/a.ts' || target === 'db://assets/scripts/b.ts') {
        throw new Error(`can not find asset ${target}`);
      }
      if (target === 'db://assets/scripts') {
        return 2;
      }
      throw new Error(`unexpected target ${target}`);
    });
    const waitForIdle = vi.fn(async () => undefined);
    const coordinator = createRuntimeRefreshCoordinator({
      projectRoot: 'E:/project',
      refreshTarget,
      waitForIdle,
      invalidateSettings: vi.fn(),
      clearImportReplacement: vi.fn(),
      verifyProgrammingOutput: vi.fn(async () => undefined),
      dirtyProvider: {
        drainDirtyTargets: vi.fn()
          .mockReturnValueOnce({
            targets: ['db://assets/scripts/a.ts', 'db://assets/scripts/b.ts'],
            entries: [
              { target: 'db://assets/scripts/a.ts', eventTypes: ['delete'], assetEventCount: 1, metaEventCount: 0 },
              { target: 'db://assets/scripts/b.ts', eventTypes: ['delete'], assetEventCount: 1, metaEventCount: 0 },
            ],
            eventCount: 2,
            drainedAt: 1000,
          })
          .mockReturnValueOnce({ targets: [], entries: [], eventCount: 0, drainedAt: 1001 }),
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
    expect(refreshTarget.mock.calls.filter(([target]) => target === 'db://assets/scripts')).toHaveLength(1);
    expect(result.passes?.[0]?.parentFallbackTargets).toEqual(['db://assets/scripts']);
    expect(waitForIdle).toHaveBeenCalledTimes(1);
  });

  it('fails dirty refresh when parent refresh for a missing deleted script fails', async () => {
    const requeueTargets = vi.fn();
    const waitForIdle = vi.fn(async () => undefined);
    const refreshTarget = vi.fn(async (target: string) => {
      if (target === 'db://assets/scripts/gone.ts') {
        throw new Error('can not find asset db://assets/scripts/gone.ts');
      }
      if (target === 'db://assets/scripts') {
        throw new Error('parent refresh failed');
      }
      throw new Error(`unexpected target ${target}`);
    });
    const coordinator = createRuntimeRefreshCoordinator({
      projectRoot: 'E:/project',
      refreshTarget,
      waitForIdle,
      invalidateSettings: vi.fn(),
      clearImportReplacement: vi.fn(),
      verifyProgrammingOutput: vi.fn(async () => undefined),
      dirtyProvider: {
        drainDirtyTargets: vi.fn().mockReturnValueOnce({
          targets: ['db://assets/scripts/gone.ts'],
          entries: [{ target: 'db://assets/scripts/gone.ts', eventTypes: ['delete'], assetEventCount: 1, metaEventCount: 0 }],
          eventCount: 1,
          drainedAt: 1000,
        }),
        requeueTargets,
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

    expect(result.ok).toBe(false);
    expect(result.failedTargets).toEqual([{ target: 'db://assets/scripts', error: 'parent refresh failed' }]);
    expect(result.settledTargets).toEqual([{
      target: 'db://assets/scripts/gone.ts',
      error: 'can not find asset db://assets/scripts/gone.ts',
    }]);
    expect(requeueTargets).toHaveBeenCalledWith(['db://assets/scripts']);
    expect(waitForIdle).not.toHaveBeenCalled();
  });

  it('settles missing dirty targets with parent fallback and root fallback', async () => {
    const requeueTargets = vi.fn();
    const waitForIdle = vi.fn(async () => undefined);
    const invalidateSettings = vi.fn();
    const clearImportReplacement = vi.fn();
    let dirtyTargetCount = 1;
    let drained = false;
    const coordinator = createRuntimeRefreshCoordinator({
      projectRoot: 'E:/project',
      refreshTarget: vi.fn(async (target: string) => {
        if (target === 'db://assets/temp.json') {
          throw new Error('can not find asset db://assets/temp.json');
        }
        if (target === 'db://assets') {
          return 1;
        }
        throw new Error(`unexpected target ${target}`);
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
    expect(result.scriptCompile.status).toBe('done');
    expect(result.settledTargets).toEqual([{
      target: 'db://assets/temp.json',
      error: 'can not find asset db://assets/temp.json',
    }]);
    expect(result.failedTargets).toBeUndefined();
    expect(requeueTargets).not.toHaveBeenCalled();
    expect(result.passes?.[0]?.parentFallbackTargets).toEqual(['db://assets']);
    expect(result.passes?.[0]?.rootFallback).toBe(true);
    expect(waitForIdle).toHaveBeenCalledTimes(1);
    expect(invalidateSettings).toHaveBeenCalledTimes(1);
    expect(clearImportReplacement).toHaveBeenCalledTimes(1);
  });

  it('reports compile failure after parent fallback refresh succeeds', async () => {
    const refreshTarget = vi.fn(async (target: string) => {
      if (target === 'db://assets/scripts/gone.ts') {
        throw new Error('can not find asset db://assets/scripts/gone.ts');
      }
      if (target === 'db://assets/scripts') {
        return 1;
      }
      throw new Error(`unexpected target ${target}`);
    });
    const coordinator = createRuntimeRefreshCoordinator({
      projectRoot: 'E:/project',
      refreshTarget,
      waitForIdle: vi.fn(async () => {
        throw new Error('stale prerequisite remains');
      }),
      invalidateSettings: vi.fn(),
      clearImportReplacement: vi.fn(),
      dirtyProvider: {
        drainDirtyTargets: vi.fn()
          .mockReturnValueOnce({
            targets: ['db://assets/scripts/gone.ts'],
            entries: [{ target: 'db://assets/scripts/gone.ts', eventTypes: ['delete'], assetEventCount: 1, metaEventCount: 0 }],
            eventCount: 1,
            drainedAt: 1000,
          })
          .mockReturnValueOnce({ targets: [], entries: [], eventCount: 0, drainedAt: 1001 }),
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

    expect(result.ok).toBe(false);
    expect(result.scriptCompile.status).toBe('failed');
    expect(result.error).toContain('stale prerequisite remains');
    expect(result.passes?.[0]?.parentFallbackTargets).toEqual(['db://assets/scripts']);
  });

  it('limits parent fallback to unique non-root directories for bulk deleted scripts', async () => {
    const scriptTargets = Array.from({ length: 100 }, (_, index) => {
      const dir = index % 3;
      return `db://assets/scripts/group-${dir}/deleted-${index}.ts`;
    });
    const parentTargets = [
      'db://assets/scripts/group-0',
      'db://assets/scripts/group-1',
      'db://assets/scripts/group-2',
    ];
    const refreshTarget = vi.fn(async (target: string) => {
      if (scriptTargets.includes(target)) {
        throw new Error(`can not find asset ${target}`);
      }
      if (parentTargets.includes(target)) {
        return 1;
      }
      throw new Error(`unexpected target ${target}`);
    });
    const waitForIdle = vi.fn(async () => undefined);
    const coordinator = createRuntimeRefreshCoordinator({
      projectRoot: 'E:/project',
      refreshTarget,
      waitForIdle,
      invalidateSettings: vi.fn(),
      clearImportReplacement: vi.fn(),
      verifyProgrammingOutput: vi.fn(async () => undefined),
      dirtyProvider: {
        drainDirtyTargets: vi.fn()
          .mockReturnValueOnce({
            targets: scriptTargets,
            entries: scriptTargets.map((target) => ({
              target,
              eventTypes: ['delete'],
              assetEventCount: 1,
              metaEventCount: 0,
            })),
            eventCount: scriptTargets.length,
            drainedAt: 1000,
          })
          .mockReturnValueOnce({ targets: [], entries: [], eventCount: 0, drainedAt: 1001 }),
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
    expect(result.passes?.[0]?.parentFallbackTargets.sort()).toEqual(parentTargets);
    expect(result.passes?.[0]?.rootFallback).toBe(false);
    expect(refreshTarget).toHaveBeenCalledTimes(103);
    expect(waitForIdle).toHaveBeenCalledTimes(1);
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

  it('skips parent directory targets with child targets unless the parent is a pure delete', async () => {
    const refreshTarget = vi.fn(async () => 1);
    const coordinator = createRuntimeRefreshCoordinator({
      projectRoot: 'E:/project',
      refreshTarget,
      waitForIdle: vi.fn(async () => undefined),
      invalidateSettings: vi.fn(),
      clearImportReplacement: vi.fn(),
      dirtyProvider: {
        drainDirtyTargets: vi.fn()
          .mockReturnValueOnce({
            targets: [
              'db://assets/__probe__',
              'db://assets/__probe__/runtime-watch-refresh.json',
            ],
            entries: [
              {
                target: 'db://assets/__probe__',
                eventTypes: ['create', 'delete'],
                assetEventCount: 2,
                metaEventCount: 0,
              },
              {
                target: 'db://assets/__probe__/runtime-watch-refresh.json',
                eventTypes: ['create'],
                assetEventCount: 1,
                metaEventCount: 0,
              },
            ],
            eventCount: 2,
            drainedAt: 1000,
          })
          .mockReturnValueOnce({ targets: [], entries: [], eventCount: 0, drainedAt: 1001 }),
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
    expect(result.targets).toEqual(['db://assets/__probe__/runtime-watch-refresh.json']);
    expect(result.passes?.[0]?.targets).toEqual(['db://assets/__probe__/runtime-watch-refresh.json']);
    expect(refreshTarget).toHaveBeenCalledTimes(1);
    expect(refreshTarget).toHaveBeenCalledWith('db://assets/__probe__/runtime-watch-refresh.json');
  });

  it('does not immediately re-refresh successful targets for meta-only follow-up events', async () => {
    const refreshTarget = vi.fn(async () => 1);
    const drainDirtyTargets = vi.fn()
      .mockReturnValueOnce({
        targets: ['db://assets/runtime-watch-refresh.json'],
        entries: [{
          target: 'db://assets/runtime-watch-refresh.json',
          eventTypes: ['create'],
          assetEventCount: 1,
          metaEventCount: 0,
        }],
        eventCount: 1,
        drainedAt: 1000,
      })
      .mockReturnValueOnce({
        targets: ['db://assets/runtime-watch-refresh.json'],
        entries: [{
          target: 'db://assets/runtime-watch-refresh.json',
          eventTypes: ['create'],
          assetEventCount: 0,
          metaEventCount: 1,
        }],
        eventCount: 1,
        drainedAt: 1001,
      });
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
          eventCount: 0,
          dirtyTargetCount: 0,
          sampleTargets: [],
        }),
      },
      maxDirtyRefreshPasses: 3,
    });

    const result = await coordinator.refresh({ reason: 'reload' });

    expect(result.ok).toBe(true);
    expect(result.targets).toEqual(['db://assets/runtime-watch-refresh.json']);
    expect(result.passes).toHaveLength(1);
    expect(result.dirtyEventCount).toBe(2);
    expect(refreshTarget).toHaveBeenCalledTimes(1);
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
