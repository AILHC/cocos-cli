# P7 Deleted Script Stale Prerequisite Records Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 runtime preview 在运行中批量删除脚本后，stale script 仍残留在 AssetDB sidecar / QuickPack prerequisite records 中并反复触发 `resolve_error_module_not_found` 的问题。

**Architecture:** 先用低层事实测试证明 `@cocos/asset-db.refresh(parentDir)` 能把“外部删除的已登记 asset”推进到 `asset-delete`；只有该事实成立，才在 runtime dirty refresh coordinator 中对 delete-only missing target 做父目录 fallback，并确保这类 refresh 会执行 post-refresh work。保持 dirty-set 增量策略，不默认回退 `db://assets` root refresh，不手工清理 P7 generated cache。

**Tech Stack:** TypeScript、Vitest、Jest、`@parcel/watcher` dirty-set、`@cocos/asset-db`、Cocos scripting / QuickPack / PackerDriver。

---

## 关联事实

- Issue：`docs/dev/runtime-preview/issues.md` 中 `RP-ISSUE-034`
- 事实记录：`docs/dev/runtime-preview/facts/p7-deleted-script-stale-prerequisite-records-20260630.md`
- 临时计划：`docs/dev/runtime-preview/plans/p7-deleted-script-stale-prerequisite-records-temp-plan-20260630.md`
- 测试规范：`docs/dev/testing-spec.md`
- runtime preview 测试规范：`docs/dev/runtime-preview/testing-spec.md`

## 当前源码判断

- `src/runtime-preview/refresh/runtime-refresh-coordinator.ts` 已有 `shouldSettleMissingDirtyTarget()`：delete dirty target 遇到 `can not find asset` 会进入 `settledTargets`。
- 同文件当前只在 `hasSuccessfulTargets` 为 true 时执行 `runPostRefreshWork()`；delete-only missing settle 且无 successful target 时，`waitForIdle()`、`verifyProgrammingOutput()`、settings/import replacement invalidation 都不会执行。
- `src/core/assets/manager/operation.ts` 的 `refreshAsset()` 对不存在单文件会抛 `can not find asset ...`；既有 move/rename 逻辑也通过刷新原父目录来观察删除。
- `src/core/assets/manager/asset.ts` 的 `_onAssetDeleted()` 会先调用 `assetHandlerManager.destroyAsset(asset)`，再 emit `asset-delete`。
- `src/core/assets/asset-handler/assets/javascript.ts` 的 `destroy()` 会 `dispatchAssetChange({ type: delete })` 并调用 `scripting.compileScripts()`，但当前 catch 会吞掉 compile error；因此计划必须通过 runtime coordinator 的 `waitForIdle()` / compile failure state / `verifyProgrammingOutput()` 暴露失败，而不能只依赖 `destroy()` 抛错。

## 文件职责

- `src/core/assets/test/operation.test.ts`
  - 增加 AssetDB 层事实测试：外部删除 source / `.meta` 后刷新父目录必须触发 `asset-delete`。
- `vitests/suites/runtime-preview/runtime-refresh-coordinator.test.ts`
  - 增加 runtime dirty-set 回归：delete-only missing target 会父目录 fallback、去重、失败可见、执行 post-refresh work。
- `src/runtime-preview/refresh/runtime-refresh-coordinator.ts`
  - 实现 `db://assets/...` 父目录计算、delete missing fallback、fallback 诊断字段、post-refresh work gate。
- `docs/dev/runtime-preview/facts/p7-deleted-script-stale-prerequisite-records-20260630.md`
  - 实施后追加验证事实。
- `docs/dev/runtime-preview/issues.md`
  - 只有真实/半真实删除脚本验证闭环后，才更新 `RP-ISSUE-034` 状态。

## 关键设计约束

- 不默认 fallback 到 `db://assets` root refresh；只有 `db://assets/<top-level-file>` 的父目录才是 `db://assets`。
- 同一 pass 内同一个 parent fallback 只刷新一次。
- parent fallback 失败必须导致 refresh `ok:false`，并 requeue parent target，不能把 deleted file 的 settled 状态误报为整体成功。
- 只要存在 parent fallback success，就必须执行 post-refresh work。
- 若存在 settled delete target 但 parent fallback 不适用或失败，结果必须保留 `settledTargets` / `failedTargets`，用于现场定位。
- 不手工编辑 P7 `library/`、`temp/cli/programming/`、source `.meta`，不把清 cache 当作修复证据。

