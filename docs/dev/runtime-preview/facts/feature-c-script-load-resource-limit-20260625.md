# feature-c 脚本加载资源上限事实记录

日期：2026-06-25

## 背景

本记录对应 `feature-c` 使用 CLI runtime preview 时，在 Edge DevTools 开启后刷新或首次加载页面出现的浏览器脚本加载错误。

当前预览地址：

`http://127.0.0.1:19530/?scene=4c721bfe-0b6e-46c2-97f0-644adfdcba31`

当前项目：

`D:\ps_copy\p6\trunk\Project\GameClient\feature-c`

当前 runtime preview log：

`D:\ps_copy\p6\trunk\Project\GameClient\feature-c\temp\preview-logs\runtime-preview-20260625-123627.log`

## 浏览器观察

用户在 Edge DevTools 中观察到下列错误形态：

```text
script-load.js:86 GET http://127.0.0.1:19530/scripting/x/packer-driver/targets/preview/chunks/7e/7ec1cf0f4e0e279457a1fe06ec87e6cb68e8b1b9.js net::ERR_INSUFFICIENT_RESOURCES
script-load.js:86 GET http://127.0.0.1:19530/scripting/x/packer-driver/targets/preview/chunks/93/93466fc2136f50e81860b8afa6961a2a83e8317c.js net::ERR_INSUFFICIENT_RESOURCES
script-load.js:86 GET http://127.0.0.1:19530/scripting/x/packer-driver/targets/preview/chunks/3b/3bcd02fcf0f9496ba42a9b573f2f8f6a03311900.js net::ERR_INSUFFICIENT_RESOURCES
```

此前还观察到 SystemJS 报错：

```text
script-load.js:69 Uncaught (in promise) Error: Error loading http://127.0.0.1:19530/scripting/x/packer-driver/targets/preview/chunks/d5/d52968c8252b39704faac908f9ca7a8f0cb48a87.js from http://127.0.0.1:19530/scripting/x/packer-driver/targets/preview/chunks/6d/6d8fd2b0177941b032ddc0733af48a561fb60657.js
```

同一 chunk URL 由命令行直接请求可返回 `200`，说明当前证据不支持“文件稳定缺失”判断。

## 产物规模

使用当前 server 直接请求：

`http://127.0.0.1:19530/scripting/x/packer-driver/targets/preview/import-map.json`

得到：

| 指标 | 值 |
| --- | --- |
| import-map raw length | `3549866` |
| `imports` count | `3255` |
| `cce:/internal/x/prerequisite-imports` | `./chunks/6d/6d8fd2b0177941b032ddc0733af48a561fb60657.js` |
| prerequisite scope count | `3253` |
| preview chunk scope count | `3253` |

使用当前 server 直接请求 prerequisite chunk：

`http://127.0.0.1:19530/scripting/x/packer-driver/targets/preview/chunks/6d/6d8fd2b0177941b032ddc0733af48a561fb60657.js`

得到：

| 指标 | 值 |
| --- | --- |
| chunk length | `170382` |
| unique `__unresolved_*` count | `3253` |
| 是否为 static `System.register([...])` | `true` |

## server log 证据

当前 runtime preview log 中统计：

| 指标 | 值 |
| --- | --- |
| `browser:preview-error` 行数 | `659` |
| chunk `Get ... failed` 行数 | `284` |

## 当前判断

`feature-c` 当前 preview target 的 prerequisite module 是 static `System.register([...deps])`，一次声明 `3253` 个 unresolved chunk 依赖。浏览器在 `System.import('cce:/internal/x/prerequisite-imports')` 阶段可能同时创建大量 script 加载请求，在 Edge / Chromium 下触发 `net::ERR_INSUFFICIENT_RESOURCES`。

这不是 RP-ISSUE-007 的目标回退。RP-ISSUE-007 解决的是 CLI preview target 不应使用 sequential dynamic import request list，而应对齐 Editor preview 的 static prerequisite 产物。本问题是 static prerequisite 在大项目下需要浏览器加载层限流和可观测指标。

## 统一实验条件

后续修复验证应使用以下固定条件：

