# Architecture Overview

`cocos-cli` 负责在 CLI 环境中组织 Cocos project、engine source、AssetDB、builder、HTTP server、runtime preview 等能力。它不直接复制 Editor runtime，而是通过当前 CLI 源码、Cocos engine 源码和相关 npm 包事实建立等价链路。

## Main Subsystems

- API：public API export 和外部调用面。
- Commands：CLI command definitions and command handlers。
- Launcher：CLI 命令入口和运行生命周期。
- Configuration：全局配置、项目配置和运行时配置解析。
- Engine：engine root 解析、engine capability 和 engine source 约束。
- Project Config：`projectRoot`、`engineRoot`、resolver records 和环境变量覆盖。
- AssetDB：资源扫描、metadata、library 输出和 query。
- Builder：构建 worker、bundle script、资源和脚本输出。
- Scripting：script compile、packer-driver、records、import-map、chunks。
- Server：HTTP server、middleware、静态/动态响应、cache validators。
- Runtime Preview：browser preview app、settings、scene load、error report。
- Display / i18n / MCP：终端展示、本地化文本和 MCP integration。

## Runtime Boundaries

Production 默认行为必须来自 CLI、Editor、engine 或 Cocos npm 包事实。测试环境可以显式 opt-in，例如 `COCOS_CLI_TEST_ENGINE_ROOT`，但不能反向改变 production 默认策略。

## Documentation Boundary

架构文档描述当前稳定结构；事实记录描述如何验证这些结构；Superpowers spec / implementation plan 统一保存在 `docs/superpowers/`；验收和交接文档保留专项过程。稳定结论不能长期只存在于日期文档中。
