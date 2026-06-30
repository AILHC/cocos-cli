# P7 Deleted Script Stale Prerequisite Records Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 runtime preview 在运行中批量删除脚本后仍使用 stale prerequisite records 反复编译失败的问题。

**Architecture:** 保持 dirty-set refresh 的增量策略，不回退到默认 root refresh。对 delete-only dirty target 增加可验证的父目录 refresh / post-refresh work 语义，确保 AssetDB 有机会发出 `asset-delete`，script handler 能 dispatch delete 并重编译 QuickPack records。失败诊断必须继续保留具体缺失脚本路径、target 和 refresh pass 信息。

**Tech Stack:** TypeScript、Vitest、`@parcel/watcher` dirty-set、`@cocos/asset-db`、Cocos scripting / QuickPack / PackerDriver。

---

## 关联材料

- Issue：`docs/dev/runtime-preview/issues.md` 中 `RP-ISSUE-034`
- 事实记录：`docs/dev/runtime-preview/facts/p7-deleted-script-stale-prerequisite-records-20260630.md`
- 测试规范：`docs/dev/testing-spec.md`
- runtime preview 测试规范：`docs/dev/runtime-preview/testing-spec.md`
- 相关源码：
  - `src/runtime-preview/refresh/runtime-refresh-coordinator.ts`
  - `src/runtime-preview/watch/runtime-asset-dirty-store.ts`
  - `src/runtime-preview/watch/runtime-asset-change-watcher.ts`
  - `src/runtime-preview/server/runtime-preview-server.ts`
  - `src/core/assets/manager/operation.ts`
  - `src/core/assets/manager/asset.ts`
  - `src/core/assets/asset-handler/assets/javascript.ts`
  - `src/core/scripting/packer-driver/index.ts`
- 相关测试：
  - `vitests/suites/runtime-preview/runtime-refresh-coordinator.test.ts`
  - `vitests/suites/runtime-preview/runtime-asset-dirty-store.test.ts`
  - `vitests/suites/runtime-preview/runtime-asset-change-watcher.test.ts`
  - `vitests/suites/runtime-preview/runtime-preview-express-server.test.ts`
  - `src/core/scripting/test/script-manager.test.ts`

## 文件职责

- `src/runtime-preview/refresh/runtime-refresh-coordinator.ts`
  - 负责 dirty-set multi-pass、missing/delete settle、post-refresh work、失败 requeue。
  - 本问题的主要修复点应在这里，而不是修改 P7 缓存或强行清 root。
- `vitests/suites/runtime-preview/runtime-refresh-coordinator.test.ts`
  - 覆盖 delete-only target、missing settle、父目录 fallback、post-refresh work 是否执行。
- `src/runtime-preview/watch/runtime-asset-dirty-store.ts`
  - 只在发现 delete target 归一化信息不够时修改；优先不动。
- `src/runtime-preview/watch/runtime-asset-change-watcher.ts`
  - 只在 baseline diff 没有覆盖启动窗口 delete 时修改；当前事实还不能直接认定这里有缺陷。
- `src/core/assets/asset-handler/assets/javascript.ts`
  - 只在确认 AssetDB 已发出 `asset-delete` 但 scripting delete compile 未清 records 时修改。
- `docs/dev/runtime-preview/facts/*.md`
  - 新会话追加复现和验证事实。
- `docs/dev/runtime-preview/issues.md`
  - 实现完成后回填 `RP-ISSUE-034` 状态和验收入口。

## Task 1: 补最小单测复现 delete-only missing settle 不触发 post-refresh work

**Files:**
- Modify: `vitests/suites/runtime-preview/runtime-refresh-coordinator.test.ts`

- [ ] **Step 1: 阅读测试规范**

Run:

```powershell
Get-Content -LiteralPath 'E:\own_space\engines\cocos-cli\docs\dev\testing-spec.md'
Get-Content -LiteralPath 'E:\own_space\engines\cocos-cli\docs\dev\runtime-preview\testing-spec.md'
```

Expected:

```text
确认测试层级、真实项目边界、环境变量限制和 runtime preview 专项要求。
```

- [ ] **Step 2: 写 failing test，证明当前 delete-only missing settle 不会执行 post-refresh work**

在 `runtime-refresh-coordinator.test.ts` 追加一个用例，构造：

