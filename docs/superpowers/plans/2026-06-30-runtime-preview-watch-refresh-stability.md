# Runtime Preview Watch Refresh Stability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 第一轮补齐 `RP-ISSUE-031` 的可定位性、PackerDriver 状态恢复、启动窗口 dirty contract 和 ready 前 route contract；只有 P7 真实项目 dirty set 验收通过且原始 hang 不再复现或可定位到具体 QuickPack 阶段后，才能关闭 issue。

**Architecture:** 先补可定位的 QuickPack / PackerDriver 阶段诊断，再修 PackerDriver build 串行化与 `try/finally` 状态恢复，随后为 watcher 启动窗口引入 baseline diff，并给 runtime preview route 增加明确 ready gate。`OPTIMIZE_ENTRY_SOURCE_COMPILATION` 不在第一轮直接改默认值，只做开关化评估与 parity 验收，避免用性能猜测改变 production 语义。

**Tech Stack:** TypeScript, Vitest, Express runtime preview server, `@parcel/watcher`, `@cocos/creator-programming-quick-pack`, Cocos AssetDB / scripting pipeline。

---

## 背景和边界

关联 issue：

- `docs/dev/runtime-preview/issues.md`：`RP-ISSUE-031`
- `docs/dev/runtime-preview/facts/watch-refresh-hang-and-startup-gap-20260629.md`

必须遵守：

- 处理测试、验收、诊断脚本前先读 `docs/dev/testing-spec.md` 和 `docs/dev/runtime-preview/testing-spec.md`。
- 真实项目最终验收必须使用 `D:\ps_copy\p7\trunk\GameClient\Client-fight-roguelike-migration`。
- 不能用硬超时作为主要修复。超时只能用于诊断、测试 fail gate 或用户可见错误边界，不能中断 QuickPack / AssetDB 写产物后继续假装成功。
- 不把 `COCOS_CLI_TEST_*` 作为 production 默认行为。
- 不默认清理 project `temp/programming` 或 source `.meta`。
- 第一轮不实现 “runtime preview dirty refresh 只 build preview target”。P7 原始卡住发生在 `Target(editor)`，但跳过 editor target 可能影响 Editor executor、depsGraph 和现有 scripting contract；该方向只记录为后续独立设计。

## 文件结构

### Production 代码

- Modify: `src/core/scripting/packer-driver/index.ts`
  - 负责 PackerDriver build 串行化、`try/finally` 状态恢复、build iteration / target / QuickPack 阶段日志。
- Modify: `src/core/scripting/index.ts`
  - 如需要，暴露 preview-only build 或更明确的 `waitForIdle` 状态；第一轮优先不改 public API。
- Modify: `src/runtime-preview/watch/runtime-asset-dirty-store.ts`
  - 扩展 dirty store，支持 baseline diff 注入的 synthetic dirty entries。
- Modify: `src/runtime-preview/watch/runtime-asset-change-watcher.ts`
  - 在 watcher start 时可选执行 startup baseline diff，记录 missed changes。
- Modify: `src/runtime-preview/server/runtime-preview-server.ts`
  - 增加 ready gate 状态，区分 server listen、settings ready、watcher ready、preview ready。
- Modify: `src/core/launcher.ts`
  - 维护 runtime preview lifecycle 状态，确保 `preview:ready` 前 route 行为可预测。
- No change by default: `src/commands/preview.ts`
  - 第一轮不新增 CLI 参数。若实现阶段证明必须增加诊断开关，只能新增 opt-in 参数，例如 `--runtime-preview-diagnostics`，不能改变默认行为。

### 测试和诊断

- Modify: `vitests/suites/runtime-preview/runtime-preview-express-server.test.ts`
  - 覆盖 ready gate、refresh endpoint、reload route 的 pre-ready 行为。
- Modify: `vitests/suites/runtime-preview/launcher-runtime-preview.test.ts`
  - 覆盖 watcher start 时机、baseline diff 和 `preview:ready` 顺序。
- Modify: `vitests/suites/runtime-preview/runtime-refresh-coordinator.test.ts`
  - 如 dirty-store contract 变化，补充 dirty-set 行为回归。
