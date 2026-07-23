# Runtime Preview 编辑 Session 统一设计

## Problem Statement

当前 `preview --runtime`、`preview --scene-editor` 与 `start-mcp-server` 分别组织自己的启动链路。runtime preview 会创建并拥有独立 HTTP server；MCP 启动链路会再次初始化 project、engine、AssetDB、scripting、builder 和 scene worker；scene-editor 入口还会创建未绑定 child process 的 detached RPC。

这使同一个项目可能同时存在多个 CLI 主进程、多个 server、重复的项目初始化状态，以及彼此独立的 scene editing 与 runtime refresh 生命周期。用户为了在 runtime preview 运行期间通过 MCP 编辑 scene 或 prefab，不应再额外启动另一套项目实例。

用户不需要普通 browser game preview。目标产品只有 runtime preview、scene-editor 和 MCP：三者必须属于同一个 CLI session，共用一个 HTTP server、一个 project context 和一个 backend scene worker。

## Solution

默认 `cocos preview` 启动一个 Runtime Preview 编辑 Session。该 session：

1. 只初始化一次 project、engine、AssetDB、scripting 和 builder。
2. 只启动一个本地 HTTP server。
3. 只启动一个 scene worker，并通过 attached RPC 供 backend scene editing 使用。
4. 在根路径提供 runtime preview。
5. 在 `/scene-editor/` 提供 scene-editor。
6. 在 `/mcp` 提供 MCP endpoint。
7. 在 MCP 或 scene service 保存资产后，通过同一 AssetDB 状态协调 runtime refresh。
8. 由 session 统一处理启动失败回滚和关闭顺序。

普通 browser game preview 不参与该 session，也不注册对应 routes。`--runtime` 在兼容期仅表示默认 runtime 入口；`--scene-editor` 仅选择启动后打开的页面，不再选择另一套后端生命周期。

## User Stories

1. 作为 Cocos 项目开发者，我希望执行一次 `cocos preview` 就获得 runtime preview、scene-editor 和 MCP，从而不需要维护多个 CLI 进程。
2. 作为 runtime preview 用户，我希望 runtime preview 默认位于 server 根路径，从而不需要额外的普通 preview 入口。
3. 作为 runtime preview 用户，我希望普通 browser game preview 不被初始化，从而避免多余 routes、状态和启动成本。
4. 作为场景开发者，我希望 scene-editor 与 runtime preview 使用同一个 server，从而只需要管理一个端口。
5. 作为使用 AI agent 的开发者，我希望 MCP endpoint 与 runtime preview 使用同一个 server，从而不需要额外启动 `start-mcp-server`。
6. 作为使用 AI agent 的开发者，我希望所有 MCP scene editing 请求进入同一个 scene worker，从而避免多个 backend scene 状态相互覆盖。
7. 作为 scene-editor 用户，我希望 scene-editor 不再创建 detached RPC 覆盖 scene worker 的 attached RPC，从而保证 MCP scene editing 始终可用。
8. 作为 scene-editor 用户，我希望浏览器到主进程的 HTTP RPC 仍可调用 AssetDB、scripting、configuration 和 i18n 能力，从而保留现有编辑功能。
9. 作为 MCP 用户，我希望 scene、node、component 和 prefab 操作通过 attached RPC 进入 backend scene worker，从而操作同一个 backend editing context。
10. 作为 MCP 用户，我希望保存 scene 或 prefab 后 runtime preview 能读取更新后的 AssetDB/library 状态，从而不需要启动另一套 import 流程。
11. 作为 runtime preview 用户，我希望 MCP 保存产生的 AssetDB 事件进入 runtime refresh 协调链路，从而避免只依赖 filesystem watcher 的间接同步。
12. 作为从外部工具修改文件的开发者，我希望 filesystem watcher 能继续处理 CLI 进程外的资源变化，从而保留现有外部变更刷新能力。
13. 作为项目开发者，我希望 engine root 只解析一次，从而保证 runtime preview、scene worker 和 MCP 使用同一个 engine source。
14. 作为项目开发者，我希望 AssetDB 只初始化一次，从而避免重复扫描、import 和 library 写入。
15. 作为项目开发者，我希望 scripting 只初始化一次，从而避免多个 PackerDriver workspace 并发改写 records 和 chunks。
16. 作为项目开发者，我希望统一 session 只使用一个 CLI-owned programming workspace，从而避免普通 Editor workspace 与 CLI workspace 相互清理。
17. 作为项目开发者，我希望 builder 只初始化一次，从而避免不同入口生成不一致的 preview settings。
18. 作为项目开发者，我希望 runtime preview 在所有依赖 ready 后才被声明为 ready，从而避免打开页面时看到部分初始化状态。
19. 作为项目开发者，我希望任何启动阶段失败都能释放已经启动的 worker、watcher 和端口，从而不会留下半启动进程。
20. 作为项目开发者，我希望关闭 preview 时 scene worker、MCP transport、watcher 和 server 都被释放，从而后续启动不会遇到残留状态。
21. 作为项目开发者，我希望重复关闭 session 不会报错，从而 signal handler 与显式关闭可以安全并存。
22. 作为 CLI 用户，我希望 `--scene-editor` 只决定默认打开 `/scene-editor/`，从而不会切换到另一套后端实例。
23. 作为现有脚本用户，我希望兼容期内 `--runtime` 仍可使用，从而迁移到新的默认语义时不立即破坏自动化脚本。
24. 作为 MCP-only 工作流用户，我希望兼容入口复用同一 Runtime Preview 编辑 Session 实现，从而不再维护第二套初始化逻辑。
25. 作为安全敏感的开发者，我希望包含 MCP 的共享 server 默认只监听 loopback，从而不会无意暴露到局域网。
26. 作为维护者，我希望 runtime preview 的业务逻辑与 HTTP server ownership 分离，从而既能挂到共享 server，也能在必要的独立测试 adapter 中运行。
27. 作为维护者，我希望 runtime routes 在 Scene 的宽泛 fallback routes 之前注册，从而确定性处理 runtime 请求。
28. 作为维护者，我希望 Scene 初始化不再隐式注册普通 browser preview，从而 Scene 模块只负责 scene 能力。
29. 作为维护者，我希望 MCP 注册只负责 MCP middleware，不再次启动 project，从而资源 ownership 保持单一。
30. 作为维护者，我希望新增设计集中在一个 session seam，而不是引入通用插件系统、service container 或 daemon，从而控制实现复杂度。

