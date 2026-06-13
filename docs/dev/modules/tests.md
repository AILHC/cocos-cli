# Tests Module

## Responsibility

`src/tests/` 和 `src/core/test/` 维护 source-level test helpers and fixtures。

## Non-Goals

测试 helper 不定义 production 默认行为，不应把测试环境 fallback 反向写入 production 链路。

## Main Entry Points

- `src/tests/`
- `src/core/test/`
- `vitests/`

## Inputs

输入包括 test fixtures、temporary project roots、显式环境变量和测试参数。

## Outputs

输出包括测试辅助对象、fixture paths 和断言辅助能力。

## Dependencies

依赖 vitest、core modules 和显式测试环境配置。

## Current Constraints

测试或专项验证可用 `COCOS_CLI_TEST_ENGINE_ROOT` 覆盖 engine source 路径；这种 override 不能改变 production 默认策略。

## Related Evidence

- `../runtime-preview/acceptance/matrix.md`