---

## Task 1: AssetDB 父目录 refresh fact gate

**Files:**
- Modify: `src/core/assets/test/operation.test.ts`

- [ ] **Step 1: 添加普通资源 fact gate**

在 `describe('delete-asset', ...)` 内新增测试。该测试模拟用户从 Git merge 后外部删除 source 文件和 `.meta`，再刷新父目录。

```ts
it('刷新父目录会为外部删除的资源广播 asset-delete 消息', async function () {
    const targetName = `${name}_external_delete.txt`;
    const targetPath = join(databasePath, targetName);
    const createdAsset = await assetManager.createAsset({
        target: targetPath,
        content: 'external delete event',
        overwrite: true,
    });
    const targetUrl = `${TestGlobalEnv.testRootUrl}/${targetName}`;

    await remove(targetPath);
    await remove(`${targetPath}.meta`);

    const eventAsset = await expectSingleAssetEvent('asset-delete', targetUrl, async () => {
        await assetManager.refreshAsset(databasePath);
    });

    expect(createdAsset).not.toBeNull();
    expect(eventAsset.uuid).toEqual(createdAsset!.uuid);
    expect(eventAsset.url).toEqual(targetUrl);
});
```

- [ ] **Step 2: 添加 TypeScript script fact gate**

同一 `describe('delete-asset', ...)` 内新增 script asset 测试。该测试只证明 AssetDB parent refresh 能触发 `cc.Script` 的 `asset-delete`，不直接证明 QuickPack prerequisite records 已清理。

```ts
it('刷新父目录会为外部删除的 TypeScript 脚本广播 asset-delete 消息', async function () {
    const targetName = `${name}_external_delete_script.ts`;
    const createdAsset = await assetManager.createAssetByType('typescript', databasePath, targetName, {
        content: 'export const deletedScriptMarker = 1;',
        overwrite: true,
    });
    const targetPath = join(databasePath, targetName);
    const targetUrl = `${TestGlobalEnv.testRootUrl}/${targetName}`;

    await remove(targetPath);
    await remove(`${targetPath}.meta`);

    const eventAsset = await expectSingleAssetEvent('asset-delete', targetUrl, async () => {
        await assetManager.refreshAsset(databasePath);
    });

    expect(createdAsset).not.toBeNull();
    expect(eventAsset.uuid).toEqual(createdAsset!.uuid);
    expect(eventAsset.url).toEqual(targetUrl);
    expect(eventAsset.type).toEqual('cc.Script');
});
```

- [ ] **Step 3: 运行 Jest focused test**

Run:

```powershell
rtk pwsh -NoProfile -Command 'npm run test -- src/core/assets/test/operation.test.ts --runInBand -t "外部删除"'
```

Expected:

```text
PASS
```

这是 fact gate，不是“先失败再通过”的回归测试。预期当前源码应通过；如果这里失败，停止实施 Task 2-6，改为调查 `@cocos/asset-db` 的外部删除同步 API 或 sidecar 清理入口。

---

## Task 2: 给 runtime coordinator 增加 delete missing 的父目录 fallback

**Files:**
- Modify: `src/runtime-preview/refresh/runtime-refresh-coordinator.ts`
- Modify: `vitests/suites/runtime-preview/runtime-refresh-coordinator.test.ts`

- [ ] **Step 1: 添加 failing test**

在 `runtime-refresh-coordinator.test.ts` 的 dirty-set 测试区域新增用例：

```ts
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
  const verifyProgrammingOutput = vi.fn(async () => undefined);
  const drainDirtyTargets = vi.fn()
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
    .mockReturnValueOnce({ targets: [], entries: [], eventCount: 0, drainedAt: 1001 });

  const coordinator = createRuntimeRefreshCoordinator({
    projectRoot: 'E:/project',
    refreshTarget,
    waitForIdle,
    invalidateSettings: vi.fn(),
    clearImportReplacement: vi.fn(),
    verifyProgrammingOutput,
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
    now: vi.fn().mockReturnValue(1000),
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
  expect(verifyProgrammingOutput).toHaveBeenCalledTimes(1);
  expect(result.scriptCompile.status).toBe('done');
});
```

Run:

```powershell
rtk pwsh -NoProfile -Command 'npm --prefix vitests run test -- suites/runtime-preview/runtime-refresh-coordinator.test.ts -t "refreshes parent directory and waits for scripting after a deleted script target is missing"'
```

Expected before implementation:

