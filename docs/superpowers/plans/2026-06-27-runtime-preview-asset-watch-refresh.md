# Runtime Preview Asset Watch Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 `preview --runtime` 增加 opt-in 资源文件监听，使用 `@parcel/watcher` 自动记录 `assets` 变更，并在 Refresh / reload 时只刷新 dirty targets，避免 feature-c 这类大项目每次触发 `db://assets` root refresh。

**Architecture:** 新增 runtime preview watcher 模块，负责启动跨平台 native watcher、过滤事件、把文件和 `.meta` 事件归一化为 AssetDB refresh target，并维护可 drain / requeue 的 dirty-set。现有 `RuntimeRefreshCoordinator` 接入 dirty provider：有显式 target 时沿用 target refresh；无 target 且 watcher 启用时刷新 dirty-set 或直接 skipped；无 watcher 时保留当前显式 root refresh 行为。`startRuntimePreviewServer()` 管理 watcher 生命周期，CLI 新增 `--watch-assets`，失败只记录日志和页面提示，不阻断 preview。

**Tech Stack:** TypeScript、Express、`@parcel/watcher` direct dependency fixed at `2.5.6`、Vitest、Playwright/browser runtime helper、Cocos `assetOperation.refreshAsset()`、现有 `scripting.waitForIdle()`。

---

## 前置事实与约束

- 先读并遵守 `AGENTS.md`、`docs/dev/testing-spec.md`、`docs/dev/runtime-preview/testing-spec.md`。
- 本计划对应 `docs/dev/runtime-preview/issues.md` 的 `RP-ISSUE-028`，并扩展 `RP-ISSUE-029` 的 refresh coordinator，不把手动输入路径作为主方案。
- `@parcel/watcher` 是跨平台 native watcher：Windows 使用 `ReadDirectoryChangesW`，macOS 使用 `FSEvents`，Linux 使用 `inotify`，并支持 Watchman。
- 当前 `assetDBManager.addTask()` 和 `AssetDB.refresh()` 有队列、lock、taskManager / waitQueue，可避免部分内部操作乱并发；但 AssetDB 不是 filesystem event journal。文件在 scan 后或 import 过程中继续变化时，不能只依赖 AssetDB 保证“本次 refresh 一定拿到最终状态”。
- watcher dirty-set 是 runtime preview 的外层收敛机制：AssetDB 负责处理单个 refresh target，dirty-set 负责捕获 refresh 过程中继续发生的文件变化，并通过 bounded multi-pass 在当前请求返回前尽量收敛。
- 本轮不实现 fallback watcher；`@parcel/watcher` 启动失败时只记录日志和页面提示，preview 正常运行。
- `--watch-assets` 默认关闭；`--refresh-on-reload` 仍默认关闭。
- 开启 `--watch-assets` 后，Refresh 按钮无 target 时刷新 dirty-set；dirty-set 为空时不做 root refresh。
- 同时开启 `--watch-assets --refresh-on-reload` 后，页面 reload 只检查并刷新 dirty-set；dirty-set 为空时 root `/` 不触发 AssetDB root scan。
- dirty-set refresh 是 bounded multi-pass：refresh 过程中 watcher 收到的新事件保留在 dirty store，并在当前请求返回前进入下一 pass 处理；默认最多 `3` pass，避免外部工具持续写文件导致 reload 无限等待。
- 如果达到 pass 上限后仍有 dirty targets，返回 `ok:false`，带 `pendingDirtyTargetCount` / `pendingSampleTargets` 并弹窗提示；不能静默返回成功，也不能 fallback 到 `db://assets` root refresh。
- 页面 reload 或 Refresh 按钮在 dirty-set refresh 进行中触发时，必须等待同一个 in-flight dirty-set promise；该 promise 包含 refresh 过程中新增 dirty 的 follow-up passes，而不是只等待第一批 batch。
- 显式开启 `--watch-assets` 但 watcher 启动失败或运行异常时，无 target refresh 返回 `ok:false` 并提示 watcher failure；不能退回 `db://assets` root refresh。
- 无 watcher 时，现有 `POST /__runtime-preview/refresh` 无 target 行为保持兼容：仍可显式 root refresh。
- 失败行为：HTTP 返回 `ok:false`、页面 toast、日志记录；root HTML 不能 500，不能清 scene，不能阻断 preview。
- 真实项目 feature-c 验收必须清理无关 `COCOS_CLI_TEST_*` 和 frozen reference env。
- feature-c source 变更验证只能创建受控临时目录 `assets/__cocos_cli_watch_probe__` 并清理；验证脚本必须记录变更前后 `git status`，不能留下 source `.meta` 或资源文件。

## 文件结构

Create:

- `src/runtime-preview/watch/runtime-asset-dirty-store.ts`：dirty target 归一化、dedupe、drain、requeue、状态类型。
- `src/runtime-preview/watch/runtime-asset-change-watcher.ts`：`@parcel/watcher` adapter、事件接入、生命周期和错误状态。
- `vitests/suites/runtime-preview/runtime-asset-dirty-store.test.ts`：dirty-store 单元测试。
- `vitests/suites/runtime-preview/runtime-asset-change-watcher.test.ts`：watcher adapter 注入测试，不依赖真实 native watcher。
- `vitests/scripts/runtime-preview-feature-c-watch-refresh-performance.mjs`：feature-c watcher 性能和受控变更验收脚本。
- `docs/dev/runtime-preview/facts/feature-c-watch-refresh-performance-20260627.md`：feature-c watcher 性能事实记录。

Modify:

- `package.json`、`package-lock.json`：新增 direct dependency `@parcel/watcher@2.5.6`。
- `src/commands/preview.ts`：新增 `--watch-assets` CLI 参数。
- `src/core/launcher.ts`：`startRuntimePreview()` 接收并传递 `watchAssets`。
- `src/runtime-preview/server/runtime-preview-server.ts`：启动/关闭 watcher，向 coordinator 和 HTML 注入 watcher 状态。
- `src/runtime-preview/refresh/runtime-refresh-coordinator.ts`：无 target 时优先 drain dirty-set，支持 multi-target refresh 结果、partial failure requeue、no-change skipped。
- `src/runtime-preview/server/runtime-refresh-entry-injection.ts`：显示 watcher failure / no-change refresh 提示。
- `src/runtime-preview/server/runtime-preview-routes.ts`：传递 refresh state，不改变 custom template 策略。
- `vitests/suites/runtime-preview/runtime-refresh-coordinator.test.ts`：新增 dirty-set 行为回归。
- `vitests/suites/runtime-preview/runtime-preview-express-server.test.ts`：新增 watcher lifecycle / reload no-root-refresh contract。
- `vitests/suites/runtime-preview/runtime-refresh-browser.test.ts`：新增 watcher failure toast / no-change toast。
- `vitests/suites/runtime-preview/cli-startup.test.ts`：新增 CLI 参数传递测试。
- `vitests/suites/runtime-preview/launcher-runtime-preview.test.ts`：新增 launcher wiring 测试。
- `docs/dev/runtime-preview/issues.md`：回填 `RP-ISSUE-028` 的计划、实现和验收入口。

---

### Task 1: Add `@parcel/watcher` direct dependency

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: 安装依赖**

Run:

```powershell
rtk pwsh -NoProfile -Command "npm install @parcel/watcher@2.5.6 --save-exact"
```

Expected:

- `package.json` 的 `dependencies` 包含 `"@parcel/watcher": "2.5.6"`。
- `package-lock.json` 包含 `@parcel/watcher` 和当前平台 optional package，例如 `@parcel/watcher-win32-x64`。
- 不修改 unrelated dependency version。

- [ ] **Step 2: 验证 package 可加载**

Run:

```powershell
rtk pwsh -NoProfile -Command "node -e \"require('@parcel/watcher'); console.log('parcel-watcher-ok')\""
```

Expected:

```text
parcel-watcher-ok
```

- [ ] **Step 3: Commit**

```powershell
rtk pwsh -NoProfile -Command "git add package.json package-lock.json; git commit -m 'chore(runtime-preview): add parcel watcher dependency'"
```

---

### Task 2: Dirty target store

**Files:**
- Create: `src/runtime-preview/watch/runtime-asset-dirty-store.ts`
- Test: `vitests/suites/runtime-preview/runtime-asset-dirty-store.test.ts`

- [ ] **Step 1: 写失败测试**

Create `vitests/suites/runtime-preview/runtime-asset-dirty-store.test.ts`:

```ts
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
```

- [ ] **Step 2: 运行失败测试**

Run:

```powershell
rtk pwsh -NoProfile -Command "npm --prefix vitests run test -- suites/runtime-preview/runtime-asset-dirty-store.test.ts"
```

