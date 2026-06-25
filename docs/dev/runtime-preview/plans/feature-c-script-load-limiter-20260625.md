# feature-c Script Load Limiter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `feature-c` 在 CLI runtime preview 中以可量化的最快速度加载，并在 Edge / Chromium 禁用缓存条件下不再触发 `net::ERR_INSUFFICIENT_RESOURCES`。

**Architecture:** 保留 RP-ISSUE-007 已确定的 static prerequisite 产物，不回退到 sequential dynamic import request list。先在真实 Edge 页面探测 SystemJS 可用 hook，再在最靠近 script 请求的 hook 层安装 preview chunk limiter；只限制 `/scripting/x/packer-driver/targets/preview/chunks/*.js`，不限制 engine、settings、asset、import-map 请求。

**Tech Stack:** TypeScript、SystemJS hook、runtime preview `preview-app`、Vitest、Playwright / Codex browser plugin CDP、Edge DevTools `Disable cache`。

---

## 已确认事实

- `feature-c` 当前 preview import-map raw length 为 `3549866`。
- preview target `imports` count 为 `3255`。
- `cce:/internal/x/prerequisite-imports` 指向 `./chunks/6d/6d8fd2b0177941b032ddc0733af48a561fb60657.js`。
- prerequisite scope count 为 `3253`。
- prerequisite chunk 是 static `System.register([...])`，unique `__unresolved_*` count 为 `3253`。
- 当前 runtime preview log 已记录 `659` 条 `browser:preview-error`，其中 `284` 条是 preview chunk `Get ... failed`。
- 用户在 Edge DevTools 观察到 `net::ERR_INSUFFICIENT_RESOURCES`。

事实入口：[facts/feature-c-script-load-resource-limit-20260625.md](../facts/feature-c-script-load-resource-limit-20260625.md)

## 非目标

- 不回退 RP-ISSUE-007 的 static prerequisite 产物策略。
- 不修改 Cocos engine source。
- 不修改 `feature-c` 项目资源、`.meta`、library 或 temp 产物作为修复手段。
- 不用浏览器缓存掩盖问题。验证时必须有 CDP `Network.setCacheDisabled(true)` 或 Network evidence 中 `fromDiskCache=false`、`fromMemoryCache=false` 的证据。

## 推荐方案

先做真实页面 probe，再实现 limiter：

1. 在当前 Edge tab 记录 `typeof System.instantiate`、`typeof System.fetchScript`、`typeof System.createScript`、实际 preview chunk URL 形态。
2. 若当前 SystemJS 暴露 `System.fetchScript`，优先 patch `fetchScript`，因为它更接近 script 请求边界。
3. 若没有 `fetchScript`，再 patch `System.instantiate`。
4. limiter 支持 URL query 调参，例如 `runtimePreviewScriptLoadConcurrency=32`，不通过反复改源码调并发。
5. retry 只针对 script load failure，例如 SystemJS `Error loading <url>` 或与当前 URL 关联的加载失败；不 retry 模块执行异常。
6. metrics 拆分：
   - `prerequisiteImportMs`
   - `validationMs`
   - `readyElapsedMs`
   - `maxActive`
   - `queuePeak`
   - `completed`
   - `failed`
   - `retryCount`
   - `cacheDisabledEvidence`

最终选择规则：

```text
在候选 concurrency 中，先过滤掉任一轮出现 ERR_INSUFFICIENT_RESOURCES / SystemJS Error#3 / chunk failed / failed>0 的候选；在剩余候选中，选择 readyElapsedMs median 最低者。如 readyElapsedMs 方差受场景资源加载影响过大，则以 prerequisiteImportMs median 作为主指标，readyElapsedMs 作为辅指标。
```

候选值：

`16 / 24 / 32 / 48`

每个候选至少刷新 `5` 次，记录 median 和 p95。

## 需要修改的文件

- Create: `src/runtime-preview/preview-app/src/systemjs-load-limiter.ts`
  - 负责 hook probe、preview chunk matcher、limiter、retry 分类、metrics。
- Modify: `src/runtime-preview/preview-app/src/main.ts`
  - 在 `System.import('cce:/internal/x/prerequisite-imports')` 前安装 limiter。
  - 记录 `prerequisiteImportMs`、`validationMs` 和 limiter metrics。
- Modify: `src/runtime-preview/preview-app/@types/type.d.ts`
  - 补充 `System.fetchScript`、`System.instantiate` 和 `window.__RUNTIME_PREVIEW_SCRIPT_LOAD_LIMITER__` 类型。