## Implementation Decisions

- 新增 Runtime Preview 编辑 Session 作为唯一生命周期 owner。其外部 interface 只暴露启动结果、runtime/scene-editor/MCP URLs 和幂等关闭。
- 默认 `cocos preview` 启动完整 session，并默认打开 runtime preview 根路径。
- session 只包含 runtime preview、scene-editor 和 MCP；普通 browser game preview 明确排除。
- runtime preview 使用 `/`；scene-editor 使用 `/scene-editor/`；MCP 使用 `/mcp`。
- runtime routes 必须先于 Scene 的宽泛 fallback routes 注册。保留清晰的注册顺序，不依赖重复挂载或偶然的 Express 匹配结果。
- Scene 初始化不再隐式注册普通 browser preview。普通 preview 现有实现可在兼容期保留，但不进入新 session。
- runtime preview 的 route/resolver/settings/refresh 行为从 HTTP listener ownership 中分离。共享 adapter 将 runtime router 挂到已有 server；必要的 standalone adapter 只用于兼容和现有测试，不成为 production 的第二条业务策略。
- runtime preview 的 close 只释放自身 watcher、listener、logger 和 refresh 状态，不关闭共享 server。
- session 只启动一个 scene worker。scene worker ready 后，主进程保留 attached RPC 作为唯一全局 RPC 实例。
- scene-editor 启动链路不再调用无 child process 参数的 RPC startup，不创建 detached RPC。
- attached RPC 同时承担两种现有能力：main-process proxy 通过 IPC request 调用 scene worker；HTTP RPC route 通过 execute-local 行为调用主进程注册的 handlers。不新增 RPC multiplexer。
- MCP 注册与 project startup 分离。MCP middleware 在 session ready 过程中注册，但不再次调用项目启动入口。
- MCP tool registry 使用当前 session 的 project context；scene editing tools 继续通过现有 main-process proxy 和 attached RPC 调用 scene worker。
- session 启动 server 后，将同一个 server URL 传给 engine、scene worker 和 runtime settings 链路。
- session 只创建一套 AssetDB、scripting 和 builder 状态。
- unified session 使用 CLI-owned programming workspace，保持当前 runtime preview 的隔离语义；不得静默切换到 Editor-owned programming workspace。
- runtime preview 继续使用共享 project library 和同一个 AssetDB manager，不创建第二套 library owner。
- MCP/scene service 通过 AssetDB 保存资产后，runtime refresh 订阅同一进程内的 AssetDB change events；filesystem watcher 继续负责进程外文件变化。Scene 模块不直接依赖 runtime preview 模块。
- server 默认绑定 loopback。远程暴露 MCP 不属于默认行为。
- session 启动只在 server listening、project import、builder、scene worker、runtime readiness 和 MCP registration 全部成功后返回。
- 启动失败使用局部 cleanup stack 逆序回滚，不引入通用资源图或依赖注入框架。
- 关闭顺序为 runtime/MCP 有状态资源、scene worker/RPC、AssetDB/scripting/project，最后关闭 HTTP server。
- `--runtime` 在兼容期保留，但不再选择独立 server path；后续可以在单独的 breaking change 中删除。
- `--scene-editor` 只选择默认打开 URL；`--no-open` 继续控制是否打开页面。
- `start-mcp-server` 不再拥有独立实现。兼容期如需保留，只能复用同一个 session 启动实现并以 headless 方式输出 MCP URL。
- 不引入跨进程 session discovery；标准工作流由 `cocos preview` 启动唯一 session，MCP client 连接该 session 输出的 URL。

