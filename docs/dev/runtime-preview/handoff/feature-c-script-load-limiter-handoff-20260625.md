# feature-c script load limiter 交接记录 2026-06-25

> **Status:** active handoff. 本文用于新会话继续处理 RP-ISSUE-022。当前事实仍以 [../issues.md](../issues.md)、[../facts/feature-c-script-load-resource-limit-20260625.md](../facts/feature-c-script-load-resource-limit-20260625.md) 和 [../plans/feature-c-script-load-limiter-20260625.md](../plans/feature-c-script-load-limiter-20260625.md) 为准。

## 当前状态

- 仓库：`E:\own_space\engines\cocos-cli`
- 分支：`adapter-to-386`
- 最新提交：`786dae5b docs: plan feature-c script load limiter`
- 工作区状态：本 handoff 文件创建前为 clean。
- 当前目标：处理 `RP-ISSUE-022`，让 `feature-c` CLI runtime preview 在 Edge / Chromium 禁用缓存条件下最快加载且不出现 `net::ERR_INSUFFICIENT_RESOURCES`。

## 必读约束

- 先读仓库根目录 `AGENTS.md`。
- 命令行优先使用 `rtk pwsh -NoProfile -Command "..."`。
- 文档使用中文；代码标识符、路径、专业术语保留 English。
- 不要回退 `RP-ISSUE-007` 的 static prerequisite 方向。
- 不要修改 `feature-c` 项目资源、source `.meta`、library 或 temp 产物作为修复手段。
- 修复前必须先跑计划里的 `Task 0` baseline / hook probe。
- 用户会在 Edge DevTools Network 开启 `Disable cache`，但验收还必须有 CDP `Network.setCacheDisabled(true)` 或 Network evidence 中 `fromDiskCache=false`、`fromMemoryCache=false` 的证据。

## 当前 feature-c 预览状态

当前运行中的 CLI runtime preview：

```text
URL: http://127.0.0.1:19530/?scene=4c721bfe-0b6e-46c2-97f0-644adfdcba31
PID: 22952
port: 19530
health: 200
projectRoot: D:\ps_copy\p6\trunk\Project\GameClient\feature-c
engineRoot: D:\workspace\engines\cocos\3.8.6
engineRootSource: project-config
runtime log: D:\ps_copy\p6\trunk\Project\GameClient\feature-c\temp\preview-logs\runtime-preview-20260625-123627.log
```

启动命令等价于：

```powershell
rtk pwsh -NoProfile -Command "node E:\own_space\engines\cocos-cli\dist\cli.js preview --runtime --project D:\ps_copy\p6\trunk\Project\GameClient\feature-c --host 127.0.0.1 --port 19530 --scene 4c721bfe-0b6e-46c2-97f0-644adfdcba31"
```

如果实现后需要重启，必须保持端口 `19530` 不变：

```powershell
rtk pwsh -NoProfile -Command "$pidToStop=(Get-NetTCPConnection -LocalPort 19530 -State Listen -ErrorAction Stop | Select-Object -First 1 -ExpandProperty OwningProcess); Stop-Process -Id $pidToStop"
rtk pwsh -NoProfile -Command "node dist/cli.js preview --runtime --project D:\ps_copy\p6\trunk\Project\GameClient\feature-c --host 127.0.0.1 --port 19530 --scene 4c721bfe-0b6e-46c2-97f0-644adfdcba31"
```

## 已确认问题

Edge DevTools 中观察到：

```text
script-load.js:86 GET http://127.0.0.1:19530/scripting/x/packer-driver/targets/preview/chunks/...js net::ERR_INSUFFICIENT_RESOURCES
script-load.js:69 Uncaught (in promise) Error: Error loading ... SystemJS Error#3
```

server 侧当前 log 仍有大量：

```text
browser:preview-error {"message":"Get http://127.0.0.1:19530/scripting/x/packer-driver/targets/preview/chunks/...js failed!","stack":""}
```