Expected: FAIL，提示 `@runtime-preview/watch/runtime-asset-dirty-store` 不存在。

- [ ] **Step 3: 实现 dirty store**

Create `src/runtime-preview/watch/runtime-asset-dirty-store.ts`:

```ts
import { isAbsolute, relative, resolve } from 'node:path';

export type RuntimeAssetWatchEventType = 'create' | 'update' | 'delete';

export interface RuntimeAssetWatchEvent {
    type: RuntimeAssetWatchEventType;
    path: string;
}

export interface RuntimeAssetDirtyBatch {
    targets: string[];
    entries: Array<{ target: string; eventTypes: RuntimeAssetWatchEventType[] }>;
    eventCount: number;
    drainedAt: number;
}

export interface RuntimeAssetDirtyStore {
    recordFileEvent(event: RuntimeAssetWatchEvent): void;
    drainDirtyTargets(): RuntimeAssetDirtyBatch;
    requeueTargets(targets: string[]): void;
    peekDirtyTargets(limit?: number): string[];
    getDirtyTargetCount(): number;
    getEventCount(): number;
}

function isInsideOrSameRoot(filePath: string, root: string): boolean {
    const rel = relative(resolve(root), resolve(filePath));
    return !rel || (!rel.startsWith('..') && !isAbsolute(rel));
}

function toDbPath(path: string): string {
    return path.replace(/\\/g, '/').replace(/^\/+/, '');
}

function sourcePathForAssetEvent(path: string): string {
    return path.endsWith('.meta') ? path.slice(0, -'.meta'.length) : path;
}

function compareTargets(left: string, right: string): number {
    return left.localeCompare(right);
}

export function createRuntimeAssetDirtyStore(options: {
    projectRoot: string;
    now?: () => number;
}): RuntimeAssetDirtyStore {
    const now = options.now ?? Date.now;
    const assetsRoot = resolve(options.projectRoot, 'assets');
    const targets = new Map<string, Set<RuntimeAssetWatchEventType>>();
    let eventCount = 0;

    const normalizeTarget = (filePath: string): string | null => {
        const sourcePath = resolve(sourcePathForAssetEvent(filePath));
        if (!isInsideOrSameRoot(sourcePath, assetsRoot)) {
            return null;
        }
        const relativePath = toDbPath(relative(assetsRoot, sourcePath));
        return relativePath ? `db://assets/${relativePath}` : 'db://assets';
    };

    return {
        recordFileEvent(event: RuntimeAssetWatchEvent): void {
            const target = normalizeTarget(event.path);
            if (!target) {
                return;
            }
            eventCount += 1;
            const eventTypes = targets.get(target) ?? new Set<RuntimeAssetWatchEventType>();
            eventTypes.add(event.type);
            targets.set(target, eventTypes);
        },
        drainDirtyTargets(): RuntimeAssetDirtyBatch {
            const drainedEntries = Array.from(targets.entries())
                .map(([target, eventTypes]) => ({
                    target,
                    eventTypes: Array.from(eventTypes).sort() as RuntimeAssetWatchEventType[],
                }))
                .sort((left, right) => compareTargets(left.target, right.target));
            const drainedTargets = drainedEntries.map((entry) => entry.target);
            const drainedEventCount = eventCount;
            targets.clear();
            eventCount = 0;
            return {
                targets: drainedTargets,
                entries: drainedEntries,
                eventCount: drainedEventCount,
                drainedAt: now(),
            };
        },
        requeueTargets(failedTargets: string[]): void {
            for (const target of failedTargets) {
                if (target === 'db://assets' || target.startsWith('db://assets/')) {
                    const eventTypes = targets.get(target) ?? new Set<RuntimeAssetWatchEventType>();
                    eventTypes.add('update');
                    targets.set(target, eventTypes);
                }
            }
        },
        peekDirtyTargets(limit = 5): string[] {
            return Array.from(targets.keys()).sort(compareTargets).slice(0, limit);
        },
        getDirtyTargetCount(): number {
            return targets.size;
        },
        getEventCount(): number {
            return eventCount;
        },
    };
}
```

- [ ] **Step 4: 运行测试**

Run:

```powershell
rtk pwsh -NoProfile -Command "npm --prefix vitests run test -- suites/runtime-preview/runtime-asset-dirty-store.test.ts"
```

Expected: PASS。

- [ ] **Step 5: Commit**

```powershell
rtk pwsh -NoProfile -Command "git add src/runtime-preview/watch/runtime-asset-dirty-store.ts vitests/suites/runtime-preview/runtime-asset-dirty-store.test.ts; git commit -m 'feat(runtime-preview): track dirty asset targets'"
```

---

### Task 3: Asset change watcher wrapper

**Files:**
- Create: `src/runtime-preview/watch/runtime-asset-change-watcher.ts`
- Test: `vitests/suites/runtime-preview/runtime-asset-change-watcher.test.ts`

- [ ] **Step 1: 写失败测试**

Create `vitests/suites/runtime-preview/runtime-asset-change-watcher.test.ts`:

```ts
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createRuntimeAssetChangeWatcher } from '@runtime-preview/watch/runtime-asset-change-watcher';
import { createRuntimeAssetDirtyStore } from '@runtime-preview/watch/runtime-asset-dirty-store';

describe('runtime asset change watcher', () => {
  it('subscribes to project assets root and records events', async () => {
    const projectRoot = 'E:/project';
    const store = createRuntimeAssetDirtyStore({ projectRoot });
    let callback: ((error: Error | null, events: Array<{ type: 'create' | 'update' | 'delete'; path: string }>) => void) | undefined;
    const subscribe = vi.fn(async (_root, cb) => {
      callback = cb;
      return { unsubscribe: vi.fn(async () => undefined) };
    });
    const watcher = createRuntimeAssetChangeWatcher({
      projectRoot,
      dirtyStore: store,
      subscribe,
    });

    await watcher.start();
    expect(subscribe).toHaveBeenCalledWith(
      join(projectRoot, 'assets'),
      expect.any(Function),
      expect.objectContaining({ ignore: expect.any(Array) }),
    );

    callback?.(null, [{ type: 'update', path: join(projectRoot, 'assets', 'a.json') }]);
    expect(watcher.getStatus().running).toBe(true);
    expect(watcher.getStatus().sampleTargets).toEqual(['db://assets/a.json']);
    expect(store.drainDirtyTargets().targets).toEqual(['db://assets/a.json']);
  });

  it('records start failure without throwing when failSoft is enabled', async () => {
    const store = createRuntimeAssetDirtyStore({ projectRoot: 'E:/project' });
    const watcher = createRuntimeAssetChangeWatcher({
      projectRoot: 'E:/project',
      dirtyStore: store,
      subscribe: async () => { throw new Error('native watcher unavailable'); },
      failSoft: true,
    });
    await watcher.start();
    expect(watcher.getStatus()).toMatchObject({
      running: false,
      error: 'native watcher unavailable',
    });
  });

  it('unsubscribes on stop', async () => {
    const unsubscribe = vi.fn(async () => undefined);
    const store = createRuntimeAssetDirtyStore({ projectRoot: 'E:/project' });
    const watcher = createRuntimeAssetChangeWatcher({
      projectRoot: 'E:/project',
      dirtyStore: store,
      subscribe: async () => ({ unsubscribe }),
    });
    await watcher.start();
    await watcher.stop();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(watcher.getStatus().running).toBe(false);
  });
});
```

- [ ] **Step 2: 运行失败测试**

Run:

```powershell
rtk pwsh -NoProfile -Command "npm --prefix vitests run test -- suites/runtime-preview/runtime-asset-change-watcher.test.ts"
```

Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现 watcher wrapper**

Create `src/runtime-preview/watch/runtime-asset-change-watcher.ts`:

```ts
import { join } from 'node:path';
import * as parcelWatcher from '@parcel/watcher';
import type { RuntimeAssetDirtyStore, RuntimeAssetWatchEvent } from './runtime-asset-dirty-store';

type ParcelEvent = { type: 'create' | 'update' | 'delete'; path: string };
type ParcelSubscription = { unsubscribe: () => Promise<void> | void };
type Subscribe = (
    root: string,
    callback: (error: Error | null, events: ParcelEvent[]) => void,
    options?: { ignore?: string[] },
) => Promise<ParcelSubscription>;

export interface RuntimeAssetWatcherStatus {
    enabled: boolean;
    running: boolean;
    assetsRoot: string;
    error?: string;
    eventCount: number;
    dirtyTargetCount: number;
    sampleTargets: string[];
}

