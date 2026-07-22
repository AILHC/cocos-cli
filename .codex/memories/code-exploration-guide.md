# CodeGraph 使用指南

CodeGraph 用于代码结构探索、symbol（符号）定位、调用关系、影响面分析和相关测试候选定位。它不替代源码判断、TypeScript 编译或测试。

## 使用边界

- 结构、模块、流程和影响面问题优先使用 CodeGraph。
- 文本、日志、配置字面量和注释查询仍优先使用 `rg`（快速文本搜索工具）。
- `codegraph_explore` 返回的源码可视为已读；只有结果缺失、索引滞后或需要核对刚修改的文件时，才补充直接读取。
- MCP（Model Context Protocol，模型上下文协议）工具不可见或项目没有索引时，直接使用 `rg`、AST（抽象语法树）搜索和源码读取，不得阻塞当前任务。

## 推荐流程

1. 理解功能、架构、bug 或代码流程时，先用 `codegraph_explore` 查询业务问题，并带上关键 symbol 或文件名。
2. 如果结果覆盖问题，直接基于返回源码判断，不重复执行大范围 `rg` / Read。
3. 当前 MCP 明确暴露 `search`、`node`、`callers`、`callees` 或 `impact` 等细粒度工具时，可按单一明确意图使用；不要假设旧版工具一定存在。
4. 查询测试影响时，同时关注 `tests/`、`vitests/` 和 `e2e/`；不要只根据 `callers` 或 `impact` 是否返回测试 symbol 下结论。
5. 工具响应出现 staleness banner（索引滞后提示）时，只回读提示列出的变更文件。

## 索引维护

首次初始化使用：

```powershell
codegraph init
```

日常由 watcher（文件监视器）增量同步。需要检查或修复时使用：

```powershell
codegraph status
codegraph sync
```

只有索引被中断、版本不兼容、排除规则改变或需要获得新版完整解析结果时，才执行 `codegraph index` 完整重建。大型索引一次只处理一个项目。

同一路径下的多个会话共享一个 daemon（守护进程）、watcher 和 SQLite（嵌入式数据库）连接。不要设置 `CODEGRAPH_NO_DAEMON=1`，除非正在诊断共享 daemon 连接故障。

## Cocos Engine 双项目查询

cocos-cli 和 Cocos Engine 源码是两个独立 CodeGraph 项目，各自拥有 `.codegraph/` 和 daemon，索引不会自动合并。

1. CLI 命令、resolver（解析器）、构建流程、MCP server 和测试查询使用 cocos-cli 根目录作为 `projectPath`。
2. 引擎类、引擎内部实现、平台实现和真实 API 查询使用实际解析出的 engine source（引擎源码）目录作为 `projectPath`。
3. engine source 路径必须从项目配置或 CLI 初始化链路确认；测试专项可使用明确设置的 `COCOS_CLI_TEST_ENGINE_ROOT`，不得把该环境变量当作 production（生产环境）默认路径。
4. 需要分析 CLI 到引擎的完整行为时，分别查询两个项目，再由 Agent 对齐入口、参数、返回值和副作用；不要假设 CodeGraph 会自动建立跨项目边。