产物规模：

| 指标 | 值 |
| --- | --- |
| preview import-map raw length | `3549866` |
| preview target `imports` count | `3255` |
| prerequisite chunk | `./chunks/6d/6d8fd2b0177941b032ddc0733af48a561fb60657.js` |
| prerequisite scope count | `3253` |
| prerequisite chunk unique `__unresolved_*` count | `3253` |
| prerequisite chunk shape | static `System.register([...])` |
| runtime log `browser:preview-error` baseline | `659` |
| runtime log chunk `Get ... failed` baseline | `284` |

当前判断：

- 不是单个 chunk 文件稳定缺失；直接请求已确认相关 chunk 可返回 `200`。
- 根因方向是 static prerequisite 一次暴露 3253 个 script 依赖，浏览器加载层并发过高，触发 Chromium 资源上限。

## 已完成文档和提交

已提交：

```text
786dae5b docs: plan feature-c script load limiter
```

包含：

- `docs/dev/runtime-preview/issues.md`
  - 新增 `RP-ISSUE-022`，状态 `in-progress`。
- `docs/dev/runtime-preview/facts/feature-c-script-load-resource-limit-20260625.md`
  - 记录当前 Edge 错误、产物规模、server log、实验条件。
- `docs/dev/runtime-preview/plans/feature-c-script-load-limiter-20260625.md`
  - reviewer 修订后的执行计划。

## reviewer 已指出并已纳入计划的关键点

原计划被资深子代理 review，结论是不应直接执行。已修正如下：

- 前置 `Task 0`，先做当前 Edge / server baseline 和 SystemJS hook probe。
- 不再用 `indexOf('installRuntimePreviewScriptLoadLimiter')` 这种会命中 import 语句的无效测试。
- 不再选择“最高并发值”；改为在零错误候选中选择 `readyElapsedMs` median 最低者，必要时以 `prerequisiteImportMs` median 为主指标。
- 每个候选并发 `16 / 24 / 32 / 48` 至少刷新 `5` 次，记录 median / p95。
- limiter 必须支持 URL query 调参：`runtimePreviewScriptLoadConcurrency=32`。
- retry 只针对 script load failure，不 retry 模块执行异常。
- 单元测试必须证明 `maxActive <= concurrency`，避免 semaphore 超发。
- 验收必须记录 `fromDiskCache=false`、`fromMemoryCache=false` 或 CDP 禁用缓存证据。

## 下一步执行顺序

严格按计划执行，不要跳过 `Task 0`：

1. `Task 0`：建立 `vitests/scripts/capture-feature-c-script-load-evidence.mjs`，对当前 Edge tab 做 baseline / hook probe。
2. `Task 1`：写并通过 limiter 单元测试，覆盖 matcher、robust semaphore、retry 分类、idempotent install、non-preview bypass。
3. `Task 2`：新增 `src/runtime-preview/preview-app/src/prerequisite-imports.ts` 并接入 `main.ts`，构建 `static/runtime-preview/preview-app/main.js`。
4. `Task 3`：保持端口 `19530`，用当前 Edge + DevTools Disable cache 对 `16 / 24 / 32 / 48` 每个候选跑至少 5 次。
5. `Task 4`：回填 facts、issues、acceptance matrix。

计划入口：

```text
docs/dev/runtime-preview/plans/feature-c-script-load-limiter-20260625.md
```

## 实现方向

推荐实现：

- 新增 `src/runtime-preview/preview-app/src/systemjs-load-limiter.ts`。
- 先 probe 当前 SystemJS hook：
  - `typeof System.instantiate`
  - `typeof System.fetchScript`
  - `typeof System.createScript`
- 如果 `System.fetchScript` 存在，优先 patch `fetchScript`。
- 如果没有 `fetchScript`，再 patch `System.instantiate`。
- 只限制 preview chunk URL：

