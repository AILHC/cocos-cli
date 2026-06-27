# Runtime Preview Explicit Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 `preview --runtime` 增加显式 AssetDB refresh endpoint、页面按钮和 opt-in reload refresh check，使资源和脚本修改能在 refresh 后被新页面读取，同时失败只提示、不阻断当前 preview。

**Architecture:** 新增 runtime refresh coordinator，集中处理 target 归一化、AssetDB refresh、script idle wait、cache invalidation、并发去重和指标。Express server 在 generic route 前注册 `POST /__runtime-preview/refresh`，root `/` 在 render 前按 `--refresh-on-reload` 触发一次 opt-in refresh，并把 refresh 状态注入 HTML。浏览器侧 installer 独立于 `Ui` 和 `.toolbar`，优先挂 toolbar，缺失时提供固定按钮。

**Tech Stack:** TypeScript、Express、Vitest、Playwright/browser runtime helper、Cocos `@cocos/asset-db` / CLI `assetOperation` / `scripting` / `PreviewSettingsProvider`。

**Execution status:** 2026-06-27 已执行。实现提交包括 `cd5bb9b1`、`77e3c426`、`7e5c1a81`、`1b3d23d0` 和后续验证补强提交；最终验收记录见 `docs/dev/runtime-preview/issues.md` 的 `RP-ISSUE-029` 与 `docs/dev/runtime-preview/facts/runtime-preview-explicit-refresh-performance-20260627.md`。`RP-ISSUE-029` 仍保持 `open`，因为尚未跑指定真实业务项目级 browser/runtime 验收。

---

## 前置约束

- 先读并遵守 `docs/dev/testing-spec.md` 与 `docs/dev/runtime-preview/testing-spec.md`。
- 本轮不做 watcher、不做 HMR、不做个人配置文件。
- `--refresh-on-reload` 默认关闭；不打开时 root reload 不触发 AssetDB scan。
- 失败行为必须是用户可见提示和日志，不返回 root 500，不清 scene，不暂停游戏。
- 不能把 route contract 通过写成 browser/runtime 或真实项目通过。
- 本计划中的所有 `npm --prefix vitests run test` 命令需要当前 shell 设置 `$env:COCOS_CLI_TEST_ENGINE_ROOT='<engine root>'`。这是 Vitest harness 输入，不能作为 production engine root 解析结论。

## 文件结构

Create:

- `src/runtime-preview/refresh/runtime-refresh-coordinator.ts`：refresh coordinator、target normalization、script idle wait、dedupe、result 类型。
- `src/runtime-preview/server/runtime-refresh-entry-injection.ts`：root HTML 注入 refresh installer 和 initial state。
- `vitests/suites/runtime-preview/runtime-refresh-coordinator.test.ts`：coordinator 单元/route-adjacent 测试。
- `vitests/suites/runtime-preview/runtime-refresh-entry-injection.test.ts`：HTML 注入测试。
- `vitests/suites/runtime-preview/runtime-refresh-browser.test.ts`：按钮、fallback、失败提示的 browser 测试。
- `vitests/scripts/runtime-preview-refresh-performance.mjs`：`--refresh-on-reload` 性能采样脚本。
- `vitests/scripts/runtime-preview-refresh-assetdb-probe.mjs`：真实 AssetDB refresh target 行为 probe。
- `docs/dev/runtime-preview/facts/runtime-preview-explicit-refresh-performance-20260627.md`：性能事实记录。
- `docs/dev/runtime-preview/facts/runtime-preview-refresh-targets-20260627.md`：`db://assets`、目录、文件 target refresh 行为事实记录。

Modify:

- `src/core/scripting/index.ts`：暴露 `hasPendingCompileTask()` 与 `waitForIdle()`，供 refresh coordinator 判断脚本 idle。
- `src/commands/preview.ts`：新增 `--refresh-on-reload` CLI 参数和校验传递。
- `src/core/launcher.ts`：`startRuntimePreview()` 接收 `refreshOnReload`，并向 server 传入 `prepareRuntimePreview`。
- `src/runtime-preview/server/runtime-preview-server.ts`：注册 refresh endpoint、root reload check、body parse error 处理、server option。
- `src/runtime-preview/server/runtime-preview-routes.ts`：route context 接收 refresh state，root HTML 注入。
- `src/runtime-preview/server/preview-entry-template.ts`：必要时导出 HTML 注入调用点；不改变 template 选择策略。
- `static/runtime-preview/toolbar.ejs`：默认 toolbar 增加 `Refresh` 按钮。
- `static/runtime-preview/resources/index.css`：refresh 按钮、busy、fixed fallback、toast 样式。
- `vitests/suites/runtime-preview/runtime-preview-express-server.test.ts`：endpoint protocol / reload check route contract。
- `vitests/suites/runtime-preview/preview-app-route-contract.test.ts`：root HTML 注入和 custom template fallback contract。
- `docs/dev/runtime-preview/issues.md`：实现后回填 `RP-ISSUE-029` 计划和验收入口。

---

### Task 0: AssetDB refresh target fact probe

**Files:**
- Create: `vitests/scripts/runtime-preview-refresh-assetdb-probe.mjs`
- Create: `docs/dev/runtime-preview/facts/runtime-preview-refresh-targets-20260627.md`

- [ ] **Step 1: 编写真实 AssetDB probe**

脚本必须启动 CLI 的 AssetDB 初始化链路，不使用 mock。probe 使用临时复制项目或专项 fixture，分别修改：

- `db://assets` root 下新增普通资源。
- `db://assets/resources` 目录下新增普通资源。
- `assets/resources/refresh-target-file.json` 文件内容。

脚本依次调用三种 candidate target：

```ts
await assetOperation.refreshAsset('db://assets');
await assetOperation.refreshAsset('db://assets/resources');
await assetOperation.refreshAsset(absoluteFilePath);
```

每次 refresh 后通过 `assetQuery.queryAssetInfo(targetUrl)` 或实际 library output 检查新增/修改是否进入 AssetDB。输出 JSON：

```json
{
  "projectKind": "temporary-runtime-preview-fixture",
  "targets": {
    "dbRoot": { "target": "db://assets", "ok": true, "changedAssetCount": null, "observedAsset": "db://assets/resources/refresh-root.json" },
    "directory": { "target": "db://assets/resources", "ok": true, "changedAssetCount": 1, "observedAsset": "db://assets/resources/refresh-dir.json" },
    "absoluteFile": { "target": "E:/tmp/project/assets/resources/refresh-target-file.json", "ok": true, "changedAssetCount": 1, "observedAsset": "db://assets/resources/refresh-target-file.json" }
  }
}
```

示例 JSON 只说明 shape；实际脚本必须写入真实观测值，不能把示例值作为结果。

- [ ] **Step 2: 运行 probe**

Run:

```powershell
rtk pwsh -NoProfile -Command "$env:COCOS_CLI_TEST_ENGINE_ROOT='<engine root for Vitest/probe harness>'; node vitests/scripts/runtime-preview-refresh-assetdb-probe.mjs"
```

Expected: 三种 target 都有明确 `ok` / error 结果。`COCOS_CLI_TEST_ENGINE_ROOT` 只作为 probe harness 输入，不得作为 production 默认行为结论。

- [ ] **Step 3: 根据 probe 结果更新 refresh strategy**

如果 `assetOperation.refreshAsset('db://assets')` 不能可靠刷新 DB root，则 Task 2 的 coordinator 必须把无 target 映射为 probe 证明可行的 API，例如 `assetDBManager.refresh()` 或逐 DB root operation。计划执行者必须在 `runtime-refresh-coordinator.ts` 中用 probe 结果对应的实际 API，不能继续假设 `db://assets` root 一定可用。

- [ ] **Step 4: 写 facts**

`docs/dev/runtime-preview/facts/runtime-preview-refresh-targets-20260627.md` 必须记录：

```markdown
# Runtime Preview Refresh Targets 2026-06-27

## 范围

- 测试层级：真实 AssetDB probe
- 项目/fixture 分类：临时复制项目或专项 fixture
- engine root 输入：
- 环境变量：
- 不能证明的边界：

## 结果

| target 类型 | target | API | 结果 | changedAssetCount 语义 |
| --- | --- | --- | --- | --- |
| DB root | `db://assets` | `assetOperation.refreshAsset` 或 fallback | 写入 probe 结果 | 写入 probe 结果 |
| directory | `db://assets/resources` | `assetOperation.refreshAsset` | 写入 probe 结果 | 写入 probe 结果 |
| absolute file | `<project>/assets/resources/refresh-target-file.json` | `assetOperation.refreshAsset` | 写入 probe 结果 | 写入 probe 结果 |
```

- [ ] **Step 5: Commit**

```powershell
rtk pwsh -NoProfile -Command "git add vitests/scripts/runtime-preview-refresh-assetdb-probe.mjs docs/dev/runtime-preview/facts/runtime-preview-refresh-targets-20260627.md; git commit -m 'test(runtime-preview): record refresh target behavior'"
```

---

### Task 1: Script idle API

**Files:**
- Modify: `src/core/scripting/index.ts`
- Test: `src/core/scripting/test/script-manager.test.ts`

- [ ] **Step 1: 写失败测试**

在 `src/core/scripting/test/script-manager.test.ts` 增加测试，mock `PackerDriver.getInstance()`：

```ts
it('reports pending compile timer and waits until scripting is idle', async () => {
  const scripting = (await import('../index')).default;
  const driver = PackerDriver.getInstance();
  jest.useFakeTimers();
  jest.spyOn(driver, 'busy')
    .mockReturnValueOnce(true)
    .mockReturnValueOnce(false);
  jest.spyOn(driver, 'build').mockResolvedValue(undefined);

  expect(scripting.hasPendingCompileTask()).toBe(false);
  const taskId = scripting.postCompileScripts(10);
  expect(taskId).toMatch(/[0-9a-f-]+/);
  expect(scripting.hasPendingCompileTask()).toBe(true);

  await jest.advanceTimersByTimeAsync(10);
  await scripting.waitForIdle({ timeoutMs: 1000, pollMs: 1 });

  expect(scripting.hasPendingCompileTask()).toBe(false);
  expect(driver.busy()).toBe(false);
  jest.useRealTimers();
});
```

- [ ] **Step 2: 运行失败测试**

Run:

```powershell
rtk pwsh -NoProfile -Command "npm run test -- src/core/scripting/test/script-manager.test.ts --runInBand"
```

Expected: FAIL，提示 `hasPendingCompileTask` 或 `waitForIdle` 不存在。

- [ ] **Step 3: 实现 API**

在 `ScriptManager` 增加：

```ts
private _pendingCompilePromise: Promise<void> | null = null;

hasPendingCompileTask(): boolean {
    return this._pendingCompileTimer !== null
        || this._pendingCompileTaskId !== null
        || this._pendingCompilePromise !== null;
}

async waitForIdle(options: { timeoutMs?: number; pollMs?: number } = {}): Promise<void> {
    const timeoutMs = options.timeoutMs ?? 30_000;
    const pollMs = options.pollMs ?? 50;
    const startedAt = Date.now();
    while (this.isCompiling() || this.hasPendingCompileTask()) {
        if (Date.now() - startedAt > timeoutMs) {
            throw new Error(`Scripting did not become idle within ${timeoutMs}ms.`);
        }
        if (this._pendingCompilePromise) {
            await this._pendingCompilePromise.catch(() => undefined);
            continue;
        }
        await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
}
```

同时修正 `postCompileScripts()` 的 timer callback：`PackerDriver.getInstance().build(assetChanges, taskId)` 必须赋给 `_pendingCompilePromise` 并 `await`，`finally` 中清空 promise。这样 `waitForIdle()` 不会在 delayed build 进入 `busy()` 前提前返回。

- [ ] **Step 4: 运行测试确认通过**

Run:

```powershell
rtk pwsh -NoProfile -Command "npm run test -- src/core/scripting/test/script-manager.test.ts --runInBand"
```

Expected: PASS。

- [ ] **Step 5: Commit**

```powershell
rtk pwsh -NoProfile -Command "git add src/core/scripting/index.ts src/core/scripting/test/script-manager.test.ts; git commit -m 'feat(runtime-preview): expose scripting idle wait'"
```

---

### Task 2: Runtime refresh coordinator

**Files:**
- Create: `src/runtime-preview/refresh/runtime-refresh-coordinator.ts`
- Test: `vitests/suites/runtime-preview/runtime-refresh-coordinator.test.ts`

- [ ] **Step 1: 写 coordinator 测试**

测试覆盖 target 归一化、越界、防并发、cache invalidation、script timeout：

```ts
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createRuntimeRefreshCoordinator } from '@runtime-preview/refresh/runtime-refresh-coordinator';

function createFixture() {
  const projectRoot = 'E:/tmp/project';
  const refreshAsset = vi.fn(async () => 3);
  const waitForIdle = vi.fn(async () => undefined);
  const invalidateSettings = vi.fn();
  const clearImportReplacement = vi.fn();
  const logger = { write: vi.fn(async () => undefined) };
  const coordinator = createRuntimeRefreshCoordinator({
    projectRoot,
    refreshAsset,
    waitForIdle,
    invalidateSettings,
    clearImportReplacement,
    logger,
    now: () => Date.now(),
  });
  return { coordinator, refreshAsset, waitForIdle, invalidateSettings, clearImportReplacement, projectRoot };
}