- 保持 `feature-c` runtime preview 端口为 `19530`。
- 保持当前 Edge 页面和 DevTools，用真实页面刷新观察。
- Edge DevTools Network 开启 `Disable cache`，保证每轮实验不被浏览器缓存掩盖。
- 仅有人工开启 `Disable cache` 的描述不足以作为验收证据；每轮应至少满足以下一种证据：
  - CDP 执行 `Network.setCacheDisabled({ cacheDisabled: true })`。
  - Network evidence 中 preview chunk response 的 `fromDiskCache=false` 且 `fromMemoryCache=false`。
- 每轮刷新记录：
  - Network 是否出现 `net::ERR_INSUFFICIENT_RESOURCES`。
  - Console 是否出现 `SystemJS Error#3` 或 chunk `Get ... failed`。
  - runtime preview log 是否新增 `browser:preview-error`。
  - `System.instantiate` / `System.fetchScript` / `System.createScript` hook probe 结果。
  - prerequisite import 耗时、validation 耗时、ready 耗时和截图。

## Task 0 baseline 和 hook probe

执行时间：2026-06-25 13:36（Asia/Shanghai）。

工具：

`vitests/scripts/capture-feature-c-script-load-evidence.mjs`

输出：

- JSON evidence：`D:\ps_copy\p6\trunk\Project\GameClient\feature-c\temp\codex-runtime-preview\feature-c-script-load-evidence-20260625-133601.json`
- screenshot：`D:\ps_copy\p6\trunk\Project\GameClient\feature-c\temp\codex-runtime-preview\feature-c-script-load-evidence-http-3A-2F-2F127.0.0.1-3A19530-2F-3Fscene-3D4c721bfe-0b6e-46c2-97f0-644adfdcba31-20260625-133601.png`

运行条件：

- 因当前会话未暴露可直接 claim 用户 Edge tab 的浏览器工具，且 `http://127.0.0.1:9222/json/version` 不可用，本轮使用脚本启动的 Chromium/Edge 新 profile 辅助 baseline。
- 脚本通过 CDP 执行 `Network.enable` 和 `Network.setCacheDisabled({ cacheDisabled: true })`。
- evidence 中 `cacheDisabled=true`，并包含 `Network.responseReceived` 的 chunk cache evidence；preview chunk response 的 `fromDiskCache=false`、`fromMemoryCache=false`。

hook probe：

| hook | typeof |
| --- | --- |
| `System.instantiate` | `function` |
| `System.fetchScript` | `undefined` |
| `System.createScript` | `function` |

本轮 Playwright/Edge 新 profile 结果：

| 指标 | 值 |
| --- | --- |
| `ready.scene` | `4c721bfe-0b6e-46c2-97f0-644adfdcba31` |
| request failure | `0` |
| preview chunk response records | `6520` |
| `SystemJS Error#3` | `0` |
| console error | `[Physics] PhysicsSystem initDefaultMaterial() Failed to load builtinMaterial.` |

解释：

- 本轮辅助 profile 未复现 `net::ERR_INSUFFICIENT_RESOURCES`，不能反向否定用户当前 Edge DevTools 环境中的复现。
- 现有 server log baseline 仍为 `browser:preview-error=659`、preview chunk `Get ... failed=284`。
- 当前可用 hook 中 `System.fetchScript` 不存在，因此 limiter 应优先 patch `System.instantiate`；如果后续真实 Edge 页面 probe 发现不同 hook 形态，需要补充事实后再调整。

## limiter 实现和候选并发验证

执行时间：2026-06-25 13:50-13:59（Asia/Shanghai）。

实现文件：

- `src/runtime-preview/preview-app/src/systemjs-load-limiter.ts`
- `src/runtime-preview/preview-app/src/prerequisite-imports.ts`
- `src/runtime-preview/preview-app/src/main.ts`
- `src/runtime-preview/preview-app/@types/type.d.ts`
- `static/runtime-preview/preview-app/*`
- `vitests/scripts/capture-feature-c-script-load-evidence.mjs`
- `vitests/suites/runtime-preview/script-load-limiter.test.ts`
- `vitests/suites/runtime-preview/preview-prerequisite-imports-policy.test.ts`