```text
FAIL
Expected refreshTarget to have been called with "db://assets/scripts"
```

- [ ] **Step 2: 扩展 result type**

在 `RuntimeRefreshPassResult` 中增加字段：

```ts
parentFallbackTargets: string[];
rootFallback: boolean;
```

- [ ] **Step 3: 新增父目录 helper**

在 `runtime-refresh-coordinator.ts` 中新增：

```ts
function dirnameForDbAssetTarget(target: string): string | null {
    if (target === defaultRefreshTarget) {
        return null;
    }
    const prefix = `${defaultRefreshTarget}/`;
    if (!target.startsWith(prefix)) {
        return null;
    }
    const relativePath = target.slice(prefix.length);
    const slashIndex = relativePath.lastIndexOf('/');
    if (slashIndex < 0) {
        return defaultRefreshTarget;
    }
    return `${prefix}${relativePath.slice(0, slashIndex)}`;
}
```

- [ ] **Step 4: 实现 fallback**

在 per-target catch 中，当 `shouldSettleMissingDirtyTarget(...)` 为 true：

```ts
settledTargets.push({ target, error: errorMessage });

const parentTarget = dirnameForDbAssetTarget(target);
if (
    parentTarget
    && !passTargets.includes(parentTarget)
    && !successfulTargetSet.has(parentTarget)
    && !parentFallbackTargetSet.has(parentTarget)
) {
    parentFallbackTargetSet.add(parentTarget);
    parentFallbackTargets.push(parentTarget);
    allTargets.push(parentTarget);
    try {
        const changed = await options.refreshTarget(parentTarget);
        successfulTargets.push(parentTarget);
        successfulTargetSet.add(parentTarget);
        if (typeof changed === 'number') {
            changedAssetCount += changed;
        }
    } catch (parentError) {
        failedTargets.push({
            target: parentTarget,
            error: getErrorMessage(parentError),
        });
    }
}
```

实现位置要求：

- `const parentFallbackTargets: string[] = [];`
- `let rootFallback = false;`
- `const parentFallbackTargetSet = new Set<string>();` 应位于单个 pass 范围内。
- `allPasses.push(...)` 必须包含 `parentFallbackTargets`。
- 当 `parentTarget === defaultRefreshTarget` 时设置 `rootFallback = true`。

- [ ] **Step 5: 运行 focused test**

Run:

```powershell
rtk pwsh -NoProfile -Command 'npm --prefix vitests run test -- suites/runtime-preview/runtime-refresh-coordinator.test.ts -t "refreshes parent directory and waits for scripting after a deleted script target is missing"'
```

Expected:

```text
PASS
```

---

## Task 3: 覆盖 parent fallback 去重和失败可见性

**Files:**
- Modify: `vitests/suites/runtime-preview/runtime-refresh-coordinator.test.ts`

- [ ] **Step 1: 添加同目录批量删除去重测试**

```ts
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
```

- [ ] **Step 2: 添加 parent fallback 失败测试**

```ts
it('fails dirty refresh when parent refresh for a missing deleted script fails', async () => {
  const requeueTargets = vi.fn();
  const refreshTarget = vi.fn(async (target: string) => {
    if (target === 'db://assets/scripts/gone.ts') {
      throw new Error('can not find asset db://assets/scripts/gone.ts');
    }
    if (target === 'db://assets/scripts') {
      throw new Error('parent refresh failed');
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
```

- [ ] **Step 3: 更新既有 settled test，并约束 root fallback**

现有测试 `settles missing dirty targets without requeueing poison entries` 当前断言 `scriptCompile.status === 'skipped'` 且 `waitForIdle` 未调用。实施后该用例应改名并更新预期，明确 create+delete race 也会刷新父目录并执行 post-refresh work：

```ts
expect(result.scriptCompile.status).toBe('done');
expect(result.passes?.[0]?.parentFallbackTargets).toEqual(['db://assets']);
expect(waitForIdle).toHaveBeenCalledTimes(1);
expect(invalidateSettings).toHaveBeenCalledTimes(1);
expect(clearImportReplacement).toHaveBeenCalledTimes(1);
```

该用例中的 target 是顶层 `db://assets/temp.json`，因此 parent 是 `db://assets`。这必须被显式记录为 root fallback 边界，并只允许 top-level missing delete 触发；P7 深层脚本路径不得产生 `db://assets` root fallback。

新增断言：

```ts
expect(result.passes?.[0]?.rootFallback).toBe(true);
```

