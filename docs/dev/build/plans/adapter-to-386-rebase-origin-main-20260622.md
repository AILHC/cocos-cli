# adapter-to-386 rebase 到 origin/main 的计划

日期：2026-06-22

## 目标

在真正改写历史前，记录已知事实、可能冲突区域和合并方向，让 `adapter-to-386` 更顺利地 rebase 到当前 `origin/main`。

`adapter-to-386` 的目标是让本 CLI 适配 Cocos Creator / engine 3.8.6 的行为。该分支需要保留能让 CLI asset import、build output、runtime preview、platform output、project extension 行为更接近 Editor 3.8.6 的改动，同时吸收不破坏该目标的上游改进。

## remote 命名

当前 remote 拓扑：

- `origin`: `https://github.com/AILHC/cocos-cli.git`
- `upstream`: `https://github.com/cocos/cocos-cli.git`

因此，本文中的 `origin/main` 指 fork 的 main 分支。不要在未检查 remote 的情况下把它称为“官方 main”。如果需要官方 Cocos main，必须显式比较 `upstream/main`。

2026-06-22 更新：当前远端 `origin/main` 与远端 `upstream/main` 都指向同一个 commit：`c71c446`。本地 `upstream/main` ref 在显式 fetch 前可能是旧的。本文的 rebase 计划以当前 `origin/main` 作为目标 base。

## 之前的快照

本文件创建前曾做过一次分析，当时状态如下：

- 本地 `main`: `b6ff0d8`
- 当时的 `origin/main`: `20f3279`
- `adapter-to-386`: `fd3fa34`
- `adapter-to-386` 与当时 `origin/main` 的 merge-base: `71b2ad8`
- 分叉情况：`adapter-to-386` ahead 103，behind 26

当时的结论是：`main..origin/main` 主要改动 scene/editor 与 builder schema 行为；`adapter-to-386` 主要改动 runtime preview、3.8.6 build parity、asset-db parity 与 project extension hooks。

## adapter-to-386 的改动主题

- Runtime preview：preview server/app、settings provider、library/programming on-demand routes、ready/logging、browser 与 HTTP smoke evidence。
- Build parity：`wechatgame` platform、CCONB output、bundle output helpers、build profile fixes。
- Asset 与 meta parity：本地 `packages/asset-db`、internal record 对齐、3D source meta 对齐、Editor-owned runtime config 与 CLI-owned persisted config 分离。
- Project extensions：extension discovery、extension asset-db mounts、project extension builder registration、build error hooks。
- 文档与测试：runtime-preview/build facts、parity plans、Vitest suites、targeted regression tests。

这些主题直接服务于 3.8.6 adapter 目标。除非有新的事实证明它们已经被上游等价替代，否则 rebase 时不应丢弃。

## 之前已知的冲突区域

之前快照中，read-only `git merge-tree origin/main adapter-to-386` 预测以下文件存在 text conflicts：

- `src/core/assets/asset-config.ts`
- `src/core/builder/manager/plugin.ts`
- `src/core/builder/worker/builder/asset-handler/script/index.ts`
- `src/core/configuration/test/manager.test.ts`

同时存在高风险 semantic overlaps：

- `package.json`
- `package-lock.json`
- `src/core/builder/index.ts`
- `src/core/builder/share/common-options-validator.ts`
- `src/core/assets/manager/query.ts`
- `src/core/configuration/script/manager.ts`

## 分区域合并方向

### `src/core/assets/asset-config.ts`

两个方向都需要保留：

- 保留 `adapter-to-386` 的 extension mount helper 行为，即 `resolveProjectExtensionAssetDbMounts()`。
- 如果 runtime preview 与 build parity 仍依赖 3.8.6 internal/project library 事实，则继续保留这些事实。
- 只有在不破坏 adapter 事实时，才吸收 `origin/main` 的 path alignment。之前快照里，`origin/main` 将 temp/library paths 往 Creator 结构对齐，这个方向有价值，但必须与 adapter 的 internal record parity 重新核对。

最新分析仍需确认的问题：

- 当前 `origin/main` 是否已经包含 extension mount abstraction，或是否有更好的官方等价实现？
- 当前 `origin/main` 的 project/internal libraries 是否仍与 adapter 预期不同？

