# Runtime Preview Windows Short Path Canonicalization Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:test-driven-development` for implementation and `superpowers:verification-before-completion` before claiming completion. This plan fixes `RP-ISSUE-035`; do not edit P7 project resources or generated cache as part of the fix.

**Goal:** 修复 `preview --runtime --watch-assets` 在 Windows 8.3 short path alias 进入 watcher / refresh 链路后，把同一资源误识别成 `resources` 与 `RESOUR~1` 两个 AssetDB asset，进而触发 source `.meta` uuid 被 `_replaceUUID()` 写回的问题。

**Architecture:** 在 runtime preview 自己的 path identity 边界做 canonicalization：所有来自 filesystem event、absolute refresh target、`db://assets/...` refresh target 的路径，进入 dirty-set 或 AssetDB refresh 前必须归一到同一个 canonical asset source path，再生成 `db://assets/...`。修复点不放在 P7 特判、全量 root refresh、全树扫描或忽略 `.meta` 上；也不修改 `@cocos/asset-db` 的核心 identity 策略。

**Tech Stack:** TypeScript、Vitest、Node `fs.realpathSync.native` / injectable fs adapter、`@parcel/watcher`、runtime preview dirty-set / refresh coordinator。

---

## 关联材料

- Issue：`docs/dev/runtime-preview/issues.md` 中 `RP-ISSUE-035`
- 事实记录：`docs/dev/runtime-preview/facts/p7-watch-assets-short-path-meta-uuid-20260707.md`
- 测试规范：`docs/dev/testing-spec.md`
- runtime preview 测试规范：`docs/dev/runtime-preview/testing-spec.md`
- 相关源码：
  - `src/runtime-preview/watch/runtime-asset-dirty-store.ts`
  - `src/runtime-preview/watch/runtime-asset-change-watcher.ts`
  - `src/runtime-preview/refresh/runtime-refresh-coordinator.ts`
  - `src/runtime-preview/server/runtime-preview-server.ts`
  - `src/core/assets/manager/operation.ts`
  - `packages/asset-db/libs/asset-db.js`
- 相关测试：
  - `vitests/suites/runtime-preview/runtime-asset-dirty-store.test.ts`
  - `vitests/suites/runtime-preview/runtime-asset-change-watcher.test.ts`
  - `vitests/suites/runtime-preview/runtime-refresh-coordinator.test.ts`

## 修复原则

- canonicalization 必须发生在 runtime preview 边界：watcher event path、dirty target 和 refresh target 进入 AssetDB 前。
- 不能用 `db://assets` root refresh 规避 short path；这会破坏 `RP-ISSUE-028` 已验证的增量性能。
- 不能简单忽略 `.meta` 事件；`.meta` 变更仍可能是合法 importer/userData 变更。
- 不能对每个 event 做全项目扫描；只允许对 event path 的自身或最近存在祖先做 `realpath`，并使用 watcher 生命周期内的目录级 cache。
- D 盘临时目录只能作为 8.3 行为诊断证据，不能作为正式 fixture。正式回归必须是可控 unit test；Windows short-name 集成测试只能做 capability-gated optional test。

## Task 1: 增加 path canonicalizer 模块和纯单测

**Files:**
- Add: `src/runtime-preview/path/runtime-asset-path-canonicalizer.ts`
- Add: `vitests/suites/runtime-preview/runtime-asset-path-canonicalizer.test.ts`

- [ ] **Step 1: 先写 failing tests**

覆盖以下场景：

- `D:/project/assets/RESOUR~1/cfg/a.json` 归一为 `db://assets/resources/cfg/a.json`。
- `D:/project/assets/RESOUR~1/cfg/a.json.meta` 先映射 source asset，再归一为 `db://assets/resources/cfg/a.json`。
- `db://assets/RESOUR~1/cfg/a.json` 归一为 `db://assets/resources/cfg/a.json`。
- deleted/missing file 使用最近存在祖先 canonicalize，例如 `RESOUR~1/cfg/missing.json` 仍归一到 `resources/cfg/missing.json`。
- path 在 canonical assetsRoot 外时返回 `null`，不能生成 dirty target。
- 当 project root / assets root 在测试中不存在时保持 fail-soft，不破坏现有纯单测。