同时在 Task 2 的 `RuntimeRefreshPassResult` 增加：

```ts
rootFallback: boolean;
```

如果执行者认为 create+delete race 不应刷新 parent，必须在计划执行前补充事实说明，否则不能保留旧断言。

- [ ] **Step 4: 运行 coordinator 全文件**

Run:

```powershell
rtk pwsh -NoProfile -Command 'npm --prefix vitests run test -- suites/runtime-preview/runtime-refresh-coordinator.test.ts'
```

Expected:

```text
PASS
```

---

## Task 4: 明确 script destroy 吞错边界，验证 compile failure 仍由 coordinator 暴露

**Files:**
- Modify: `vitests/suites/runtime-preview/runtime-refresh-coordinator.test.ts`

- [ ] **Step 1: 添加 post-refresh failure 测试**

```ts
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
```

Run:

```powershell
rtk pwsh -NoProfile -Command 'npm --prefix vitests run test -- suites/runtime-preview/runtime-refresh-coordinator.test.ts -t "reports compile failure after parent fallback refresh succeeds"'
```

Expected:

```text
PASS
```

---

## Task 5: 回归 watcher / dirty-store 边界，不扩大刷新范围

**Files:**
- Modify: `vitests/suites/runtime-preview/runtime-asset-dirty-store.test.ts`
- Modify: `vitests/suites/runtime-preview/runtime-asset-change-watcher.test.ts`
- No production file unless tests reveal a real gap.

- [ ] **Step 1: 补 source + meta 同时 delete 的 dirty-store 测试**

在 `runtime-asset-dirty-store.test.ts` 新增：

```ts
it('keeps delete event type when source and meta are deleted together', () => {
  const store = createRuntimeAssetDirtyStore({ projectRoot });
  store.recordFileEvent({ type: 'delete', path: join(assetsRoot, 'scripts', 'gone.ts') });
  store.recordFileEvent({ type: 'delete', path: join(assetsRoot, 'scripts', 'gone.ts.meta') });

  expect(store.drainDirtyTargets().entries).toEqual([{
    target: 'db://assets/scripts/gone.ts',
    eventTypes: ['delete'],
    assetEventCount: 1,
    metaEventCount: 1,
  }]);
});
```

- [ ] **Step 2: 补 startup baseline delete 的 watcher 测试**

在 `runtime-asset-change-watcher.test.ts` 新增：

```ts
it('records startup baseline source deletes as delete dirty targets', async () => {
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
```

- [ ] **Step 3: 运行 watch / dirty focused tests**

Run:

```powershell
rtk pwsh -NoProfile -Command 'npm --prefix vitests run test -- suites/runtime-preview/runtime-asset-dirty-store.test.ts suites/runtime-preview/runtime-asset-change-watcher.test.ts'
```

Expected:

```text
PASS
```

- [ ] **Step 2: 如果失败，只允许按事实修正**

允许修正条件：

- startup baseline delete 未进入 dirty target；
- `.meta` delete 映射错误；
- dirty target eventTypes 丢失。

禁止修正：

- 把所有 delete 统一提升为 `db://assets` root；
- 为了测试通过丢弃 delete event；
- 将 P7 cache 状态作为 production 默认策略。

---

## Task 6: Bulk delete 性能和范围 gate

**Files:**
- Modify: `vitests/suites/runtime-preview/runtime-refresh-coordinator.test.ts`
- Modify: `docs/dev/runtime-preview/facts/p7-deleted-script-stale-prerequisite-records-20260630.md`

- [ ] **Step 1: 增加 coordinator bulk delete 范围测试**

新增一个纯 unit 测试，构造 100 个 missing deleted script targets，分布在 3 个目录。预期：

- `refreshTarget` 对 100 个 file target 各调用一次；
- parent fallback 只调用 3 次；
- `parentFallbackTargets.length === 3`；
- `rootFallback === false`；
- `waitForIdle()` 只调用一次。

测试代码骨架：

```ts
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
```

- [ ] **Step 2: P7 或 disposable P7 copy 验收必须记录性能范围**

事实记录必须包含：