export interface RuntimeAssetChangeWatcher {
    start(): Promise<void>;
    stop(): Promise<void>;
    getStatus(): RuntimeAssetWatcherStatus;
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export function createRuntimeAssetChangeWatcher(options: {
    projectRoot: string;
    dirtyStore: RuntimeAssetDirtyStore;
    subscribe?: Subscribe;
    failSoft?: boolean;
    logger?: { write: (line: string) => Promise<void> | void };
}): RuntimeAssetChangeWatcher {
    const assetsRoot = join(options.projectRoot, 'assets');
    const subscribe = options.subscribe ?? parcelWatcher.subscribe;
    const failSoft = options.failSoft ?? true;
    let subscription: ParcelSubscription | null = null;
    let error: string | undefined;

    const writeLog = async (line: string): Promise<void> => {
        await options.logger?.write(`runtime-asset-watch ${line}`);
    };

    const status = (): RuntimeAssetWatcherStatus => ({
        enabled: true,
        running: !!subscription && !error,
        assetsRoot,
        error,
        eventCount: options.dirtyStore.getEventCount(),
        dirtyTargetCount: options.dirtyStore.getDirtyTargetCount(),
        sampleTargets: options.dirtyStore.peekDirtyTargets(5),
    });

    return {
        async start(): Promise<void> {
            if (subscription) {
                return;
            }
            try {
                subscription = await subscribe(
                    assetsRoot,
                    (callbackError, events) => {
                        if (callbackError) {
                            error = callbackError.message;
                            void writeLog(`event-error ${error}`);
                            return;
                        }
                        for (const event of events) {
                            options.dirtyStore.recordFileEvent(event as RuntimeAssetWatchEvent);
                        }
                        const sampleTargets = options.dirtyStore.peekDirtyTargets(5).join(',');
                        void writeLog(`events count=${events.length} dirtyTargets=${options.dirtyStore.getDirtyTargetCount()} sample=${sampleTargets}`);
                    },
                    {
                        ignore: [
                            '**/.DS_Store',
                            '**/Thumbs.db',
                        ],
                    },
                );
                error = undefined;
                await writeLog(`start assetsRoot=${assetsRoot}`);
            } catch (startError) {
                error = getErrorMessage(startError);
                await writeLog(`start-error ${error}`);
                if (!failSoft) {
                    throw startError;
                }
            }
        },
        async stop(): Promise<void> {
            const active = subscription;
            subscription = null;
            if (active) {
                await active.unsubscribe();
                await writeLog('stop');
            }
        },
        getStatus: status,
    };
}
```

- [ ] **Step 4: 运行测试**

Run:

```powershell
rtk pwsh -NoProfile -Command "npm --prefix vitests run test -- suites/runtime-preview/runtime-asset-change-watcher.test.ts"
```

Expected: PASS。

- [ ] **Step 5: Commit**

```powershell
rtk pwsh -NoProfile -Command "git add src/runtime-preview/watch/runtime-asset-change-watcher.ts vitests/suites/runtime-preview/runtime-asset-change-watcher.test.ts; git commit -m 'feat(runtime-preview): add asset change watcher'"
```

---

### Task 4: Dirty-set refresh coordinator integration

**Files:**
- Modify: `src/runtime-preview/refresh/runtime-refresh-coordinator.ts`
- Test: `vitests/suites/runtime-preview/runtime-refresh-coordinator.test.ts`

- [ ] **Step 1: 写 coordinator 回归测试**

Append to `vitests/suites/runtime-preview/runtime-refresh-coordinator.test.ts`:

```ts
it('refreshes dirty targets instead of root when a dirty provider is available', async () => {
  const refreshTarget = vi.fn(async () => 1);
  const dirtyProvider = {
    drainDirtyTargets: vi.fn(() => ({
      targets: ['db://assets/a.json', 'db://assets/b.json'],
      entries: [
        { target: 'db://assets/a.json', eventTypes: ['update'] },
        { target: 'db://assets/b.json', eventTypes: ['update'] },
      ],
      eventCount: 3,
      drainedAt: 1000,
    })),
    requeueTargets: vi.fn(),
    getStatus: vi.fn(() => ({ enabled: true, running: true, assetsRoot: 'E:/project/assets', eventCount: 3, dirtyTargetCount: 2, sampleTargets: ['db://assets/a.json'] })),
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
      getStatus: () => ({ enabled: true, running: true, assetsRoot: 'E:/project/assets', eventCount: 0, dirtyTargetCount: 0, sampleTargets: [] }),
    },
  });
  const result = await coordinator.refresh({ reason: 'reload' });
  expect(result.ok).toBe(true);
  expect(result.scriptCompile.status).toBe('skipped');
  expect(result.target).toBe('dirty-set');
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
      getStatus: () => ({ enabled: true, running: true, assetsRoot: 'E:/project/assets', eventCount: 2, dirtyTargetCount: 2, sampleTargets: ['db://assets/good.json', 'db://assets/bad.json'] }),
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
  const coordinator = createRuntimeRefreshCoordinator({
    projectRoot: 'E:/project',
    refreshTarget: vi.fn(async () => {
      throw new Error('can not find asset db://assets/temp.json');
    }),
    waitForIdle,
    invalidateSettings,
    clearImportReplacement,
    dirtyProvider: {
      drainDirtyTargets: () => ({ targets: ['db://assets/temp.json'], entries: [{ target: 'db://assets/temp.json', eventTypes: ['create', 'delete'] }], eventCount: 2, drainedAt: 1000 }),
      requeueTargets,
      getStatus: () => ({ enabled: true, running: true, assetsRoot: 'E:/project/assets', eventCount: 2, dirtyTargetCount: 1, sampleTargets: ['db://assets/temp.json'] }),
    },
  });
  const result = await coordinator.refresh({ reason: 'reload' });
  expect(result.ok).toBe(true);
  expect(result.scriptCompile.status).toBe('skipped');
  expect(result.settledTargets).toEqual([{ target: 'db://assets/temp.json', error: 'can not find asset db://assets/temp.json' }]);
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
      getStatus: () => ({ enabled: true, running: false, assetsRoot: 'E:/project/assets', error: 'native watcher unavailable', eventCount: 0, dirtyTargetCount: 0, sampleTargets: [] }),
    },
  });
  const result = await coordinator.refresh({ reason: 'endpoint' });
  expect(result.ok).toBe(false);
  expect(result.error).toContain('native watcher unavailable');
  expect(refreshTarget).not.toHaveBeenCalled();
});

it('dedupes concurrent dirty-set refresh requests with one drain', async () => {
  let releaseRefresh: (() => void) | undefined;
  const refreshTarget = vi.fn(async () => {
    await new Promise<void>((resolve) => { releaseRefresh = resolve; });
    return 1;
  });
  const drainDirtyTargets = vi.fn(() => ({ targets: ['db://assets/a.json'], entries: [{ target: 'db://assets/a.json', eventTypes: ['update'] }], eventCount: 1, drainedAt: 1000 }));
  const coordinator = createRuntimeRefreshCoordinator({
    projectRoot: 'E:/project',
    refreshTarget,
    waitForIdle: vi.fn(async () => undefined),
    invalidateSettings: vi.fn(),
    clearImportReplacement: vi.fn(),
    dirtyProvider: {
      drainDirtyTargets,
      requeueTargets: vi.fn(),
      getStatus: () => ({ enabled: true, running: true, assetsRoot: 'E:/project/assets', eventCount: 1, dirtyTargetCount: 1, sampleTargets: ['db://assets/a.json'] }),
    },
  });
  const first = coordinator.refresh({ reason: 'reload' });
  const second = coordinator.refresh({ reason: 'endpoint' });
  releaseRefresh?.();
  await Promise.all([first, second]);
  expect(drainDirtyTargets).toHaveBeenCalledTimes(1);
  expect(refreshTarget).toHaveBeenCalledTimes(1);
});