用 injectable fs adapter 模拟 short path，不依赖真实 D 盘：

```ts
const canonicalizer = createRuntimeAssetPathCanonicalizer({
    projectRoot: 'D:/project',
    fs: {
        existsSync: (path) => existingPaths.has(normalizePath(path)),
        realpathSyncNative: (path) => realpathMap.get(normalizePath(path)) ?? path,
    },
});
```

- [ ] **Step 2: 实现 canonicalizer**

建议 API：

```ts
export interface RuntimeAssetPathCanonicalizer {
    fileEventPathToDbTarget(filePath: string): string | null;
    refreshTargetToDbTarget(target: string): RuntimeAssetTargetNormalizeResult;
}

export function createRuntimeAssetPathCanonicalizer(options: {
    projectRoot: string;
    fs?: RuntimeAssetPathCanonicalizerFs;
}): RuntimeAssetPathCanonicalizer;
```

`refreshTargetToDbTarget()` 不能只返回 `string | null`。coordinator 需要保留现有错误语义，至少区分非 string、dot segment、assets root 外、root target 和正常 canonical target：

```ts
type RuntimeAssetTargetNormalizeResult =
    | { ok: true; originalTarget: string; canonicalTarget: string; changed: boolean }
    | { ok: false; originalTarget: string; reason: 'non-string' | 'dot-segment' | 'outside-assets-root' | 'invalid-target'; message: string };
```

实现要点：

- `assetsRoot = resolve(projectRoot, 'assets')` 本身也 canonicalize；如果不存在，退回 normalized absolute path，保证纯单测兼容。
- 对 `.meta` event 先去掉 `.meta` 后缀，再 canonicalize source path。
- 对 missing/deleted path，从自身开始向上查找最近存在祖先；realpath 该祖先后拼回剩余 relative tail。
- 使用 directory realpath cache 和 missing-ancestor lookup cache；同一目录在同一 watcher 生命周期只 realpath 一次，同一缺失目录下的大批文件不能反复逐级 `existsSync` 探测。
- canonical result 必须重新做 inside-assetsRoot 校验，再用 POSIX slash 生成 `db://assets/...`。
- 保留大小写和 unicode 的语义，不做额外 lower-case；Windows alias 修复依赖 realpath，不依赖字符串大小写猜测。
- 保留现有 `db://assets` dot segment 拒绝语义；`db://assets/../x`、`db://assets/foo/../../x` 不能被 filesystem `resolve()` 吃掉后误接受。
- deleted path 的 long name 恢复依赖最近存在祖先仍可 `realpath`。如果整个 alias 对应目录已删除，只能依赖 canonicalizer 之前见过该 alias 的 cache；测试需覆盖“已缓存 alias 后目录删除”的场景，未见过且祖先消失时不得猜测 long name。

## Task 2: dirty-store 使用 canonicalizer 归一 watcher events

**Files:**
- Modify: `src/runtime-preview/watch/runtime-asset-dirty-store.ts`
- Modify: `vitests/suites/runtime-preview/runtime-asset-dirty-store.test.ts`

- [ ] **Step 1: 写 failing tests**

新增测试：

- `recordFileEvent({ path: 'D:/project/assets/RESOUR~1/cfg/a.json', type: 'update' })` 后 dirty target 是 `db://assets/resources/cfg/a.json`。
- `.json.meta` event 生成同一个 source target，不生成 `...json.meta` target。
- 同一 long path 与 short path 事件去重成一个 target，`eventTypes` 和计数仍累加。
- canonical assetsRoot 外的 event 被忽略，不污染 dirty-set。

- [ ] **Step 2: 接入 canonicalizer**

