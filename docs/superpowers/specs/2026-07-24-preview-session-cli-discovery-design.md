# Preview Session CLI 自动发现与连接设计

## Problem Statement

统一 Runtime Preview editing session 已让 Runtime Preview、Scene Editor 和 MCP 在一个 CLI 进程内共享 server、AssetDB、scripting、builder、attached RPC 和唯一 `sceneWorker`。但是 session 仍只能通过启动日志中的 URL 被外部客户端发现，普通 CLI 命令不能在项目目录中自动连接正在运行的 Preview。

同一项目还可以由多个独立 CLI 进程重复启动 Preview。HTTP server 会在端口被占用后选择后续端口，因此第二个进程表面上能够成功启动；但每个进程都会初始化自己的 AssetDB、scripting 和 scene worker，并发读写同一个项目的 `library`、`temp/cli`、source asset、`.meta` 和 scene 文件。当前没有跨进程 project ownership，AssetDB 内部锁也只在单个进程内生效。

用户希望 Preview 成为项目唯一的 writable backend。CLI 在 Cocos 项目目录或任意子目录执行时，应自动找到该项目已经启动的 Preview URL，并像正常 CLI 一样执行 scene、asset 等操作。AI agent 还需要稳定、可发现、结构化的命令接口，而不是解析 Preview 启动日志或要求用户反复提供 URL。

## Solution

每个 Cocos 项目使用一个位于 CLI-owned `temp/cli` 目录的 `preview-session.json`。该文件同时承担跨进程 advisory lock 和 session endpoint descriptor，不引入用户级 registry、daemon 或全局项目路径索引。

`cocos preview` 在初始化 server、AssetDB 和 scene worker 之前原子创建该文件。创建成功的进程成为项目 Preview owner；创建失败时验证已有 descriptor、PID 和 session endpoint。已有 session 仍存活时，不再启动第二套 writable backend，而是报告已有 URL，并根据现有 CLI open 语义打开对应页面或正常退出。descriptor 已失效时，启动进程回收 stale 文件并重试一次。

Preview ready 后，descriptor 包含 session identity、canonical project root、owner PID、实际 server URL、MCP URL、状态、协议版本和启动时间。Preview 正常关闭时只在 descriptor 仍属于当前 session 的前提下删除文件，避免旧进程误删后继 session。

统一 server 提供一个只读 session identity endpoint，以及一个基于 public command allowlist 的 CLI command endpoint。CLI 不能直接调用内部任意 RPC module/method；现有 Scene Process 到主进程的 Web RPC 方向和权限边界保持不变。

MCP 与 CLI HTTP adapter 复用同一个 transport-independent public command executor。executor 使用现有 tool metadata、输入输出 schema、业务 API 和错误模型；scene command 继续经 main-process proxy 和 attached RPC 到达唯一 scene worker。

项目内 CLI 从当前工作目录向上解析 project root，读取固定 descriptor，验证 endpoint identity 后自动连接。项目外调用或显式覆盖时仍允许传入 `--project` 或 `--url`。CLI 不因找不到 session 而隐式启动后台 Preview。

## User Stories

