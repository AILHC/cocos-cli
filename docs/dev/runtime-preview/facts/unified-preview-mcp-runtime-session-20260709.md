# 统一 preview / runtime preview / MCP session 需求事实

日期：2026-07-09

## 背景

当前 `cocos preview --runtime` 与 `cocos start-mcp-server` 是两条独立启动链路。前者面向 runtime preview 浏览器访问，后者面向 MCP tool / scene editing 自动化。

用户反馈：如果为了在 runtime preview 下编辑 prefab / scene 资产，需要额外启动 MCP 实例，就会形成两个 CLI 初始化实例，各自加载 engine、AssetDB、scripting、builder 和相关缓存状态。这会让“预览结果”和“资产编辑落盘”之间只能通过磁盘、watch / refresh 间接联动，难以理解和协调。

## 现有源码事实

- `preview` 命令在不带 `--runtime` 时调用 `Launcher.startPreview()`；带 `--runtime` 时调用 `Launcher.startRuntimePreview()`。
- `Launcher.startRuntimePreview()` 当前启动 runtime preview server，并通过 lazy prepare 初始化 preview settings、AssetDB、scripting 和 builder，但不启动 scene RPC / MCP / editor scene service。
- `start-mcp-server` 通过 `CocosAPI.startup()` 调用 `Launcher.startup()`；该链路会启动 server、builder 和 scene worker，再注册 `/mcp`。
- scene / prefab 编辑落盘能力依赖 scene service / scene worker 链路，例如 `scene-open`、`scene-set-component-property`、`scene-add-component`、`scene-save`。
- runtime preview 浏览器 VM 不可能与 Node.js 进程直接共享对象内存；可实现的共享边界是同一个 CLI session 内复用 project context、engine root resolution、AssetDB manager、scripting manager、server、builder 初始化状态和 scene worker / RPC。

## 用户目标

默认 `cocos preview` 应成为统一工作台：

- 同一个 preview server 同时具备普通 preview、runtime preview 和 MCP 能力。
- 不再需要为了 agent 编辑资产单独启动 `start-mcp-server`。
- runtime preview、普通 preview 和 MCP scene editing 应共享同一套 CLI 初始化实例，避免重复 import 项目、重复启动 AssetDB、重复写 `library` / `temp`。
- 普通 preview 与 runtime preview 的选择应通过 URL / 参数切换，而不是要求用户启动不同 CLI 进程。
- asset editing 应继续通过可操作对象和 scene / prefab API 落盘，不应退化为直接编辑 `.scene` / `.prefab` 原始 JSON。

## 初步边界

- 本需求不是把浏览器运行态对象与 Node.js scene object 做真实共享内存。
- 本需求不是在 runtime preview 旁边外挂一个独立 MCP server。
- 本需求需要重新设计 `preview` 启动生命周期、server route 命名空间、MCP middleware 注册时机、scene worker 生命周期、runtime refresh 与 scene save 的协调关系。
- 实现前必须补充计划和验收矩阵，避免破坏已有 runtime preview 独立性、普通 preview 兼容性和 MCP scene editing 行为。