扩展 factory options：

```ts
createRuntimeAssetDirtyStore({
    projectRoot,
    pathCanonicalizer,
});
```

`recordFileEvent()` 必须改为调用 `pathCanonicalizer.fileEventPathToDbTarget(event.path)`。`recordDirtyTarget()` 若接收 `db://assets/...`，也应调用 `refreshTargetToDbTarget()` 做一次轻量归一，避免测试或 future caller 把 `db://assets/RESOUR~1/...` 直接塞进 dirty-set。

## Task 3: refresh coordinator 归一显式 refresh target

**Files:**
- Modify: `src/runtime-preview/refresh/runtime-refresh-coordinator.ts`
- Modify: `vitests/suites/runtime-preview/runtime-refresh-coordinator.test.ts`

- [ ] **Step 1: 写 failing tests**

覆盖：

- `refresh({ target: 'D:/project/assets/RESOUR~1/cfg/a.json' })` 调用 `refreshTarget('db://assets/resources/cfg/a.json')`。
- `refresh({ target: 'db://assets/RESOUR~1/cfg/a.json' })` 调用 `refreshTarget('db://assets/resources/cfg/a.json')`。
- 非 assets 内 target 继续返回现有 invalid-target 错误，不进入 AssetDB。
- `db://assets/../x`、`db://assets/foo/../../x` 继续返回现有 dot segment / invalid-target 错误，不进入 AssetDB。

- [ ] **Step 2: 接入 canonicalizer**

在 coordinator options 中注入同一个 canonicalizer，替换现有只基于 `resolve/relative` 的 `normalizeRefreshTarget()`。保持 error message 可诊断：用户传入非法 target 时仍包含原始 target；内部 refresh 只看到 canonical target。

- [ ] **Step 3: dirtyProvider drained targets 再做轻量归一**

`dirtyProvider.drainDirtyTargets()` 是可注入接口，不能只假设 production dirty-store 已 canonicalize。dirty-set refresh 在处理 drained targets 前必须对 `db://assets/...` target 再调用 `refreshTargetToDbTarget()`：

- canonical 成功且 target 变化时，用 canonical target refresh，并把 pass result 中的 target 展示为 canonical target。
- canonical 失败时，不调用 AssetDB；结果应进入 `failedTargets` 或等价 invalid-target 分支，并记录 bounded log，避免 future caller 把 `db://assets/RESOUR~1/...` 重新绕回 AssetDB。
- 同一批次中 canonical 后重复的 targets 要去重，但事件计数和诊断信息不能丢。

## Task 4: server 生命周期只创建一个 canonicalizer

**Files:**
- Modify: `src/runtime-preview/server/runtime-preview-server.ts`
- Test: existing runtime preview server / watcher focused tests

- [ ] **Step 1: 共享实例**

在 runtime preview server 初始化时创建一个 `RuntimeAssetPathCanonicalizer`，传给 dirty-store、watcher 相关 factory 和 refresh coordinator。不要在每个 event / refresh request 里创建新实例；这样 directory realpath cache 才有效。

- [ ] **Step 2: 有界诊断日志**

仅当 canonical target 与原始 event/target 映射不同，记录 bounded sample，例如每个 server 生命周期最多 5 条：

```text
runtime-path-canonicalize input=... target=db://assets/resources/... reason=watch-event
```

该日志用于证明 `RESOUR~1` 被收敛，不允许对每个 event 打日志。

## Task 5: capability-gated Windows watcher 诊断测试

**Files:**
- Add: `vitests/suites/runtime-preview/runtime-asset-short-path-watcher.integration.test.ts`

- [ ] **Step 1: 建立可跳过的 Windows integration test**

该测试只验证环境事实，不作为所有平台必跑前提：