- Create: `vitests/suites/runtime-preview/packer-driver-build-state.test.ts`
  - 覆盖 build 串行化、异常后状态恢复、target build 顺序日志。
- Modify: `vitests/scripts/runtime-preview-feature-c-watch-refresh-performance.mjs`
  - 保留 `--probe-kind ts`，记录诊断字段。
- Create: `vitests/scripts/runtime-preview-p7-watch-refresh-diagnostics.mjs`
  - 专门验收 P7 dirty set 和卡住阶段日志，不作为通用 fixture。

### 文档

- Modify: `docs/dev/runtime-preview/issues.md`
  - 完成后回填 `RP-ISSUE-031` 状态和验收入口。
- Modify: `docs/dev/runtime-preview/facts/watch-refresh-hang-and-startup-gap-20260629.md`
  - 追加每轮验证事实，不覆盖原始证据。
- Modify: `docs/dev/runtime-preview/acceptance/matrix.md`
  - 增加或更新 watch refresh stability 相关验收项。

## Task 1: QuickPack / PackerDriver 阶段诊断

**Files:**

- Modify: `src/core/scripting/packer-driver/index.ts`
- Test: `vitests/suites/runtime-preview/packer-driver-build-state.test.ts`

- [ ] **Step 1: 写失败测试，要求 target build 日志包含阶段边界**

在 `vitests/suites/runtime-preview/packer-driver-build-state.test.ts` 新建测试。测试用 fake target，不依赖真实 Cocos 项目：

```ts
import { describe, expect, it, vi } from 'vitest';

describe('PackerDriver build diagnostics', () => {
  it('logs target build start, done and error boundaries', async () => {
    const lines: string[] = [];
    const logger = {
      clear: vi.fn(),
      debug: vi.fn((line: string) => lines.push(line)),
      error: vi.fn((line: string) => lines.push(line)),
      warn: vi.fn((line: string) => lines.push(line)),
    };

    // 使用本任务新增的 test helper 创建最小 PackerDriver。
    const driver = createPackerDriverForTest({
      logger,
      targets: {
        editor: createFakePackTarget('editor', { depsGraph: {} }),
        preview: createFakePackTarget('preview', { depsGraph: {} }),
      },
    });

    await driver.build([]);

    expect(lines.join('\n')).toContain('Target(editor) build started.');
    expect(lines.join('\n')).toContain('Target(editor) ends');
    expect(lines.join('\n')).toContain('Target(preview) build started.');
    expect(lines.join('\n')).toContain('Target(preview) ends');
  });
});
```

Expected：测试先失败，因为当前没有可注入 fake target 的 test helper，且阶段日志不完整。

- [ ] **Step 2: 增加最小 test helper，不改变 production 默认行为**

在 `src/core/scripting/packer-driver/index.ts` 中新增 internal factory，只在测试中使用。helper 名称固定为 `createPackerDriverForTest`，不要再引入其它别名。示例接口：

```ts
export function createPackerDriverForTest(input: {
    logger: PackerDriverLogger;
    targets: Record<TargetName, PackTarget>;
    tsBuilder?: TypeScriptConfigBuilder;
    statsQuery?: StatsQuery;
    options?: {
        optimizeEntrySourceCompilation?: boolean;
    };
}): PackerDriver {
    return new PackerDriver(
        input.tsBuilder ?? createNoopTypeScriptConfigBuilderForTest(),
        input.targets,
        input.statsQuery ?? createNoopStatsQueryForTest(),
        input.logger,
    );
}
```

如果 `PackerDriver` constructor private 导致 TypeScript 不允许外部调用，factory 必须定义在同文件内；不要把 constructor 改成 public。

该 factory 是 test-only API。导出时必须加注释：

```ts
// Test-only factory. Do not use from production runtime paths.
```

- [ ] **Step 3: 给 target build 增加结构化阶段日志**

在 `_startBuild()` target loop 中保证每个 target 都有：

```ts
this._logger.debug(`Target(${target.name}) build started.`);
const targetStartedAt = performance.now();
try {
    const buildResult = await target.build();
    this._logger.debug(`Target(${target.name}) ends, cost: ${performance.now() - targetStartedAt}ms.`);
    // 原有 buildResult 处理保持不变
} catch (error) {
    this._logger.error(`Target(${target.name}) build failed, cost: ${performance.now() - targetStartedAt}ms. ${getErrorMessage(error)}`);
    throw error;
}
```

