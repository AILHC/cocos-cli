# Runtime preview ready state 与日志现状

日期：2026-06-12

本文记录 runtime preview 当前源码事实，不决定修复方案。后续是否延后输出 URL、增加 request ready gate、清理日志噪声或调整日志文件职责，需确认后再进入计划。

## 事实入口

- `src/core/launcher.ts`
  - `writeRuntimePreviewConsoleLine()` 直接向 raw console 输出 `[runtime-preview] ...`。
  - `Launcher` constructor 调用 `newConsole.init(join(projectPath, 'temp', 'logs'), true)` 和 `newConsole.record()`，这是通用 CLI 日志链路。
  - `startRuntimePreview()` 创建 runtime preview server 后才设置 `writeRuntimePreviewLog`，随后输出 `active-output`、`preview:preparing`、各阶段 `*:start/done/error`、`preview:ready`。
- `src/runtime-preview/logging/runtime-preview-logger.ts`
  - `createRuntimePreviewLogger()` 写入 `<project>/temp/preview-logs/runtime-preview-YYYYMMDD-HHMMSS.log`。
  - 文件第一行为 `runtime-preview:log:start`。
  - `RuntimePreviewLogger.write()` 是 append-only 串行写入；当前没有 level、channel、owner、schema。
- `src/runtime-preview/server/runtime-preview-server.ts`
  - `startRuntimePreviewServer()` 监听端口后写入 `server:listening <url>` 到 runtime preview 专用日志，并把该行放入 `startupLogLines`。
  - Express route 捕获异常；`/settings.js` 异常会额外 `console.error("[runtime-preview] settings:generation:error ...")`，然后进入 500 response。
  - `/__runtime-preview/health` 暴露 `logFilePath`。
- `src/runtime-preview/server/runtime-preview-routes.ts`
  - `/` 在没有 `preview:ready` gate 的情况下直接返回 runtime preview HTML。
  - `/settings.js` 写入 `settings:generation:start/done/error`，并调用 `settingsProvider.getPreviewSettings()`。
  - bundle config、bundle index、plugin replacement route 也会通过 `settingsProvider.getPreviewSettings()` 读取 settings。
- `src/runtime-preview/server/preview-app-required-routes.ts`
  - `/preview-error` 的 POST 会写入 `browser:preview-error <body>` 到 runtime preview 专用日志。
  - missing asset route 当前返回 `{ uuid, missing: true, source: "runtime-preview-cli" }`。
- `src/core/scripting/packer-driver/index.ts`
  - 当前存在裸 `console.time('update entry mod')` / `console.timeEnd('update entry mod')`。
  - 因此 `update entry mod: 0.005ms` 是 CLI 源码里的直接 console 输出，不是外部 npm 包日志泄漏。

## ready state 现状

- `server:listening` 只表示 HTTP socket 已监听。
- `active-output` 当前在 `preview:ready` 之前输出，其中包含可访问 URL。
- `preview:preparing` 在 `active-output` 后输出。
- `preview:ready` 表示默认 preview settings warm-up 完成，包括 `import`、AssetDB、builder init、默认 `settings:build` 和部分 programming artifact inspection。
- `preview:ready` 仍不等同于浏览器 scene runtime ready；既有设计文档已区分这一点。

当前代码没有全局 ready gate。浏览器在 `preview:ready` 前访问 URL 时：

- `/` 可以返回页面。
- `/settings.js` 可以触发 settings generation。
- 如果时机早于 `serverUrl` 赋值，`PreviewSettingsProvider` 会抛出 `Runtime preview settings requested before server URL was assigned.`，Express 返回 500。
- 如果进入 settings generation，与 launcher 主动 warm-up 存在并发交错风险；`ensurePreviewSettingsReady()` dedupe 的是 import / builder init 准备阶段，不是所有 `getPreviewSettings()` 调用。

## 控制台输出现状

控制台目前至少有三类来源：

| 来源 | 入口 | 特征 |
| --- | --- | --- |
| runtime preview 人工可读事件 | `writeRuntimePreviewConsoleLine()` / `emitRuntimePreviewEvent()` | 带 `[runtime-preview]` 前缀；用于启动状态和关键阶段。 |
| route error 摘要 | `runtime-preview-server.ts` 的 `/settings.js` catch | 只在 `/settings.js` route 异常时 `console.error`，也带 `[runtime-preview]` 前缀。 |
| 通用 CLI / packer / AssetDB / builder console | `newConsole` 初始化后的全局 console 链路，以及源码里的裸 `console.*` | 不一定有 runtime preview 结构化前缀；`update entry mod: ...` 属于此类。 |

因此当前 stdout 不能只按 `[runtime-preview]` 理解，也不能把所有 stdout 都视为 runtime preview 专用日志。

## 文件写入现状

当前至少存在两类本地日志目录：

| 路径 | 当前职责 | 现状问题 |
| --- | --- | --- |
| `<project>/temp/preview-logs/runtime-preview-YYYYMMDD-HHMMSS.log` | runtime preview 专用事件、server listening、settings generation、browser `/preview-error` | append-only 文本；没有 level/channel/schema；不是所有控制台输出都会进入该文件。 |
| `<project>/temp/logs` | `newConsole` 通用 CLI 日志 | 与 runtime preview 专用日志并存；是否包含底层 console 噪声取决于 `newConsole` 捕获链路，和 runtime preview 专用日志职责未统一。 |

既有反馈已记录三类日志职责应明确：stdout 只显示人工可读摘要和关键阶段；`temp/preview-logs` 记录 runtime preview 验收主线；`temp/logs` 保留底层全量日志。见 `acceptance/feedback-20260609.md` 中“当前日志输出和文件写入混乱”相关段落。

## 当前待确认问题

- 是否将可点击 URL 的输出延后到 `preview:ready` 后，或在 `preview:ready` 前只输出端口监听状态而不输出浏览器入口。
- 是否在 server route 层增加 ready gate：`/` 返回 loading/503，或 `/settings.js` 等依赖 settings 的 route 等待同一个 readiness promise。
- 是否为 `PreviewSettingsProvider` 增加 in-flight settings build dedupe，避免早访问和主动 warm-up 并发调用 `getPreviewSettings()`。
- 是否删除或降级裸 `console.time('update entry mod')` 输出，或纳入 debug channel。
- 是否明确日志契约：stdout、`temp/preview-logs`、`temp/logs` 的 owner、level、字段格式、写入范围和噪声过滤规则。