- 仅在 Windows 执行。
- 使用 Vitest temp directory，不写入 P7。
- 创建 `resources` 后用 `cmd /c dir /x` 或 Node fs 行为确认存在 `RESOUR~1` short name；没有 short name capability 时 `test.skip`。
- 通过 short path 写文件，确认 `@parcel/watcher` 可能发出 short path event。
- 把该 event 喂给 dirty-store，断言 dirty target canonicalize 为 `db://assets/resources/...`。
- 不能断言 watcher 必然发 short path：如果当前 Windows backend / volume 没有发 short path，测试应跳过 watcher 诊断断言，只保留 fake fs unit tests 作为核心正确性依据。

这不是核心正确性测试；核心正确性由 Task 1-3 的 fake fs unit tests 保证。

## Task 6: 验证命令

- [ ] **Step 1: focused tests**

```powershell
rtk pwsh -NoProfile -Command "npm --prefix vitests run test -- suites/runtime-preview/runtime-asset-path-canonicalizer.test.ts suites/runtime-preview/runtime-asset-dirty-store.test.ts suites/runtime-preview/runtime-refresh-coordinator.test.ts suites/runtime-preview/runtime-asset-change-watcher.test.ts"
```

Expected:

```text
PASS
```

- [ ] **Step 2: TypeScript build**

```powershell
rtk pwsh -NoProfile -Command "npx tsc -b --pretty false"
```

Expected:

```text
退出码 0
```

- [ ] **Step 3: CLI compile**

```powershell
rtk pwsh -NoProfile -Command "npm run compile"
```

Expected:

```text
退出码 0
```

## Task 7: 真实项目验收边界

P7 验证只能在干净 baseline 下做；当前已有大量 `.meta` diff 的现场不能直接作为修复验收。

- [ ] **Step 1: 准备干净 baseline**

确认 P7 工作区 tracked `.meta` 没有既有 uuid-only diff，或复制一份干净项目用于验证。不得在运行中的 preview 进程上做 destructive cleanup。

- [ ] **Step 2: 启动修复后的 CLI**

使用本仓库编译后的 `dist/cli.js` 启动 `preview --runtime --watch-assets`。保持日志路径、端口和项目路径可记录。

- [ ] **Step 3: 模拟真实事件**

用正式 fixture 或干净 P7 复制项目触发批量资源 / `.meta` 变更；如需模拟 8.3 alias，使用测试脚本通过 short path 写入资源，但不得把 D 盘临时目录当作验收 fixture。

- [ ] **Step 4: 验收结果**

必须同时满足：

- runtime log 不再出现 `db://assets/RESOUR~1` dirty target。
- bounded canonicalization log 能显示 short path 被映射到 `db://assets/resources/...`。
- `git diff -- '*.meta'` 不再新增 uuid-only rewrite。
- refresh 仍保持 dirty-set 增量，不出现无条件 `db://assets` root refresh。

## 回填规则

实现完成并通过 Task 6 与 Task 7 后：

- 更新 `docs/dev/runtime-preview/facts/p7-watch-assets-short-path-meta-uuid-20260707.md`，记录实现 commit、测试命令、P7/fixture 验收结果。
- 更新 `docs/dev/runtime-preview/issues.md`：若真实项目或正式 fixture 验收完成，把 `RP-ISSUE-035` 标为 `fixed`；若只完成 unit/focused tests，最多标为 `in-progress`，不得标 `fixed`。

## 风险和边界

- 如果 `fs.realpathSync.native()` 在某些 Windows 网络盘 / junction / symlink 场景返回不可用路径，canonicalizer 必须 fail-soft 并拒绝 assetsRoot 外路径，不能把路径误归到项目外。
- 如果 canonicalization cache 引入 stale directory realpath，风险集中在目录 rename/delete；测试必须覆盖 missing path 的最近存在祖先逻辑，避免缓存旧目录导致错误 target。
- 如果后续发现 AssetDB 自身也会通过其他入口接收 short path，应另开 AssetDB 层修复计划；本计划只修复 runtime preview `--watch-assets` 和 explicit refresh 的入口链路。