### `src/core/builder/manager/plugin.ts`

这是最高风险文件。

两个方向都需要保留：

- 保留 `origin/main` 的 builder schema 与 query APIs：`queryPlatformConfig`、`getPlatformBuildSchema`、build option checking、required fields、i18n/doc URL materialization。
- 保留 `adapter-to-386` 的 project extension builder registration、package default merging、project extension conflict checks 与 build hook registration。

不要整文件选择任一侧。正确结果应该让 platform schema/query APIs 同时看到 built-in platform options 与 project extension package options。

最新分析仍需确认的问题：

- `origin/main` 是否再次改变了 `BuildCheckResult` shape？
- adapter 的 project extension package defaults 是否能通过官方 `getPlatformBuildSchema` object output 表达？
- project extension configs 应该出现在 `packages[platform][extensionName]`，还是应由新版官方 API flatten？

### `src/core/builder/worker/builder/asset-handler/script/index.ts`

adapter 删除了 bundle script packaging 中 hard-fatal 的 static compile check。原因是 `.tsx` tilemap 等非脚本资源可能进入宽泛的 TypeScript include patterns，并被误当成 TypeScript source，从而触发失败。adapter 的方向是 report-only 或 preflight-scoped checking，而不是让宽泛 asset glob 阻断所有 script packaging。

最新分析仍需确认的问题：

- 当前 `origin/main` 是否已经收窄 static compile check inputs，足以避免 `.tsx` tilemap false positives？
- 是否有官方 error-code path 需要保留，同时仍避免 false positives？
- build 与 runtime-preview 是否应该使用不同的 static compile failure 策略？

### Configuration manager tests 与 ownership

adapter 修改了 configuration 语义：

- Editor-owned config 是 runtime input。
- CLI-owned config 是唯一持久化 overlay，写入 `cocos.config.json`。
- `cocos.config.json` 中残留的旧 Editor-owned values 不应覆盖当前 Editor-owned facts。

除非 `origin/main` 已采用等价 owner model，否则应保留该语义。

最新分析仍需确认的问题：

- 当前 `origin/main` 是否新增 configuration metadata 或 schema rules，需要加入 owner-map？
- 当前 `origin/main` 是否改变 migration behavior，并与 adapter 的 Editor-owned loader 重复或冲突？

### Dependency strategy

adapter 将 `@cocos/asset-db` 以 `file:./packages/asset-db` 方式 vendored，以控制 3.8.6 parity fixes。这是 dependency policy 决策，不是普通 lockfile conflict。

2026-06-22 已确认当前 `origin/main` 与 adapter 的 npm 相关差异：

- 根 `package.json` 版本从 `0.0.1-alpha.28` 更新到 `0.0.1-alpha.30`。
- `engines.pink` 从 `>=0.0.1.21` 更新到 `>=0.0.1.24`。
- `build` script 追加 `npm run generate:dts`，因此 rebase 后必须验证 `packages/cocos-cli-types` 的 DTS snapshot。
- `@cocos/asset-db` 在 merge-base 与当前 `origin/main` 都是 registry package `3.0.0-alpha.10`。
- `packages/asset-db` workspace 不是官方原本状态，而是 adapter 通过 `8bb68e7 chore: vendor asset-db local package mirror` 引入的本地 vendored package。
- adapter 又通过 `8a80e3b chore: add maintainable asset-db record managers` 修改了本地 `packages/asset-db`，用于维护 asset-db record manager 相关行为。
- `packages/cocos-cli-types` 版本从 `0.0.1-alpha.28.1` 更新到 `0.0.1-alpha.30.1`。
- `vitests/package.json` 与 `vitests/package-lock.json` 在 `origin/main` 删除。

因此，`@cocos/asset-db` 不是“官方从 workspace 升级到 npm package”。真实情况是 adapter 把官方 registry package 替换为本地 workspace mirror，并在本地 package 上继续打 adapter 修正。`adapter-to-386..origin/main` 看到的 `file:./packages/asset-db` 到 registry diff，是“从 adapter 当前状态回看官方 main”的差异，不代表官方历史曾采用 workspace。

本次 rebase 处理策略：

