# Preview Session Module

## Responsibility

`src/core/preview-session/` 负责 preview session 的跨进程 project ownership 与项目内 CLI 自动发现：lock dir + descriptor 原子 claim、liveness 判定、stale 回收、project root 向上解析和 session descriptor 读写。它保证同一项目任意时刻只有一个 writable Preview owner，并让项目内任意 cwd 的 CLI 能找到已启动的 Preview session。

## Non-Goals

- 不引入 registry service、daemon、通用 service container 或新的 RPC protocol。
- 不实现 command 通道本身：agent 入口 `cocos session` 命令组（`src/commands/session/`）作为标准 MCP client 直连统一 server 已有的 `/mcp`，server 端零改动。
- 不处理 `mcp-server` 与运行中 Preview 并存的双写问题（另起 effort）。
- 找不到 live session 时不隐式启动后台 Preview。

## Main Entry Points

- `src/core/preview-session/`（claim、descriptor、liveness、ownership、reclaim、project-root）
- `src/commands/session/`（info/list/describe/call，MCP client）
- `src/commands/preview.ts`、`src/commands/preview-existing-session.ts`
- identity endpoint：`GET /__cocos-cli/session`（统一 server 只读路由）

## Inputs

输入包括 project root（cwd 向上解析或 `--project`，与 `--url` 互斥）、CLI-owned `temp/cli/` 下的 claim 目录与 descriptor、identity endpoint 响应和进程 liveness 事实。

## Outputs

输出包括 ownership claim 获取/报告/回收结果、session identity（sessionId、projectRoot、state、serverUrl、mcpUrl、protocolVersion）和 `cocos session` 命令的结构化 envelope。

## Dependencies

依赖 configuration、project、filesystem、server（identity endpoint）和 MCP SDK（client 侧）；被 `preview` 命令与 `cocos session` 命令组依赖。

## Current Constraints

- claim 是 `mkdir` 原子创建的 `temp/cli/preview-session-<sessionId>-<pid>` 目录（不可变）；descriptor 是目录内 `descriptor.json`，tmp+rename 原子发布；lock 与 descriptor 分离。
- ownership 获取发生在 command 层参数验证后、构造 `Launcher` 之前，早于任何项目写入（server、AssetDB、scripting、builder、sceneWorker、日志）。
- liveness 八级判定；`invalid-owner-alive` 永不回收；stale 回收必须先终止 owner（POSIX SIGTERM / Windows terminateTree）并确认死亡后才接管。
- 三态 starting/ready/draining；close 开始即释放 claim。Windows 上 SIGTERM 是硬杀（不触发 close handler），claim 残留为 stale 属平台预期，由下次 preview 回收。
- `--build` 在已有 live session 时为 blocking-only owner，不启动第二套 writable backend。
- 安全模型为用户知情接受统一 server 的 CORS 通配现状，不引入 token / Origin 校验。

## Related Evidence

- `../superpowers/specs/2026-07-24-preview-session-cli-discovery-design.md`（正式 spec，含验收结果）
- `../runtime-preview/issues.md`（RP-ISSUE-040）
- `../runtime-preview/acceptance/matrix.md`
- `vitests/scripts/preview-session-cli-acceptance.ts`（隔离主测试项目跨表面验收，22/22，2026-07-24）