it('refreshes dirty targets recorded while a pass is running before returning', async () => {
  const batches = [
    { targets: ['db://assets/a.json'], entries: [{ target: 'db://assets/a.json', eventTypes: ['update'] }], eventCount: 1, drainedAt: 1000 },
    { targets: ['db://assets/b.json'], entries: [{ target: 'db://assets/b.json', eventTypes: ['update'] }], eventCount: 1, drainedAt: 1001 },
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
      getStatus: () => ({ enabled: true, running: true, assetsRoot: 'E:/project/assets', eventCount: 1, dirtyTargetCount: batches[0]?.targets.length ?? 0, sampleTargets: batches[0]?.targets.slice(0, 5) ?? [] }),
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
      drainDirtyTargets: vi.fn(() => ({ targets: ['db://assets/churn.json'], entries: [{ target: 'db://assets/churn.json', eventTypes: ['update'] }], eventCount: 1, drainedAt: Date.now() })),
      requeueTargets: vi.fn(),
      getStatus: () => ({ enabled: true, running: true, assetsRoot: 'E:/project/assets', eventCount: 1, dirtyTargetCount: 1, sampleTargets: ['db://assets/churn.json'] }),
    },
    maxDirtyRefreshPasses: 2,
  });
  const result = await coordinator.refresh({ reason: 'reload' });
  expect(result.ok).toBe(false);
  expect(result.error).toContain('dirty-set did not become stable');
  expect(result.pendingDirtyTargetCount).toBe(1);
  expect(result.pendingSampleTargets).toEqual(['db://assets/churn.json']);
});
```

- [ ] **Step 2: 运行失败测试**

Run:

```powershell
rtk pwsh -NoProfile -Command "npm --prefix vitests run test -- suites/runtime-preview/runtime-refresh-coordinator.test.ts"
```

Expected: FAIL，`dirtyProvider`、`targets` 或 `failedTargets` 类型不存在。

- [ ] **Step 3: 扩展 coordinator 类型**

Modify `src/runtime-preview/refresh/runtime-refresh-coordinator.ts`:

```ts
export interface RuntimeRefreshFailedTarget {
    target: string;
    error: string;
}

export interface RuntimeRefreshSettledTarget {
    target: string;
    error: string;
}

export interface RuntimeRefreshPassResult {
    index: number;
    targets: string[];
    successfulTargets: string[];
    failedTargets: RuntimeRefreshFailedTarget[];
    settledTargets: RuntimeRefreshSettledTarget[];
    dirtyEventCount: number;
    durationMs: number;
}

export interface RuntimeRefreshResult {
    ok: boolean;
    refreshId: string;
    target: string;
    targets?: string[];
    passes?: RuntimeRefreshPassResult[];
    failedTargets?: RuntimeRefreshFailedTarget[];
    settledTargets?: RuntimeRefreshSettledTarget[];
    pendingDirtyTargetCount?: number;
    pendingSampleTargets?: string[];
    reason: RuntimeRefreshReason;
    changedAssetCount: number | null;
    dirtyEventCount?: number;
    watcher?: {
        enabled: boolean;
        running: boolean;
        assetsRoot: string;
        error?: string;
        eventCount: number;
        dirtyTargetCount: number;
        sampleTargets: string[];
    };
    scriptCompile: RuntimeRefreshScriptCompileResult;
    durationMs: number;
    error?: string;
}

export interface RuntimeRefreshDirtyProvider {
    drainDirtyTargets(): {
        targets: string[];
        entries?: Array<{ target: string; eventTypes: string[] }>;
        eventCount: number;
        drainedAt: number;
    };
    requeueTargets(targets: string[]): void;
    getStatus(): RuntimeRefreshResult['watcher'];
}
```

`RuntimeRefreshCoordinatorOptions` 增加：

```ts
dirtyProvider?: RuntimeRefreshDirtyProvider;
maxDirtyRefreshPasses?: number;
```

- [ ] **Step 3b: 更新 result helper 构造函数**

把 `createSkippedResult()`、`createFailedResult()` 和 success result 构造统一改成接收可选 patch，避免 dirty-set / watcher failure 多处零散 mutation：

```ts
type RuntimeRefreshResultPatch = Partial<Pick<
    RuntimeRefreshResult,
    'targets'
    | 'passes'
    | 'failedTargets'
    | 'settledTargets'
    | 'pendingDirtyTargetCount'
    | 'pendingSampleTargets'
    | 'dirtyEventCount'
    | 'watcher'
>>;

const createSkippedResult = (
    refreshId: string,
    target: string,
    reason: RuntimeRefreshReason,
    startedAt: number,
    error?: string,
    patch: RuntimeRefreshResultPatch = {},
): RuntimeRefreshResult => ({
    ok: !error,
    refreshId,
    target,
    reason,
    changedAssetCount: null,
    scriptCompile: { status: 'skipped', durationMs: 0 },
    durationMs: now() - startedAt,
    ...(error ? { error } : {}),
    ...patch,
});

const createFailedResult = (
    refreshId: string,
    target: string,
    reason: RuntimeRefreshReason,
    startedAt: number,
    changedAssetCount: number | null,
    scriptCompile: RuntimeRefreshScriptCompileResult,
    error: string,
    patch: RuntimeRefreshResultPatch = {},
): RuntimeRefreshResult => ({
    ok: false,
    refreshId,
    target,
    reason,
    changedAssetCount,
    scriptCompile,
    durationMs: now() - startedAt,
    error,
    ...patch,
});
```

所有 watcher failure、dirty-set empty、dirty-set failed / settled result 都必须通过这些 helper 带上 `watcher`、`targets`、`failedTargets`、`settledTargets`，不能在返回前用多处 ad hoc mutation 拼对象。

- [ ] **Step 4: 实现 dirty-set refresh 分支**

在 `refresh(input)` target normalization 前判断。dirty-set refresh 使用独立 key `dirty-set` 进入现有 in-flight map；同一时刻只允许一个 dirty-set multi-pass refresh。后续 reload / endpoint 请求如果命中 pending dirty-set promise，等待同一个 promise，并返回同一次 dirty-set refresh 的聚合结果副本，不再次 drain，也不再次调用 `refreshTarget()`。

```ts
const shouldUseDirtyProvider = input.target === undefined || input.target === '';
if (shouldUseDirtyProvider && options.dirtyProvider) {
    const watcher = options.dirtyProvider.getStatus();
    if (watcher?.enabled && !watcher.running) {
        return createFailedResult(
            refreshId,
            'dirty-set',
            input.reason,
            startedAt,
            null,
            { status: 'skipped', durationMs: 0 },
            watcher.error ? `Runtime asset watcher unavailable: ${watcher.error}` : 'Runtime asset watcher is not running.',
            { watcher, targets: [] },
        );
    }
    const pending = inFlight.get('dirty-set');
    if (pending) {
        const result = await pending;
        return {
            ...result,
            refreshId,
            reason: input.reason,
            durationMs: now() - startedAt,
        };
    }
    const promise = refreshDirtySet(input.reason, startedAt, refreshId)
        .finally(() => {
            if (inFlight.get('dirty-set') === promise) {
                inFlight.delete('dirty-set');
            }
        });
    inFlight.set('dirty-set', promise);
    return promise;
}
```

`refreshDirtySet()` 行为是 bounded multi-pass。每 pass 开始时 drain 当前 dirty-set；pass 运行期间 watcher 新收到的事件会留在 dirty store，下一 pass 再 drain。默认 `maxDirtyRefreshPasses = options.maxDirtyRefreshPasses ?? 3`。

```ts
const maxPasses = options.maxDirtyRefreshPasses ?? 3;
const allTargets: string[] = [];
const allPasses: RuntimeRefreshPassResult[] = [];
const allFailedTargets: RuntimeRefreshFailedTarget[] = [];
const allSettledTargets: RuntimeRefreshSettledTarget[] = [];
let changedAssetCount = 0;

for (let passIndex = 1; passIndex <= maxPasses; passIndex += 1) {
    const passStartedAt = now();
    const batch = options.dirtyProvider.drainDirtyTargets();
    const watcher = options.dirtyProvider.getStatus();
    if (batch.targets.length === 0) {
        if (allPasses.length === 0) {
            const result = createSkippedResult(refreshId, 'dirty-set', reason, startedAt, undefined, {
                targets: [],
                passes: [],
                dirtyEventCount: batch.eventCount,
                watcher,
            });
            await writeResult(result);
            return result;
        }
        break;
    }

    const successfulTargets: string[] = [];
    const failedTargets: RuntimeRefreshFailedTarget[] = [];
    const settledTargets: RuntimeRefreshSettledTarget[] = [];
    for (const target of batch.targets) {
        allTargets.push(target);
        try {
            const changed = await options.refreshTarget(target);
            successfulTargets.push(target);
            if (typeof changed === 'number') {
                changedAssetCount += changed;
            }
        } catch (error) {
            const errorMessage = getErrorMessage(error);
            if (shouldSettleMissingDirtyTarget(batch.entries, target, errorMessage)) {
                settledTargets.push({ target, error: errorMessage });
            } else {
                failedTargets.push({ target, error: errorMessage });
            }
        }
    }

    allFailedTargets.push(...failedTargets);
    allSettledTargets.push(...settledTargets);
    allPasses.push({
        index: passIndex,
        targets: batch.targets,
        successfulTargets,
        failedTargets,
        settledTargets,
        dirtyEventCount: batch.eventCount,
        durationMs: now() - passStartedAt,
    });

    if (failedTargets.length > 0) {
        options.dirtyProvider.requeueTargets(failedTargets.map((item) => item.target));
        break;
    }
}