- 保留 `origin/main` 的根版本、`engines.pink` 与 `build` script 更新。
- 暂时保留 adapter 自己引入的 `@cocos/asset-db: file:./packages/asset-db` 和 `packages/asset-db` workspace，因为 adapter 需要本地 `asset-db` 源码/产物来承载 3.8.6 parity 与 internal record 相关修正；官方 registry package 与本地 package 版本号相同，不能仅凭版本号判断行为等价。
- 暂时保留 `vitests` 独立 package，因为 adapter 的 runtime-preview 诊断与 Vitest fixture 仍依赖该目录。
- rebase 验证时不能只跑 `npm ci --ignore-scripts` 或只复用旧 `node_modules`。必须确认 worktree 的 `packages/engine`、`packages/cc-module` 生成物与 adapter 环境一致；若官方 npm source 与 adapter local package 不一致，需要按 adapter 的本地 package 策略验证。

完整的重新分析计划已拆到独立文档：`docs/dev/build/plans/adapter-to-386-rebase-origin-main-deep-analysis-plan-20260622.md`。本文只保留 rebase 记录和已确认事实，避免把历史记录与下一轮分析计划混在一起。

## rebase 后验证目标

解决冲突后的最低验证：

- `npm run build`
- builder 相关 focused tests：platform registration、build schema、project extension hooks、`wechatgame`
- asset/config 相关 focused tests：internal records、source meta parity、config ownership
- runtime-preview Vitest suite，并提供所需 fixture env
- 如 fixture 可用，运行 `wechatgame` Editor baseline parity tests

完整 Jest 与完整 Vitest 可能仍包含环境敏感失败；应记录具体失败类别，不应把任何失败都自动归因于 rebase。

## 下一步分析动作

写完本文档后，fetch 当前 fork `origin/main`，并重复 read-only 分析：

1. 比较本地 `main` 与当前 `origin/main`。
2. 比较 `adapter-to-386` 与当前 `origin/main`。
3. 运行 read-only conflict prediction。
4. 如果新冲突覆盖旧快照，更新本文或增加 dated follow-up。

## 2026-06-22 最新 origin/main 分析

2026-06-22 fetch `origin/main` 后：

- `origin/main`: `c71c446`
- 远端 `upstream/main`: `c71c446`
- 本地 `upstream/main`: 显式 fetch upstream 前为 `6da6f6e`，相对远端已过期
- 本地 `main`: `b6ff0d8`
- `adapter-to-386`: `8a17b16`
- `adapter-to-386` 与 `origin/main` 的 merge-base: `71b2ad8`
- 分叉情况：`adapter-to-386` ahead 124，behind 33

`origin/main` 当时比本地 `main` ahead 35 commits。与旧的本地 `upstream/main`（`6da6f6e`）相比，最新 target 新增了 6 个 commit：

- `a9a81f0` 调整 builder/base console/new APIs。
- `950ad03` decode normalized glTF skin weights。
- `c166ecd` 修复 custom render pipeline preview 在缺少 effect settings 时失败的问题。
- `475076d` 暴露 create build template API。
- `064664c` 暴露 build stage progress callback。
- `c71c446` 拒绝 cyclic node reparenting。

这 6 个 commit 增加了 builder 与 asset 方向和 `adapter-to-386` 的重叠。

### 最新冲突预测

read-only `git merge-tree origin/main adapter-to-386` 预测以下文件存在 text conflicts：

- `src/api/builder/builder.ts`
- `src/api/builder/schema.ts`
- `src/core/assets/asset-config.ts`
- `src/core/builder/index.ts`
- `src/core/builder/manager/plugin.ts`
- `src/core/builder/worker/builder/asset-handler/script/index.ts`
- `src/core/configuration/test/manager.test.ts`

相比之前快照，新增冲突文件是：

- `src/api/builder/builder.ts`
- `src/api/builder/schema.ts`
- `src/core/builder/index.ts`

新增冲突来自较新的 `origin/main` builder API additions：create build template 与 build stage progress callback。它们与 adapter 的 build facade、project extension hooks、`wechatgame`、Editor facade 工作直接重叠。

### 更新后的合并方向

public APIs 与 schemas 以 `origin/main` 作为 base：

- 保留 `origin/main` 的 builder API surface，包括 create build template 与 build stage progress callback。
- 保留 `origin/main` 的 `getPlatformBuildSchema` object output 与 required field 行为。
- 保留 `origin/main` 的 `BuildCheckResult` shape：`valid`、`message`、`fixedValue`、`level`。