it('refreshes db assets root when target is omitted', async () => {
  const fixture = createFixture();
  const result = await fixture.coordinator.refresh({ reason: 'endpoint' });
  expect(result.ok).toBe(true);
  expect(result.target).toBe('db://assets');
  expect(fixture.refreshAsset).toHaveBeenCalledWith('db://assets');
  expect(fixture.invalidateSettings).toHaveBeenCalledTimes(1);
  expect(fixture.clearImportReplacement).toHaveBeenCalledTimes(1);
});

it('rejects paths outside project assets without scanning', async () => {
  const fixture = createFixture();
  const result = await fixture.coordinator.refresh({
    reason: 'endpoint',
    target: 'E:/tmp/project/../outside/asset.txt',
  });
  expect(result.ok).toBe(false);
  expect(result.error).toContain('outside project assets root');
  expect(fixture.refreshAsset).not.toHaveBeenCalled();
});

it('converts absolute asset paths to db urls', async () => {
  const fixture = createFixture();
  const result = await fixture.coordinator.refresh({
    reason: 'endpoint',
    target: join(fixture.projectRoot, 'assets', 'resources', 'a.json'),
  });
  expect(result.ok).toBe(true);
  expect(fixture.refreshAsset).toHaveBeenCalledWith('db://assets/resources/a.json');
});

it('dedupes reload immediately after endpoint success', async () => {
  let now = 1000;
  const fixture = createFixture();
  const coordinator = createRuntimeRefreshCoordinator({
    projectRoot: fixture.projectRoot,
    refreshAsset: fixture.refreshAsset,
    waitForIdle: fixture.waitForIdle,
    invalidateSettings: fixture.invalidateSettings,
    clearImportReplacement: fixture.clearImportReplacement,
    logger: { write: vi.fn(async () => undefined) },
    now: () => now,
    reloadDedupeWindowMs: 2000,
  });
  await coordinator.refresh({ reason: 'endpoint' });
  now = 1500;
  const result = await coordinator.refresh({ reason: 'reload' });
  expect(result.ok).toBe(true);
  expect(result.scriptCompile.status).toBe('skipped');
  expect(fixture.refreshAsset).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: 运行失败测试**

Run:

```powershell
rtk pwsh -NoProfile -Command "npm --prefix vitests run test -- suites/runtime-preview/runtime-refresh-coordinator.test.ts"
```

Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现 coordinator**

核心接口：

```ts
export type RuntimeRefreshReason = 'endpoint' | 'reload';

export interface RuntimeRefreshRequest {
    reason: RuntimeRefreshReason;
    target?: unknown;
}

export interface RuntimeRefreshResult {
    ok: boolean;
    refreshId: string;
    target: string;
    reason: RuntimeRefreshReason;
    changedAssetCount: number | null;
    scriptCompile: { status: 'done' | 'skipped' | 'failed'; durationMs: number; error?: string };
    durationMs: number;
    error?: string;
}

export function createRuntimeRefreshCoordinator(options: RuntimeRefreshCoordinatorOptions) {
    let inFlight: Promise<RuntimeRefreshResult> | null = null;
    let lastEndpointSuccess: { completedAt: number; target: string } | null = null;
    return {
        async refresh(request: RuntimeRefreshRequest): Promise<RuntimeRefreshResult> {
            const normalized = normalizeRuntimeRefreshTarget(options.projectRoot, request.target);
            if (!normalized.ok) {
                return createFailure(request.reason, normalized.target ?? 'db://assets', normalized.error);
            }
            if (request.reason === 'reload' && shouldSkipReload(options, lastEndpointSuccess, normalized.target)) {
                return createSkipped(request.reason, normalized.target);
            }
            if (inFlight) {
                return inFlight;
            }
            inFlight = runRefresh(options, request.reason, normalized.target)
                .finally(() => { inFlight = null; });
            const result = await inFlight;
            if (result.ok && request.reason === 'endpoint') {
                lastEndpointSuccess = { completedAt: options.now(), target: normalized.target };
            }
            return result;
        },
    };
}
```

`runRefresh()` 顺序固定为 `refreshTarget(target)`、`waitForIdle()`、`invalidateSettings()`、`clearImportReplacement()`、写 log。`refreshTarget` 的实际实现必须来自 Task 0 的 probe 结论：如果 `db://assets` root 可由 `assetOperation.refreshAsset` 处理，则用该 API；如果不可行，则无 target path 改用 probe 证明可行的 `assetDBManager.refresh()` 或等价 DB root API。任何 operation error 返回 `ok:false`，不 throw 到 HTTP root。

- [ ] **Step 4: 运行 coordinator 测试**

Run:

```powershell
rtk pwsh -NoProfile -Command "npm --prefix vitests run test -- suites/runtime-preview/runtime-refresh-coordinator.test.ts"
```

Expected: PASS。

- [ ] **Step 5: Commit**

```powershell
rtk pwsh -NoProfile -Command "git add src/runtime-preview/refresh/runtime-refresh-coordinator.ts vitests/suites/runtime-preview/runtime-refresh-coordinator.test.ts; git commit -m 'feat(runtime-preview): add refresh coordinator'"
```

---

### Task 3: Refresh endpoint and reload check

**Files:**
- Modify: `src/runtime-preview/server/runtime-preview-server.ts`
- Modify: `src/runtime-preview/server/runtime-preview-routes.ts`
- Modify: `src/runtime-preview/settings/preview-settings-provider.ts` if tests need a spy-safe invalidate contract only.
- Test: `vitests/suites/runtime-preview/runtime-preview-express-server.test.ts`

- [ ] **Step 1: 写 endpoint / reload route tests**

在 `runtime-preview-express-server.test.ts` 新增：

```ts
it('handles runtime refresh endpoint success before generic route handler', async () => {
  const refresh = vi.fn(async () => ({
    ok: true,
    refreshId: 'refresh-1',
    target: 'db://assets',
    reason: 'endpoint',
    changedAssetCount: null,
    scriptCompile: { status: 'done', durationMs: 1 },
    durationMs: 2,
  }));
  const { server } = await createServerFixture({ refreshCoordinator: { refresh } });
  try {
    const response = await fetch(`${server.url}/__runtime-preview/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, target: 'db://assets' });
    expect(refresh).toHaveBeenCalledWith({ reason: 'endpoint' });
  } finally {
    await server.close();
  }
});