1. 作为 Cocos 项目开发者，我希望在项目目录执行 CLI scene 命令时自动连接正在运行的 Preview，从而不需要复制 URL。
2. 作为 Cocos 项目开发者，我希望在项目任意子目录执行 CLI 命令时仍能解析到同一个 project root 和 Preview session。
3. 作为 Cocos 项目开发者，我希望同一项目只能有一个 writable Preview owner，从而避免多个 AssetDB 和 scene worker 并发写项目。
4. 作为 Cocos 项目开发者，我希望第二次执行 `cocos preview` 时看到已有 session 的明确 URL，而不是静默启动到另一个端口。
5. 作为 Cocos 项目开发者，我希望第二次执行 `cocos preview` 不产生第二个 scene process，从而避免独立 scene 内存状态互相覆盖。
6. 作为 Cocos 项目开发者，我希望不同项目仍可同时启动各自的 Preview，从而不引入全局单实例限制。
7. 作为 Cocos 项目开发者，我希望 Preview 崩溃后残留的 descriptor 能被识别和恢复，从而不需要手工删除 lock。
8. 作为 Cocos 项目开发者，我希望 PID 被操作系统复用时仍通过 session identity endpoint 识别 descriptor 是否真实有效。
9. 作为 Cocos 项目开发者，我希望 Preview 正常退出时自动清理 descriptor，从而后续可以立即重新启动。
10. 作为 Cocos 项目开发者，我希望旧 Preview 的迟到 cleanup 不会删除新 Preview 的 descriptor。
11. 作为 CLI 用户，我希望没有运行中 Preview 时收到可执行的错误提示，从而知道应先运行 `cocos preview`。
12. 作为 CLI 用户，我希望 CLI 找不到 session 时不要偷偷启动后台进程，从而保持进程 ownership 明确。
13. 作为 CLI 用户，我希望在项目外可以通过 `--project` 选择项目并自动发现其 Preview。
14. 作为 CLI 用户，我希望在项目外或诊断场景可以通过 `--url` 显式连接 endpoint。
15. 作为 CLI 用户，我希望显式 URL 仍经过 session identity 和协议版本验证，从而避免连接到错误服务。
16. 作为 CLI 用户，我希望 session endpoint 返回 canonical project identity，从而能够确认当前命令作用于哪个项目。
17. 作为 CLI 用户，我希望 scene open、query、update 和 save 最终进入 Preview owner 的唯一 attached RPC。
18. 作为 CLI 用户，我希望 CLI 保存 scene 后 Scene Editor、MCP 和 Runtime Preview 能读取同一结果。
19. 作为 CLI 用户，我希望 public command 错误产生稳定的非零 exit code，而不是只打印日志后返回成功。
20. 作为 CLI 用户，我希望机器可读结果只写 stdout，诊断信息写 stderr，从而脚本可以可靠解析 JSON。
21. 作为 AI agent 用户，我希望列出当前 session 支持的 public commands，从而无需把能力清单硬编码到 prompt。
22. 作为 AI agent 用户，我希望查询单个 command 的输入输出 schema，从而可以在调用前构造合法参数。
23. 作为 AI agent 用户，我希望通过一个通用 command invocation 入口覆盖 MCP 已公开的能力，从而不需要等待每个能力都有手写 CLI wrapper。
24. 作为 AI agent 用户，我希望常用 scene 操作具有正常的 CLI alias，从而输出和帮助信息对人类也友好。
25. 作为 MCP 用户，我希望新增 CLI transport 不改变现有 MCP tool 名称、schema 和行为。
26. 作为 Scene Editor 用户，我希望新增 CLI endpoint 不改变浏览器到主进程的现有内部 Web RPC。
27. 作为 Runtime Preview 用户，我希望 CLI scene save 继续进入现有 AssetDB save 和 Runtime Preview refresh 协调链路。
28. 作为项目维护者，我希望 lock 与 descriptor 使用一个项目内文件，从而不维护用户级 registry 或 daemon。
29. 作为项目维护者，我希望 descriptor 位于 CLI-owned runtime output，而不是项目根目录顶层，从而避免被误提交。
30. 作为项目维护者，我希望 session discovery 复用现有 project root 解析规则，从而不产生第二种 Cocos 项目识别逻辑。
31. 作为项目维护者，我希望 CLI 和 MCP 复用同一个 public command executor，从而避免两套参数校验和业务调用逻辑漂移。
32. 作为项目维护者，我希望 public command endpoint 只暴露 allowlist 中的业务命令，从而不把内部任意 RPC 方法变成远程 API。
33. 作为项目维护者，我希望 session ownership 在 project 初始化前确定，从而第二个进程不会先写产物再发现冲突。
34. 作为项目维护者，我希望实现只处理本机 loopback session，从而不引入远程认证、分布式锁或网络文件系统语义。
35. 作为测试维护者，我希望通过真实 CLI child process 验证 discovery、command 和 lifecycle，从而不把纯 route contract 当作完整验收。
36. 作为测试维护者，我希望主测试项目验收使用隔离副本，从而不修改原项目的 source、`.meta`、`library` 或 `temp`。

