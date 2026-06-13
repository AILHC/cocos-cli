# Configuration Module

## Responsibility

`src/core/configuration/` 负责 CLI、project 和 runtime configuration 的读取、合并和传递。

## Non-Goals

Configuration 模块不应根据测试失败反向改变 production 默认策略，也不直接初始化 engine 或 server。

## Main Entry Points

- `src/core/configuration/`

## Inputs

输入包括 global config、project config、command options、环境变量和显式测试 override。

## Outputs

输出是标准化后的配置对象、resolver input 和下游初始化参数。

## Dependencies

依赖 filesystem、project model 和上游 command options。

## Current Constraints

正常运行时，engine source 应从项目配置和 CLI 初始化链路解析。测试或专项验证可用 `COCOS_CLI_TEST_ENGINE_ROOT` 覆盖 engine source 路径。

Creator profile adapter 和 `cocos.config.json` 迁移策略属于 build/configuration 交叉边界。现有 build issue 只记录事实和待决策略，不能在未确认 production 策略时强制重写配置默认行为。

`cocos.config.json` 是 CLI-owned overlay 文件，只持久化 CLI-only 配置和文件 metadata。Editor-owned 配置必须从 Creator `settings/`、`profiles/` 和 global profiles 读取，并只在 runtime 内存中合并；保存时不能把 `builder`、`engine`、`script`、`scene` 或非白名单 `import.*` snapshot 写回 `cocos.config.json`。

## Related Evidence

当前 evidence 主要来自 runtime preview / engine root 专项；后续 configuration 专项结束后应补充模块自己的 facts 文档。

- `../../superpowers/specs/2026-06-13-cocos-config-editor-owned-runtime-merge-design.md`
- `../build/issues.md`
- `../build/README.md`
- `../build-extension-hooks-20260612.md`
- `../runtime-preview/facts/source-meta-editor-baseline-20260611.md`