## Testing Decisions

- 最高测试 seam 是真实 CLI child process 启动的 Runtime Preview 编辑 Session。测试通过 HTTP、MCP 调用、进程和端口生命周期观察行为，不断言内部字段。
- CLI integration 断言一次启动只产生一个 listening server，且 runtime、scene-editor 和 MCP endpoint 使用同一实际端口。
- CLI integration 断言 runtime 根路径返回 runtime preview，而不是普通 GamePreview 页面。
- route contract 覆盖 runtime routes 先于 Scene fallback routes，且 `/scene-editor/`、`/mcp` 不被 runtime root handler吞掉。
- launcher/session integration 覆盖 project、AssetDB、scripting、builder 和 scene worker 各初始化一次。
- RPC integration 覆盖 attached RPC 下的 MCP scene operation，并同时覆盖浏览器 HTTP RPC 对主进程 local handler 的调用。
- 回归测试明确断言 scene-editor 初始化不会调用 detached RPC startup，也不会 dispose 已连接的 scene worker RPC。
- MCP integration 至少执行一个 scene open/query/save 闭环，证明 MCP 使用当前 session 的 scene worker。
- runtime refresh integration 通过 MCP 或 scene service 保存测试资产，观察同一 session 内 AssetDB change、runtime refresh 和 HTTP readback。
- filesystem watcher 测试继续覆盖进程外文件变化，且不得因增加 AssetDB event source 导致重复 refresh 或 dirty target 泄漏。
- programming output integration 验证 runtime settings、scene scripting routes 和 scene worker 读取同一 CLI-owned programming workspace。
- failure-path 测试覆盖 server 启动后 project import 失败、scene worker 启动失败、runtime prepare 失败和 MCP registration 失败，并验证端口与 child process 均释放。
- shutdown integration 验证 session close 后 scene worker 退出、watcher 停止、MCP transport 关闭且端口可重新监听。
- close idempotency 测试覆盖显式 close 与 signal cleanup 重复触发。
- CLI command 测试覆盖默认 `preview`、兼容 `--runtime`、`--scene-editor` 和 `--no-open` 的新语义。
- 普通 GamePreview routes 不属于新 session 的成功条件；测试应防止它们被 Scene 初始化意外注册。
- Vitest route contract 只能证明 HTTP contract；至少补一个真实 CLI child process integration。
- 主测试项目可证明统一 session 的通用能力；具体真实业务项目问题仍需按 runtime preview 测试规范单独验收。
- 最终 production 验收必须记录实际 project、engine root、端口、scene、环境变量、构建状态、MCP scene operation、runtime ready 和关闭结果。
- 主测试项目验收必须使用从 `E:\own_space\engines\cocos-test-projects` 创建的隔离副本，不删除或改写原项目的 `library`、`temp`、source 或 `.meta`。
- 修改前基线 `preview --runtime` 与新默认 `preview` 必须在等价的冷启动隔离副本上比较 `library`、`temp/cli/asset-db` 和 `temp/cli/programming`；仅规范化绝对根路径、端口和时间戳等非语义字段。
- 隔离主测试项目中的全部 `cc.SceneAsset` 必须逐个通过共享 MCP 打开，并在真实 Runtime Preview 浏览器中达到对应 scene ready；逐 scene 检查 console、page error、network、canvas 和截图。
- 最终验收还必须覆盖 MCP/Scene Editor 跨表面状态、scene save 后 runtime readback、watcher 外部变化与内部保存去重，以及成功 session 的信号关闭、端口释放和同端口重启。

## Out of Scope

- 普通 browser game preview。
- legacy build-based preview。
- 浏览器运行时对象与 Node scene object 的共享内存。
- 多个 scene worker 或按页面创建 scene worker。
- 多项目共用一个 CLI session。
- 常驻 daemon、跨 CLI 进程接管和 session discovery protocol。
- 通用插件系统、service container 或动态 feature registry。
- session 运行期间动态卸载并重新挂载 runtime、scene-editor 或 MCP。
- 合并 runtime resolver 与 Scene middleware 的内部实现。
- 直接修改 `.scene` 或 `.prefab` 原始 JSON 代替 scene service。
- 默认向局域网暴露 MCP。
- 在本需求中删除所有历史普通 preview 源码和测试；只要求新 session 不再进入该链路。

## Further Notes

- 对应问题：`RP-ISSUE-036`。
- Triage：`ready-for-agent`。
- 本 spec 取代 2026-07-09 事实记录中“统一普通 preview、runtime preview 和 MCP”的旧目标。最新明确范围只有 runtime preview、scene-editor 和 MCP。
- 实现前应把 acceptance matrix 增加统一 session 专项条目；未完成真实 CLI child process、MCP scene editing 和 runtime refresh 验收前，不得将问题标记为 `fixed`。
