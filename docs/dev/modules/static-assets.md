# Static Assets Module

## Responsibility

`static/` 保存 CLI 运行、runtime preview、build templates、scripting support 和 web 相关的静态模板与资源。

## Non-Goals

Static assets 不定义 production 策略；它们由 builder、server、runtime preview 或 workflow 模块按明确入口消费。

## Main Entry Points

- `static/runtime-preview/`
- `static/build-templates/`
- `static/scripting/`
- `static/web/`
- `static/assets/`
- `static/i18n/`
- `static/tools/`

## Inputs

输入包括模板变量、build context、runtime preview context 和调用方传入的资源路径。

## Outputs

输出包括 preview HTML/template、build templates、web assets 和静态辅助文件。

## Dependencies

依赖消费它们的 runtime-preview、builder、server、i18n 或 workflow 模块。

## Current Constraints

模板和静态资源的业务语义应记录到消费模块文档中；本模块负责登记静态文件归属。

## Related Evidence

- `../runtime-preview/archive/old-implementation-review-20260606.md`
- `../runtime-preview/facts/browser-entry.md`