如果 `PackTarget` 当前没有 public `name`，不要扩大接口；target loop 改为 `for (const [targetName, target] of Object.entries(this._targets))` 并使用 `targetName`。

- [ ] **Step 4: QuickPack 阶段 instrumentation 只做 debug log，不修改 node_modules**

保留现有 debug log 风格，补齐这些阶段：

- `QuickPack(<target>) build:start`
- `QuickPack(<target>) build:returned`
- `QuickPack(<target>) instantiate:start`
- `QuickPack(<target>) instantiate:done`
- `QuickPack(<target>) setEntryChunks:start`
- `QuickPack(<target>) setEntryChunks:done`
- `QuickPack(<target>) persistTempFiles:start`
- `QuickPack(<target>) persistTempFiles:done`
- `QuickPack(<target>) renameTempFiles:start`
- `QuickPack(<target>) renameTempFiles:done`
- `QuickPack(<target>) depsGraph:start`
- `QuickPack(<target>) depsGraph:done`
- `QuickPack(<target>) lock:start`
- `QuickPack(<target>) lock:done`
- `QuickPack(<target>) unlock:start`
- `QuickPack(<target>) unlock:done`

注意：不修改 `node_modules/@cocos/creator-programming-quick-pack`。通过 wrapper 包装 QuickPack instance 的 private 方法和内部对象：

- `_instantiateAll`
- `_chunkWriter.setEntryChunks`
- `_chunkWriter.persistToTempFiles`
- `_chunkWriter.renameTempFiles`
- `_getDepsGraphFromModuleRecords`
- `_middleware.lock`

`proper-lockfile.lock()` 返回的 release function 不是 `middleware.unlock()`，因此要包装 `middleware.lock()` 的返回值：

```ts
const originalLock = middleware.lock.bind(middleware);
middleware.lock = async (...args: unknown[]) => {
    logger.debug(`QuickPack(${targetName}) lock:start`);
    const startedAt = performance.now();
    const release = await originalLock(...args as []);
    logger.debug(`QuickPack(${targetName}) lock:done cost=${performance.now() - startedAt}ms`);
    return async () => {
        logger.debug(`QuickPack(${targetName}) unlock:start`);
        const unlockStartedAt = performance.now();
        await release();
        logger.debug(`QuickPack(${targetName}) unlock:done cost=${performance.now() - unlockStartedAt}ms`);
    };
};
```

QuickPack 的 `save()` 是 `build()` 内部局部函数，无法不改包直接包住；本任务用 `persistTempFiles` 与 `renameTempFiles` 作为 save 子阶段定位。如果再次卡住，日志至少能区分 instantiate、setEntryChunks、persist、rename、depsGraph、unlock。

- [ ] **Step 5: 运行 focused 测试**

Run:

```powershell
npm --prefix vitests run test -- suites/runtime-preview/packer-driver-build-state.test.ts
```

Expected：新增测试通过。

## Task 2: PackerDriver build 串行化与状态恢复

**Files:**

- Modify: `src/core/scripting/packer-driver/index.ts`
- Test: `vitests/suites/runtime-preview/packer-driver-build-state.test.ts`

- [ ] **Step 1: 写失败测试，两个并发 build 必须串行执行**

新增测试：

```ts
it('serializes concurrent build requests and consumes each request changes in its own iteration', async () => {
  const order: string[] = [];
  const appliedChanges: string[][] = [];
  let releaseFirst!: () => void;
  const firstBuildBlocker = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });

  const target = createFakePackTarget('preview', {
    async applyAssetChanges(changes) {
      appliedChanges.push(changes.map((change) => change.filePath));
    },
    async build() {
      order.push('build:start');
      if (order.length === 1) {
        await firstBuildBlocker;
      }
      order.push('build:end');
      return { depsGraph: {} };
    },
  });
  const driver = createPackerDriverForTest({ targets: { preview: target } });

  const first = driver.build([{ type: 'change', filePath: 'a.ts', url: 'db://assets/a.ts' } as any]);
  const second = driver.build([{ type: 'change', filePath: 'b.ts', url: 'db://assets/b.ts' } as any]);

  await Promise.resolve();
  releaseFirst();
  await Promise.all([first, second]);

  expect(order).toEqual(['build:start', 'build:end', 'build:start', 'build:end']);
  expect(appliedChanges).toEqual([['a.ts'], ['b.ts']]);
});
```