const finalWatcher = options.dirtyProvider.getStatus();
if (finalWatcher.dirtyTargetCount > 0 && allFailedTargets.length === 0) {
    return createFailedResult(
        refreshId,
        'dirty-set',
        reason,
        startedAt,
        changedAssetCount || null,
        { status: 'skipped', durationMs: 0 },
        `Runtime asset dirty-set did not become stable within ${maxPasses} pass(es).`,
        {
            targets: dedupe(allTargets),
            passes: allPasses,
            settledTargets: allSettledTargets,
            pendingDirtyTargetCount: finalWatcher.dirtyTargetCount,
            pendingSampleTargets: finalWatcher.sampleTargets,
            watcher: finalWatcher,
        },
    );
}
```

Script idle 和 cache invalidation 规则：

- `allPasses` 为空：dirty-set 为空，返回 `ok:true`、`scriptCompile.status:"skipped"`，不调用 `waitForIdle()` / invalidation。
- 所有 pass 都只有 `settledTargets`、没有 `successfulTargets`、没有 `failedTargets`：返回 `ok:true`、`scriptCompile.status:"skipped"`，带 `settledTargets`，不调用 `waitForIdle()` / invalidation。
- 任一 pass 有 `successfulTargets` 且没有 `failedTargets` 且 dirty-set 收敛：调用一次 `waitForIdle()`，再调用一次 `invalidateSettings()` 和 `clearImportReplacement()`，最终返回 `ok:true`。
- 任一 pass 有 `failedTargets`：requeue failed targets，停止后续 pass；如果此前有 successful targets，先 `waitForIdle()` 并 invalidate，再返回 `ok:false`；如果没有 successful targets，不调用 `waitForIdle()` / invalidation。
- 有任一 failed target：最终 `ok:false`，`error` 汇总为 `Runtime refresh failed for N dirty target(s).`。
- 达到 `maxDirtyRefreshPasses` 后仍有 pending dirty：最终 `ok:false`，带 `pendingDirtyTargetCount` / `pendingSampleTargets`，不 fallback root refresh。若此前有 successful targets，先 wait idle 并 invalidate，避免已成功导入的资源仍使用旧 settings/cache。
- 没有 failed target 且 dirty-set 已清空：最终 `ok:true`。
- `shouldSettleMissingDirtyTarget()` 只在 dirty-set 模式使用：当错误文本包含 `can not find asset`、`not exists` 或 `not in asset-db`，且该 target 的 eventTypes 包含 `delete`，或同一 target 同批包含 `create` 和 `delete`，视为短生命周期文件 / rename old path / 已收敛删除，不 requeue，写入 `settledTargets`。其它 import / syntax / permission / internal error 必须进入 `failedTargets` 并 requeue。
- watcher enabled 但 `running:false` 时，无 target refresh 返回 `ok:false`，显示 watcher failure；不能 fallback 到 `db://assets` root refresh。

- [ ] **Step 5: 运行 coordinator 测试**

Run:

```powershell
rtk pwsh -NoProfile -Command "npm --prefix vitests run test -- suites/runtime-preview/runtime-refresh-coordinator.test.ts"
```

Expected: PASS。

- [ ] **Step 6: Commit**

```powershell
rtk pwsh -NoProfile -Command "git add src/runtime-preview/refresh/runtime-refresh-coordinator.ts vitests/suites/runtime-preview/runtime-refresh-coordinator.test.ts; git commit -m 'feat(runtime-preview): refresh dirty asset targets'"
```

---

### Task 5: Server lifecycle and reload behavior

**Files:**
- Modify: `src/runtime-preview/server/runtime-preview-server.ts`
- Modify: `src/runtime-preview/server/runtime-refresh-entry-injection.ts`
- Test: `vitests/suites/runtime-preview/runtime-preview-express-server.test.ts`

- [ ] **Step 1: 写 server tests**

Append to `vitests/suites/runtime-preview/runtime-preview-express-server.test.ts`:

```ts
it('starts asset watcher when watchAssets is enabled and closes it with the server', async () => {
  const start = vi.fn(async () => undefined);
  const stop = vi.fn(async () => undefined);
  const { server } = await createServerFixture({
    watchAssets: true,
    assetChangeWatcherFactory: () => ({
      start,
      stop,
      getStatus: () => ({ enabled: true, running: true, assetsRoot: 'E:/project/assets', eventCount: 0, dirtyTargetCount: 0, sampleTargets: [] }),
    }),
  });
  expect(start).toHaveBeenCalledTimes(1);
  await server.close();
  expect(stop).toHaveBeenCalledTimes(1);
});

it('does not root-refresh on reload when watcher dirty-set is empty', async () => {
  const refreshTarget = vi.fn(async () => 1);
  const { server } = await createServerFixture({
    refreshOnReload: true,
    watchAssets: true,
    refreshTarget,
    assetDirtyStoreFactory: () => ({
      recordFileEvent: vi.fn(),
      drainDirtyTargets: () => ({ targets: [], entries: [], eventCount: 0, drainedAt: Date.now() }),
      requeueTargets: vi.fn(),
      peekDirtyTargets: () => [],
      getDirtyTargetCount: () => 0,
      getEventCount: () => 0,
    }),
  });
  try {
    const response = await fetch(server.url);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('dirty-set');
    expect(refreshTarget).not.toHaveBeenCalledWith('db://assets');
  } finally {
    await server.close();
  }
});

it('injects watcher start failure into root html without failing root', async () => {
  const { server } = await createServerFixture({
    watchAssets: true,
    assetChangeWatcherFactory: () => ({
      start: async () => undefined,
      stop: async () => undefined,
      getStatus: () => ({
        enabled: true,
        running: false,
        assetsRoot: 'E:/project/assets',
        error: 'native watcher unavailable',
        eventCount: 0,
        dirtyTargetCount: 0,
        sampleTargets: [],
      }),
    }),
  });
  try {
    const response = await fetch(server.url);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('native watcher unavailable');
  } finally {
    await server.close();
  }
});
```

- [ ] **Step 2: 运行失败测试**

Run:

```powershell
rtk pwsh -NoProfile -Command "npm --prefix vitests run test -- suites/runtime-preview/runtime-preview-express-server.test.ts"
```

Expected: FAIL，`watchAssets` 等 server options 不存在。

- [ ] **Step 3: 扩展 server options**

Modify `RuntimePreviewServerOptions`:

```ts
watchAssets?: boolean;
assetDirtyStoreFactory?: (input: { projectRoot: string }) => RuntimeAssetDirtyStore;
assetChangeWatcherFactory?: (input: {
    projectRoot: string;
    dirtyStore: RuntimeAssetDirtyStore;
    logger: RuntimePreviewLogger;
}) => RuntimeAssetChangeWatcher;
refreshTarget?: (target: string) => Promise<number | null | undefined>;
```

默认 factory：

```ts
const dirtyStore = options.watchAssets === true
    ? (options.assetDirtyStoreFactory?.({ projectRoot: context.projectRoot })
        ?? createRuntimeAssetDirtyStore({ projectRoot: context.projectRoot }))
    : undefined;

const assetWatcher = dirtyStore
    ? (options.assetChangeWatcherFactory?.({ projectRoot: context.projectRoot, dirtyStore, logger })
        ?? createRuntimeAssetChangeWatcher({ projectRoot: context.projectRoot, dirtyStore, logger, failSoft: true }))
    : undefined;

await assetWatcher?.start();
```

`getRefreshCoordinator()` 中传入：

```ts
dirtyProvider: dirtyStore && assetWatcher
    ? {
        drainDirtyTargets: () => dirtyStore.drainDirtyTargets(),
        requeueTargets: (targets) => dirtyStore.requeueTargets(targets),
        getStatus: () => assetWatcher.getStatus(),
    }
    : undefined,
refreshTarget: options.refreshTarget ?? async (target) => {
    const { assetOperation } = await import('../../core/assets/manager/operation');
    return assetOperation.refreshAsset(target);
},
```

`close()` 需要关闭 watcher：

```ts
close: async () => {
    try {
        await assetWatcher?.stop();
    } finally {
        await close(server);
    }
}
```

- [ ] **Step 4: 注入 watcher status 到 root HTML**

`runtimeRefreshState` 增加：

```ts
if (assetWatcher?.getStatus().error) {
    runtimeRefreshState = {
        ...(runtimeRefreshState ?? {}),
        watcher: assetWatcher.getStatus(),
    };
}
```

`runtime-refresh-entry-injection.ts` 启动时显示：

```js
if (state && state.watcher && state.watcher.error) {
  showRuntimeRefreshToast('Runtime asset watcher unavailable: ' + state.watcher.error);
}
```