## Implementation Decisions

- 一个 canonical project root 对应一个 writable Preview owner。该限制只作用于同一项目；不同项目可以各自拥有 session。
- project root canonicalization 复用现有项目解析能力，并在 Windows 上处理路径大小写、分隔符和可解析 real path，避免同一路径以不同拼写绕过 lock。
- session descriptor 固定放在项目的 CLI-owned `temp/cli` 目录。项目根目录顶层不新增运行时 marker。
- descriptor 与 lock 合并为一个文件。首次创建使用 exclusive create 语义，普通覆盖写不能作为 ownership 获取方式。
- ownership 必须在 server、project import、AssetDB、scripting、builder 和 scene worker 初始化之前获得。
- descriptor 至少记录 session ID、canonical project root、owner PID、state、实际 server URL、MCP URL、protocol version 和 started-at。
- 启动中使用明确的 `starting` 状态；全部 session 能力 ready 后才切换到 `ready`。descriptor 更新应避免让客户端读取半个 JSON。
- lock 已存在时，先读取 descriptor，再验证 owner PID 与只读 session endpoint。只有 PID、session ID 和 project identity 一致时才视为 live session。
- live session 存在时，第二次 `cocos preview` 不启动新 server、AssetDB、scripting 或 scene worker。它输出已有 session 信息，并保持成功的、可预测的退出语义。
- stale descriptor 只允许在重新读取后仍属于已观察 session 且 health check 失败时回收；回收后最多重试一次 ownership 获取，避免无界竞争循环。
- cleanup 删除 descriptor 前必须再次核对 session ID，旧 owner 不得删除后继 session。
- server 提供只读 session identity endpoint。响应包含 session ID、project identity、state、protocol version 和 capabilities，不暴露任意本地文件内容。
- CLI endpoint 不直接复用内部 Web RPC route。内部 Web RPC 继续服务 Scene Process/浏览器到主进程的请求。
- public command executor 从 MCP transport 中分离，负责 command lookup、schema validation、业务实例解析、执行、结构化结果和错误规范化。
- MCP adapter 与 CLI HTTP adapter 都调用同一个 executor。业务 command 不依赖 MCP transport 类型。
- public command 集合以当前已注册、已有 schema 的业务 tool metadata 为初始 allowlist，不开放任意 module/method 反射调用。
- CLI HTTP request 包含 command name 和结构化 input；response 包含 session identity、成功状态、结果或规范化错误。
- CLI 在 cwd 中自动向上解析 project root，再读取固定 descriptor。自动发现优先于要求用户输入 URL。
- `--project` 用于显式指定项目并执行相同 discovery；`--url` 用于显式 endpoint override。二者的冲突和优先级必须确定并反映在 help 中。
- 未发现 live session 时 CLI 返回明确错误，不隐式创建 daemon，也不自动执行 `cocos preview`。
- Agent 全能力入口提供 list、describe 和 call，输出稳定 JSON。常用 scene 命令可以提供薄 CLI alias，但不在首轮手写全部 public command wrapper。
- stdout 只承载命令结果；诊断和进度写 stderr；失败使用非零 exit code。
- server 默认继续绑定 loopback。局域网远程控制、鉴权和多用户权限不属于本需求。
- session close、signal cleanup 和启动失败回滚统一释放 descriptor，不创建第二套 lifecycle owner。

## Testing Decisions