Expected：当前实现可能重入或状态不可预测，测试先失败。

- [ ] **Step 2: 写失败测试，target throw 后 busy 和 taskId 必须恢复**

```ts
it('resets busy state and task id when target build throws', async () => {
  const driver = createPackerDriverForTest({
    targets: {
      preview: createFakePackTarget('preview', {
        async build() {
          throw new Error('simulated build failure');
        },
      }),
    },
  });

  await expect(driver.build([], 'task-a')).rejects.toThrow('simulated build failure');
  expect(driver.busy()).toBe(false);
  expect(driver.getCurrentTaskId()).toBeNull();

  await expect(driver.build([], 'task-b')).rejects.toThrow('simulated build failure');
  expect(driver.getCurrentTaskId()).toBeNull();
});
```

- [ ] **Step 3: 实现 `_buildChain` 串行队列，串行边界必须包住变更收集**

在 `PackerDriver` 增加字段：

```ts
private _buildChain: Promise<void> = Promise.resolve();
```

当前 `build()` 在调用 `_startBuild()` 前会把 `changeInfos` 和 `AssetDbInterop` pending changes 合并到共享 `_assetChangeQueue`。串行化不能只包 `_startBuild()`，否则并发 build 仍可能在队列边界外合并变更。

把现有 `build()` 主体拆成 private method：

```ts
private async _runBuildRequest(changeInfos?: AssetChangeInfo[], taskId?: string): Promise<void> {
    const logger = this._logger;

    logger.debug('Pulling asset-db.');

    const t1 = performance.now();
    if (changeInfos && changeInfos.length > 0) {
        changeInfos.forEach(changeInfo => {
            this._assetDbInterop.onAssetChange(changeInfo);
        });
    }
    const pendingChanges = this._assetDbInterop.getAssetChangeQueue();
    if (pendingChanges.length > 0) {
        this._assetChangeQueue.push(...pendingChanges);
        this._assetDbInterop.resetAssetChangeQueue();
    }
    const t2 = performance.now();

    logger.debug(`Fetch asset-db cost: ${t2 - t1}ms.`);

    await this._startBuild(taskId);
}
```

`build()` 只负责排队：

```ts
const previous = this._buildChain.catch(() => undefined);
const current = previous.then(() => this._runBuildRequest(changeInfos, taskId));
this._buildChain = current.catch(() => undefined);
await current;
```

这样当前 build 的错误仍会返回给调用方，但不会破坏后续队列。

- [ ] **Step 4: `_startBuild()` 使用 `try/finally` 恢复状态**

把 `_building = false`、`_currentTaskId = null`、`eventEmitter.emit('compiled', 'project')` 放入 `finally`。示例结构：

```ts
this._building = true;
this._currentTaskId = taskId || null;
eventEmitter.emit('compile-start', 'project', taskId);
let err: Error | null = null;
try {
    // 原有 build 主体
} finally {
    this._building = false;
    this._currentTaskId = null;
    eventEmitter.emit('compiled', 'project');
}
if (err) {
    throw err;
}
```

如果 `beforeEditorBuildDelegate.dispatch()` 抛错，也必须进入 `finally`。

- [ ] **Step 5: 运行 focused 测试和 TypeScript 编译检查**

Run:

```powershell
npm --prefix vitests run test -- suites/runtime-preview/packer-driver-build-state.test.ts
npx tsc -b --pretty false
```

Expected：测试通过，TypeScript 通过。结论必须说明 `tsc -b` 不代表 `dist` 已构建。

## Task 3: watcher 启动窗口 baseline diff

**Files:**

- Modify: `src/runtime-preview/watch/runtime-asset-dirty-store.ts`
- Modify: `src/runtime-preview/watch/runtime-asset-change-watcher.ts`
- Modify: `src/core/launcher.ts`
- Test: `vitests/suites/runtime-preview/launcher-runtime-preview.test.ts`