```markdown
- deleted script count:
- unique parent fallback count:
- rootFallback:
- refreshTarget file calls:
- refreshTarget parent calls:
- script compile count / target build count:
- dirty refresh durationMs:
- QuickPack editor durationMs:
- QuickPack preview durationMs:
- 是否保持 dirty-set，不 fallback `db://assets` root:
```

如果出现 `rootFallback=true` 且删除脚本不是顶层 `assets/*.ts`，该实现不能确认。

---

## Task 7: 验证命令

**Files:**
- No source change beyond previous tasks.

- [ ] **Step 1: Jest / Vitest focused**

Run:

```powershell
rtk pwsh -NoProfile -Command 'npm run test -- src/core/assets/test/operation.test.ts --runInBand -t "外部删除"'
rtk pwsh -NoProfile -Command 'npm --prefix vitests run test -- suites/runtime-preview/runtime-refresh-coordinator.test.ts suites/runtime-preview/runtime-asset-dirty-store.test.ts suites/runtime-preview/runtime-asset-change-watcher.test.ts suites/runtime-preview/runtime-preview-express-server.test.ts'
```

Expected:

```text
两个命令均退出码 0。
```

- [ ] **Step 2: TypeScript 编译检查**

Run:

```powershell
rtk pwsh -NoProfile -Command 'npx tsc -b --pretty false'
```

Expected:

```text
退出码 0。该结果只能证明 TypeScript 编译通过，不能证明 dist 已更新。
```

- [ ] **Step 3: 构建 dist**

Run:

```powershell
rtk pwsh -NoProfile -Command 'npm run compile'
```

Expected:

```text
退出码 0。该结果证明 dist 已按当前源码更新，可用于真实 CLI 验收。
```

---

## Task 8: 半真实候选验证和 P7 真实删除脚本验收

**Files:**
- Modify: `docs/dev/runtime-preview/facts/p7-deleted-script-stale-prerequisite-records-20260630.md`
- Modify: `docs/dev/runtime-preview/issues.md`

- [ ] **Step 1: 优先构造临时 fixture 复现**

可接受的半真实验收必须满足：

- 通过真实 AssetDB / scripting / runtime refresh coordinator 路径；
- source 删除发生在 `assets` 下；
- 不通过 mock 手工删除 sidecar records；
- 不依赖 `COCOS_CLI_TEST_EDITOR_*` frozen reference；
- 结论只声明 fixture 范围，不声明 P7 fixed。

- [ ] **Step 2: disposable P7 copy 复现运行中删除**

为了可重复触发 delete dirty target，优先复制 P7 到 disposable 路径或使用一次性 worktree。不得在原始 P7 项目上做破坏性删除复现。

建议路径：

```text
D:\ps_copy\p7\trunk\GameClient\Client-fight-roguelike-migration-codex-delete-repro
```

操作要求：

- 启动 preview 后再删除脚本，模拟“运行中的 preview 收到 merge 后批量 delete”。
- 删除 source 和 `.meta` 必须发生在 disposable copy，不得发生在原始 P7。
- 不手工清理 disposable copy 的 `library/.cli-assets-*` 或 `temp/cli/programming`，否则不能证明 stale records 自动 purge。
- 删除样本应优先使用 facts 中的两个历史 stale scripts，若 disposable copy 当前不存在这些文件，则选择 3-10 个受 Git 跟踪的 TypeScript 脚本复制成临时 probe scripts，启动成功后删除这些 probe scripts 和 `.meta`。

示例触发命令只作为计划模板，执行时必须先确认 disposable copy 路径存在：

```powershell
rtk pwsh -NoProfile -Command 'node E:\own_space\engines\cocos-cli\dist\cli.js preview --runtime --project D:\ps_copy\p7\trunk\GameClient\Client-fight-roguelike-migration-codex-delete-repro --host 127.0.0.1 --port 9627 --watch-assets --refresh-on-reload'
```

另一个 PowerShell 中删除 disposable copy 的脚本样本后请求 root reload 或 refresh endpoint：

```powershell
rtk pwsh -NoProfile -Command 'Remove-Item -LiteralPath "D:\ps_copy\p7\trunk\GameClient\Client-fight-roguelike-migration-codex-delete-repro\assets\scripts\__cocos_cli_delete_probe__\probe_a.ts" -ErrorAction SilentlyContinue; Remove-Item -LiteralPath "D:\ps_copy\p7\trunk\GameClient\Client-fight-roguelike-migration-codex-delete-repro\assets\scripts\__cocos_cli_delete_probe__\probe_a.ts.meta" -ErrorAction SilentlyContinue; Invoke-WebRequest "http://127.0.0.1:9627/" | Select-Object -ExpandProperty StatusCode'
```

该步骤通过只能证明候选修复覆盖 P7 形态的运行中删除；不能把 `RP-ISSUE-034` 标为 `fixed`。

- [ ] **Step 3: 原始 P7 production 验收**

运行前必须先构建 `dist`，并清理无关 test env：

```powershell
rtk pwsh -NoProfile -Command 'npm run compile'
rtk pwsh -NoProfile -Command 'Remove-Item Env:COCOS_CLI_TEST_PROJECT_ROOT -ErrorAction SilentlyContinue; Remove-Item Env:COCOS_CLI_TEST_ENGINE_ROOT -ErrorAction SilentlyContinue; Remove-Item Env:COCOS_CLI_TEST_EDITOR_LIBRARY_REF -ErrorAction SilentlyContinue; Remove-Item Env:COCOS_CLI_TEST_EDITOR_PROGRAMMING_REF -ErrorAction SilentlyContinue'
```

启动命令：

```powershell
rtk pwsh -NoProfile -Command 'node E:\own_space\engines\cocos-cli\dist\cli.js preview --runtime --project D:\ps_copy\p7\trunk\GameClient\Client-fight-roguelike-migration --host 127.0.0.1 --port 9527 --watch-assets --refresh-on-reload'
```

通过条件：

- 如果原始 P7 当前仍有 stale deleted records，runtime refresh log 出现 delete missing 对应的 `parentFallbackTargets`。
- 如果原始 P7 当前已经没有 stale deleted records，则记录为“未触发 delete fallback 的 production smoke”，不能单独作为 fixed 证据；必须结合 disposable P7 copy 的运行中删除复现。
- stale deleted script 不再以“一个脚本失败几十秒、清掉后推进到下一个 stale script”的方式反复阻塞。
- 若仍失败，失败 JSON 必须包含具体缺失脚本、`settledTargets`、`failedTargets`、`passes[].parentFallbackTargets`、`scriptCompile`。
- 不手工修改 P7 generated cache，不手工删除 `library/.cli-assets-*` 或 `temp/cli/programming` records。
- 不写 P7 source `.meta` 作为修复手段；若 AssetDB 自身因 refresh 写 `.meta`，事实记录必须说明。

- [ ] **Step 4: 记录事实**

在 facts 文档追加：

```markdown
## 修复验证

- CLI commit:
- 构建命令:
- 测试层级:
- 项目/fixture 分类:
- 环境变量:
- 是否构建 dist:
- 删除脚本样本:
- runtime-refresh result:
- parentFallbackTargets:
- rootFallback:
- deleted script count:
- unique parent fallback count:
- refreshTarget file calls:
- refreshTarget parent calls:
- dirty refresh durationMs:
- settledTargets:
- failedTargets:
- QuickPack target result:
- 是否仍出现 stale prerequisite:
- 本验证能证明:
- 本验证不能证明:
```

- [ ] **Step 5: 回填 issue**

只有满足以下全部条件，才能把 `RP-ISSUE-034` 标为 `fixed`：

- Task 1 的 AssetDB 事实测试通过。
- Task 2-6 的 runtime focused tests 通过。
- Task 6 的 bulk delete 性能和范围 gate 通过。
- `npx tsc -b --pretty false` 通过。
- `npm run compile` 通过。
- disposable P7 copy 运行中删除复现通过。
- 原始 P7 production 验收通过；如果原始 P7 无法触发 delete fallback，只能结合 disposable P7 copy 证明候选能力，并把 `RP-ISSUE-034` 保持 `in-progress`，等待真实项目自然复现或用户确认可接受的 production 触发条件。

如果只有单元/route contract 或半真实 fixture 通过，`RP-ISSUE-034` 只能保持 `open` 或更新为 `in-progress`，不能标 `fixed`。

## 风险和回滚标准

- 如果 `refresh(parentDir)` 不能触发 `asset-delete`，当前方案不可确认，应停止并调查 AssetDB sidecar stale record 删除 API。
- 如果 parent fallback 造成大量 `db://assets` root refresh 或 P7 changed refresh 性能显著回退，应回滚 coordinator fallback 或增加更窄的 parent 选择策略。
- 如果 `JavascriptHandler.destroy()` 吞错导致 refresh 返回成功但 QuickPack records 仍坏，必须依赖 `waitForIdle()` / `verifyProgrammingOutput()` 的失败结果继续暴露，不允许吞掉 runtime refresh failure。
- 如果 P7 验收需要修改项目资源或 `.meta` 才能通过，不得把结果记为 production 修复。
