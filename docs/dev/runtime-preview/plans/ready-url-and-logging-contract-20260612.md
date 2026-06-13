# Runtime Preview Ready URL And Logging Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** runtime preview 只在默认 preview settings 真正可用后输出可点击 URL，按 Editor browser preview 的业务语义选择 preview template / 默认设备尺寸，并把 stdout、`temp/preview-logs`、`temp/logs` 的职责收敛到可验证契约。

**Architecture:** HTTP server 仍可先监听端口，但 stdout 不在 `preview:ready` 前暴露完整 URL；`/` 在 preparing 阶段返回 loading page 并轮询 health，settings 相关 route 在 preparing 阶段返回 503，不触发 settings build。ready 后的 root page 按旧 Editor 业务意图优先使用 `<project>/preview-template/index.ejs`，render data 由当前 CLI route/settings facts 填充；默认 `Default` device 从项目 `settings.screen.designResolution` 派生，而不是固定 960x640。`PreviewSettingsProvider` 增加 in-flight dedupe，日志先保留现有文本格式但明确 event 边界，删除默认 stdout 噪声。

**Tech Stack:** TypeScript、Express、Vitest、runtime preview `RuntimePreviewLogger`、现有 `newConsole`。

---

## Scope

本计划处理 `RP-ISSUE-017`、`RP-ISSUE-018` 和 `RP-ISSUE-019` 的第一阶段：

- 修复 URL 在 `preview:ready` 前作为可点击入口输出的问题。
- 防止浏览器或用户猜到端口后提前访问 settings route 触发并发 settings build 或早期 500。
- 对齐 Editor browser preview 的项目模板选择：项目 `<project>/preview-template/index.ejs` 存在时默认使用，不增加 CLI 专用 opt-in 参数。
- 对齐 Editor browser preview 的默认显示意图：没有用户选择 device 时，`Default` 使用项目 design resolution，不固定 960x640。
- 删除 `update entry mod: ...` 默认 stdout 噪声。
- 明确当前资源 import、script compile、settings generation、browser error 的日志写入边界。

不在本计划中实现完整百分比进度条。资源 import / script compile 没有全量、当前项、完成项等稳定事实前，不输出伪百分比。

## Editor Preview Parity Principles

- 默认行为贴近 Editor browser preview，不通过额外 CLI 参数让用户 opt in。
- 项目 `preview-template/index.ejs` 是项目级 browser preview 定制能力；存在时应默认优先于 CLI 内置 `index.ejs`。
- render data 形态应尽量对齐旧 Editor：`title`、`tip_sceneIsEmpty`、`enableDebugger`、`devices`、`config`、`cocosTemplate`、`cocosToolBar`、`settingsJs`、`packImportMapURL`、`packResolutionDetailMapURL`。
- 不能机械复制旧 Editor 的 URL 或 engine cache path。render data 中的 `settingsJs`、`packImportMapURL`、`packResolutionDetailMapURL`、`cocosTemplate` 必须继续指向当前 CLI 已实现的 route facts。
- `preview-template/script.ejs` 是否参与，应按 Editor 真实业务语义和项目模板 include 关系处理，不新增 CLI 专用开关。当前已知 Editor 3.x `server.js` 优先读取项目 `preview-template/index.ejs`，但传入的 `cocosTemplate` 仍是内置 `static/views/script.ejs`；因此第一阶段对齐目标是项目 `index.ejs` 优先，`cocosTemplate` 仍使用 CLI 适配后的内置 `script.ejs`。
- `Default` device 是 preview shell 模拟窗口尺寸；默认值应从项目 design resolution 派生。用户在 toolbar 中切换 device 后，只影响当前浏览器模拟尺寸，不写回项目配置。

## Files

- Modify: `src/core/launcher.ts`
  - 创建 launcher-owned readiness deferred。
  - 将包含 URL 的 `active-output` 延后到 `preview:ready` 前最后一步或 `preview:ready` 后。
  - stdout 早期只输出非可点击 socket 状态，例如 `server:listening status=preparing host=127.0.0.1 port=19530`。