- [ ] **Step 1: 写失败测试，watcher start 前修改的 asset 会进入 dirty-set**

在 `launcher-runtime-preview.test.ts` 中增加测试。使用 fake watcher factory，并模拟：

1. 创建 server 前记录 assets baseline。
2. initial `getPreviewSettings()` / script sync 完成。
3. watcher start 前外部修改 non-meta source asset。
4. `startAssetWatcher()` 执行 baseline diff。
5. reload refresh drain dirty-set 时能看到该 target。

断言：

```ts
expect(dirtyStore.peekDirtyTargets()).toContain('db://assets/scripts/damage_system.ts');
```

- [ ] **Step 1b: 写负向测试，启动期 `.meta` only diff 不进入 dirty-set**

新增测试：

```ts
it('does not record startup baseline meta-only changes as dirty targets', async () => {
  const dirtyStore = createRuntimeAssetDirtyStore({ projectRoot });
  const watcher = createRuntimeAssetChangeWatcher({
    projectRoot,
    dirtyStore,
    subscribe: fakeSubscribe,
    startupSnapshot: snapshotBeforePrepare,
    snapshotFiles: async () => snapshotAfterPrepareWithOnlyMetaChanges,
  });

  await watcher.start();

  expect(dirtyStore.peekDirtyTargets()).toEqual([]);
  expect(watcher.getStatus().startupIgnoredMetaOnlyCount).toBeGreaterThan(0);
});
```

- [ ] **Step 2: 扩展 dirty store 支持 synthetic record**

在 `RuntimeAssetDirtyStore` 增加方法：

```ts
recordDirtyTarget(input: {
    target: string;
    eventType: RuntimeAssetWatchEventType;
    assetEventCount?: number;
    metaEventCount?: number;
}): void;
```

实现时复用现有 `targets` map，不绕过排序和 drain 逻辑。

- [ ] **Step 3: watcher start 支持 startup baseline**

在 `createRuntimeAssetChangeWatcher()` 增加可选参数：

```ts
startupSnapshot?: RuntimeAssetStartupSnapshot;
snapshotFiles?: (assetsRoot: string) => Promise<RuntimeAssetStartupSnapshot>;
```

`RuntimeAssetStartupSnapshot` 形态：

```ts
export interface RuntimeAssetStartupSnapshot {
    files: Map<string, { mtimeMs: number; size: number }>;
}
```

比较规则必须写死，避免把 AssetDB 启动期 `.meta` 写回污染 dirty-set：

- key 使用 assetsRoot 相对路径，统一 `/`。
- non-meta source file 新增或 mtime/size 改变：记录 `update`。
- non-meta source file 删除：记录 `delete`。
- `.meta` only 新增、修改、删除：不记录 dirty target，只记录 `startupIgnoredMetaOnlyCount` 和 sample。
- 同一 source asset 同时存在 non-meta source diff 和 `.meta` diff：按 source diff 记录一次 target，`.meta` diff 只增加诊断计数。
- `library/`、`temp/`、`profiles/` 不在 assetsRoot 下，不参与 snapshot。

- [ ] **Step 4: launcher 在 initial prepare 前后采样**

在 `Launcher.startRuntimePreview()` 中：

```ts
const startupSnapshotBeforePrepare = options.watchAssets
    ? await createRuntimeAssetStartupSnapshot(projectAssetsRoot)
    : undefined;
```

在 `server.startAssetWatcher()` 前把 snapshot 注入 watcher。若现有 server factory 初始化时必须知道 snapshot，则创建 server 前采样，watcher start 时再采一次进行 diff。

注意：不要把 AssetDB 启动期自己写出的 `.meta` 全量加入 dirty-set。baseline diff 第一轮只把 non-meta source asset diff 转为 synthetic dirty；meta-only diff 只记录诊断，不触发 refresh。

- [ ] **Step 5: 测试**

Run:

```powershell
npm --prefix vitests run test -- suites/runtime-preview/launcher-runtime-preview.test.ts
npm --prefix vitests run test -- suites/runtime-preview/runtime-refresh-coordinator.test.ts
```