```text
/scripting/x/packer-driver/targets/preview/chunks/*.js
```

- 不限制 engine、settings、asset、import-map。
- metrics 至少包含：
  - `prerequisiteImportMs`
  - `validationMs`
  - `readyElapsedMs`
  - `maxActive`
  - `queuePeak`
  - `completed`
  - `failed`
  - `retryCount`
  - `cacheDisabledEvidence`

## 验收标准

每个候选并发至少 5 次刷新，候选：

```text
16 / 24 / 32 / 48
```

过滤掉任一轮出现以下问题的候选：

- `ERR_INSUFFICIENT_RESOURCES`
- `SystemJS Error#3`
- preview chunk `Get ... failed`
- limiter `failed > 0`
- `maxActive > concurrency`
- cache evidence 缺失或显示命中 `fromDiskCache/fromMemoryCache`

最终选择：

```text
在零错误候选中选择 median(readyElapsedMs) 最低者；如果 readyElapsedMs 受场景资源加载波动明显，则选择 median(prerequisiteImportMs) 最低者，并在 facts 中说明原因。
```

最终人工验收必须满足：

- 当前 URL 仍是 `http://127.0.0.1:19530/?scene=4c721bfe-0b6e-46c2-97f0-644adfdcba31`，可带 `runtimePreviewScriptLoadConcurrency=<n>` query。
- Edge DevTools Network 开启 `Disable cache`。
- CDP 或 evidence script 证明 `fromDiskCache=false`、`fromMemoryCache=false`。
- Network 无 `net::ERR_INSUFFICIENT_RESOURCES`。
- Console 无 `SystemJS Error#3`。
- Console 无 preview chunk `Get ... failed`。
- `window.__RUNTIME_PREVIEW_READY` 存在并记录 scene uuid。
- 保存 screenshot 和 JSON evidence。

## 常用命令

查看当前 `19530` 端口：

```powershell
rtk pwsh -NoProfile -Command "Get-NetTCPConnection -LocalPort 19530 -ErrorAction SilentlyContinue | Select-Object LocalAddress,LocalPort,State,OwningProcess"
```

查看 health：

```powershell
rtk pwsh -NoProfile -Command "Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:19530/__runtime-preview/health' -TimeoutSec 5 | Select-Object StatusCode,Content"
```

查看当前 log 尾部：

```powershell
rtk pwsh -NoProfile -Command "Get-Content -Path 'D:\ps_copy\p6\trunk\Project\GameClient\feature-c\temp\preview-logs\runtime-preview-20260625-123627.log' -Tail 80"
```

构建 preview-app：

```powershell
rtk pwsh -NoProfile -Command "npm run build:runtime-preview-app"
```

focused tests：

```powershell
rtk pwsh -NoProfile -Command "cd vitests; npx vitest run suites/runtime-preview/script-load-limiter.test.ts suites/runtime-preview/preview-prerequisite-imports-policy.test.ts"
```

预期 evidence 脚本运行方式：

```powershell
rtk pwsh -NoProfile -Command "$env:COCOS_CLI_FEATURE_C_PREVIEW_URL='http://127.0.0.1:19530/?scene=4c721bfe-0b6e-46c2-97f0-644adfdcba31'; $env:COCOS_CLI_FEATURE_C_PROJECT_ROOT='D:\ps_copy\p6\trunk\Project\GameClient\feature-c'; node vitests/scripts/capture-feature-c-script-load-evidence.mjs"
```

## 注意事项

- 不要用“无错误但未证明禁用缓存”的结果验收。
- 不要用 Playwright 新 profile 未复现来否定用户当前 Edge DevTools 的复现；当前 Edge tab 是主验收环境。
- 不要只看 screenshot；必须有 Network / console / limiter metrics / ready state JSON。
- 如果 `fetchScript` 和 `instantiate` hook 都不稳定，停止实现，补 facts 后重新评估 HTML script injection hook；不要叠加猜测。