- dirty batch 只有一个 script delete target。
- `refreshTarget('db://assets/scripts/gone.ts')` 抛 `can not find asset db://assets/scripts/gone.ts`。
- `drainDirtyTargets()` 第二次返回空。
- 期望修复后的行为至少调用一次父目录 refresh 或 post-refresh work；当前实现应失败。

建议测试骨架：

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
    const invalidateSettings = vi.fn(async () => undefined);
    const clearImportReplacement = vi.fn(async () => undefined);
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
        .mockReturnValueOnce({
            targets: [],
            entries: [],
            eventCount: 0,
            drainedAt: 1001,
        });

    const coordinator = createRuntimeRefreshCoordinator({
        projectRoot: 'D:/project',
        refreshTarget,
        waitForIdle,
        invalidateSettings,
        clearImportReplacement,
        verifyProgrammingOutput,
        dirtyProvider: {
            drainDirtyTargets,
            requeueTargets: vi.fn(),
            getStatus: () => ({
                enabled: true,
                running: true,
                assetsRoot: 'D:/project/assets',
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
        },
        logger: { write: vi.fn() },
        now: vi.fn()
            .mockReturnValueOnce(1000)
            .mockReturnValue(1010),
    });

    const result = await coordinator.refresh({ reason: 'reload' });

    expect(result.ok).toBe(true);
    expect(refreshTarget).toHaveBeenCalledWith('db://assets/scripts/gone.ts');
    expect(refreshTarget).toHaveBeenCalledWith('db://assets/scripts');
    expect(waitForIdle).toHaveBeenCalledTimes(1);
    expect(verifyProgrammingOutput).toHaveBeenCalledTimes(1);
    expect(result.settledTargets).toEqual([{
        target: 'db://assets/scripts/gone.ts',
        error: 'can not find asset db://assets/scripts/gone.ts',
    }]);
});
```

- [ ] **Step 3: 运行 focused test，确认失败**

Run:

```powershell
npm --prefix vitests run test -- suites/runtime-preview/runtime-refresh-coordinator.test.ts -t "refreshes parent directory and waits for scripting after a deleted script target is missing"
```

Expected before implementation:

```text
FAIL
Expected refreshTarget to have been called with "db://assets/scripts"
```

## Task 2: 在 coordinator 中实现 delete missing 的父目录 fallback

**Files:**
- Modify: `src/runtime-preview/refresh/runtime-refresh-coordinator.ts`
- Test: `vitests/suites/runtime-preview/runtime-refresh-coordinator.test.ts`

- [ ] **Step 1: 添加 helper，计算 deleted target 的父目录**

在 `runtime-refresh-coordinator.ts` 中新增 helper。保持 `db://assets` 边界，不引入 filesystem path 计算。

建议实现：

```ts
function dirnameForDbAssetTarget(target: string): string | null {
    if (target === 'db://assets') {
        return null;
    }
    const prefix = 'db://assets/';
    if (!target.startsWith(prefix)) {
        return null;
    }
    const relativePath = target.slice(prefix.length);
    const slashIndex = relativePath.lastIndexOf('/');
    if (slashIndex < 0) {
        return 'db://assets';
    }
    return `${prefix}${relativePath.slice(0, slashIndex)}`;
}
```

- [ ] **Step 2: delete missing settle 时刷新父目录**

在 `refreshDirtySet()` 的 per-target catch 中，当 `shouldSettleMissingDirtyTarget(...)` 为 true 时：

1. 继续记录 `settledTargets`，保留当前 API 语义。
2. 对 deleted file target 计算父目录。
3. 父目录未在本 pass 处理、未成功过时，调用 `options.refreshTarget(parentTarget)`。
4. 父目录 refresh 成功时，把 parentTarget 加入 `successfulTargets` 和 `successfulTargetSet`，并累计 `changedAssetCount`。
5. 父目录 refresh 失败时，把 parentTarget 记录到 `failedTargets`，不要吞真实错误。

建议局部实现形态：

```ts
if (shouldSettleMissingDirtyTarget(batch.entries, target, errorMessage)) {
    settledTargets.push({ target, error: errorMessage });

    const parentTarget = dirnameForDbAssetTarget(target);
    if (
        parentTarget
        && !passTargets.includes(parentTarget)
        && !successfulTargetSet.has(parentTarget)
    ) {
        try {
            const changed = await options.refreshTarget(parentTarget);
            successfulTargets.push(parentTarget);
            successfulTargetSet.add(parentTarget);
            allTargets.push(parentTarget);
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
} else {
    failedTargets.push({ target, error: errorMessage });
}
```