Expected：watcher 启动窗口测试通过，现有 dirty-set refresh 行为不回退为 root refresh。

## Task 4: runtime preview ready gate

**Files:**

- Modify: `src/runtime-preview/server/runtime-preview-server.ts`
- Modify: `src/core/launcher.ts`
- Test: `vitests/suites/runtime-preview/runtime-preview-express-server.test.ts`
- Test: `vitests/suites/runtime-preview/launcher-runtime-preview.test.ts`

- [ ] **Step 1: 写失败测试，`preview:ready` 前 root reload 不进入 dirty refresh**

在 `runtime-preview-express-server.test.ts` 增加：

```ts
it('returns deterministic pre-ready response instead of dirty refresh before preview ready', async () => {
  const refresh = vi.fn();
  const server = await startRuntimePreviewServer({
    // 最小 context
    watchAssets: true,
    refreshOnReload: true,
    refreshCoordinator: { refresh },
    previewReady: false,
  } as any);

  const response = await fetch(server.url);
  expect(response.status).toBe(503);
  expect(await response.text()).toContain('Runtime preview is preparing');
  expect(refresh).not.toHaveBeenCalled();
});
```

如果不接受 root 返回 503，也可以返回 loading HTML；但必须固定语义，不能继续进入 dirty refresh。

本计划固定 contract：pre-ready route 返回 `503 text/plain`，body 包含 `Runtime preview is preparing`。不做 loading HTML，避免引入前端状态和缓存语义。

- [ ] **Step 1b: 写失败测试，pre-ready endpoint 和 settings 行为确定**

覆盖：

```ts
expect(await fetch(server.url + '/settings.js')).toMatchObject({ status: 503 });
expect(await fetch(server.url + '/__runtime-preview/refresh', { method: 'POST', body: '{}' })).toMatchObject({ status: 503 });
expect(await fetch(server.url + '/__runtime-preview/status')).toMatchObject({ status: 200 });
```

如果当前没有 `/__runtime-preview/status`，本任务新增最小 status endpoint：

```json
{
  "ready": false,
  "settingsReady": false,
  "assetWatcherReady": false,
  "artifactsInspected": false
}
```

- [ ] **Step 2: 引入 lifecycle state**

在 server options 中新增：

```ts
readiness?: {
    isReady(): boolean;
    describe(): {
        settingsReady: boolean;
        assetWatcherReady: boolean;
        artifactsInspected: boolean;
    };
};
```

默认无 `readiness` 时保持现有测试兼容，只有 Launcher runtime preview production 传入 ready state。

- [ ] **Step 3: route gate**

在 root `/`、`/settings.js`、`/__runtime-preview/refresh` 和需要 `prepareRuntimePreview()` 的 route 前检查：

```ts
if (options.readiness && !options.readiness.isReady()) {
    response.status(503).type('text/plain').send('Runtime preview is preparing. Reload after preview:ready.');
    return;
}
```

例外：health/status endpoint 必须允许 pre-ready 访问并返回 readiness 状态。

- [ ] **Step 4: launcher 维护状态**

在 `Launcher.startRuntimePreview()` 中维护：

```ts
const readiness = {
    settingsReady: false,
    assetWatcherReady: options.watchAssets !== true,
    artifactsInspected: false,
};
```

对应阶段完成后置 true。只有三者都 true 才输出 `preview:ready`。

新增 launcher test，断言状态转移：

```ts
expect(readiness.describe()).toEqual({
  settingsReady: false,
  assetWatcherReady: false,
  artifactsInspected: false,
});
await settingsProvider.getPreviewSettings();
expect(readiness.describe().settingsReady).toBe(true);
await server.startAssetWatcher();
expect(readiness.describe().assetWatcherReady).toBe(true);
await inspectRuntimePreviewProgrammingArtifacts();
expect(readiness.isReady()).toBe(true);
```

- [ ] **Step 5: active-output 顺序决策**

保持当前 `active-output` 可输出，但文档和日志必须明确它只是 server listen，不代表 ready。若要避免用户点击早访问，另起 issue 处理 URL 输出时机；本任务只保证早访问行为确定。

- [ ] **Step 6: 测试**

Run:

```powershell
npm --prefix vitests run test -- suites/runtime-preview/runtime-preview-express-server.test.ts
npm --prefix vitests run test -- suites/runtime-preview/launcher-runtime-preview.test.ts
```

Expected：pre-ready route 行为固定，ready 后现有 root / refresh 测试仍通过。

## Task 5: `OPTIMIZE_ENTRY_SOURCE_COMPILATION` 评估，不直接改默认

**Files:**

- Modify: `src/core/scripting/packer-driver/index.ts`
- Create: `vitests/suites/runtime-preview/packer-driver-entry-source-optimization.test.ts`
- Modify: `docs/dev/runtime-preview/facts/watch-refresh-hang-and-startup-gap-20260629.md`

- [ ] **Step 1: 写评估测试，覆盖 import list 不变时不更新 entry source**

新增测试只验证 opt-in 行为，不改变默认：

```ts
it('skips prerequisite entry source update when opt-in optimization sees unchanged import list', async () => {
  const target = createFakePackTarget('preview');
  const driver = createPackerDriverForTest({
    options: { optimizeEntrySourceCompilation: true },
    targets: { preview: target },
  });

  await driver.build([{ type: 'change', filePath: 'assets/a.ts', url: 'db://assets/a.ts' } as any]);
  await driver.build([{ type: 'change', filePath: 'assets/a.ts', url: 'db://assets/a.ts' } as any]);

  expect(target.updateEntrySourceCallCount).toBe(1);
});
```

- [ ] **Step 2: 保持 production 默认 false**

把常量收敛成 option，但默认保持 false：

```ts
const defaultOptimizeEntrySourceCompilation = false;
```

只允许测试或显式诊断路径 opt-in。不要在 `preview --runtime` 默认打开。

- [ ] **Step 3: parity 验收矩阵**

在事实文档追加必须验证的 case：

- 修改已有 `.ts`，import list 不变。
- 修改已有 `.ts`，新增 import。
- 删除 import。
- 新增 `.ts`。
- 删除 `.ts`。
- 修改 `.d.ts`。

每个 case 对比：

- `import-map.json`
- `main-record.json`
- `assembly-record.json`
- browser 实际加载是否成功
- `queryScriptDeps()` / `queryScriptUsers()` 是否符合预期

- [ ] **Step 4: 跑评估测试**

Run:

```powershell
npm --prefix vitests run test -- suites/runtime-preview/packer-driver-entry-source-optimization.test.ts
```

Expected：只证明 opt-in optimization 行为，不证明可以改 production 默认。

- [ ] **Step 4b: 补 opt-in 负向和边界测试**

新增测试覆盖：

```ts
it('updates prerequisite entry source when opt-in optimization sees a new import', async () => {
  // first build imports ["a"], second build imports ["a", "b"]
  // expect updateEntrySourceCallCount to be 2
});

it('updates prerequisite entry source when opt-in optimization sees a removed import', async () => {
  // first build imports ["a", "b"], second build imports ["a"]
  // expect updateEntrySourceCallCount to be 2
});

it('does not update prerequisite entry source for dts-only changes', async () => {
  // filePath endsWith ".d.ts"
  // expect applyAssetChanges receives empty nonDTSChanges
});
```

这些测试仍然只证明 opt-in 行为，不作为 production 默认改动依据。

## Task 6: P7 真实项目诊断和最终验收

**Files:**

- Create: `vitests/scripts/runtime-preview-p7-watch-refresh-diagnostics.mjs`
- Modify: `docs/dev/runtime-preview/facts/watch-refresh-hang-and-startup-gap-20260629.md`
- Modify: `docs/dev/runtime-preview/issues.md`

- [ ] **Step 1: 写 P7 专项诊断脚本**

脚本输入：

```powershell
node vitests\scripts\runtime-preview-p7-watch-refresh-diagnostics.mjs --project "D:\ps_copy\p7\trunk\GameClient\Client-fight-roguelike-migration" --port 20031
```

脚本行为：

- 清理 `COCOS_CLI_TEST_*` env。
- 启动 `node dist/cli.js preview --runtime --watch-assets --refresh-on-reload`。
- 等待 `preview:ready`。
- touch 原始 6 个 dirty files。
- 请求 root `/`。
- 请求 health/status。
- 收集 runtime preview log 和 packer-driver debug log。
- 输出 JSON summary。

