# AssetDB Module

## Responsibility

`src/core/assets/` 负责 AssetDB integration、resource metadata、library output 和 query。它把 project assets、`.meta`、serialized data 和 library 产物转为 builder、scene、runtime preview 可消费的事实。

## Non-Goals

AssetDB 模块不直接推导 script chunk 业务语义，不负责 HTTP route response，也不把 frozen editor output 作为 production 默认数据源。

## Main Entry Points

- `src/core/assets/`
- `src/core/assets/manager/`

## Inputs

输入包括 project assets、`.meta`、AssetDB records、engine source、project config 和显式测试 override。

## Outputs

输出包括 resource metadata、library files、asset query results、`dependScripts` / `dependedScripts` 等下游需要的资源事实。

## Dependencies

依赖 project、configuration、engine、filesystem 和 Cocos AssetDB 相关 npm packages。

## Current Constraints

资源解析必须基于真实 AssetDB/library metadata。不能用 chunk regex 或 frozen editor output 反推 production 语义。

## Related Evidence

当前 evidence 主要来自 runtime preview 专项；后续 AssetDB 专项结束后应补充模块自己的 facts 文档。

- `../runtime-preview/facts/architecture.md`
- `../runtime-preview/facts/reference-library.md`
- `../runtime-preview/acceptance/matrix.md`
