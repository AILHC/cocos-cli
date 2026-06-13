# API Module

## Responsibility

`src/api/` 维护 `cocos-cli` 对外可复用的 API surface。它把内部能力整理成可导入接口，但不负责 CLI command lifecycle。

## Non-Goals

本模块不直接初始化 engine、AssetDB、builder 或 runtime preview server，也不保存长期运行状态。

## Main Entry Points

- `src/api/`

## Inputs

输入来自调用方传入的 project、engine、配置和命令参数。API 层不应隐式依赖测试环境缓存。

## Outputs

输出是可由外部调用方消费的函数、类型或封装结果。

## Dependencies

依赖 `src/core/` 中的具体能力模块，以及公共类型定义。

## Current Constraints

API 行为应与 CLI command 使用同一套 production 默认策略。测试 override 必须显式传入，不能在 API 层制造新的默认值。

## Related Evidence

当前没有独立 facts 文档。新增 API 行为证据时，应记录到 `../facts/` 或对应模块 facts 中。