- [ ] **Step 2: 明确 fail gate**

脚本必须在这些条件失败：

- `preview:ready` 未出现。
- root reload 超过诊断上限但没有阶段日志推进。
- packer-driver log 中出现 target build start 但没有对应 done/error，且 QuickPack 阶段无法定位。
- root reload 返回非 200/304/明确 503 pre-ready。

诊断上限只能让脚本失败并保留日志，不能让 production 继续执行“成功路径”。

- [ ] **Step 3: 构建 dist**

Run:

```powershell
npm run compile
```

Expected：compile 成功，`dist/cli.js` 更新。

- [ ] **Step 4: 跑 focused 和真实项目验收**

Run:

```powershell
npm --prefix vitests run test -- suites/runtime-preview/packer-driver-build-state.test.ts
npm --prefix vitests run test -- suites/runtime-preview/runtime-preview-express-server.test.ts
npm --prefix vitests run test -- suites/runtime-preview/launcher-runtime-preview.test.ts
node vitests\scripts\runtime-preview-p7-watch-refresh-diagnostics.mjs --project "D:\ps_copy\p7\trunk\GameClient\Client-fight-roguelike-migration" --port 20031
```

Expected：

- focused tests 通过。
- P7 reload 在可接受时间内完成；或者如果复现卡住，日志能定位到 `lock` / `instantiate` / `setEntryChunks` / `persistTempFiles` / `renameTempFiles` / `depsGraph` / `unlock` 中的具体阶段。

- [ ] **Step 5: 回填文档**

如果未复现卡住但风险修复已完成，`RP-ISSUE-031` 不能直接标 `fixed`；应写成：

```md
已完成 build 状态恢复、ready gate、watcher 启动窗口和阶段诊断；原始 P7 hang 未稳定复现，保留为后续观察，下一次复现时日志可定位 QuickPack 阶段。
```

只有同时满足这些条件才能改 `fixed`：

- P7 原始 dirty set 验收通过。
- 启动窗口测试通过。
- pre-ready route 测试通过。
- PackerDriver 串行化 / 状态恢复测试通过。
- QuickPack 阶段日志可定位。

## 总体验证命令

最低 focused 验证：

```powershell
npm --prefix vitests run test -- suites/runtime-preview/packer-driver-build-state.test.ts
npm --prefix vitests run test -- suites/runtime-preview/runtime-preview-express-server.test.ts
npm --prefix vitests run test -- suites/runtime-preview/launcher-runtime-preview.test.ts
npm --prefix vitests run test -- suites/runtime-preview/runtime-refresh-coordinator.test.ts
npx tsc -b --pretty false
```

使用 `dist/cli.js` 前必须：

```powershell
npm run compile
```

真实项目验收：

```powershell
Remove-Item Env:COCOS_CLI_TEST_PROJECT_ROOT -ErrorAction SilentlyContinue
Remove-Item Env:COCOS_CLI_TEST_ENGINE_ROOT -ErrorAction SilentlyContinue
Remove-Item Env:COCOS_CLI_TEST_EDITOR_LIBRARY_REF -ErrorAction SilentlyContinue
Remove-Item Env:COCOS_CLI_TEST_EDITOR_PROGRAMMING_REF -ErrorAction SilentlyContinue
node vitests\scripts\runtime-preview-p7-watch-refresh-diagnostics.mjs --project "D:\ps_copy\p7\trunk\GameClient\Client-fight-roguelike-migration" --port 20031
```

## 自检

- Spec coverage：覆盖 `RP-ISSUE-031` 中的卡住诊断、watcher 启动窗口、pre-ready route、PackerDriver 串行化、`OPTIMIZE_ENTRY_SOURCE_COMPILATION` 评估。
- Placeholder scan：未发现占位式任务描述。
- Type consistency：所有新增接口名称在同一任务内定义，后续任务只引用已定义的 `readiness`、`RuntimeAssetStartupSnapshot`、`recordDirtyTarget()`。
- 风险控制：不引入硬超时修复，不默认清 cache，不把 optimization 默认打开，不把低层测试等同于 P7 真实项目 fixed。