- Modify: `src/runtime-preview/server/runtime-preview-server.ts`
  - 接收可选 readiness gate。
  - `/__runtime-preview/health` 增加 `ready` / `state` 字段。
  - 保持 file log 中记录真实 `server:listening <url>`，供诊断使用。
- Modify: `src/runtime-preview/server/runtime-preview-routes.ts`
  - `/` 在 preparing 阶段返回 loading HTML，ready 后返回真实 runtime preview HTML。
  - `/settings.js`、bundle config、bundle index、plugin replacement 等依赖 settings 的 route 在 preparing 阶段返回 `503 Preview is preparing`，不等待、不触发 settings build。
  - readiness error 时返回明确错误页面或 500 文案，不让 route 自己进入不完整状态。
  - loading HTML 使用 `/__runtime-preview/health` 轮询，`ready: true` 后刷新当前页面。
- Modify: `src/runtime-preview/server/preview-entry-template.ts`
  - root page render 优先使用 `<project>/preview-template/index.ejs`。
  - fallback 继续使用 CLI 内置 `static/runtime-preview/index.ejs`。
  - `cocosTemplate` / `cocosToolBar` 继续指向 CLI 当前适配模板，避免旧项目 `script.ejs` 中的 Editor cache path 破坏当前 route。
  - `devices.Default` 默认从 `settings.screen.designResolution` 派生；没有 settings 或字段缺失时才 fallback `960x640`。
- Modify: `src/runtime-preview/settings/preview-settings-provider.ts`
  - 增加 `pendingResults` map，同一 build options key 复用 in-flight promise。
  - 失败时清理 pending，不污染 cache。
- Modify: `src/core/scripting/packer-driver/index.ts`
  - 删除裸 `console.time('update entry mod')` / `console.timeEnd('update entry mod')`，或改为默认关闭的 debug event。
- Modify: `vitests/shared/runtime-preview-cli-process.ts`
  - 不再从 stdout 的早期 `server:listening http://...` 解析 URL。
  - 等 `active-output` 或 `preview:url` 在 ready 后出现再解析 URL。
- Modify: `vitests/suites/runtime-preview/settings-generation.test.ts`
  - 覆盖同 key 并发 `getPreviewSettings()` 只调用一次 loader。
  - 覆盖失败后 pending 清理，下一次可重新调用。
- Modify: `vitests/suites/runtime-preview/runtime-preview-express-server.test.ts`
  - 覆盖 readiness pending 时 settings route 不调用 provider。
  - 覆盖 readiness resolve 后 route 正常返回。
  - 覆盖 health route 的 ready state。
- Modify: `vitests/suites/runtime-preview/browser-entry-contract.test.ts`
  - 覆盖项目 `preview-template/index.ejs` 优先于 CLI 内置 index。
  - 覆盖项目 `preview-template/script.ejs` 存在时，默认 render data 的 `cocosTemplate` 仍指向 CLI 适配后的内置 script。
  - 覆盖 `Default` device 使用 settings design resolution。
- Modify: `vitests/suites/runtime-preview/launcher-runtime-preview.test.ts`
  - 覆盖 stdout 中完整 URL 不早于 `preview:ready`。
  - 覆盖 `server:listening` console 不重复且不作为可点击 URL。
  - 覆盖 runtime preview log 仍包含可诊断的 server URL。
- Modify: `vitests/suites/runtime-preview/cli-generated-output-integration.test.ts`
  - 更新 active-output 顺序断言。
  - 断言 stdout 不包含 `update entry mod: `。
- Modify: `docs/dev/runtime-preview/facts/logging-and-ready-state-20260612.md`
  - 实现后回填新事实。
- Modify: `docs/dev/runtime-preview/issues.md`
  - 实现验收后更新 `RP-ISSUE-017` / `RP-ISSUE-018` / `RP-ISSUE-019` 状态。

## Logging Contract Target

stdout 默认只显示人工可读关键状态：