- [ ] **Step 5: 运行 server tests**

Run:

```powershell
rtk pwsh -NoProfile -Command "npm --prefix vitests run test -- suites/runtime-preview/runtime-preview-express-server.test.ts"
```

Expected: PASS。

- [ ] **Step 6: Commit**

```powershell
rtk pwsh -NoProfile -Command "git add src/runtime-preview/server/runtime-preview-server.ts src/runtime-preview/server/runtime-refresh-entry-injection.ts vitests/suites/runtime-preview/runtime-preview-express-server.test.ts; git commit -m 'feat(runtime-preview): manage asset watcher lifecycle'"
```

---

### Task 6: CLI and Launcher wiring

**Files:**
- Modify: `src/commands/preview.ts`
- Modify: `src/core/launcher.ts`
- Test: `vitests/suites/runtime-preview/cli-startup.test.ts`
- Test: `vitests/suites/runtime-preview/launcher-runtime-preview.test.ts`

- [ ] **Step 1: 写 CLI / launcher tests**

Add to `cli-startup.test.ts`:

```ts
it('passes watch-assets to runtime preview launcher', async () => {
  await runPreviewCli(['--project', projectRoot, '--runtime', '--watch-assets']);
  expect(launcherMockState.startRuntimePreview).toHaveBeenCalledWith(expect.objectContaining({
    watchAssets: true,
  }));
});

it('does not enable watch-assets by default', async () => {
  await runPreviewCli(['--project', projectRoot, '--runtime']);
  const runtimeOptions = launcherMockState.startRuntimePreview.mock.calls[0]?.[0];
  expect(runtimeOptions?.watchAssets).not.toBe(true);
});
```

Add to `launcher-runtime-preview.test.ts`:

```ts
it('passes watchAssets to runtime preview server', async () => {
  const launcher = new Launcher(projectRoot);
  await launcher.startRuntimePreview({ port: 0, watchAssets: true });
  expect(capturedServerOptions[0].watchAssets).toBe(true);
});
```

- [ ] **Step 2: 运行失败测试**

Run:

```powershell
rtk pwsh -NoProfile -Command "npm --prefix vitests run test -- suites/runtime-preview/cli-startup.test.ts suites/runtime-preview/launcher-runtime-preview.test.ts"
```

Expected: FAIL，CLI option 或 launcher option 不存在。

- [ ] **Step 3: 修改 CLI**

Modify `src/commands/preview.ts`:

```ts
.option('--watch-assets', 'Watch project assets and refresh only changed files during runtime preview refresh')
```

传入:

```ts
watchAssets: options.watchAssets === true,
```

- [ ] **Step 4: 修改 launcher**

Modify `src/core/launcher.ts`:

```ts
async startRuntimePreview(options: {
    port?: number;
    host?: string;
    scene?: string;
    settingsTimeoutMs?: number;
    scriptLoadConcurrency?: number;
    clearProgrammingCache?: boolean;
    refreshOnReload?: boolean;
    watchAssets?: boolean;
} = {}) {
```

传入 server:

```ts
watchAssets: options.watchAssets === true,
```

- [ ] **Step 5: 运行测试**

Run:

```powershell
rtk pwsh -NoProfile -Command "npm --prefix vitests run test -- suites/runtime-preview/cli-startup.test.ts suites/runtime-preview/launcher-runtime-preview.test.ts"
```

Expected: PASS。

- [ ] **Step 6: Commit**

```powershell
rtk pwsh -NoProfile -Command "git add src/commands/preview.ts src/core/launcher.ts vitests/suites/runtime-preview/cli-startup.test.ts vitests/suites/runtime-preview/launcher-runtime-preview.test.ts; git commit -m 'feat(runtime-preview): wire asset watch option'"
```

---

### Task 7: Browser UX for watcher states

**Files:**
- Modify: `src/runtime-preview/server/runtime-refresh-entry-injection.ts`
- Test: `vitests/suites/runtime-preview/runtime-refresh-browser.test.ts`

- [ ] **Step 1: 写 browser tests**

Append to `runtime-refresh-browser.test.ts`:

```ts
it('shows no-change message and does not reload when watcher dirty-set is empty', async () => {
  const refresh = vi.fn(async () => ({
    ok: true,
    refreshId: 'watch-empty',
    target: 'dirty-set',
    targets: [],
    reason: 'endpoint',
    changedAssetCount: null,
    dirtyEventCount: 0,
    watcher: { enabled: true, running: true, assetsRoot: 'E:/project/assets', eventCount: 0, dirtyTargetCount: 0, sampleTargets: [] },
    scriptCompile: { status: 'skipped', durationMs: 0 },
    durationMs: 0,
  }));
  const resources = await openRuntimePreviewPage({ refresh });
  try {
    await resources.page.goto(resources.server.url);
    await resources.page.click('#btn-runtime-refresh');
    await expect(resources.page.locator('#runtime-preview-refresh-toast')).toContainText('No asset changes');
    expect(await resources.page.evaluate(() => localStorage.getItem('runtime-refresh-beforeunload-count'))).toBeNull();
    await expect(resources.page.locator('#btn-runtime-refresh')).toBeEnabled();
  } finally {
    await resources.close();
  }
});

it('shows watcher unavailable toast from injected root state', async () => {
  const resources = await openRuntimePreviewPage({
    refresh: async () => createRefreshResult(),
    watcherStatus: {
        enabled: true,
        running: false,
        assetsRoot: 'E:/project/assets',
        error: 'native watcher unavailable',
        eventCount: 0,
        dirtyTargetCount: 0,
        sampleTargets: [],
    },
  });
  try {
    await resources.page.goto(resources.server.url);
    await expect(resources.page.locator('#runtime-preview-refresh-toast')).toContainText('native watcher unavailable');
  } finally {
    await resources.close();
  }
});
```

- [ ] **Step 2: 运行失败测试**

Run:

```powershell
rtk pwsh -NoProfile -Command "npm --prefix vitests run test -- suites/runtime-preview/runtime-refresh-browser.test.ts"
```

Expected: FAIL，toast 文案或 injected watcher state 未实现。

- [ ] **Step 3: 实现 no-change 和 watcher error 文案**

先扩展 `runtime-refresh-browser.test.ts` 内现有 `openRuntimePreviewPage()` helper 的 options：

```ts
async function openRuntimePreviewPage(options: {
  refresh: (input: { reason: 'endpoint' | 'reload'; target?: unknown }) => Promise<RuntimeRefreshResult>;
  templateHtml?: string;
  refreshOnReload?: boolean;
  watcherStatus?: {
    enabled: boolean;
    running: boolean;
    assetsRoot: string;
    error?: string;
    eventCount: number;
    dirtyTargetCount: number;
    sampleTargets: string[];
  };
  onConsole?: (message: ConsoleMessage) => void;
}) {
```

并在 `startRuntimePreviewServer()` 调用中按 `watcherStatus` 注入 fake watcher：

```ts
watchAssets: options.watcherStatus?.enabled,
assetChangeWatcherFactory: options.watcherStatus
  ? () => ({
      start: async () => undefined,
      stop: async () => undefined,
      getStatus: () => options.watcherStatus!,
    })
  : undefined,
```

Modify installer in `runtime-refresh-entry-injection.ts`:

```js
function getSuccessMessage(result) {
  if (result.target === 'dirty-set' && Array.isArray(result.targets) && result.targets.length === 0) {
    return 'No asset changes detected.';
  }
  if (result.target === 'dirty-set') {
    return 'Refreshed ' + (result.targets ? result.targets.length : 0) + ' changed asset target(s).';
  }
  return 'Runtime refresh completed.';
}
```

Click handler:

```js
if (result.ok && result.scriptCompile && result.scriptCompile.status === 'skipped' && result.target === 'dirty-set') {
  showRuntimeRefreshToast(getSuccessMessage(result));
  button.disabled = false;
  return;
}
```

Boot:

```js
if (state && state.watcher && state.watcher.error) {
  showRuntimeRefreshToast('Runtime asset watcher unavailable: ' + state.watcher.error);
}
```

- [ ] **Step 4: 运行 browser tests**

Run:

```powershell
rtk pwsh -NoProfile -Command "npm --prefix vitests run test -- suites/runtime-preview/runtime-refresh-browser.test.ts"
```

Expected: PASS。

- [ ] **Step 5: Commit**

```powershell
rtk pwsh -NoProfile -Command "git add src/runtime-preview/server/runtime-refresh-entry-injection.ts vitests/suites/runtime-preview/runtime-refresh-browser.test.ts; git commit -m 'test(runtime-preview): cover asset watch refresh ux'"
```

---

### Task 8: Live watcher integration on mutable fixture

