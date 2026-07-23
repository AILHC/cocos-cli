# 统一 runtime preview / scene-editor / MCP session 需求事实

日期：2026-07-09

## 背景

当前 `cocos preview --runtime`、`cocos preview --scene-editor` 与 `cocos start-mcp-server` 是彼此分离的启动链路。前者面向 runtime preview 浏览器访问，后两者分别面向 scene-editor 和 MCP tool / scene editing 自动化。

用户反馈：如果为了在 runtime preview 下编辑 prefab / scene 资产，需要额外启动 MCP 实例，就会形成两个 CLI 初始化实例，各自加载 engine、AssetDB、scripting、builder 和相关缓存状态。这会让“预览结果”和“资产编辑落盘”之间只能通过磁盘、watch / refresh 间接联动，难以理解和协调。

## 现有源码事实

- `preview` 命令当前默认调用 `Launcher.startGamePreview()`；带 `--runtime` 时调用 `Launcher.startRuntimePreview()`；带 `--scene-editor` 时调用 `Launcher.startSceneEditorPreview()`。
- `Launcher.startRuntimePreview()` 当前启动 runtime preview server，并通过 lazy prepare 初始化 preview settings、AssetDB、scripting 和 builder，但不启动 scene RPC / MCP / editor scene service。
- `start-mcp-server` 通过 `CocosAPI.startup()` 调用 `Launcher.startup()`；该链路会启动 server、builder 和 scene worker，再注册 `/mcp`。
- `Launcher.startSceneEditorPreview()` 当前与 browser game preview 共用 server，但会创建未绑定 child process 的 RPC 实例；该实例与 scene worker attached RPC 不能作为两个独立全局实例并存。
- scene / prefab 编辑落盘能力依赖 scene service / scene worker 链路，例如 `scene-open`、`scene-set-component-property`、`scene-add-component`、`scene-save`。
- runtime preview 浏览器 VM 不可能与 Node.js 进程直接共享对象内存；可实现的共享边界是同一个 CLI session 内复用 project context、engine root resolution、AssetDB manager、scripting manager、server、builder 初始化状态和 scene worker / RPC。

## 用户目标

默认 `cocos preview` 应成为 Runtime Preview 编辑工作台：

- 同一个 server 同时具备 runtime preview、scene-editor 和 MCP 能力。
- runtime preview 是唯一 preview，并占用 server 根路径；普通 browser game preview 不属于目标能力。
- 不再需要为了 agent 编辑资产单独启动 `start-mcp-server`。
- runtime preview、scene-editor 和 MCP scene editing 应共享同一套 CLI 初始化实例，避免重复 import 项目、重复启动 AssetDB、重复写 `library` / `temp`。
- scene-editor 通过独立 URL 进入，但不启动另一套 backend lifecycle。
- asset editing 应继续通过可操作对象和 scene / prefab API 落盘，不应退化为直接编辑 `.scene` / `.prefab` 原始 JSON。

## 初步边界

- 本需求不是把浏览器运行态对象与 Node.js scene object 做真实共享内存。
- 本需求不是在 runtime preview 旁边外挂一个独立 MCP server。
- 本需求不包含普通 browser game preview；Scene 初始化不应继续隐式注册该能力。
- 本需求需要重新设计 `preview` 启动生命周期、runtime 与 Scene route 注册顺序、MCP middleware 注册时机、scene worker 生命周期、runtime refresh 与 scene save 的协调关系。
- 详细设计见 `docs/superpowers/specs/2026-07-23-runtime-preview-editing-session-design.md`。
- 验收矩阵必须覆盖 runtime preview、scene-editor、MCP scene editing、保存协调和生命周期。

## 2026-07-23 实现事实

- 默认 `cocos preview` 与显式 `preview --runtime` 进入同一条 `RuntimePreviewSession` 启动链路；`--scene-editor` 只决定初始打开的页面，不创建另一套服务。
- session 只创建一个共享 `Server`、一套 project/engine/AssetDB/scripting/builder context 和一个 `sceneWorker`。Runtime Preview 挂在根路径，Scene Editor 挂在 `/scene-editor/`，MCP Streamable HTTP transport 挂在 `/mcp`。
- `sceneWorker` 与主进程 `Rpc` 使用 attached 模式绑定同一个 child process；MCP scene tool 和 Scene Editor HTTP RPC 都复用该实例。detached `Rpc.startup()` 不参与统一 session。
- ordinary GamePreview 不再是默认 `preview` 能力，也不会被统一 session 隐式注册。
- Runtime Preview HTTP router 与 listener ownership 已拆分：production 挂到共享 server，standalone adapter 仅保留兼容和测试用途。
- Runtime Preview 根路径 library route 会区分 browser 与 Node scene engine 请求：browser 获得资源字节，scene engine 对 canonical root library URL 获得本地绝对路径，避免 router 注册顺序破坏 Node adapter 的加载契约。
- AssetDB 保存成功会发布领域事件；`RuntimeAssetSaveCoordinator` 在同一 AssetDB/scripting context 中完成产物等待、runtime cache invalidation 和 watcher follow-up 去重。保存失败不发布成功事件。
- session 按 ownership 逆序清理 runtime/MCP 状态、scene worker/RPC、项目服务和 HTTP server；`SIGINT`、`SIGTERM` 与启动失败均进入同一异步清理路径。

## 2026-07-23 自动化与局部证据