- Modify: `static/runtime-preview/preview-app/main.js`
  - 由 `npm run build:runtime-preview-app` 生成，不手写。
- Create: `vitests/suites/runtime-preview/script-load-limiter.test.ts`
  - 单元验证 matcher、robust semaphore、retry 分类、idempotent install、non-preview bypass。
- Modify: `vitests/suites/runtime-preview/preview-prerequisite-imports-policy.test.ts`
  - 保留防回退断言：preview target 仍使用 static prerequisite。
  - 不使用 `indexOf('installRuntimePreviewScriptLoadLimiter')` 这类会命中 import 语句的测试。
- Create: `vitests/scripts/capture-feature-c-script-load-evidence.mjs`
  - 支持当前 Edge tab / CDP 优先，Playwright 新 profile 辅助。
  - 输出 JSON、screenshot、Network failure、cache evidence 和 limiter metrics。

## Task 0: 真实 Edge baseline 和 SystemJS hook probe

**Files:**

- Create: `vitests/scripts/capture-feature-c-script-load-evidence.mjs`
- Modify: `docs/dev/runtime-preview/facts/feature-c-script-load-resource-limit-20260625.md`

- [ ] **Step 1: 写 evidence 脚本骨架**

脚本读取：

```js
const previewUrl = process.env.COCOS_CLI_FEATURE_C_PREVIEW_URL
  || 'http://127.0.0.1:19530/?scene=4c721bfe-0b6e-46c2-97f0-644adfdcba31';
const projectRoot = process.env.COCOS_CLI_FEATURE_C_PROJECT_ROOT
  || 'D:/ps_copy/p6/trunk/Project/GameClient/feature-c';
const outputDir = process.env.COCOS_CLI_FEATURE_C_EVIDENCE_DIR
  || path.join(projectRoot, 'temp', 'codex-runtime-preview');
```

脚本必须输出：

```ts
type FeatureCScriptLoadEvidence = {
  url: string;
  timestamp: string;
  cacheDisabled: boolean;
  systemHooks: {
    instantiate: string;
    fetchScript: string;
    createScript: string;
  };
  failures: Array<{ url: string; errorText: string; type?: string }>;
  chunkResponses: Array<{
    url: string;
    status: number;
    fromDiskCache?: boolean;
    fromMemoryCache?: boolean;
  }>;
  consoleErrors: string[];
  limiter?: unknown;
  ready?: unknown;
  screenshotPath: string;
};
```

- [ ] **Step 2: 当前 Edge / CDP baseline**

优先用 Codex browser plugin claim 当前 `feature-c` Edge tab。执行 CDP：

```js
await cdp.send('Network.enable');
await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
await cdp.send('Runtime.enable');
```

然后刷新当前页面，读取：

```js
await cdp.send('Runtime.evaluate', {
  expression: `({
    instantiate: typeof System !== 'undefined' ? typeof System.instantiate : 'missing',
    fetchScript: typeof System !== 'undefined' ? typeof System.fetchScript : 'missing',
    createScript: typeof System !== 'undefined' ? typeof System.createScript : 'missing',
    ready: window.__RUNTIME_PREVIEW_READY || null
  })`,
  returnByValue: true,
});
```

Expected baseline:

```text
evidence contains ERR_INSUFFICIENT_RESOURCES or SystemJS Error#3 or preview chunk failed
```

如果当前 Edge plugin/CDP 连接在刷新时断开，脚本记录 `cdpDisconnected=true`，并保留用户 DevTools 截图/复制日志作为 baseline 主证据。

- [ ] **Step 3: Playwright 辅助 baseline**

Run:

```powershell
rtk pwsh -NoProfile -Command "$env:COCOS_CLI_FEATURE_C_PREVIEW_URL='http://127.0.0.1:19530/?scene=4c721bfe-0b6e-46c2-97f0-644adfdcba31'; $env:COCOS_CLI_FEATURE_C_PROJECT_ROOT='D:\ps_copy\p6\trunk\Project\GameClient\feature-c'; node vitests/scripts/capture-feature-c-script-load-evidence.mjs"
```

Expected:

```text
JSON evidence written
screenshot written
cacheDisabled=true when CDP path is available
```

Playwright 新 profile 不复现时，不把它当作否定证据；当前 Edge DevTools 仍是主验收环境。

- [ ] **Step 4: 回填 facts baseline**