**Files:**
- Modify: `vitests/suites/runtime-preview/runtime-refresh-live-integration.test.ts`

- [ ] **Step 1: 写 live integration tests**

Append tests using existing mutable runtime preview fixture:

```ts
it('watch-assets refreshes changed resource on reload without root refresh', async () => {
  const project = await createMutableRuntimePreviewFixture();
  const resourcePath = join(project.assetsRoot, 'resources', 'runtime-watch.json');
  await writeFile(resourcePath, '{"value":"before"}', 'utf8');
  const preview = await startRealRuntimePreview(project, {
    watchAssets: true,
    refreshOnReload: true,
  });
  try {
    await preview.page.goto(preview.url);
    await writeFile(resourcePath, '{"value":"after"}', 'utf8');
    await waitForRuntimeAssetWatcherDirty(preview.logFilePath, 'runtime-watch.json');
    await preview.page.reload();
    const refreshLog = await readLastRuntimeRefreshLog(preview.logFilePath);
    expect(refreshLog.target).toBe('dirty-set');
    expect(refreshLog.targets).toContain('db://assets/resources/runtime-watch.json');
    expect(refreshLog.targets).not.toContain('db://assets');
    await expectRuntimeResourceValue(preview.page, 'after');
  } finally {
    await preview.close();
  }
});

it('watch-assets refreshes changed script on reload after script compile finishes', async () => {
  const project = await createMutableRuntimePreviewFixture();
  const scriptPath = join(project.assetsRoot, 'scripts', 'runtime-watch-script.ts');
  await writeFile(scriptPath, 'window.__RUNTIME_PREVIEW_SCRIPT_REFRESH_VALUE__ = "before";', 'utf8');
  const preview = await startRealRuntimePreview(project, {
    watchAssets: true,
    refreshOnReload: true,
  });
  try {
    await preview.page.goto(preview.url);
    await writeFile(scriptPath, 'window.__RUNTIME_PREVIEW_SCRIPT_REFRESH_VALUE__ = "after";', 'utf8');
    await waitForRuntimeAssetWatcherDirty(preview.logFilePath, 'runtime-watch-script.ts');
    await preview.page.reload();
    const refreshLog = await readLastRuntimeRefreshLog(preview.logFilePath);
    expect(refreshLog.target).toBe('dirty-set');
    expect(refreshLog.scriptCompile.status).toBe('done');
    await expect.poll(() => preview.page.evaluate(() => (window as any).__RUNTIME_PREVIEW_SCRIPT_REFRESH_VALUE__)).toBe('after');
  } finally {
    await preview.close();
  }
});
```

Helper `waitForRuntimeAssetWatcherDirty(logFilePath, marker)` polls preview log for:

```text
runtime-asset-watch events count=
```

and the dirty target marker. Watcher log must include up to 5 target samples from `dirtyStore.peekDirtyTargets(5)`:

```ts
runtime-asset-watch events count=${events.length} dirtyTargets=${dirtyStore.getDirtyTargetCount()} sample=${dirtyStore.peekDirtyTargets(5).join(',')}
```

- [ ] **Step 2: 运行 live tests**

Run:

```powershell
rtk pwsh -NoProfile -Command "npm --prefix vitests run test -- suites/runtime-preview/runtime-refresh-live-integration.test.ts"
```

Expected: PASS。失败时必须定位是 watcher event、AssetDB refresh、script compile、HTTP resource route 还是 browser cache，不能用 mock 替代该 live 验收。

- [ ] **Step 3: Commit**

```powershell
rtk pwsh -NoProfile -Command "git add vitests/suites/runtime-preview/runtime-refresh-live-integration.test.ts src/runtime-preview/watch/runtime-asset-change-watcher.ts; git commit -m 'test(runtime-preview): verify watched asset refresh integration'"
```

---

### Task 9: feature-c performance and source cleanup evidence

**Files:**
- Create: `vitests/scripts/runtime-preview-feature-c-watch-refresh-performance.mjs`
- Create: `docs/dev/runtime-preview/facts/feature-c-watch-refresh-performance-20260627.md`

- [ ] **Step 1: 写 feature-c 性能脚本**

Create `vitests/scripts/runtime-preview-feature-c-watch-refresh-performance.mjs` with these required modes:

```js
const modes = [
  { name: 'defaultOff', args: [] },
  { name: 'watchNoReload', args: ['--watch-assets'] },
  { name: 'watchReloadNoChange', args: ['--watch-assets', '--refresh-on-reload'] },
  { name: 'watchReloadChanged', args: ['--watch-assets', '--refresh-on-reload'], mutate: true },
];
```

Required behavior:

- Launch `node dist/cli.js preview --runtime --project <feature-c> --host 127.0.0.1 --port <allocated> --scene 4c721bfe-0b6e-46c2-97f0-644adfdcba31`.
- Clear `COCOS_CLI_TEST_PROJECT_ROOT`、`COCOS_CLI_TEST_ENGINE_ROOT`、`COCOS_CLI_TEST_EDITOR_LIBRARY_REF`、`COCOS_CLI_TEST_EDITOR_PROGRAMMING_REF`、`COCOS_CLI_SHARED_LIBRARY_OUTPUT` before launching production CLI.
- For every `watchReloadNoChange` round, reload root and parse the latest `runtime-refresh` JSON line from preview log. Hard assert:
  - `target === "dirty-set"`
  - `targets` is an empty array
  - `scriptCompile.status === "skipped"`
  - `changedAssetCount === null`
  - `target !== "db://assets"` and `targets` does not contain exact root `db://assets`
  - `durationMs` is recorded and included in per-round JSON
- For `watchReloadChanged`, create `assets/__cocos_cli_watch_probe__/runtime-watch-refresh.json` with JSON content, wait for watcher log, reload root, assert last refresh result:
  - `target === "dirty-set"`
  - `targets` contains `db://assets/__cocos_cli_watch_probe__/runtime-watch-refresh.json`
  - `targets` does not contain `db://assets`
  - `scriptCompile.status` is `done` or `skipped` only if no script target was part of the batch
  - `durationMs` is recorded
- Record source status with these commands:
  - before mutation: `git -C <feature-c> status --short -- assets/__cocos_cli_watch_probe__ assets/__cocos_cli_watch_probe__.meta`
  - after mutation before cleanup: same command, must show only controlled probe entries under `assets/__cocos_cli_watch_probe__` and/or `assets/__cocos_cli_watch_probe__.meta`
  - after cleanup: same command, must be empty
  - after cleanup path checks:
    - `Test-Path <feature-c>/assets/__cocos_cli_watch_probe__` is false
    - `Test-Path <feature-c>/assets/__cocos_cli_watch_probe__.meta` is false
    - `Test-Path <feature-c>/assets/__cocos_cli_watch_probe__/runtime-watch-refresh.json.meta` is false
- Cleanup `assets/__cocos_cli_watch_probe__` and sibling `assets/__cocos_cli_watch_probe__.meta` after every changed round, even on failure. A failed cleanup must fail the script.
- Write JSON to `<feature-c>/temp/codex-runtime-preview/feature-c-watch-refresh-performance-<timestamp>.json`.

Output JSON shape:

```json
{
  "projectKind": "real-project-feature-c",
  "sourceMutationPolicy": "temporary assets/__cocos_cli_watch_probe__ directory, removed before success",
  "rounds": 5,
  "modes": {
    "defaultOff": { "rounds": [{ "rootHtmlMs": 0, "refreshResults": [] }] },
    "watchNoReload": { "rounds": [{ "rootHtmlMs": 0, "watcherStartMs": 0, "refreshResults": [] }] },
    "watchReloadNoChange": {
      "rounds": [{
        "rootHtmlMs": 0,
        "refreshResult": {
          "target": "dirty-set",
          "targets": [],
          "scriptCompileStatus": "skipped",
          "dirtyTargetCount": 0,
          "durationMs": 0,
          "rootRefresh": false
        }
      }]
    },
    "watchReloadChanged": {
      "rounds": [{
        "rootHtmlMs": 0,
        "refreshResult": {
          "target": "dirty-set",
          "targets": ["db://assets/__cocos_cli_watch_probe__/runtime-watch-refresh.json"],
          "scriptCompileStatus": "done",
          "dirtyTargetCount": 1,
          "durationMs": 0,
          "rootRefresh": false
        },
        "gitStatusBeforeMutation": "",
        "gitStatusAfterMutationBeforeCleanup": "?? assets/__cocos_cli_watch_probe__/",
        "gitStatusAfterCleanup": "",
        "probeDirExistsAfterCleanup": false,
        "probeDirMetaExistsAfterCleanup": false,
        "metaExistsAfterCleanup": false
      }]
    }
  },
  "summary": {
    "watchReloadNoChange": { "rootHtmlP50Ms": 0, "refreshP50Ms": 0 },
    "watchReloadChanged": { "rootHtmlP50Ms": 0, "refreshP50Ms": 0 }
  },
  "cleanup": {
    "probeDirRemoved": true,
    "gitStatusBeforeMutation": "",
    "gitStatusAfterMutationBeforeCleanup": "",
    "gitStatusAfterCleanup": "",
    "probeDirExistsAfterCleanup": false,
    "probeDirMetaExistsAfterCleanup": false,
    "metaExistsAfterCleanup": false
  }
}
```