注意：如果实现时 `allTargets.push(parentTarget)` 会影响 pass `targets` 展示，需要同步调整测试期望，确保诊断结果能看到 parent fallback。

- [ ] **Step 3: 运行 Task 1 测试，确认通过**

Run:

```powershell
npm --prefix vitests run test -- suites/runtime-preview/runtime-refresh-coordinator.test.ts -t "refreshes parent directory and waits for scripting after a deleted script target is missing"
```

Expected:

```text
PASS
```

## Task 3: 覆盖批量删除脚本时父目录 fallback 去重

**Files:**
- Modify: `vitests/suites/runtime-preview/runtime-refresh-coordinator.test.ts`

- [ ] **Step 1: 写批量 delete test**

新增测试，两个 missing deleted scripts 同属一个目录：

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
        projectRoot: 'D:/project',
        refreshTarget,
        waitForIdle,
        invalidateSettings: vi.fn(async () => undefined),
        clearImportReplacement: vi.fn(async () => undefined),
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
                assetsRoot: 'D:/project/assets',
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
        },
        logger: { write: vi.fn() },
        now: vi.fn().mockReturnValue(1000),
    });

    const result = await coordinator.refresh({ reason: 'reload' });

    expect(result.ok).toBe(true);
    expect(refreshTarget.mock.calls.filter(([target]) => target === 'db://assets/scripts')).toHaveLength(1);
    expect(waitForIdle).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: 运行 focused test**

Run:

```powershell
npm --prefix vitests run test -- suites/runtime-preview/runtime-refresh-coordinator.test.ts -t "dedupes parent refresh for multiple missing deleted script targets"
```

Expected:

```text
PASS
```

## Task 4: 保证 parent fallback 失败不会被误判成功

**Files:**
- Modify: `vitests/suites/runtime-preview/runtime-refresh-coordinator.test.ts`

- [ ] **Step 1: 写 fallback failure test**

新增测试：deleted file missing 被 settle，但父目录 refresh 失败。期望整体 `ok:false`，并 requeue parent target 或至少把 parent 放入 `failedTargets`。

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
    const coordinator = createRuntimeRefreshCoordinator({
        projectRoot: 'D:/project',
        refreshTarget,
        waitForIdle: vi.fn(async () => undefined),
        invalidateSettings: vi.fn(async () => undefined),
        clearImportReplacement: vi.fn(async () => undefined),
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
                assetsRoot: 'D:/project/assets',
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
        },
        logger: { write: vi.fn() },
        now: vi.fn().mockReturnValue(1000),
    });

    const result = await coordinator.refresh({ reason: 'reload' });

    expect(result.ok).toBe(false);
    expect(result.failedTargets).toEqual([{ target: 'db://assets/scripts', error: 'parent refresh failed' }]);
    expect(requeueTargets).toHaveBeenCalledWith(['db://assets/scripts']);
});
```

- [ ] **Step 2: 运行 focused test**

Run:

```powershell
npm --prefix vitests run test -- suites/runtime-preview/runtime-refresh-coordinator.test.ts -t "fails dirty refresh when parent refresh for a missing deleted script fails"
```

Expected:

```text
PASS
```

## Task 5: 增强日志，让现场能看出 delete fallback 和 post-refresh 状态

**Files:**
- Modify: `src/runtime-preview/refresh/runtime-refresh-coordinator.ts`
- Modify: `vitests/suites/runtime-preview/runtime-refresh-coordinator.test.ts`

- [ ] **Step 1: 在 result patch 中暴露 parent fallback**

扩展 `RuntimeRefreshPassResult` 或现有 pass payload，加入可选字段：

```ts
parentFallbackTargets?: string[];
```

每个 pass 记录本轮由 delete missing 推导出的父目录 fallback target。

- [ ] **Step 2: 更新测试断言**

在 Task 1 和 Task 3 的测试中断言：

```ts
expect(result.passes?.[0]?.parentFallbackTargets).toEqual(['db://assets/scripts']);
```

- [ ] **Step 3: 运行 coordinator 测试**

Run:

```powershell
npm --prefix vitests run test -- suites/runtime-preview/runtime-refresh-coordinator.test.ts
```

Expected:

```text
PASS
```

## Task 6: 真实或半真实复现验证

**Files:**
- Modify: `docs/dev/runtime-preview/facts/p7-deleted-script-stale-prerequisite-records-20260630.md`

- [ ] **Step 1: 构建当前仓库 CLI**

Run:

```powershell
npm run compile
```

Expected:

```text
退出码 0
```

- [ ] **Step 2: 用临时 fixture 或 P7 复现批量删除脚本**

优先使用临时 fixture；只有需要真实业务规模时再使用 P7。不得修改 P7 source `.meta` 或手动编辑 P7 generated cache。

P7 验证命令参考：

```powershell
node E:\own_space\engines\cocos-cli\dist\cli.js preview --runtime --project D:\ps_copy\p7\trunk\GameClient\Client-fight-roguelike-migration --host 127.0.0.1 --port 9527 --watch-assets --refresh-on-reload
```

Expected:

```text
日志中能看到 delete missing 的 parentFallbackTargets。
不会长时间反复停留在同一个已删除脚本的 prerequisite resolve_error_module_not_found。
若仍失败，失败结果必须包含当前具体缺失脚本路径、target、pass、settledTargets 和 failedTargets。
```

- [ ] **Step 3: 记录验证事实**

把以下内容追加到事实文档：

```markdown
## 修复验证