```text
[runtime-preview] server:listening status=preparing host=127.0.0.1 port=19530
[runtime-preview] preview:preparing
[runtime-preview] engine:init:start
[runtime-preview] engine:init:done durationMs=...
[runtime-preview] asset-db:start
[runtime-preview] asset-db:script-sync:collect:done durationMs=... count=...
[runtime-preview] asset-db:script-compile:start count=...
[runtime-preview] asset-db:script-compile:done durationMs=... count=...
[runtime-preview] builder:init:done durationMs=...
[runtime-preview] settings:build:done durationMs=... scene=... scripts=... bundles=...
[runtime-preview] preview:ready durationMs=...
[runtime-preview] active-output:
[runtime-preview]   url: http://127.0.0.1:19530
[runtime-preview]   logFilePath: ...
```

`temp/preview-logs/runtime-preview-*.log` 记录 runtime preview 验收主线：

- `runtime-preview:log:start`
- `server:listening <url>`
- launcher stage events
- AssetDB runtime preview events
- settings route `settings:generation:*`
- browser `/preview-error`

`temp/logs` 保留 `newConsole` 通用 CLI / AssetDB / builder 细节日志。默认 stdout 不应出现未归类的 debug timing，例如 `update entry mod: 0.005ms`。

## Task 1: Settings Provider In-Flight Dedupe

**Files:**
- Modify: `src/runtime-preview/settings/preview-settings-provider.ts`
- Test: `vitests/suites/runtime-preview/settings-generation.test.ts`

- [ ] **Step 1: Add failing concurrent dedupe test**

Add a test that creates a deferred `loadPreviewSettings`, calls `getPreviewSettings({ startScene: "scene-a" })` twice before resolving, resolves once, and asserts:

```ts
expect(loadPreviewSettings).toHaveBeenCalledTimes(1);
expect(secondResult).toBe(firstResult);
```

- [ ] **Step 2: Add failing retry-after-error test**

Add a test where first `loadPreviewSettings` rejects, second call resolves, and assert:

```ts
await expect(firstCall).rejects.toThrow('first failure');
expect(await provider.getPreviewSettings()).toMatchObject({ settings: { assets: {} } });
expect(loadPreviewSettings).toHaveBeenCalledTimes(2);
```

- [ ] **Step 3: Implement `pendingResults`**

In `PreviewSettingsProvider`, add:

```ts
private pendingResults = new Map<string, Promise<PreviewSettingsProviderResult>>();
```

`getPreviewSettings()` should:

- compute `cacheKey` before calling loader;
- return `cachedResults.get(cacheKey)` when present;
- return `pendingResults.get(cacheKey)` when present;
- store the generation promise before awaiting;
- on success, write `cachedResults` and `activeResult`;
- in `finally`, delete pending key.

- [ ] **Step 4: Run focused test**

Run:

```powershell
rtk npm --prefix vitests run test -- suites/runtime-preview/settings-generation.test.ts
```

Expected: pass.

## Task 2: Loading Page And Readiness Guard For HTTP Routes

**Files:**
- Modify: `src/runtime-preview/server/runtime-preview-server.ts`
- Modify: `src/runtime-preview/server/runtime-preview-routes.ts`
- Test: `vitests/suites/runtime-preview/runtime-preview-express-server.test.ts`

- [ ] **Step 1: Add readiness types**

Add a small readiness contract owned by server options:

```ts
export type RuntimePreviewReadyState = 'preparing' | 'ready' | 'error';

export interface RuntimePreviewReadiness {
    state: () => RuntimePreviewReadyState;
    error: () => string | null;
}
```

Default readiness is immediately ready for direct server unit tests unless options provide one.

- [ ] **Step 2: Add preparing loading page for `/`**

When `context.readiness.state()` returns `preparing`, `/` should return a small HTML page with status 200 and no runtime preview scripts. The page polls `/__runtime-preview/health` and reloads when health returns `ready: true`. When `state()` returns `error`, `/` should return the same lightweight page with the error text visible and no runtime preview scripts.

Expected body shape:

```html
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Runtime Preview Preparing</title>
</head>
<body>
  <div id="status">Runtime preview is preparing...</div>
  <script>
    async function poll() {
      try {
        const response = await fetch('/__runtime-preview/health', { cache: 'no-store' });
        const health = await response.json();
        if (health.ready) {
          window.location.reload();
          return;
        }
        if (health.state === 'error') {
          document.getElementById('status').textContent = health.error || 'Runtime preview failed.';
          return;
        }
      } catch (error) {
        document.getElementById('status').textContent = String(error && error.message || error);
      }
      setTimeout(poll, 500);
    }
    void poll();
  </script>
</body>
</html>
```

Do not gate:

- `/__runtime-preview/health`
- `/preview-error`
- pure static file routes that do not require settings
- missing asset JSON response

- [ ] **Step 3: Return 503 for settings-dependent routes while preparing**

When `context.readiness.state()` returns `preparing`, these routes should return 503 with `Retry-After: 1` and a clear plain-text body, without calling `settingsProvider.getPreviewSettings()`:

- `/settings.js`
- bundle config route
- bundle index route
- plugin replacement / query extension route when it depends on settings

Use a body like:

```text
Runtime preview is preparing. Retry after preview:ready.
```

When `state()` returns `error`, return a clear error response and do not call settings provider.

- [ ] **Step 4: Add health state**

Extend health JSON:

```json
{
  "ok": true,
  "ready": false,
  "state": "preparing",
  "error": null
}
```

When ready, return `ready: true`, `state: "ready"`. When error, return `ready: false`, `state: "error"`, and a short `error` message.

- [ ] **Step 5: Add tests**

Add tests that:

- create pending readiness;
- request `/` and assert it returns the preparing loading page;
- request `/settings.js` and assert 503 plus `Retry-After`;
- assert provider is not called while readiness is preparing;
- resolve readiness;
- assert `/` returns real preview HTML;
- assert `/settings.js` returns 200 and provider called once;
- assert health reports `ready: false` before resolve and `ready: true` after resolve;
- reject readiness and assert `/` shows an error state while settings-dependent routes do not enter provider generation.

- [ ] **Step 6: Run focused server tests**

Run:

```powershell
rtk npm --prefix vitests run test -- suites/runtime-preview/runtime-preview-express-server.test.ts
```

Expected: pass.

## Task 3: Delay Clickable URL Output Until Ready

**Files:**
- Modify: `src/core/launcher.ts`
- Modify: `vitests/shared/runtime-preview-cli-process.ts`
- Test: `vitests/suites/runtime-preview/launcher-runtime-preview.test.ts`
- Test: `vitests/suites/runtime-preview/cli-generated-output-integration.test.ts`
- Test: `vitests/suites/runtime-preview/main-test-project-cli-integration.test.ts`

- [ ] **Step 1: Create launcher readiness deferred**

In `startRuntimePreview()`, create a deferred before `startRuntimePreviewServer()`.

- `state()` returns `preparing` until warm-up succeeds.
- resolve after default `settingsProvider.getPreviewSettings(...)` and programming inspection succeed.
- reject when preview warm-up throws, with a short error message exposed through health.

Pass it to `startRuntimePreviewServer()`.

- [ ] **Step 2: Stop printing early full URL to stdout**

Do not call `server.startupLogLines.forEach(writeRuntimePreviewConsoleLine)` when the line is `server:listening <url>`.

Instead print a non-clickable status line:

```text
server:listening status=preparing host=127.0.0.1 port=19530
```

Keep `server:listening <url>` in `temp/preview-logs` for diagnostics.

- [ ] **Step 3: Move `active-output` after ready**

Emit:

```text
preview:ready durationMs=...
active-output:
  url: http://127.0.0.1:19530
  ...
```

This makes the first full URL in stdout appear only after the CLI preview main chain is ready.

- [ ] **Step 4: Update CLI process helper**

In `vitests/shared/runtime-preview-cli-process.ts`, parse URL from ready-time `active-output` instead of early `server:listening`.

Keep timeout error messages including stdout/stderr for failures before ready.

- [ ] **Step 5: Update tests**

Update assertions:

- stdout full URL position is greater than `preview:ready` position;
- stdout does not match `server:listening http://`;
- runtime preview log still contains `server:listening http://`;
- helper returns `url` after ready.

- [ ] **Step 6: Run focused launcher / integration tests**

Run:

```powershell
rtk npm --prefix vitests run test -- suites/runtime-preview/launcher-runtime-preview.test.ts suites/runtime-preview/cli-generated-output-integration.test.ts
```

Expected: pass.

## Task 4: Editor Preview Template And Default Device Parity

**Files:**
- Modify: `src/runtime-preview/server/preview-entry-template.ts`
- Test: `vitests/suites/runtime-preview/browser-entry-contract.test.ts`
- Test: `vitests/suites/runtime-preview/launcher-runtime-preview.test.ts`

- [ ] **Step 1: Add project `preview-template/index.ejs` test**

Create a temporary project root with:

```text
preview-template/index.ejs
```

The template should include a unique marker and render one existing variable:

```ejs
<html>
  <body>
    <div id="project-preview-template">project template</div>
    <div id="title"><%= title %></div>
    <%- include(cocosTemplate, {}) %>
  </body>
</html>
```

Call root page render through the existing route test helper and assert:

```ts
expect(html).toContain('id="project-preview-template"');
expect(html).toContain('Cocos Creator Preview');
expect(html).toContain('/settings.js');
expect(html).toContain('/preview-app/index.js');
```

- [ ] **Step 2: Add fallback template test**

Use a project root without `preview-template/index.ejs` and assert root HTML still contains the CLI builtin page structure:

```ts
expect(html).toContain('id="GameCanvas"');
expect(html).toContain('/preview-app/index.js');
```

- [ ] **Step 3: Add project `script.ejs` non-authority test**

Create both:

```text
preview-template/index.ejs
preview-template/script.ejs
```

Put a marker in project `script.ejs`:

```ejs
<script>window.__PROJECT_SCRIPT_TEMPLATE_USED = true;</script>
```

Use an `index.ejs` that includes `cocosTemplate`. Assert default render does not include the marker:

```ts
expect(html).not.toContain('__PROJECT_SCRIPT_TEMPLATE_USED');
expect(html).toContain('/scripting/engine/bin/.cache/dev-cli/web/import-map.json');
```

This encodes the Editor 3.x observed behavior: project `index.ejs` is preferred, but `cocosTemplate` is supplied by preview package render data. No CLI opt-in flag is introduced.

- [ ] **Step 4: Add design resolution device test**

Use a settings provider fixture that returns:

```ts
settings: {
  screen: {
    designResolution: {
      width: 1080,
      height: 1920,
      policy: 0,
    },
  },
}
```

Render root HTML and assert the default device data includes `1080` and `1920`, and the toolbar default does not show `Default (960X640)`.

- [ ] **Step 5: Implement project index template lookup**

In `renderRuntimePreviewEntry()`:

- compute `projectTemplate = join(context.projectRoot, 'preview-template', 'index.ejs')`;
- if it exists and is a file, render it with the same render data;
- if rendering throws, log the error through runtime preview logger if available and fallback to CLI builtin template;
- if it does not exist, render CLI builtin template.

Do not add a command-line flag or opt-in switch.

- [ ] **Step 6: Implement default device from settings design resolution**

Make device creation accept optional preview settings:

- get `settings.screen.designResolution.width`;
- get `settings.screen.designResolution.height`;
- if both are positive numbers, set `devices.Default = { name: 'Default', width, height }`;
- keep `FullScreen` and `WebpageFullScreen`;
- preserve device list from `static/runtime-preview/devices/devices.json`.

The root page may need access to `PreviewSettingsProvider` result after readiness is ready. Do not run an independent settings build only to compute device size; use existing provider cache/dedupe.

- [ ] **Step 7: Run focused browser entry tests**

Run:

```powershell
rtk npm --prefix vitests run test -- suites/runtime-preview/browser-entry-contract.test.ts
```

Expected: pass.

## Task 5: Remove Default `update entry mod` Noise

**Files:**
- Modify: `src/core/scripting/packer-driver/index.ts`
- Test: `vitests/suites/runtime-preview/cli-generated-output-integration.test.ts`

- [ ] **Step 1: Add stdout negative assertion**

In the real CLI output integration test, assert:

```ts
expect(normalizedStdout).not.toContain('update entry mod:');
```

- [ ] **Step 2: Remove naked timing output**

Delete:

```ts
console.time('update entry mod');
console.timeEnd('update entry mod');
```

Do not replace with a default `console.log`.

- [ ] **Step 3: Run focused integration test**

Run:

```powershell
rtk npm --prefix vitests run test -- suites/runtime-preview/cli-generated-output-integration.test.ts
```

Expected: pass and no `update entry mod:` in stdout.

## Task 6: Clarify Progress Events Without Fake Percentages

**Files:**
- Modify: `src/core/assets/manager/asset-db.ts`
- Modify: `src/core/launcher.ts`
- Test: `vitests/suites/runtime-preview/launcher-runtime-preview.test.ts`
- Docs: `docs/dev/runtime-preview/facts/logging-and-ready-state-20260612.md`

- [ ] **Step 1: Preserve existing exact counters**

Keep current exact script events:

```text
asset-db:script-sync:collect:start
asset-db:script-sync:collect:done durationMs=... count=...
asset-db:script-compile:start count=...
asset-db:script-compile:done durationMs=... count=...
asset-db:script-compile:error durationMs=... count=... ...
asset-db:script-compile:skip count=0
```

- [ ] **Step 2: Add coarse AssetDB checkpoints only where facts exist**

If the code has stable boundaries, add or keep:

```text
asset-db:effect-compile:start
asset-db:effect-compile:done durationMs=...
asset-db:effect-bin-watch:start
asset-db:effect-bin-watch:done durationMs=...
```

Do not output `percent=...` unless a real total and completed count are available.

- [ ] **Step 3: Make stdout concise**

stdout should show phase starts/dones and exact counts, not every imported file. Detailed low-level logs stay in `temp/logs`.

- [ ] **Step 4: Run launcher test**

Run:

```powershell
rtk npm --prefix vitests run test -- suites/runtime-preview/launcher-runtime-preview.test.ts
```

Expected: pass with script collect / compile events before `preview:ready`.

## Task 7: Docs And Issue State

**Files:**
- Modify: `docs/dev/runtime-preview/facts/logging-and-ready-state-20260612.md`
- Modify: `docs/dev/runtime-preview/issues.md`
- Modify: `docs/dev/runtime-preview/acceptance/matrix.md` if acceptance wording changes.

- [ ] **Step 1: Update facts**

Record the implemented behavior:

- first full URL in stdout appears after `preview:ready`;
- `/` returns loading page before ready and refreshes after health reports ready;
- settings-dependent routes return 503 before ready and do not trigger settings build;
- project `preview-template/index.ejs` is used by default when present, without CLI opt-in flags;
- `Default` device derives from project design resolution when available;
- project `preview-template/script.ejs` is not treated as authoritative for current CLI route paths unless Editor parity evidence requires it;
- settings provider dedupes in-flight same-key generation;
- `update entry mod:` no longer appears in default stdout;
- stdout / `temp/preview-logs` / `temp/logs` responsibilities.

- [ ] **Step 2: Update issue table**

If tests pass and behavior is verified:

- mark `RP-ISSUE-017` as `fixed`;
- mark `RP-ISSUE-018` as `fixed` only for first-stage logging contract, or keep `open` with narrowed remaining scope if deeper logger schema work remains.
- mark `RP-ISSUE-019` as `fixed` when project template priority and default design-resolution device behavior are covered by tests.

- [ ] **Step 3: Run final verification**

Run:

```powershell
rtk npm --prefix vitests run test -- suites/runtime-preview/settings-generation.test.ts suites/runtime-preview/runtime-preview-express-server.test.ts suites/runtime-preview/browser-entry-contract.test.ts suites/runtime-preview/launcher-runtime-preview.test.ts suites/runtime-preview/cli-generated-output-integration.test.ts
```

If time allows, run the main project integration:

```powershell
rtk npm --prefix vitests run test -- suites/runtime-preview/main-test-project-cli-integration.test.ts
```

Expected: focused tests pass. If main project still fails due unrelated browser runtime facts, record exact failure and do not mark unrelated issues fixed.