Actual script must write real values, not the example zeros.

- [ ] **Step 2: 构建 dist**

Run:

```powershell
rtk pwsh -NoProfile -Command "npm run compile"
```

Expected: exit code 0。必须先构建，后续才可用 `node dist/cli.js`。

- [ ] **Step 3: 运行 feature-c 性能脚本**

Run:

```powershell
rtk pwsh -NoProfile -Command "Remove-Item Env:COCOS_CLI_TEST_PROJECT_ROOT -ErrorAction SilentlyContinue; Remove-Item Env:COCOS_CLI_TEST_ENGINE_ROOT -ErrorAction SilentlyContinue; Remove-Item Env:COCOS_CLI_TEST_EDITOR_LIBRARY_REF -ErrorAction SilentlyContinue; Remove-Item Env:COCOS_CLI_TEST_EDITOR_PROGRAMMING_REF -ErrorAction SilentlyContinue; Remove-Item Env:COCOS_CLI_SHARED_LIBRARY_OUTPUT -ErrorAction SilentlyContinue; node vitests/scripts/runtime-preview-feature-c-watch-refresh-performance.mjs --rounds 5"
```

Expected:

- `watchReloadNoChange` 每轮 `refreshResult.target === "dirty-set"`、`targets === []`、`scriptCompileStatus === "skipped"`、`rootRefresh === false`。
- `watchReloadChanged` 每轮 targets 是临时 probe 文件或 probe 目录，不包含 `db://assets` root，且 `rootRefresh === false`。
- `cleanup.gitStatusBeforeMutation === ""`、`cleanup.gitStatusAfterCleanup === ""`、`cleanup.probeDirExistsAfterCleanup === false`、`cleanup.probeDirMetaExistsAfterCleanup === false`、`cleanup.metaExistsAfterCleanup === false`。
- 无同源 failed request、无 bad response、无 `console.error`。

- [ ] **Step 4: 写 facts**

Create `docs/dev/runtime-preview/facts/feature-c-watch-refresh-performance-20260627.md`:

```markdown
# feature-c Watch Refresh Performance 2026-06-27

## 范围

- 测试层级：真实项目 production CLI 性能与行为验收
- 项目：`D:\ps_copy\p6\trunk\Project\GameClient\feature-c`
- scene：`4c721bfe-0b6e-46c2-97f0-644adfdcba31`
- 是否构建 dist：
- 清理的环境变量：
- 源资源变更策略：
- JSON 输出：
- 不能证明的边界：

## 结果

| 模式 | rounds | root `/` p50 | refresh p50 | dirty targets | root refresh |
| --- | ---: | ---: | ---: | --- | --- |
| default off | 5 | 写入脚本输出 | n/a | n/a | no |
| watch no reload | 5 | 写入脚本输出 | n/a | n/a | no |
| watch reload no change | 5 | 写入脚本输出 | 写入脚本输出 | `[]` | no |
| watch reload changed | 5 | 写入脚本输出 | 写入脚本输出 | 写入脚本输出 | no |

## 清理检查

- `assets/__cocos_cli_watch_probe__` 是否删除：
- `assets/__cocos_cli_watch_probe__.meta` 是否删除：
- mutation 前 `git status --short -- assets/__cocos_cli_watch_probe__ assets/__cocos_cli_watch_probe__.meta`：
- mutation 后 cleanup 前 `git status --short -- assets/__cocos_cli_watch_probe__ assets/__cocos_cli_watch_probe__.meta`：
- cleanup 后 `git status --short -- assets/__cocos_cli_watch_probe__ assets/__cocos_cli_watch_probe__.meta`：
- cleanup 后 file `.meta` 是否存在：

## 结论

写入真实观测结论。若 watcher dirty-set 仍触发 root refresh 或接近 60s，本实现不得标记完成。
```

- [ ] **Step 5: Commit**

```powershell
rtk pwsh -NoProfile -Command "git add vitests/scripts/runtime-preview-feature-c-watch-refresh-performance.mjs docs/dev/runtime-preview/facts/feature-c-watch-refresh-performance-20260627.md; git commit -m 'test(runtime-preview): record feature-c watch refresh performance'"
```

---

### Task 10: Final verification and issue status

**Files:**
- Modify: `docs/dev/runtime-preview/issues.md`
- Optional Modify: `docs/dev/runtime-preview/acceptance/matrix.md`

- [ ] **Step 1: 运行 focused test set**

Run:

```powershell
rtk pwsh -NoProfile -Command "npm --prefix vitests run test -- suites/runtime-preview/runtime-asset-dirty-store.test.ts suites/runtime-preview/runtime-asset-change-watcher.test.ts suites/runtime-preview/runtime-refresh-coordinator.test.ts suites/runtime-preview/runtime-preview-express-server.test.ts suites/runtime-preview/runtime-refresh-browser.test.ts suites/runtime-preview/runtime-refresh-live-integration.test.ts suites/runtime-preview/cli-startup.test.ts suites/runtime-preview/launcher-runtime-preview.test.ts"
```

Expected: exit code 0。

- [ ] **Step 2: TypeScript compile check**

Run:

```powershell
rtk pwsh -NoProfile -Command "npx tsc -b --pretty false"
```

Expected: exit code 0。

- [ ] **Step 3: 构建 dist**

Run:

```powershell
rtk pwsh -NoProfile -Command "npm run compile"
```

Expected: exit code 0。只有此项通过后，才能声明 `dist/cli.js` 验收有效。

- [ ] **Step 4: CLI help smoke**

Run:

```powershell
rtk pwsh -NoProfile -Command "node dist/cli.js preview --help"
```

Expected: output contains:

```text
--watch-assets
--refresh-on-reload
```

- [ ] **Step 5: feature-c performance gate**

Run Task 9 command again if Task 9 was not run after final code changes.

Expected:

- `watchReloadNoChange` 每轮 `refreshResult.target === "dirty-set"`、`targets === []`、`scriptCompileStatus === "skipped"`、`rootRefresh === false`，且 p50 不接近历史 `~60s` root refresh。
- `watchReloadChanged` 每轮 `refreshResult.target === "dirty-set"`，不包含 `db://assets` root target，且 `rootRefresh === false`。
- cleanup clean。

- [ ] **Step 6: 更新 issue 台账**

Update `docs/dev/runtime-preview/issues.md`:

- `RP-ISSUE-028` 状态改为 `fixed` 仅当以下全部成立：
  - watcher unit tests pass；
  - live resource/script refresh integration pass；
  - feature-c no-change and changed watch refresh performance pass；
  - feature-c cleanup clean；
  - `npm run compile` pass；
  - CLI help smoke pass。
- `RP-ISSUE-029` 保持 `open` 或补充说明：root refresh 性能问题由 `RP-ISSUE-028` watcher dirty-set 解决，显式 root refresh 仍保留为兼容能力，不作为常规 reload 路径。

- [ ] **Step 7: Commit**

```powershell
rtk pwsh -NoProfile -Command "git add docs/dev/runtime-preview/issues.md docs/dev/runtime-preview/acceptance/matrix.md; git commit -m 'docs(runtime-preview): record asset watch refresh validation'"
```

---

## 自检清单

- [ ] 计划没有要求用户输入变更路径。
- [ ] `--watch-assets` 默认关闭。
- [ ] `--refresh-on-reload` 默认关闭。
- [ ] `--watch-assets --refresh-on-reload` reload 时 dirty-set 为空不会触发 `db://assets`。
- [ ] Refresh 按钮在 watcher 启用时无 target 会刷新 dirty-set，不会 root refresh。
- [ ] Watcher 启动失败不阻断 server/root，只提示和记录日志。
- [ ] Dirty target 支持 `.meta` 映射、delete、dedupe、失败 requeue。
- [ ] Server close 会 unsubscribe watcher。
- [ ] Live integration 覆盖资源更新和脚本更新。
- [ ] feature-c 验收记录 no-change 和 changed 两类性能数据。
- [ ] feature-c 临时 source 变更有清理和 `git status` 证据。
- [ ] 不把 Vitest fixture 结论扩大成真实 feature-c 结论。