- CLI commit:
- 构建命令:
- 项目/fixture:
- 删除脚本样本:
- runtime-refresh result:
- parentFallbackTargets:
- settledTargets:
- failedTargets:
- QuickPack target result:
- 是否仍出现 stale prerequisite:
```

## Task 7: 回归测试和台账回填

**Files:**
- Modify: `docs/dev/runtime-preview/issues.md`
- Modify: `docs/dev/runtime-preview/facts/p7-deleted-script-stale-prerequisite-records-20260630.md`

- [ ] **Step 1: 运行 focused runtime preview 测试**

Run:

```powershell
npm --prefix vitests run test -- suites/runtime-preview/runtime-refresh-coordinator.test.ts suites/runtime-preview/runtime-asset-dirty-store.test.ts suites/runtime-preview/runtime-asset-change-watcher.test.ts suites/runtime-preview/runtime-preview-express-server.test.ts
```

Expected:

```text
PASS
```

- [ ] **Step 2: 运行 TypeScript 构建**

Run:

```powershell
npx tsc -b --pretty false
```

Expected:

```text
退出码 0
```

- [ ] **Step 3: 运行 CLI 编译**

Run:

```powershell
npm run compile
```

Expected:

```text
退出码 0
```

- [ ] **Step 4: 回填 issue**

如果最小测试、focused tests、TypeScript build、CLI compile 和至少一个真实/半真实删除脚本验证都通过，把 `RP-ISSUE-034` 从 `open` 更新为 `fixed`，并把验收入口写入 `issues.md`。

如果只有单元测试通过但真实 P7 仍不能稳定通过，保持 `open` 或改为 `in-progress`，不得标 `fixed`。

## 风险和边界

- 不允许通过硬超时掩盖问题；超时只能作为已有 `waitForIdle` 的失败边界，不是修复手段。
- 不允许默认回退到 `db://assets` root refresh；P7 / feature-c 真实项目已证明 root refresh 成本高。
- 不允许把 P7 generated cache 的手工清理当作 production 修复。
- 不允许把 `COCOS_CLI_TEST_*` 或 frozen Editor reference 当作 production 验收。
- 如果父目录 fallback 导致大量目录 refresh，需要增加去重和 pass 限制，不能破坏 `RP-ISSUE-028` 的 changed refresh 性能结论。

## 交接备注

当前最可信的修复方向是：delete-only missing target 不能只 settle；需要给 AssetDB 一个父目录 refresh 机会，并且只要本轮存在 settled script delete 或 parent fallback 成功，就必须执行 post-refresh work，确保 scripting delete compile 和 programming output verification 有机会运行。

如果新会话发现 `@cocos/asset-db.refresh(parentDir)` 也不能触发对应 `asset-delete`，应停止当前方案，转向调查 AssetDB sidecar stale record 的官方删除 API 或 scripting layer 的显式 delete dispatch，不要继续叠加 workaround。