it('returns 400 for malformed refresh JSON', async () => {
  const { server } = await createServerFixture();
  try {
    const response = await fetch(`${server.url}/__runtime-preview/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"target":',
    });
    expect(response.status).toBe(400);
    expect(await response.text()).toContain('Invalid runtime refresh JSON body.');
  } finally {
    await server.close();
  }
});

it('runs refresh-on-reload before root html render when enabled', async () => {
  const order: string[] = [];
  const refresh = vi.fn(async () => {
    order.push('refresh');
    return { ok: true, refreshId: 'r', target: 'db://assets', reason: 'reload', changedAssetCount: null, scriptCompile: { status: 'done', durationMs: 0 }, durationMs: 0 };
  });
  const settingsProvider = new PreviewSettingsProvider({
    loadPreviewSettings: async () => {
      order.push('settings');
      return { settings: { assets: { server: '' } }, script2library: {}, bundleConfigs: [] };
    },
  });
  const { server } = await createServerFixture({ refreshOnReload: true, refreshCoordinator: { refresh }, settingsProvider });
  try {
    const response = await fetch(`${server.url}/`);
    expect(response.status).toBe(200);
    expect(order.slice(0, 2)).toEqual(['refresh', 'settings']);
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

Expected: FAIL，server options / endpoint 不存在。

- [ ] **Step 3: 扩展 server options**

在 `RuntimePreviewServerOptions` 增加：

```ts
refreshOnReload?: boolean;
refreshCoordinator?: {
    refresh(request: { reason: 'endpoint' | 'reload'; target?: unknown }): Promise<RuntimeRefreshResult>;
};
prepareRuntimePreview?: (serverUrl: string) => Promise<void>;
```

真实 server 未传 `refreshCoordinator` 时，在 `startRuntimePreviewServer()` 内创建 coordinator：

```ts
const refreshCoordinator = options.refreshCoordinator ?? createRuntimeRefreshCoordinator({
    projectRoot: context.projectRoot,
    refreshTarget: createRuntimeRefreshTarget({
        refreshAsset: async (target) => assetOperation.refreshAsset(target),
        refreshAssetDbRoot: async () => assetDBManager.refresh(),
    }),
    waitForIdle: async () => scripting.waitForIdle({ timeoutMs: 30_000 }),
    invalidateSettings: () => getSettingsProvider().invalidate(),
    clearImportReplacement: () => importReplacementExtensionResolver.clear(),
    logger,
});
```

`createRuntimeRefreshTarget()` 必须按 Task 0 facts 选择 root target 的 API：如果 `assetOperation.refreshAsset('db://assets')` 被 probe 证明可用，就对所有 target 统一调用 `refreshAsset(target)`；如果 root target 不可靠，则仅无 target / `db://assets` 使用 `refreshAssetDbRoot()`，目录和文件继续使用 `refreshAsset(target)`。

refresh 前执行时必须传入最终 URL：

```ts
await options.prepareRuntimePreview?.(serverUrl);
```

- [ ] **Step 4: 注册 endpoint**

在 `const app = express(); app.disable('x-powered-by');` 之后、当前 generic `app.use(async (request: Request, response: Response, next: NextFunction) => {` 之前注册：

```ts
app.all('/__runtime-preview/refresh', (request, response, next) => {
    if (request.method !== 'POST') {
        response.status(405).type('text/plain').send('Runtime refresh only supports POST.');
        return;
    }
    next();
});

app.post('/__runtime-preview/refresh', express.json({
    type: () => true,
    limit: maxRuntimeRefreshBodyBytes,
}), async (request, response, next) => {
    try {
        const body = request.body ?? {};
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
            response.status(400).type('text/plain').send('Runtime refresh body must be a JSON object.');
            return;
        }
        await options.prepareRuntimePreview?.(serverUrl);
        const result = await refreshCoordinator.refresh({ reason: 'endpoint', target: body.target });
        response.status(200).type('application/json').send(JSON.stringify(result));
    } catch (error) {
        next(error);
    }
});
```

error middleware 增加 JSON parse error：

```ts
if (isJsonParseError(error)) {
    response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Invalid runtime refresh JSON body.');
    return;
}
```

- [ ] **Step 5: root reload check**

在 generic handler 中，`pathname === '/'` 且 `options.refreshOnReload === true` 时，在调用 `handleRuntimePreviewRequest()` 前执行：

```ts
let runtimeRefreshState: RuntimeRefreshClientState | undefined;
if (pathname === '/' && options.refreshOnReload === true) {
    await options.prepareRuntimePreview?.(serverUrl);
    const result = await refreshCoordinator.refresh({ reason: 'reload' });
    runtimeRefreshState = result.ok ? { lastRefresh: result } : { refreshOnReloadFailure: result };
}
```

传给 `handleRuntimePreviewRequest()`：

```ts
const routeResponse = await handleRuntimePreviewRequest({
    runtimeContext: context,
    settingsProvider: getSettingsProvider(),
    capturedRuntimeUrls: options.capturedRuntimeUrls,
    logger,
    method: request.method,
    body: typeof request.body === 'string' ? request.body : undefined,
    importReplacementExtensionResolver,
    runtimeRefreshState,
}, request.originalUrl || request.url || '/');
```

- [ ] **Step 6: 运行测试**

Task 3 必须同时覆盖以下协议和失败行为：

```ts
it('returns 405 for non-POST runtime refresh requests', async () => {
  const { server } = await createServerFixture();
  try {
    const response = await fetch(`${server.url}/__runtime-preview/refresh`);
    expect(response.status).toBe(405);
  } finally {
    await server.close();
  }
});

it('returns 400 for non-object JSON refresh body', async () => {
  const { server } = await createServerFixture();
  try {
    const response = await fetch(`${server.url}/__runtime-preview/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '[]',
    });
    expect(response.status).toBe(400);
  } finally {
    await server.close();
  }
});

it('returns 413 for oversized runtime refresh body', async () => {
  const { server } = await createServerFixture();
  try {
    const response = await fetch(`${server.url}/__runtime-preview/refresh`, {
      method: 'POST',
      body: 'x'.repeat(64 * 1024 + 1),
    });
    expect(response.status).toBe(413);
  } finally {
    await server.close();
  }
});

it('returns 200 ok false for refresh operation failure', async () => {
  const refresh = vi.fn(async () => ({
    ok: false,
    refreshId: 'refresh-fail',
    target: 'db://assets',
    reason: 'endpoint',
    changedAssetCount: null,
    scriptCompile: { status: 'failed', durationMs: 0, error: 'compile failed' },
    durationMs: 1,
    error: 'compile failed',
  }));
  const { server } = await createServerFixture({ refreshCoordinator: { refresh } });
  try {
    const response = await fetch(`${server.url}/__runtime-preview/refresh`, { method: 'POST', body: '{}' });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: false, error: 'compile failed' });
  } finally {
    await server.close();
  }
});

it('does not refresh root html when refresh-on-reload is disabled', async () => {
  const refresh = vi.fn();
  const { server } = await createServerFixture({ refreshOnReload: false, refreshCoordinator: { refresh } });
  try {
    const response = await fetch(`${server.url}/`);
    expect(response.status).toBe(200);
    expect(refresh).not.toHaveBeenCalled();
  } finally {
    await server.close();
  }
});

