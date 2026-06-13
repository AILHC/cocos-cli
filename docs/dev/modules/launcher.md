# Launcher Module

## Responsibility

`src/core/launcher.ts` 负责 CLI lifecycle and command orchestration。它把 command intent 连接到 project、engine、AssetDB、builder、server 和 runtime preview 等模块。

## Non-Goals

Launcher 不应复制具体模块内部策略。例如 script dependency、HTTP response cache、AssetDB metadata 解析都应保留在对应模块。

## Main Entry Points

- `src/core/launcher.ts`

## Inputs

输入包括 command options、project root、engine root、global configuration、环境变量和测试显式 override。

## Outputs

输出包括运行中的服务、构建流程、日志、错误报告和命令生命周期状态。

## Dependencies

依赖 configuration、project、engine、asset-db、builder、scripting、server、runtime-preview、display 和 i18n。

## Current Constraints

Launcher 可以编排初始化顺序，但 production 默认行为必须来自下游模块事实。测试辅助参数只能显式 opt-in。

## Related Evidence

- `../runtime-preview/facts/logging-and-ready-state-20260612.md`
- `../runtime-preview/plans/ready-url-and-logging-contract-20260612.md`
