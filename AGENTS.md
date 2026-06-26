# AGENTS.md

## 地图

- `src/`：CLI 源码。
- `src/core/`：核心功能模块。
- `src/server/`：HTTP server 和 middleware。
- `src/runtime-preview/`：runtime preview 相关实现。
- `static/`：模板和静态资源。
- `vitests/`：Vitest 测试、测试辅助脚本和集成诊断入口。
- `docs/usage.md`：给 agent 使用发布版 CLI 时的注意事项；CLI `--help` 已覆盖的参数说明不在此重复。
- `docs/dev/`：开发设计、事实记录、计划和验收文档。

## 外部事实

- 本仓库行为同时受当前 CLI 源码、Cocos engine 源码、Cocos 相关 npm 包约束。
- 正常运行时，engine source 应从项目配置和 CLI 初始化链路解析。
- 测试或专项验证可用 `COCOS_CLI_TEST_ENGINE_ROOT` 覆盖 engine source 路径。
- `@cocos/asset-db`、`@cocos/ccbuild` 等 Cocos npm 包的 API、产物和版本行为是重要事实来源。
- 修改 engine source 时，记录 CLI 修改与 engine 修改的对应关系。

## 工作原则

- 修改前先读相关源码和 `docs/dev/` 中对应主题文档。
- 处理任何测试、验收、诊断脚本、环境变量或真实项目复现前，必须先读 `docs/dev/testing-spec.md`；不得跳过其中的测试层级、项目/fixture 分类、环境变量边界和构建要求。runtime preview 还必须继续读取 `docs/dev/runtime-preview/testing-spec.md`。
- 用户要求“记录反馈问题”或登记缺陷时，先在 `docs/dev/` 下查找对应专题的 `issues.md`、问题台账或状态定义；优先登记到已有台账。只有没有对应台账时才新建文档，并说明原因。
- 文档使用中文；代码标识符、路径、命令、专业术语保留英文。
- 判断以源码、真实产物和可重复验证结果为准。
- 测试失败、开发机缓存污染、路径迁移、旧 `engineRoot` / `projectRoot` / resolver record 残留，只能作为诊断事实或显式参数的依据，不能反向改变 production 默认策略。
- 不得为了让测试跑通而引入未被 CLI、Editor、engine 或 Cocos npm 包事实支持的默认行为；测试应对齐真实行为，特殊测试环境必须显式 opt-in。
- 不得把 `COCOS_CLI_TEST_*`、frozen Editor reference 或历史 fixture 当作 production 真实项目验收；route contract 通过也不得直接等同于 `preview --runtime` 真实项目通过。
- 不随意修改生成物、缓存或项目资源 `.meta`。
- 保持小步提交，提交信息说明具体意图。

## CodeGraph

处理代码结构探索、symbol 定位、调用关系、影响面或相关测试候选时，先阅读：

`.codex/memories/code-exploration-guide.md`

文本、日志、配置字面量查询仍优先使用 `rg`。

## 常用入口

- 构建和测试命令以根目录 `package.json`、`vitests/package.json` 为准。
- 发布版 CLI 使用注意事项入口：`docs/usage.md`。
- 项目测试规范入口：`docs/dev/testing-spec.md`。
- 改测试前先确认现有测试组织方式。
- runtime preview 专项测试规范入口：`docs/dev/runtime-preview/testing-spec.md`。