然后在其上重新应用 adapter capabilities：

- Project extension builder packages 必须纳入 schema/defaults/checking，而不是绕开官方 builder API。
- Extension hook error behavior 与 Editor facade behavior 必须仍对正常 build 可用。
- `wechatgame` 必须接入官方 build progress/template APIs，而不是 fork builder flow。

### 更新后的文件级指导

#### `src/api/builder/builder.ts` 与 `src/api/builder/schema.ts`

新增冲突类别。保留 `origin/main` public API additions，尤其是 create build template。仅在仍然需要且不冲突官方 schema naming 时，重新加入 adapter-facing build APIs。

待确认问题：

- adapter 的 build-config command 是否需要通过这些 schemas 暴露 project extension builder options？
- Extension builder hook diagnostics 应通过现有 builder API responses 暴露，还是需要新的 adapter-specific field？

#### `src/core/builder/index.ts`

新增冲突类别。保留官方 build stage progress callback behavior 与 template creation entrypoints。重新合入以下 adapter 行为：

- task execution 前注册 project extension hooks；
- 注入 Editor facade；
- 注册 `wechatgame` platform；
- 保留 packAutoAtlas 与 texture compression overlay behavior。

不要丢弃官方 progress callbacks；它们属于 public API surface。

#### `src/core/builder/manager/plugin.ts`

更新结论：adapter 必须迁移旧 check result semantics。不要继续把 `{ error, newValue }` 作为 canonical result shape。应将 adapter 的 project-extension/default logic 转换到 `origin/main` 的 `BuildCheckResult` shape 与 schema pipeline。

具体目标：

- `getPlatformBuildSchema` 应包含 built-in common options、platform options 与 project extension package options。
- Project extension package defaults 仍应 merge 到 `options.packages.<extensionName>`。
- 保留 `origin/main` 的 required/hidden/i18n/doc URL 行为。

#### `src/core/assets/asset-config.ts`

最新 `origin/main` 仍不包含 adapter 的 `resolveProjectExtensionAssetDbMounts()` abstraction。保留 adapter helper。除非新证据证明 `origin/main` path layout 已经解决同一个 Editor/library pollution 问题，否则保留 adapter 的 library isolation strategy。

rebase 后建议验证的 path policy：

- project assets library 在 CLI/runtime-preview parity 需要时仍保持隔离；
- extension libraries 仍位于 adapter-specific extension output root；
- internal record 行为仍通过 internal record/source meta parity tests。

#### `src/core/builder/worker/builder/asset-handler/script/index.ts`

保留 adapter 方向：宽泛 asset-glob static compile failure 不应 hard-block bundle script packaging。如果 `origin/main` 需要 error-code/reporting semantics，应将其移入显式 scoped preflight 或 report-only path。

需要用曾触发 TypeScript syntax errors 的 tiled `.tsx` case 重新验证。

#### `src/core/configuration/test/manager.test.ts`

保留 adapter owner model。更新 test expectations，使其与当前 `origin/main` schema path 与 metadata changes 共存。

具体规则：

- Editor-owned runtime config 不应持久化到 `cocos.config.json`。
- 只有 CLI-owned overlay 与 metadata 应持久化。
- 新官方 metadata/schema fields 需要 owner-map review。

### 更新后的验证重点

rebase 后优先验证：

- builder API/schema tests，包括 create build template 与 build stage progress callback；
- project extension builder hook tests；
- `wechatgame` baseline/parity tests；
- asset-db internal record 与 3D source meta parity tests；
- runtime-preview Vitest suite；
- 针对 `.tsx` static compile false-positive case 的 targeted test；
- `npm run build`，因为 `origin/main` 已包含 dts generation behavior 更新。

## 2026-06-22 本地 main 更新记录

根据当前仓库事实，执行 rebase 试验前已将本地 `main` 的 upstream 从 `upstream/main` 改为 `origin/main`，并在确认 `main...origin/main` 为 `0 35` 后，将本地 `main` 快进到 `origin/main`。

更新后：

- 本地 `main`: `c71c446`
- upstream: `origin/main`
- `main...origin/main`: `0 0`