写入：

- hook probe 结果。
- cache disabled 证明方式。
- baseline failures。
- evidence JSON / screenshot 路径。

- [ ] **Step 5: 提交 baseline 工具和事实**

```powershell
rtk pwsh -NoProfile -Command "git add vitests/scripts/capture-feature-c-script-load-evidence.mjs docs/dev/runtime-preview/facts/feature-c-script-load-resource-limit-20260625.md; git commit -m 'test: capture feature-c script load baseline'"
```

## Task 1: 建立 limiter 单元测试

**Files:**

- Create: `vitests/suites/runtime-preview/script-load-limiter.test.ts`
- Create: `src/runtime-preview/preview-app/src/systemjs-load-limiter.ts`

- [ ] **Step 1: 写失败测试**

测试必须覆盖：

- `isRuntimePreviewProjectChunkUrl()` 只匹配 preview chunk。
- limiter 不限制 non-preview URL。
- 并发窗口稳定满足 `maxObservedActive <= concurrency`，不超发。
- queue peak 可观测。
- install idempotent，不重复 patch。
- retry 只对 `isScriptLoadFailure(error, url) === true` 的错误生效。
- 模块执行异常不 retry。

测试结构：

```ts
import { describe, expect, it, vi } from 'vitest';
import {
  installRuntimePreviewScriptLoadLimiter,
  isRuntimePreviewProjectChunkUrl,
  isScriptLoadFailure,
} from '../../../src/runtime-preview/preview-app/src/systemjs-load-limiter';

describe('runtime preview SystemJS script load limiter', () => {
  it('matches only preview project chunk URLs', () => {
    expect(isRuntimePreviewProjectChunkUrl(
      'http://127.0.0.1:19530/scripting/x/packer-driver/targets/preview/chunks/aa/a.js',
    )).toBe(true);
    expect(isRuntimePreviewProjectChunkUrl(
      'http://127.0.0.1:19530/scripting/engine/bin/.cache/dev-cli/web/bundled/index.js',
    )).toBe(false);
  });

  it('does not exceed configured concurrency', async () => {
    let active = 0;
    let maxObservedActive = 0;
    const system = {
      instantiate: vi.fn(async (url: string) => {
        active += 1;
        maxObservedActive = Math.max(maxObservedActive, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return `loaded:${url}`;
      }),
    };
    const limiter = installRuntimePreviewScriptLoadLimiter(system, { concurrency: 2, retry: 0 });
    const urls = Array.from({ length: 8 }, (_, index) =>
      `http://127.0.0.1:19530/scripting/x/packer-driver/targets/preview/chunks/aa/${index}.js`);

    await Promise.all(urls.map((url) => system.instantiate(url, undefined)));

    expect(maxObservedActive).toBeLessThanOrEqual(2);
    expect(limiter.metrics.maxActive).toBeLessThanOrEqual(2);
    expect(limiter.metrics.completed).toBe(8);
    expect(limiter.metrics.failed).toBe(0);
  });

  it('retries script load failure only', async () => {
    const loadFailure = new Error('Error loading http://127.0.0.1:19530/scripting/x/packer-driver/targets/preview/chunks/aa/a.js from parent');
    const executionFailure = new Error('module execute failed');

    expect(isScriptLoadFailure(loadFailure, 'http://127.0.0.1:19530/scripting/x/packer-driver/targets/preview/chunks/aa/a.js')).toBe(true);
    expect(isScriptLoadFailure(executionFailure, 'http://127.0.0.1:19530/scripting/x/packer-driver/targets/preview/chunks/aa/a.js')).toBe(false);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```powershell
rtk pwsh -NoProfile -Command "cd vitests; npx vitest run suites/runtime-preview/script-load-limiter.test.ts"
```

Expected:

```text
FAIL Cannot find module ... systemjs-load-limiter
```

- [ ] **Step 3: 实现 limiter**

实现要求：

- 不用 `release()` 先减 active 再异步唤醒造成超发。
- queue slot 交接必须同步保留名额。
- 已安装时直接返回现有 state。
- 记录 `queuePeak`。
- `concurrency` 读取顺序：explicit options > URL query > default `32`。

核心接口：

```ts
export interface RuntimePreviewScriptLoadLimiterMetrics {
    active: number;
    maxActive: number;
    queuePeak: number;
    enqueued: number;
    completed: number;
    failed: number;
    retryCount: number;
    bypassed: number;
}

export interface RuntimePreviewScriptLoadLimiterState {
    hook: 'fetchScript' | 'instantiate';
    concurrency: number;
    metrics: RuntimePreviewScriptLoadLimiterMetrics;
}
```

- [ ] **Step 4: 运行测试确认通过**

```powershell
rtk pwsh -NoProfile -Command "cd vitests; npx vitest run suites/runtime-preview/script-load-limiter.test.ts"
```

Expected:

```text
PASS suites/runtime-preview/script-load-limiter.test.ts
```

- [ ] **Step 5: 提交**

```powershell
rtk pwsh -NoProfile -Command "git add src/runtime-preview/preview-app/src/systemjs-load-limiter.ts vitests/suites/runtime-preview/script-load-limiter.test.ts; git commit -m 'test: add runtime preview script load limiter contract'"
```

## Task 2: 接入 preview-app prerequisite import

**Files:**

- Modify: `src/runtime-preview/preview-app/src/main.ts`
- Create: `src/runtime-preview/preview-app/src/prerequisite-imports.ts`
- Modify: `src/runtime-preview/preview-app/@types/type.d.ts`
- Modify: `vitests/suites/runtime-preview/preview-prerequisite-imports-policy.test.ts`

- [ ] **Step 1: 写有效的接入契约测试**

不要用会命中 import 语句的 `indexOf('installRuntimePreviewScriptLoadLimiter')`。

新增 `src/runtime-preview/preview-app/src/prerequisite-imports.ts`，将 prerequisite 加载逻辑从 `main.ts` 拆出。测试该模块的调用顺序，而不是测试源码字符串位置。

目标接口：

```ts
export interface RuntimePreviewPrerequisiteImportOptions {
    system: SystemJS;
    installLimiter?: (system: SystemJS) => RuntimePreviewScriptLoadLimiterState;
    now?: () => number;
}

export async function loadRuntimePreviewPrerequisiteImports(
    options: RuntimePreviewPrerequisiteImportOptions,
): Promise<void>;
```

测试用 injectable `installLimiter` 和 stub `system.import` 记录调用顺序：

```ts
it('installs limiter before importing prerequisite module', async () => {
  const calls: string[] = [];
  const system = {
    instantiate: async () => undefined,
    import: async (id: string) => {
      calls.push(`import:${id}`);
      return undefined;
    },
  };

  await loadRuntimePreviewPrerequisiteImports({
    system: system as any,
    installLimiter: () => {
      calls.push('install-limiter');
      return {
        hook: 'instantiate',
        concurrency: 32,
        metrics: {
          active: 0,
          maxActive: 0,
          queuePeak: 0,
          enqueued: 0,
          completed: 0,
          failed: 0,
          retryCount: 0,
          bypassed: 0,
        },
      };
    },
    now: () => 1,
  });

  expect(calls.slice(0, 2)).toEqual([
    'install-limiter',
    'import:cce:/internal/x/prerequisite-imports',
  ]);
});
```

- [ ] **Step 2: 运行测试确认失败**

```powershell
rtk pwsh -NoProfile -Command "cd vitests; npx vitest run suites/runtime-preview/preview-prerequisite-imports-policy.test.ts"
```

Expected:

```text
FAIL Cannot find module ... prerequisite-imports
```

- [ ] **Step 3: 接入并拆分 metrics**

`src/runtime-preview/preview-app/src/prerequisite-imports.ts` 中的 `loadRuntimePreviewPrerequisiteImports()` 需要先安装 limiter，再执行 import 和 validation：

```ts
const system = options.system;
const now = options.now ?? Date.now;
const installLimiter = options.installLimiter ?? installRuntimePreviewScriptLoadLimiter;
const limiter = installLimiter(system);
(window as any).__RUNTIME_PREVIEW_SCRIPT_LOAD_LIMITER__ = limiter;

const importStartedAt = now();
await system.import('cce:/internal/x/prerequisite-imports');
const prerequisiteImportMs = now() - importStartedAt;

const validationStartedAt = now();
await validateRuntimePreviewPrerequisiteImportMap();
const validationMs = now() - validationStartedAt;
```

输出：

```ts
console.info(
  `[runtime-preview] prerequisite-imports:done prerequisiteImportMs=${prerequisiteImportMs}`
  + ` validationMs=${validationMs}`
  + ` hook=${limiter.hook}`
  + ` concurrency=${limiter.concurrency}`
  + ` maxActive=${limiter.metrics.maxActive}`
  + ` queuePeak=${limiter.metrics.queuePeak}`
  + ` completed=${limiter.metrics.completed}`
  + ` failed=${limiter.metrics.failed}`
  + ` retry=${limiter.metrics.retryCount}`,
);
```

- [ ] **Step 4: 补类型声明**

在 `src/runtime-preview/preview-app/@types/type.d.ts` 中按现有声明合并：

```ts
interface SystemJS {
    import(id: string): Promise<unknown>;
    instantiate?: (url: string, parent?: string) => Promise<unknown>;
    fetchScript?: (url: string, firstParentUrl?: string) => Promise<unknown>;
    createScript?: (url: string) => HTMLScriptElement;
}

interface Window {
    __RUNTIME_PREVIEW_SCRIPT_LOAD_LIMITER__?: unknown;
}
```

- [ ] **Step 5: 构建 preview-app 静态产物**

```powershell
rtk pwsh -NoProfile -Command "npm run build:runtime-preview-app"
```

Expected:

```text
tsc -p src/runtime-preview/preview-app/tsconfig.json
node workflow/build-runtime-preview-app.js
```

- [ ] **Step 6: 运行 focused tests**

```powershell
rtk pwsh -NoProfile -Command "cd vitests; npx vitest run suites/runtime-preview/script-load-limiter.test.ts suites/runtime-preview/preview-prerequisite-imports-policy.test.ts"
```

Expected:

```text
PASS suites/runtime-preview/script-load-limiter.test.ts
PASS suites/runtime-preview/preview-prerequisite-imports-policy.test.ts
```

- [ ] **Step 7: 提交**

```powershell
rtk pwsh -NoProfile -Command "git add src/runtime-preview/preview-app static/runtime-preview/preview-app/main.js vitests/suites/runtime-preview/preview-prerequisite-imports-policy.test.ts; git commit -m 'fix: limit runtime preview prerequisite script loads'"
```

## Task 3: 当前 Edge 页面候选并发实测

**Files:**

- Modify: `vitests/scripts/capture-feature-c-script-load-evidence.mjs`
- Evidence output: `D:\ps_copy\p6\trunk\Project\GameClient\feature-c\temp\codex-runtime-preview\`

- [ ] **Step 1: 保持端口 19530**

如果旧进程仍运行旧 `dist/cli.js`，构建后只重启同端口：

```powershell
rtk pwsh -NoProfile -Command "$pidToStop=(Get-NetTCPConnection -LocalPort 19530 -State Listen -ErrorAction Stop | Select-Object -First 1 -ExpandProperty OwningProcess); Stop-Process -Id $pidToStop"
rtk pwsh -NoProfile -Command "node dist/cli.js preview --runtime --project D:\ps_copy\p6\trunk\Project\GameClient\feature-c --host 127.0.0.1 --port 19530 --scene 4c721bfe-0b6e-46c2-97f0-644adfdcba31"
```

用户 Edge URL 保持不变。

- [ ] **Step 2: 每个候选跑 5 次**

候选 URL：

```text
http://127.0.0.1:19530/?scene=4c721bfe-0b6e-46c2-97f0-644adfdcba31&runtimePreviewScriptLoadConcurrency=16
http://127.0.0.1:19530/?scene=4c721bfe-0b6e-46c2-97f0-644adfdcba31&runtimePreviewScriptLoadConcurrency=24
http://127.0.0.1:19530/?scene=4c721bfe-0b6e-46c2-97f0-644adfdcba31&runtimePreviewScriptLoadConcurrency=32
http://127.0.0.1:19530/?scene=4c721bfe-0b6e-46c2-97f0-644adfdcba31&runtimePreviewScriptLoadConcurrency=48
```

每轮必须记录：

- `ERR_INSUFFICIENT_RESOURCES` count。
- `SystemJS Error#3` count。
- preview chunk `Get ... failed` count。
- `fromDiskCache/fromMemoryCache` 是否均为 false。
- `window.__RUNTIME_PREVIEW_READY` 内容和 scene uuid。
- limiter metrics。
- `prerequisiteImportMs`。
- `validationMs`。
- `readyElapsedMs`。
- screenshot path。

- [ ] **Step 3: 选择最终并发值**

计算：

```text
median(prerequisiteImportMs)
p95(prerequisiteImportMs)
median(readyElapsedMs)
p95(readyElapsedMs)
```

选择规则：

```text
先过滤任一轮出现 ERR_INSUFFICIENT_RESOURCES / SystemJS Error#3 / chunk failed / limiter.failed>0 / maxActive>concurrency 的候选；在剩余候选中，选择 median(readyElapsedMs) 最低者。如 readyElapsedMs 受场景资源波动明显，则选择 median(prerequisiteImportMs) 最低者，并在 facts 中说明原因。
```

- [ ] **Step 4: 保存汇总 JSON**

输出文件名：

```text
D:\ps_copy\p6\trunk\Project\GameClient\feature-c\temp\codex-runtime-preview\feature-c-script-load-concurrency-summary-20260625.json
```

汇总字段：

```ts
type ConcurrencySummary = {
  selectedConcurrency: number;
  candidates: Array<{
    concurrency: number;
    runs: number;
    errorRuns: number;
    prerequisiteImportMsMedian: number;
    prerequisiteImportMsP95: number;
    readyElapsedMsMedian: number;
    readyElapsedMsP95: number;
    maxActiveMax: number;
    queuePeakMax: number;
    retryCountTotal: number;
  }>;
};
```

## Task 4: 回填文档和验收矩阵

**Files:**

- Modify: `docs/dev/runtime-preview/facts/feature-c-script-load-resource-limit-20260625.md`
- Modify: `docs/dev/runtime-preview/issues.md`
- Modify: `docs/dev/runtime-preview/acceptance/matrix.md`

- [ ] **Step 1: 更新 facts**

写入：

- hook probe 结果。
- 最终 hook 选择理由。
- 4 个候选并发的 5 次刷新统计。
- selected concurrency。
- cache disabled evidence。
- JSON evidence 和 screenshot 路径。

- [ ] **Step 2: 更新 issues**

如果验收通过，把 RP-ISSUE-022 状态改为 `fixed`，并填入实现文件和验收入口。

- [ ] **Step 3: 更新 acceptance matrix**

新增或更新 `feature-c` browser script load row，标明：

- Edge DevTools / CDP cache disabled。
- 端口 `19530`。
- selected concurrency。
- 无 `ERR_INSUFFICIENT_RESOURCES`。
- 无 `SystemJS Error#3`。
- 无 chunk failed。
- `ready` scene uuid。
- screenshot / JSON evidence 路径。

- [ ] **Step 4: 提交文档**

```powershell
rtk pwsh -NoProfile -Command "git add docs/dev/runtime-preview; git commit -m 'docs: record feature-c script load limiter evidence'"
```

## 最终验收命令

```powershell
rtk pwsh -NoProfile -Command "npm run build:runtime-preview-app"
rtk pwsh -NoProfile -Command "cd vitests; npx vitest run suites/runtime-preview/script-load-limiter.test.ts suites/runtime-preview/preview-prerequisite-imports-policy.test.ts"
rtk pwsh -NoProfile -Command "$env:COCOS_CLI_FEATURE_C_PREVIEW_URL='http://127.0.0.1:19530/?scene=4c721bfe-0b6e-46c2-97f0-644adfdcba31'; $env:COCOS_CLI_FEATURE_C_PROJECT_ROOT='D:\ps_copy\p6\trunk\Project\GameClient\feature-c'; node vitests/scripts/capture-feature-c-script-load-evidence.mjs"
```

最终人工验收：

- 用户 Edge DevTools Network 开启 `Disable cache`。
- Codex 通过 CDP 或 evidence script 证明 `fromDiskCache=false`、`fromMemoryCache=false`。
- 刷新当前 `19530` 页面。
- Network 无 `net::ERR_INSUFFICIENT_RESOURCES`。
- Console 无 `SystemJS Error#3`。
- Console 无 preview chunk `Get ... failed`。
- limiter metrics 满足 `failed=0`、`completed=enqueued`、`maxActive <= concurrency`。
- 页面进入 runtime ready，记录 scene uuid。
- 保存截图和 JSON 证据。

## 风险和回滚

- 如果 `System.fetchScript` 存在并可用，优先 patch `fetchScript`；否则 patch `System.instantiate`。
- 如果两个 hook 都不稳定，停止实现，补充事实记录后再评估 HTML script injection hook，不叠加猜测。
- 如果 limiter 消除错误但所有候选耗时不可接受，先用实测数据讨论 server-side chunk group 或更深层 Editor loader 对齐，不回退 RP-ISSUE-007。
- 回滚方式是删除 limiter 接入，保留 RP-ISSUE-007 static prerequisite 代码不变。
