# Cocos CLI Development Documentation

本文是 `cocos-cli` 开发文档入口。文档按渐进式披露组织：先读项目架构，再进入模块文档，需要核实时再进入事实记录和过程记录。

## Reading Path

1. 项目整体结构：`architecture/overview.md`
2. 源码模块地图：`architecture/module-map.md`
3. 文档维护规则：`architecture/documentation-policy.md`
4. 模块正式文档：`modules/`
5. 可验证事实：`facts/`
6. 设计决策：`decisions/`
7. 专项计划、验收和交接：各主题目录下的 `plans/`、`acceptance/`、`handoff/`

## Document Types

- `architecture/`：跨模块架构、生命周期、数据流和文档维护规则。
- `modules/`：当前模块职责、入口、输出、依赖和边界。
- `facts/`：源码位置、真实产物、命令输出和对比记录。
- `decisions/`：带取舍的长期设计决策。
- `plans/`：某次修改计划。
- `acceptance/`：验收过程和结果。
- `handoff/`：阶段性交接。
- `archive/`：历史记录，不作为当前架构入口。

## Existing Documents

现有主题文档继续保留，并从正式入口登记：

- `design.md`：历史总体设计入口，后续稳定内容逐步回填到 `architecture/` 和 `modules/`。
- `quick-reference.md`：开发速查入口。
- `codegraph-usage.md`：CodeGraph 使用说明。
- `build-extension-hooks-20260612.md`：build extension hooks 专题记录。
- `i18n.md`、`i18n-types-usage.md`：i18n 专题记录，归属 `modules/i18n.md`。
- `build/`、`core/`：已有主题目录，后续按模块归属逐步链接到 `modules/`。
- `runtime-preview/`：runtime preview 专项记录，稳定结论回填到 `modules/runtime-preview.md` 和相关跨模块文档。

## Maintenance Rule

验证和排查时可以先记录在 `facts`、`issues`、`plans` 或 `acceptance`。专项结束后，稳定结论必须回填到 `architecture/` 或 `modules/`，证据链接保留到 `facts/` 或过程文档。