- 最高测试 seam 是真实 CLI child process：先启动 production Preview，再从项目子目录启动另一个 CLI process，通过自动 discovery 执行 public command，并从 Scene Editor、MCP 或 Runtime Preview 观察结果。
- session ownership 单元测试只验证外部状态转换：首次 acquire、live conflict、stale recovery、ready publish、owner-matched release 和旧 owner 不删除新 descriptor。
- project identity 测试覆盖项目根目录、嵌套 cwd、相对路径、Windows 路径大小写和显式 `--project`。
- server contract 测试覆盖 session identity endpoint 的 ready、starting、project mismatch 和 protocol mismatch。
- command contract 测试覆盖 list、describe、成功 execute、未知 command、schema invalid、业务错误和结构化 response。
- MCP compatibility 测试验证抽取 public command executor 后现有 tool list、tool schema 和 representative scene operation 不变。
- CLI integration 启动一个 Preview 后，从项目子目录执行 scene query、open、node update 和 save，验证请求进入运行中 session，而不是创建新的 project context。
- 同项目第二次 `cocos preview` 的 integration 必须证明实际 scene PID 没有增加，且原 server URL 仍可用。
- 不同项目 integration 启动两个 Preview，证明它们拥有不同 descriptor、URL 和 scene PID，且不会互相拒绝。
- stale recovery integration 强杀 owner process，保留 descriptor，再启动 Preview，验证能够恢复并发布新 session ID。
- PID 复用风险通过 endpoint session ID/project identity mismatch contract 验证，不依赖仅检查 PID。
- lifecycle integration 覆盖正常 close、`SIGINT`、`SIGTERM`、启动失败回滚和旧 cleanup 晚到；最终 descriptor、端口和 scene process 都应释放。
- Agent CLI 测试验证 stdout 是可解析 JSON、stderr 承载诊断、失败 exit code 非零，并覆盖 list/describe/call。
- 跨表面验收选择一个代表性 scene：CLI 打开并修改节点、CLI 保存、MCP query、Scene Editor 浏览器读取相同节点、Runtime Preview 读取保存产物。
- 主测试项目必须先创建隔离副本；不得直接修改原主测试项目的 source、`.meta`、`library` 或 `temp`。
- 既有 273 scene sweep 不需要因本需求全部重跑，因为 scene loader、runtime route 和资源解析语义不在修改范围；若 public executor 改变 scene API 行为，则升级测试范围。
- route contract 不能单独满足完成条件。至少需要一次真实 CLI process 到 URL、public command、attached RPC、scene worker 的完整链路。

## Out of Scope

- 同一项目同时运行多个 writable Preview backend。
- 通过隔离 `library` 或 `temp` 支持同一 source project 的多 writer。
- 用户级或系统级 session registry。
- 常驻 daemon、后台自动启动 Preview或跨机器 session discovery。
- 分布式锁、网络文件系统 lock 和多主协调。
- 远程网络鉴权、TLS、权限角色和多用户协作。
- 共享浏览器 VM 或把浏览器对象暴露给 CLI。
- 将内部任意 RPC module/method 直接开放为 public HTTP API。
- 重写 Scene Process IPC 协议。
- 在首轮为全部 public commands 手写独立 CLI subcommand。
- 改变已有 MCP tool 名称和输入输出 schema。
- 改变普通 build、make、run、upload 在没有 Preview session 时的现有独立 CLI 语义。
- 找不到 Preview 时自动启动后台 session。
- 因本需求重新执行完整 273 scene sweep。

## Further Notes

- 对应问题：`RP-ISSUE-040`（原编号 `RP-ISSUE-039`，因 `adapter-to-386` 的 P6 SVN AssetDB 完整性问题占用该号而改号）。
- Triage：`ready-for-agent`。
- 本 spec 扩展 `RP-ISSUE-036` 已完成的单进程统一 session；不修改其“Runtime Preview、Scene Editor 和 MCP 共享 backend，但不共享浏览器 VM”的边界。
- 首轮实现保持项目内一个 descriptor 文件和两个小型 HTTP surface，不引入 registry service、daemon、通用 service container 或新的 RPC protocol。
