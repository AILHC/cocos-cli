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

依赖 project、configuration、engine、filesystem 和 Cocos AssetDB 相关 packages。当前 `@cocos/asset-db` 由本仓库 local package `packages/asset-db` 接管，root `package.json` 通过 `file:./packages/asset-db` 引用。

## Current Constraints

资源解析必须基于真实 AssetDB/library metadata。不能用 chunk regex 或 frozen editor output 反推 production 语义。

CLI build 期间 AssetDB 对 `.meta` 和 project-level `library` records 的写入必须与 Editor baseline 对齐。不能简单禁止写入、build 后回滚文件，或未确认 Editor 行为就把 `internal` DB 改到隔离目录。

`packages/asset-db` 必须保留原 package name `@cocos/asset-db` 和既有 `@cocos/asset-db/libs/*` 子路径兼容。修改 local package 行为前，应先用行为测试锁定 registry package 或当前 local mirror 行为，再记录与 Editor baseline 对齐的差异。

当前 build/AssetDB 写入状态：

- `BUILD-ISSUE-007`：`internal` DB 顶层 record schema 已基本收敛到 Editor baseline，但 `.internal-info1.0.0.json` 仍有 1 个 engine asset `time` 字段差异，状态 `open`。
- `BUILD-ISSUE-008`：非 3D `typescript` `.meta imported:false` 复验后不再复现，状态 `fixed`。
- `BUILD-ISSUE-009`：3D `.gltf/.glb/.fbx.meta` 与 Editor baseline 不一致，状态 `open`。

## Related Evidence

当前 evidence 包含 runtime preview 专项和 build/AssetDB 写入一致性专项。后续 AssetDB 专项完成后，应继续把稳定结论回填到本模块。

- `../build/README.md`
- `../build/facts/meta-library-editor-parity-20260613.md`
- `../../superpowers/plans/2026-06-13-asset-db-custom-source.md`
- `../build/issues.md`
- `../runtime-preview/facts/architecture.md`
- `../runtime-preview/facts/reference-library.md`
- `../runtime-preview/acceptance/matrix.md`