it('keeps serving root html when reload refresh fails', async () => {
  const refresh = vi.fn(async () => ({
    ok: false,
    refreshId: 'reload-fail',
    target: 'db://assets',
    reason: 'reload',
    changedAssetCount: null,
    scriptCompile: { status: 'failed', durationMs: 0 },
    durationMs: 1,
    error: 'reload refresh failed',
  }));
  const { server } = await createServerFixture({ refreshOnReload: true, refreshCoordinator: { refresh } });
  try {
    const response = await fetch(`${server.url}/`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('reload refresh failed');
  } finally {
    await server.close();
  }
});

it('passes the final server URL into prepareRuntimePreview before refresh', async () => {
  const prepareRuntimePreview = vi.fn(async (_serverUrl: string) => undefined);
  const refresh = vi.fn(async () => ({
    ok: true,
    refreshId: 'r',
    target: 'db://assets',
    reason: 'endpoint',
    changedAssetCount: null,
    scriptCompile: { status: 'done', durationMs: 0 },
    durationMs: 0,
  }));
  const { server } = await createServerFixture({ prepareRuntimePreview, refreshCoordinator: { refresh } });
  try {
    await fetch(`${server.url}/__runtime-preview/refresh`, { method: 'POST', body: '{}' });
    expect(prepareRuntimePreview).toHaveBeenCalledWith(server.url);
  } finally {
    await server.close();
  }
});
```

Run:

```powershell
rtk pwsh -NoProfile -Command "npm --prefix vitests run test -- suites/runtime-preview/runtime-preview-express-server.test.ts"
```

Expected: PASS。

- [ ] **Step 7: Commit**

```powershell
rtk pwsh -NoProfile -Command "git add src/runtime-preview/server/runtime-preview-server.ts src/runtime-preview/server/runtime-preview-routes.ts vitests/suites/runtime-preview/runtime-preview-express-server.test.ts; git commit -m 'feat(runtime-preview): expose refresh endpoint'"
```

---

### Task 4: HTML injection and browser installer

**Files:**
- Create: `src/runtime-preview/server/runtime-refresh-entry-injection.ts`
- Modify: `src/runtime-preview/server/runtime-preview-routes.ts`
- Modify: `static/runtime-preview/toolbar.ejs`
- Modify: `static/runtime-preview/resources/index.css`
- Test: `vitests/suites/runtime-preview/runtime-refresh-entry-injection.test.ts`
- Test: `vitests/suites/runtime-preview/preview-app-route-contract.test.ts`

- [ ] **Step 1: 写 HTML 注入测试**

```ts
import { describe, expect, it } from 'vitest';
import { injectRuntimeRefreshEntry } from '@runtime-preview/server/runtime-refresh-entry-injection';

it('injects refresh state and installer into html with a body tag', () => {
  const html = '<html><body><div id="GameDiv"></div></body></html>';
  const result = injectRuntimeRefreshEntry(html, {
    refreshOnReloadFailure: { ok: false, refreshId: 'r1', target: 'db://assets', reason: 'reload', changedAssetCount: null, scriptCompile: { status: 'failed', durationMs: 0 }, durationMs: 1, error: 'boom' },
  });
  expect(result).toContain('window.__RUNTIME_PREVIEW_REFRESH_STATE__');
  expect(result).toContain('installRuntimePreviewRefreshButton');
  expect(result).toContain('</body>');
});

it('appends installer when html has no body tag', () => {
  const result = injectRuntimeRefreshEntry('<div>preview</div>', undefined);
  expect(result).toContain('<div>preview</div>');
  expect(result).toContain('btn-runtime-refresh');
});
```

- [ ] **Step 2: 运行失败测试**

Run:

```powershell
rtk pwsh -NoProfile -Command "npm --prefix vitests run test -- suites/runtime-preview/runtime-refresh-entry-injection.test.ts"
```

Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现注入 helper**

`injectRuntimeRefreshEntry(html, state)` 生成一个 `<script>`，其中只包含 browser installer 和 JSON state。关键 browser 逻辑：

```js
(function installRuntimePreviewRefreshButton() {
  var state = window.__RUNTIME_PREVIEW_REFRESH_STATE__ || null;
  function showRefreshMessage(message) {
    var toast = document.querySelector('#runtime-preview-refresh-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'runtime-preview-refresh-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.style.display = 'block';
  }
  async function triggerRefresh(button) {
    button && (button.disabled = true);
    try {
      var response = await fetch('/__runtime-preview/refresh', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      var result = await response.json();
      window.__RUNTIME_PREVIEW_LAST_REFRESH__ = result;
      if (result.ok) {
        window.location.reload();
        return;
      }
      showRefreshMessage(result.error || 'Runtime refresh failed.');
      console.warn('[runtime-preview] refresh failed', result);
    } catch (error) {
      window.__RUNTIME_PREVIEW_LAST_REFRESH__ = { ok: false, error: String(error) };
      showRefreshMessage(String(error));
      console.warn('[runtime-preview] refresh request failed', error);
    } finally {
      button && (button.disabled = false);
    }
  }
  function ensureButton() {
    var button = document.querySelector('#btn-runtime-refresh');
    if (!button) {
      button = document.createElement('button');
      button.id = 'btn-runtime-refresh';
      button.type = 'button';
      button.textContent = 'Refresh';
    }
    if (!button.dataset.runtimeRefreshInstalled) {
      button.dataset.runtimeRefreshInstalled = '1';
      button.addEventListener('click', function() { triggerRefresh(button); });
    }
    var toolbar = document.querySelector('.toolbar');
    if (toolbar && button.parentElement !== toolbar) {
      toolbar.appendChild(button);
      button.classList.remove('runtime-preview-refresh-fixed');
    } else if (!toolbar && !button.parentElement) {
      button.className = 'runtime-preview-refresh-fixed';
      document.body.appendChild(button);
    } else if (!toolbar) {
      button.classList.add('runtime-preview-refresh-fixed');
    }
  }
  function boot() {
    ensureButton();
    if (state && state.refreshOnReloadFailure) {
      window.__RUNTIME_PREVIEW_REFRESH_ON_RELOAD__ = state.refreshOnReloadFailure;
      showRefreshMessage(state.refreshOnReloadFailure.error || 'Runtime reload refresh failed.');
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
```

- [ ] **Step 4: toolbar 和 CSS**

`static/runtime-preview/toolbar.ejs` 添加：

```html
<button id="btn-runtime-refresh" class="item" type="button" title="Refresh AssetDB">Refresh</button>
```

`static/runtime-preview/resources/index.css` 添加：

```css
#btn-runtime-refresh[disabled] {
    opacity: 0.6;
    pointer-events: none;
}

.runtime-preview-refresh-fixed {
    position: fixed;
    right: 12px;
    top: 12px;
    z-index: 9999;
}

#runtime-preview-refresh-toast {
    position: fixed;
    right: 12px;
    top: 52px;
    max-width: 420px;
    padding: 8px 10px;
    background: rgba(20, 20, 20, 0.92);
    color: #fff;
    font-size: 12px;
    line-height: 1.4;
    z-index: 9999;
}
```

- [ ] **Step 5: route 接入注入**

在 root route 返回 HTML 前调用：

```ts
const html = await renderRuntimePreviewEntry(context.runtimeContext, context.settingsProvider, requestPath);
return textResponse(
    200,
    injectRuntimeRefreshEntry(html, context.runtimeRefreshState),
    'text/html; charset=utf-8',
);
```

本轮只采用 server post-process 注入，不修改 `static/runtime-preview/script.ejs`。这样 custom template 即使没有 include `cocosTemplate`，只要 root response 仍是 CLI 渲染出的 HTML，就能获得 installer。

- [ ] **Step 6: route contract 测试 custom template**

在 `preview-app-route-contract.test.ts` 增加 custom template 不 include toolbar 的测试，断言 root HTML 仍包含 installer 和 `btn-runtime-refresh` 逻辑。

- [ ] **Step 7: 运行测试**

Run:

```powershell
rtk pwsh -NoProfile -Command "npm --prefix vitests run test -- suites/runtime-preview/runtime-refresh-entry-injection.test.ts suites/runtime-preview/preview-app-route-contract.test.ts"
```

Expected: PASS。

- [ ] **Step 8: Commit**

```powershell
rtk pwsh -NoProfile -Command "git add src/runtime-preview/server/runtime-refresh-entry-injection.ts src/runtime-preview/server/runtime-preview-routes.ts static/runtime-preview/toolbar.ejs static/runtime-preview/resources/index.css vitests/suites/runtime-preview/runtime-refresh-entry-injection.test.ts vitests/suites/runtime-preview/preview-app-route-contract.test.ts; git commit -m 'feat(runtime-preview): add refresh button installer'"
```

---

### Task 5: CLI option and launcher wiring

**Files:**
- Modify: `src/commands/preview.ts`
- Modify: `src/core/launcher.ts`
- Test: `vitests/suites/runtime-preview/launcher-runtime-preview.test.ts`
- Test: `vitests/suites/runtime-preview/cli-startup.test.ts`

- [ ] **Step 1: 写 CLI/launcher 测试**

在 launcher 测试中 spy `startRuntimePreviewServer`，断言 `refreshOnReload` 和 `prepareRuntimePreview` 传入：

```ts
it('passes refresh-on-reload to runtime preview server', async () => {
  const serverSpy = vi.spyOn(runtimePreviewModule, 'startRuntimePreviewServer').mockResolvedValue(createStartedServer());
  const launcher = new Launcher(projectRoot);
  await launcher.startRuntimePreview({ port: 0, refreshOnReload: true });
  expect(serverSpy).toHaveBeenCalledWith(expect.objectContaining({
    refreshOnReload: true,
    prepareRuntimePreview: expect.any(Function),
  }));
});
```

并补充 URL-aware prepare 顺序测试：

```ts
it('uses the server url provided by prepareRuntimePreview instead of an outer empty url', async () => {
  let capturedPrepare: ((serverUrl: string) => Promise<void>) | undefined;
  vi.spyOn(runtimePreviewModule, 'startRuntimePreviewServer').mockImplementation(async (options) => {
    capturedPrepare = options.prepareRuntimePreview;
    return createStartedServer({ url: 'http://127.0.0.1:19999' });
  });
  const launcher = new Launcher(projectRoot);
  await launcher.startRuntimePreview({ port: 19999, refreshOnReload: true });
  await capturedPrepare?.('http://127.0.0.1:19999');
  expect(getPreviewSettingsSpy).toHaveBeenCalledWith(expect.objectContaining({
    server: 'http://127.0.0.1:19999',
  }));
});
```

在 CLI startup 测试中跑 `preview --help`，断言 help 包含 `--refresh-on-reload`。

- [ ] **Step 2: 运行失败测试**

Run:

```powershell
rtk pwsh -NoProfile -Command "npm --prefix vitests run test -- suites/runtime-preview/launcher-runtime-preview.test.ts suites/runtime-preview/cli-startup.test.ts"
```

Expected: FAIL，参数未传递或 help 缺少选项。

- [ ] **Step 3: 修改 CLI**

`src/commands/preview.ts` 增加：

```ts
.option('--refresh-on-reload', 'Run one AssetDB refresh before serving the runtime preview root page')
```

传入 launcher：

```ts
refreshOnReload: options.refreshOnReload === true,
```

- [ ] **Step 4: 修改 launcher**

`startRuntimePreview(options)` 类型增加：

```ts
refreshOnReload?: boolean;
```

把 `ensurePreviewSettingsReady` 改成接收 server URL，不能继续只读外层 `serverUrl`：

```ts
let preparePreviewSettings: Promise<void> | null = null;
let preparedServerUrl = '';
const ensurePreviewSettingsReady = (runtimeServerUrl: string) => {
    if (!preparePreviewSettings) {
        preparedServerUrl = runtimeServerUrl;
        preparePreviewSettings = (async () => {
            const engineServerUrl = runtimeServerUrl.endsWith('/') ? runtimeServerUrl : `${runtimeServerUrl}/`;
            await this.import({
                serverURL: engineServerUrl,
                diagnostics,
                clearRuntimePreviewProgrammingCache: options.clearProgrammingCache === true,
                programmingRoot: projectProgrammingRoot,
            });
            const { init: initBuilder } = await import('./builder');
            diagnostics.stageStart('builder:init');
            try {
                await initBuilder();
                diagnostics.stageDone('builder:init');
            } catch (error) {
                diagnostics.stageError('builder:init', error);
                throw error;
            }
        })();
    } else if (preparedServerUrl !== runtimeServerUrl) {
        throw new Error(`Runtime preview was prepared for ${preparedServerUrl}, not ${runtimeServerUrl}.`);
    }
    return preparePreviewSettings;
};
```

`PreviewSettingsProvider.loadPreviewSettings` 使用 `const activeServerUrl = serverUrl || preparedServerUrl`，不能只读外层 `serverUrl`：

```ts
const activeServerUrl = serverUrl || preparedServerUrl;
if (!activeServerUrl) {
    throw new Error('Runtime preview settings requested before server URL was assigned.');
}
const result = await getPreviewSettings({
    ...(buildOptions ?? {}),
    server: activeServerUrl,
    startScene,
} as never);
```

这样即使固定端口在 `startRuntimePreviewServer()` listen 后、Launcher 赋值 `serverUrl = server.url` 前收到 root/refresh 请求，`prepareRuntimePreview(server.url)` 也会把 settings generation 需要的 URL 写入 `preparedServerUrl`。

`startRuntimePreviewServer()` 参数增加：

```ts
refreshOnReload: options.refreshOnReload === true,
prepareRuntimePreview: ensurePreviewSettingsReady,
```

- [ ] **Step 5: 运行测试**

Run:

```powershell
rtk pwsh -NoProfile -Command "npm --prefix vitests run test -- suites/runtime-preview/launcher-runtime-preview.test.ts suites/runtime-preview/cli-startup.test.ts"
```

Expected: PASS。

- [ ] **Step 6: Commit**

```powershell
rtk pwsh -NoProfile -Command "git add src/commands/preview.ts src/core/launcher.ts vitests/suites/runtime-preview/launcher-runtime-preview.test.ts vitests/suites/runtime-preview/cli-startup.test.ts; git commit -m 'feat(runtime-preview): wire refresh-on-reload option'"
```

---

### Task 6: Browser integration for button and failure behavior

**Files:**
- Create: `vitests/suites/runtime-preview/runtime-refresh-browser.test.ts`

- [ ] **Step 1: 写 browser 测试**

使用 `startRuntimePreviewServer()` 的 fake coordinator，不启动真实 AssetDB：

```ts
it('clicking Refresh posts to endpoint and reloads after ok response', async () => {
  const refresh = vi.fn(async () => ({
    ok: true,
    refreshId: 'button-ok',
    target: 'db://assets',
    reason: 'endpoint',
    changedAssetCount: null,
    scriptCompile: { status: 'done', durationMs: 0 },
    durationMs: 1,
  }));
  const { server, page } = await openRuntimePreviewPage({ refreshCoordinator: { refresh } });
  try {
    await page.goto(server.url);
    await page.click('#btn-runtime-refresh');
    await page.waitForFunction(() => Boolean(window.__RUNTIME_PREVIEW_LAST_REFRESH__?.ok));
    expect(refresh).toHaveBeenCalledWith({ reason: 'endpoint' });
  } finally {
    await page.close();
    await server.close();
  }
});

it('shows fixed fallback button when custom template has no toolbar', async () => {
  const { server, page } = await openRuntimePreviewPage({ customTemplate: '<html><body><canvas id="GameCanvas"></canvas><%- include(cocosTemplate, {}) %></body></html>' });
  try {
    await page.goto(server.url);
    const button = page.locator('#btn-runtime-refresh');
    await expect(button).toBeVisible();
    await expect(button).toHaveClass(/runtime-preview-refresh-fixed/);
  } finally {
    await page.close();
    await server.close();
  }
});

it('shows refresh failure prompt without console.error and without reload', async () => {
  const refresh = vi.fn(async () => ({
    ok: false,
    refreshId: 'button-fail',
    target: 'db://assets',
    reason: 'endpoint',
    changedAssetCount: null,
    scriptCompile: { status: 'failed', durationMs: 0, error: 'compile failed' },
    durationMs: 1,
    error: 'compile failed',
  }));
  const consoleErrors: string[] = [];
  const { server, page } = await openRuntimePreviewPage({ refreshCoordinator: { refresh } });
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  try {
    await page.goto(server.url);
    const beforeUrl = page.url();
    await page.click('#btn-runtime-refresh');
    await expect(page.locator('#runtime-preview-refresh-toast')).toContainText('compile failed');
    expect(page.url()).toBe(beforeUrl);
    expect(consoleErrors).toEqual([]);
  } finally {
    await page.close();
    await server.close();
  }
});
```

- [ ] **Step 2: 运行失败测试**

Run:

```powershell
rtk pwsh -NoProfile -Command "npm --prefix vitests run test -- suites/runtime-preview/runtime-refresh-browser.test.ts"
```

Expected: FAIL，缺 helper 或 installer 行为未完成。

- [ ] **Step 3: 调整 browser helper**

如果现有 helper 不能创建轻量 page fixture，在测试文件内实现最小 `openRuntimePreviewPage()`：创建临时 project/engine/library/programming root，写入必要 `import-map.json`，用 `PreviewSettingsProvider` 返回最小 settings，启动 Chromium page。

- [ ] **Step 4: 运行 browser 测试**

Run:

```powershell
rtk pwsh -NoProfile -Command "npm --prefix vitests run test -- suites/runtime-preview/runtime-refresh-browser.test.ts"
```

Expected: PASS。

- [ ] **Step 5: Commit**

```powershell
rtk pwsh -NoProfile -Command "git add vitests/suites/runtime-preview/runtime-refresh-browser.test.ts; git commit -m 'test(runtime-preview): cover refresh button behavior'"
```

---

### Task 7: Resource/script refresh integration and performance data

**Files:**
- Create: `vitests/scripts/runtime-preview-refresh-performance.mjs`
- Modify: existing runtime preview integration suite if a suitable helper already exists; otherwise create focused tests under `vitests/suites/runtime-preview/runtime-refresh-live-integration.test.ts`.
- Create: `docs/dev/runtime-preview/facts/runtime-preview-explicit-refresh-performance-20260627.md`

- [ ] **Step 1: 写 live integration 测试**

使用临时复制项目或专项 fixture，不直接修改真实主测试项目源文件。测试流程：

```ts
it('refreshes a changed resource and browser reads the updated content after reload', async () => {
  const project = await createMutableRuntimePreviewFixture();
  await writeFile(join(project.assetsRoot, 'resources', 'runtime-refresh.json'), '{"value":"before"}', 'utf8');
  const preview = await startRealRuntimePreview(project, { refreshOnReload: false });
  try {
    await preview.page.goto(preview.url);
    await writeFile(join(project.assetsRoot, 'resources', 'runtime-refresh.json'), '{"value":"after"}', 'utf8');
    const response = await fetch(`${preview.url}/__runtime-preview/refresh`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(await response.json()).toMatchObject({ ok: true });
    await preview.page.reload();
    await expectRuntimeResourceValue(preview.page, 'after');
  } finally {
    await preview.close();
  }
});
```

脚本更新测试使用同一 fixture，修改 TS/JS 脚本中的 `window.__RUNTIME_PREVIEW_SCRIPT_REFRESH_VALUE__ = 'after'`，refresh 后 reload 并断言 browser global 值为 `after`。

- [ ] **Step 2: 运行 live integration 测试**

Run:

```powershell
rtk pwsh -NoProfile -Command "npm --prefix vitests run test -- suites/runtime-preview/runtime-refresh-live-integration.test.ts"
```

Expected: PASS。若失败，记录是 AssetDB refresh、script compile、library route 还是 browser cache 问题，不把失败绕成 mock 通过。

- [ ] **Step 3: 写性能脚本**

`vitests/scripts/runtime-preview-refresh-performance.mjs` 输出 JSON，包含：

```json
{
  "projectKind": "main-test-project-copy",
  "distBuilt": true,
  "testEnvCleared": true,
  "rounds": {
    "defaultOff": [{ "rootHtmlMs": 0, "settingsGenerationMs": 0, "readyMs": 0 }],
    "onNoChange": [{ "rootHtmlMs": 0, "assetDbRefreshMs": 0, "scriptCompileMs": 0, "settingsGenerationMs": 0, "readyMs": 0 }],
    "onChanged": [{ "rootHtmlMs": 0, "assetDbRefreshMs": 0, "scriptCompileMs": 0, "settingsGenerationMs": 0, "readyMs": 0 }]
  },
  "summary": {
    "defaultOff": { "min": 0, "median": 0, "max": 0 },
    "onNoChange": { "min": 0, "median": 0, "max": 0 },
    "onChanged": { "min": 0, "median": 0, "max": 0 }
  }
}
```

实际脚本不得把示例 `0` 写成结果；运行时从 response timing、server log 和 `window.__RUNTIME_PREVIEW_READY` 采集真实值。`settingsGenerationMs` 从 runtime preview log 的 `settings:generation:done` 或 `settings:build:done` duration 读取。

- [ ] **Step 4: 构建 dist 并跑性能采样**

Run:

```powershell
rtk pwsh -NoProfile -Command "npm run compile"
rtk pwsh -NoProfile -Command "Remove-Item Env:COCOS_CLI_TEST_PROJECT_ROOT -ErrorAction SilentlyContinue; Remove-Item Env:COCOS_CLI_TEST_EDITOR_LIBRARY_REF -ErrorAction SilentlyContinue; Remove-Item Env:COCOS_CLI_TEST_EDITOR_PROGRAMMING_REF -ErrorAction SilentlyContinue; node vitests/scripts/runtime-preview-refresh-performance.mjs"
```

Expected: JSON 中三组各 5 次，包含 `min` / `median` / `max`，无 `console.error`、无同源 failed request。

- [ ] **Step 5: 写 facts**

`docs/dev/runtime-preview/facts/runtime-preview-explicit-refresh-performance-20260627.md` 必须包含：

```markdown
# Runtime Preview Explicit Refresh Performance 2026-06-27

## 范围

- 测试层级：
- 项目/fixture 分类：
- 是否构建 dist：
- 清理的环境变量：
- 不能证明的边界：

## 结果

| 场景 | rounds | root `/` median | AssetDB refresh median | script compile median | settings generation median | ready median |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| default off | 5 | 使用脚本输出 `summary.defaultOff.rootHtmlMs.median` | 使用脚本输出 `summary.defaultOff.assetDbRefreshMs.median` | 使用脚本输出 `summary.defaultOff.scriptCompileMs.median` | 使用脚本输出 `summary.defaultOff.settingsGenerationMs.median` | 使用脚本输出 `summary.defaultOff.readyMs.median` |
| on no change | 5 | 使用脚本输出 `summary.onNoChange.rootHtmlMs.median` | 使用脚本输出 `summary.onNoChange.assetDbRefreshMs.median` | 使用脚本输出 `summary.onNoChange.scriptCompileMs.median` | 使用脚本输出 `summary.onNoChange.settingsGenerationMs.median` | 使用脚本输出 `summary.onNoChange.readyMs.median` |
| on changed | 5 | 使用脚本输出 `summary.onChanged.rootHtmlMs.median` | 使用脚本输出 `summary.onChanged.assetDbRefreshMs.median` | 使用脚本输出 `summary.onChanged.scriptCompileMs.median` | 使用脚本输出 `summary.onChanged.settingsGenerationMs.median` | 使用脚本输出 `summary.onChanged.readyMs.median` |

## 结论

`--refresh-on-reload` 仍保持默认关闭。以上数据只证明 opt-in 的本机采样成本，不作为默认开启依据。
```

- [ ] **Step 6: Commit**

```powershell
rtk pwsh -NoProfile -Command "git add vitests/suites/runtime-preview/runtime-refresh-live-integration.test.ts vitests/scripts/runtime-preview-refresh-performance.mjs docs/dev/runtime-preview/facts/runtime-preview-explicit-refresh-performance-20260627.md; git commit -m 'test(runtime-preview): verify explicit refresh integration'"
```

---

### Task 8: Final verification and docs status

**Files:**
- Modify: `docs/dev/runtime-preview/issues.md`
- Optional Modify: `docs/dev/runtime-preview/acceptance/matrix.md` if a matching acceptance row exists.

- [ ] **Step 1: 运行 focused test set**

Run:

```powershell
rtk pwsh -NoProfile -Command "npm run test -- src/core/scripting/test/script-manager.test.ts --runInBand"
rtk pwsh -NoProfile -Command "npm --prefix vitests run test -- suites/runtime-preview/runtime-refresh-coordinator.test.ts suites/runtime-preview/runtime-preview-express-server.test.ts suites/runtime-preview/runtime-refresh-entry-injection.test.ts suites/runtime-preview/preview-app-route-contract.test.ts suites/runtime-preview/runtime-refresh-browser.test.ts suites/runtime-preview/runtime-refresh-live-integration.test.ts"
rtk pwsh -NoProfile -Command "npx tsc -b --pretty false"
```

Expected: 全部 exit code 0。

- [ ] **Step 2: 构建验证**

Run:

```powershell
rtk pwsh -NoProfile -Command "npm run compile"
```

Expected: exit code 0。只有这一步通过后，才能用 `dist/cli.js` 进行 CLI 验收。

- [ ] **Step 3: CLI help smoke**

Run:

```powershell
rtk pwsh -NoProfile -Command "node dist/cli.js preview --help"
```

Expected: 输出包含 `--refresh-on-reload`。

- [ ] **Step 4: 更新 issue 台账**

`RP-ISSUE-029` 的计划 / 实现列写入本计划、关键代码文件和 facts。状态规则：

- 如果 route、browser、live fixture、性能采样都通过，但没有指定真实业务项目验收，则状态保持 `open` 或改为 `in-progress`，不能标 `fixed`。
- 如果后续用户指定真实项目并通过真实项目 `preview --runtime` 验收，才可标 `fixed`。

- [ ] **Step 5: Commit**

```powershell
rtk pwsh -NoProfile -Command "git add docs/dev/runtime-preview/issues.md docs/dev/runtime-preview/acceptance/matrix.md; git commit -m 'docs(runtime-preview): record explicit refresh validation'"
```

---

## 自检清单

- [ ] endpoint 和 preview app button 都有任务覆盖。
- [ ] `--refresh-on-reload` 默认关闭，并有关闭/开启 route tests。
- [ ] 自定义 template 不 include toolbar、完全无 `.toolbar` 的 fallback 有测试。
- [ ] refresh failure 显示提示，不 reload，不 `console.error`。
- [ ] resource update 和 script update 都有 refresh 后 browser/runtime 验收。
- [ ] 性能采样默认关闭、开启无变更、开启有变更三组各 5 次。
- [ ] `RP-ISSUE-030` 只保留后续配置入口，不进入本轮实现。