- `unified-session-cli-integration.test.ts` 从明确分类的 `asset-operation` fixture 创建临时项目，排除原有 `library` 和 `temp` 后冷启动；child process 不注入已知 `COCOS_CLI_TEST_*`，并以不带 `--runtime` 的默认 `cocos preview --no-open` 启动。
- 同一 child process 中观测到一个 HTTP server 和一个 scene process；同一端口的 `/`、`/scene-editor/`、`/mcp` 均可用，普通 GamePreview route 返回不存在。
- MCP 完成 tool list、2D scene create、open、query 和 save；保存后 Runtime Preview scene route 可读取新 scene 产物，并记录一次共享保存协调完成事件。
- lifecycle focused tests 覆盖 attached RPC、worker early exit、重复启动、`SIGINT`、`SIGTERM`、启动回滚、清理阶段继续执行和失败 owner 重试。
- 真实 CLI integration `1/1` 通过；统一 session focused Vitest 中不依赖 frozen Editor reference 的 `123` 项通过；Jest `54/54` 通过；`tsc -b` 与 `npm run compile` 通过。
- 另有 `8` 个既有 frozen-reference 用例因当前环境未提供 `COCOS_CLI_TEST_EDITOR_LIBRARY_REF` 而未执行到断言，不把该环境缺口解释为 production 行为回归。

以上是最终验收前的基础 contract 证据。随后补充了隔离主测试项目验收，结论见下节。

## 2026-07-23 隔离主测试项目最终验收

所有可写验收均在 `E:\own_space\tmp\cocos-cli-opt-acceptance-20260723` 下执行。输入项目 `E:\own_space\engines\cocos-test-projects` 未写入验收 scene、`.meta`、`library` 或 `temp`；验收结束后隔离 current project 已恢复为 `273` 个 scene。

### 产物 parity

- 修改前基线使用 detached worktree `b23f2fe5` 的 `preview --runtime`；当前实现使用不带 `--runtime` 的默认 `preview --no-open`。
- 两次启动使用同一个隔离 `parity-project`，比较范围为 `library`、`temp/cli/asset-db`、`temp/cli/programming`。
- 只忽略 `temp/cli/programming/packer-driver/logs/debug.log` 和已明确列出的时间戳字段；不忽略路径、UUID、依赖、import map、script output 或 library 内容。
- baseline 与 current 均得到 `7365` 个规范化文件；`missing=0`、`added=0`、`changed=0`。
- 证据：`E:\own_space\tmp\cocos-cli-opt-acceptance-20260723\output-parity-final.json`。

### 全 scene 浏览器 sweep

- baseline 与 current 的 source scene 数和 `/scene-list` route scene 数均为 `273`。
- 两边均有 `273/273` scene 到达 `__RUNTIME_PREVIEW_READY`，且 `GameCanvas` 的 backing/client 尺寸均为正。
- current strict-clean 为 `213`，baseline strict-clean 为 `212`；`60` 个 failure 在两边共同出现，主要是测试项目既有 missing asset、TiledMap class 等诊断。
- current-only failure 为 `0`。baseline-only failure 为 `network.scene` 的一次瞬时结果，current 通过。
- 当前实现的 `14` 张 contact sheet 已逐张人工检查；未发现新增 blank、crash、画面未构建或布局级重大问题。已知空白 TiledMap case 与 baseline 的相同错误对应，不能记为本次修复，也不能记为新回归。
- 证据：`E:\own_space\tmp\cocos-cli-opt-acceptance-20260723\scene-sweep\evidence.json` 与 `scene-sweep-baseline\evidence.json`。

### 共享编辑、watcher 与 lifecycle

- 默认 `cocos preview --watch-assets --no-open` 的同一 origin 上，Runtime Preview、`/scene-editor/`、`/mcp` 和 attached scene RPC 均返回成功。
- MCP 在隔离副本中创建 2D scene，完成 open、create node、query、rename 和 save；Scene Editor 浏览器打开相同 scene UUID，并显示 `UnifiedAcceptanceNodeSaved`；Runtime Preview route 与浏览器读取相同保存产物。
- 首个 session 只观测到一个 scene process PID，MCP 和两个浏览器 surface 没有启动额外 scene process。
- 内部 save 只完成一次 refresh；同一 save 的中间 watcher observation 被后续 AssetDB success generation 消解。随后对隔离 scene 文件做外部修改，watcher 仍触发独立 refresh。
- `SIGTERM` 释放首个 scene PID 和端口；同一端口重启后只产生一个新 scene PID；`SIGINT` 再次释放新 PID 和端口。
- `unified-session-edit-acceptance.ts` 共 `24` 项检查，`24/24` 通过。证据：`E:\own_space\tmp\cocos-cli-opt-acceptance-20260723\shared-session\evidence.json` 与 `shared-session\screenshots`。

### 已知非阻断诊断

- Scene Editor 浏览器加载 `default_skybox` 时存在两条精确记录的 `404`：`query-asset-info` 和对应 serialized JSON。验收脚本只豁免这两个已知 URL，其他 console/page/network/request failure 仍会失败。当前 2D 验收 scene 的 Scene Editor 画布、engine pipeline、scene UUID 和 node 状态均正常。
- Scene Editor 启动时还观测到 `sceneConfigInstance.set` 尝试持久化 `scene.gizmo` 被配置层拒绝；这是配置边界诊断，没有阻断本次 scene open/query/save/readback。它不属于“共享 session 是否成立”的判据，也未被描述为已修复。
- Runtime Preview 创建 scene 的浏览器页面为 `960x640` 正尺寸 canvas，console/page/network/request failure 均为 `0`。

## 结论

`RP-ISSUE-036` 的目标已成立：默认 `cocos preview` 只提供一个 Runtime Preview editing session，Runtime Preview、Scene Editor 和 MCP 共享同一 server、项目上下文、AssetDB/scripting/builder 状态、attached RPC 与唯一 scene worker。各浏览器 realm 仍是独立 VM；实现和验收都没有宣称共享浏览器对象内存。普通 GamePreview 不在该 session 中。