关键实现事实：

- `System.fetchScript` 为 `undefined`，不能作为 hook。
- 首轮将 limiter 安装在 `loadRuntimePreviewPrerequisiteImports()` 内时，`window.__RUNTIME_PREVIEW_SCRIPT_LOAD_LIMITER__.metrics.enqueued=0`，说明此位置过晚，真实 preview chunk script load 已在 prerequisite 函数执行前发生。
- 修正后在 `main()` 开始、`System.import('cc')` 前安装 limiter；matcher 仍只限制 `/scripting/x/packer-driver/targets/preview/chunks/*.js`，不限制 engine、settings、asset、import-map。
- `runtimePreviewScriptLoadConcurrency=<n>` query override 已验证；默认值为 `32`。
- `retry` 只对 `Error loading <url>`、`ERR_INSUFFICIENT_RESOURCES`、`Get <url> failed` 等 script load failure 生效，不 retry 模块执行异常。

候选并发 summary：

`D:\ps_copy\p6\trunk\Project\GameClient\feature-c\temp\codex-runtime-preview\feature-c-script-load-concurrency-summary-20260625.json`

| concurrency | runs | errorRuns | median readyElapsedMs | p95 readyElapsedMs | median prerequisiteImportMs | p95 prerequisiteImportMs | maxActiveMax | queuePeakMax | retryCountTotal |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `16` | 5 | 0 | `16297` | `18253` | `1` | `1` | `16` | `3238` | `0` |
| `24` | 5 | 0 | `14983` | `15530` | `1` | `2` | `24` | `3230` | `0` |
| `32` | 5 | 0 | `14963` | `15494` | `1` | `1` | `32` | `3222` | `0` |
| `48` | 5 | 0 | `15535` | `19213` | `0` | `1` | `48` | `3206` | `0` |

选择：

`selectedConcurrency=32`。

原因：

- 四个候选均为零错误候选：无 `ERR_INSUFFICIENT_RESOURCES`、无 `SystemJS Error#3`、无 preview chunk `Get ... failed`、limiter `failed=0`、`maxActive <= concurrency`。
- `readyElapsedMs` 是本轮更有区分度的主指标；`prerequisiteImportMs` 在 limiter 提前安装后只记录后续 prerequisite import/validation 阶段，median 基本为 `0-1ms`，不足以区分候选。
- 在零错误候选中，`32` 的 `median(readyElapsedMs)=14963ms` 最低，`p95(readyElapsedMs)=15494ms` 也低于 `16` 和 `48`，略低于 `24`。

本轮代表性 evidence：

- `16`：`D:\ps_copy\p6\trunk\Project\GameClient\feature-c\temp\codex-runtime-preview\feature-c-script-load-evidence-20260625-135327.json`
- `24`：`D:\ps_copy\p6\trunk\Project\GameClient\feature-c\temp\codex-runtime-preview\feature-c-script-load-evidence-20260625-135505.json`
- `32`：`D:\ps_copy\p6\trunk\Project\GameClient\feature-c\temp\codex-runtime-preview\feature-c-script-load-evidence-20260625-135636.json`
- `48`：`D:\ps_copy\p6\trunk\Project\GameClient\feature-c\temp\codex-runtime-preview\feature-c-script-load-evidence-20260625-135807.json`

每轮 evidence 均包含：

- `cacheDisabled=true`，来源为 CDP `Network.setCacheDisabled({ cacheDisabled: true })`。
- preview chunk `Network.responseReceived` cache evidence，`fromDiskCache=false`、`fromMemoryCache=false`。
- `window.__RUNTIME_PREVIEW_READY.scene=4c721bfe-0b6e-46c2-97f0-644adfdcba31`。
- limiter metrics：`enqueued=3259`、`completed=3259`、`failed=0`、`retryCount=0`。

残留非阻塞 console error：

```text
[Physics] PhysicsSystem initDefaultMaterial() Failed to load builtinMaterial.
```

该错误在本 issue 的 script load failure 分类之外，本轮没有作为 `ERR_INSUFFICIENT_RESOURCES` / `SystemJS Error#3` / preview chunk load failure 处理。
