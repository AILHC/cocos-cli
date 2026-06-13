# Vitests Module

## Responsibility

`vitests/` 保存 Vitest suites、fixtures、shared test utilities 和集成诊断入口。

## Non-Goals

Vitest fixtures 和 test override 不定义 production 默认行为。

## Main Entry Points

- `vitests/suites/`
- `vitests/fixtures/`
- `vitests/shared/`
- `vitests/scripts/`

## Inputs

输入包括 test project、fixtures、显式环境变量、engine root override 和 test runner options。

## Outputs

输出包括测试结果、诊断 evidence 和回归保护。

## Dependencies

依赖 Vitest、主 CLI build output、engine source 和测试项目。

## Current Constraints

测试失败、fixture 污染和本机缓存污染只能作为诊断事实或显式参数依据，不能反向改变 production 默认策略。

## Related Evidence

- `../runtime-preview/acceptance/matrix.md`
- `../runtime-preview/plans/integration-fixture-migration-20260612.md`
