# adapter-to-386 rebase origin/main 深入分析报告

## 分析目标

本文用于重新分析 `adapter-to-386` rebase 到最新 `origin/main` 的官方更新、adapter 改动、自定义 npm 依赖、冲突处理和验证缺口。

重要更正：`packages/asset-db` workspace 是 adapter 自己引入的本地 vendored package，不是官方原本状态。分析中禁止用 `adapter-to-386..origin/main` 反推官方历史。

## 当前状态矩阵

| 名称 | 引用 | commit | 说明 |
| --- | --- | --- | --- |
| `BASE` | `git merge-base adapter-to-386 origin/main` | `71b2ad89883e2fb73383f599a1a80c17400328c6` | 共同祖先 |
| `OFFICIAL` | `origin/main` | `c71c446` | 当前官方 rebase 目标 |
| `ADAPTER` | `adapter-to-386` | `8a17b16` | 当前 adapter 分支 |
| `REBASED` | `codex/rebase-adapter-to-386-origin-main-20260622` | `8ca5ed4` | 已有 rebase 试验分支，只作审计对象 |

分叉计数：

- `adapter-to-386...origin/main`: adapter ahead `124`，behind `33`。
- `origin/main...codex/rebase-adapter-to-386-origin-main-20260622`: rebase 分支 ahead `126`，behind `0`。

工作区状态：

- 主工作区：`adapter-to-386...origin/adapter-to-386`，未跟踪文档包括本报告与计划文档。
- rebase worktree：`codex/rebase-adapter-to-386-origin-main-20260622`，当前 clean。

## 分析方法

本文按以下 diff 线分别分析：

- `BASE..OFFICIAL`：官方真实更新。
- `BASE..ADAPTER`：adapter 自己引入的改动。
- `OFFICIAL..REBASED`：rebase 结果相对官方保留了什么。
- `ADAPTER..REBASED`：rebase 结果相对 adapter 发生了什么变化。

## 子代理分工

本轮分析派出 4 个 read-only 子代理：

- 官方更新分析：只分析 `BASE..origin/main`。
- adapter 目标分析：只分析 `BASE..adapter-to-386`。
- 自定义 npm 依赖分析：聚焦 `@cocos/asset-db`，并扫描其他候选依赖。
- rebase 审计与验证矩阵：审计冲突、间接影响和验证缺口。

子代理不写文件；本文由主线程根据证据统一记录。

## 官方更新分析

### 摘要

子代理只分析了 `BASE..origin/main`。该区间共 `33` 个官方 commit，整体 diff 约为 `182 files changed, 13260 insertions(+), 2396 deletions(-)`。

官方更新主要集中在：

- scene undo/redo、reload lifecycle、node validation。
- builder public API、schema、check result、template、progress callback、log sink。
- asset path normalization、asset save validation、missing dependency diagnostics、glTF importer。
- configuration schema path 和 metadata。
- DTS/public API snapshot 与 CI。
- `repo.json` engine tag 从 `4.0.0-alpha.21` 到 `4.0.0-alpha.22`。

### 官方 commit 与 adapter 影响

| commit | 官方改动 | 对 adapter 的潜在影响 |
| --- | --- | --- |
| `590b7bb` | bump `0.0.1-alpha.29` | 版本号，无直接 runtime 行为 |
| `09486c0` | business errors 与 assets path | 影响 asset-db mount/path parity |
| `b0ecc3e` | create/save asset 描述与校验 | 影响 asset 操作兼容 |
| `8fe4aa9` | scene undo/redo | 影响 scene/editor facade |
| `1f77737` | add component path | 影响 scene public API |
| `424d47c` | update `cocos-cli-types` | public API 生成物变化 |
| `03df848` | `queryPlatformConfig` / `getPlatformBuildSchema` | 影响 adapter builder extension/schema |
| `3f17be1` | close editors without saving | 影响 scene editor lifecycle |
| `43c9daf` | required build options in schema | 影响 build option 校验 |
| `1bbcbc4` | temp/library path align | 高影响：`temp/asset-db`、`library` 路径策略变化 |
| `dc17418` | prefab null guards | 影响 prefab workflow |
| `1f44649` | custom layers | 影响 engine service 初始化和 3.8.6 对齐 |
| `a58b4a0` | MCP LLM 500 handling | 影响 API error contract |
| `acb3376` | scene tick metadata | 影响 configuration metadata |
| `80b5738` | UI prefab without Canvas | 间接影响 preview prefab |
| `056de90` | check-dts CI | 影响 DTS 验证策略 |
| `4280887` | query node interface rename | breaking public API |
| `c68e0d0` | editor reload lifecycle | 影响 editor facade |
| `9e4699c` | bump `0.0.1-alpha.30` 与 engine tag | 影响 3.8.6 engine baseline |
| `604fd16` | refresh `cocos-cli-types` snapshot | public API 生成物变化 |
| `7d44645` | missing dependency error asset name | 影响 asset missing reporter |
| `f260c6d` | revert scene-worker changes | 影响 scene-worker 判断 |
| `096b128` | schema return structure | 影响 builder schema shape |
| `5b59839` | doc URL | 低行为影响 |
| `f25e88f` | `pink >=0.0.1.24` | 环境约束变化 |
| `20f3279` | skip pr-test for dts-only | CI 行为 |
| `6da6f6e` | prefab edit root clear | 影响 prefab editor state |
| `a9a81f0` | new APIs/logging | 影响 builder check API、logDest、worker log sink |
| `950ad03` | glTF normalized skin weights | importer 行为修复 |
| `c166ecd` | custom render pipeline preview | 影响 preview/server effect settings |
| `475076d` | create build template API | 影响 project extension/template hooks |
| `064664c` | build stage progress callback | 影响 build progress integration |
| `c71c446` | reject cyclic node reparenting | 影响 scene manipulation |

### 分子系统结论

#### npm/package

- `package.json` / `package-lock.json` 的官方真实更新包括 root version `0.0.1-alpha.28 -> 0.0.1-alpha.30`、`pink >=0.0.1.21 -> >=0.0.1.24`、`build` script 追加 `npm run generate:dts`。
- `@cocos/asset-db` 官方仍是 `3.0.0-alpha.10`，没有官方升级，也没有官方 `packages/asset-db` workspace。
- `cc` 官方仍是 `file:./packages/cc-module`，`BASE..origin/main` 中 `packages/cc-module` 无 diff。
- `repo.json` engine tag `4.0.0-alpha.21 -> 4.0.0-alpha.22`，这与 adapter 的 3.8.6 对齐目标存在明确风险。

#### builder API

- 官方新增或调整 `queryPlatformConfig`、`getPlatformBuildSchema`、`refreshDisplayI18nFields`、`createBuildTemplate`、`checkBuildOption(s)`、`BuildStageProgressCallback`。
- `BuildCheckResult` shape 从旧的 `{ error, newValue, level }` 方向转为 `{ valid, level?, message?, fixedValue? }`，属于 breaking API。
- `executeBuildStageTask` 增加 progress callback；build/bundle/stage task 新增 log sink restore 与 `logDest` 传递。

#### asset / asset-db

- 官方没有修改 `packages/asset-db`，也没有改变 `@cocos/asset-db` package 版本。
- CLI asset 层新增 `pathToDbUrlIfAssetDBPath`、`dirnameForDbUrlOrPath`，允许 asset-db 内绝对路径/相对路径归一化到 `db://`。
- `asset-config.ts` 路径从 `temp/cli/asset-db` / `library/cli` 对齐到 `temp/asset-db` / `library`，这是行为变化，不是生成物变化。
- `saveAsset` 增加 script/scene/prefab 内容结构校验；`querySubAssetName` 增强缺失依赖名称解析。
- glTF normalized skin weights 解码修复有 importer 行为含义。

#### configuration

- schema 输出位置从 `temp/cli/cocos.config.schema.json` 改为 `temp/cocos.config.schema.json`。
- metadata 类型收敛到 `ICocosConfigurationPropertySchema`，scene 新增 `scene.tick` metadata/i18n。
- 这些变化会影响 adapter 的 configuration owner model 和 schema path 判断。

#### runtime-preview / Vitest

- `BASE..origin/main -- src/runtime-preview vitests` 无直接 diff。
- preview 仍受 scene/server 间接影响，例如新增 `/scripting/engine/effect-settings`，路径从 `temp/cli/programming` 改为 `temp/programming`。

#### generated / public API

- `packages/cocos-cli-types` snapshot 变化很大，约 `527 insertions / 1137 deletions`，不是单纯版本号。
- `packages/cocos-cli-types/package.json` 版本从 `0.0.1-alpha.28.1` 到 `0.0.1-alpha.30.1`。
- `src/lib/index.ts` 删除 `ICLI` / `IServiceManager` / `GlobalEventManager` type re-export，存在 public API 兼容影响。
- `check-dts.yml` 改为对 regenerated snapshot 与 base/working tree 同时检查，`build` 也会生成 DTS。

### 官方更新对 adapter 的重点风险

- adapter 的 3.8.6 engine / `cc-module` 目标需要显式处理官方 `repo.json` 4.0 alpha.22 baseline，不能默认跟随。
- adapter 的 local `@cocos/asset-db` vendor 不能解释成“官方删除”；官方根本没有 `packages/asset-db`。
- 官方路径对齐到 `temp/asset-db`、`library` 可能冲击 adapter 的 library isolation、internal record 和 source meta parity。
- builder schema/check/template/progress API 与 adapter 的 project extension hooks、`wechatgame` options、schema/check pipeline 直接重叠。
- `build` 自动生成 DTS 会扩大 rebase 后生成物验证范围。
- scene query/open API 参数 rename 是 breaking public API，adapter 若有旧调用需要兼容迁移。

## adapter 目标与改动分析

### 摘要

子代理只分析了 `BASE..adapter-to-386`。结论是：`adapter-to-386` 的真实目标不是单纯升级版本，而是把 CLI 适配到 Cocos Creator / engine `3.8.6` 的构建、AssetDB、runtime-preview、project extension builder hook、`wechatgame`、configuration ownership 和 isolated build runtime 语义。

重要更正：

- 在 `adapter-to-386` 原始分支中，`packages/asset-db` vendor 相关 commit 是 `7e3d243` 和 `0c9cab7`。
- `8bb68e7` 和 `8a80e3b` 是 rebase 分支里的对应重放 commit，不能用于说明 adapter 原始历史。

### 分目标发现

#### 3.8.6 engine / `cc-module` / generated package

相关 commit：

- `79565b6 fix: use build nodejs runtime for normal builds`
- `758ae45` / `5bdd5d0`：nodejs editor path 设计文档。
- `40af637`：texture compression tool overlay。
- `dedce87`：3D source meta。
- `ee24e9a`：CommonJS fallback。

相关文件：

- `packages/cc-module/src/preload.ts`
- `src/core/engine/index.ts`
- `src/core/launcher.ts`
- `src/core/launcher-engine-root.ts`
- `src/core/engine/editor-extends/**`
- `src/core/scripting/**`

测试/文档证据：

- `src/core/builder/test/builder-api-build.spec.ts`
- `src/core/builder/test/texture-compress-tool-resolver.spec.ts`
- `vitests/suites/runtime-preview/launcher-engine-root.test.ts`
- `docs/dev/build/plans/build-issue-021-root-cause-plan-20260617.md`

缺口：`BASE..ADAPTER` 未看到 adapter 对 `packages/cocos-cli-types` 的直接更新证据，rebase 后 DTS 生成需要单独验证。

#### `@cocos/asset-db` 本地 vendored package

结论：`packages/asset-db` 是 adapter 引入，不是官方 workspace。`origin/main` 仍依赖 registry `@cocos/asset-db: 3.0.0-alpha.10`，且没有 `packages/asset-db` tree；`adapter-to-386` 把依赖改为 `file:./packages/asset-db` 并加入 workspace。

相关 commit：

- `da420d2 test: cover current asset-db internal record behavior`
- `7e3d243 chore: vendor asset-db local package mirror`
- `0c9cab7 chore: add maintainable asset-db record managers`
- `0071c72 fix: align asset-db internal records with editor`
- `03d8ffc fix: use editor internal info record path`

相关文件：

- `package.json`
- `package-lock.json`
- `packages/asset-db/**`

测试/文档证据：

- `src/core/assets/test/asset-db-internal-record.test.ts`
- `docs/superpowers/plans/2026-06-13-asset-db-custom-source.md`

#### AssetDB mount / library isolation / internal record / source meta

相关 commit：

- `dbc9be2`：extension AssetDB mount 与 project extension discovery。
- `0071c72`：internal records。
- `03d8ffc`：internal info path。
- `dedce87`：3D source meta parity。
- `8271c7e`：runtime-preview internal library root 调整。

相关文件：

- `src/core/assets/asset-config.ts`
- `src/core/assets/extension-asset-db-mounts.ts`
- `src/core/assets/manager/asset-db.ts`
- `packages/asset-db/libs/{data,dependency,info,migrator}.js|ts`
- `src/core/assets/asset-handler/assets/gltf*.ts`

测试/文档证据：

- `src/core/assets/test/extension-asset-db-mounts.spec.ts`
- `src/core/assets/test/asset-db-internal-record.test.ts`
- `vitests/suites/build/3d-source-meta-editor-alignment.test.ts`
- `docs/dev/build/facts/meta-library-editor-parity-20260613.md`

结论：adapter 目标不是简单隔离全部 library，而是让 assets DB、extension mounts、internal DB record 写入分别对齐 Editor/CLI 边界。

#### builder project extension hooks / defaults / schema / check

相关 commit：

- `dbc9be2`：注册 project builder hooks。
- `6a90f40`：error hooks。
- `ab83cd7`：project hooks fatal。
- `ea73a30`：`packAutoAtlas`。
- `cc770ac`：physics default material。
- `40af637`：texture tool resolver。
- `79565b6`：builder API build runtime。

相关文件：

- `src/core/builder/manager/plugin.ts`
- `src/core/builder/worker/builder/manager/hook-runner.ts`
- `src/core/builder/share/common-options-validator.ts`
- `src/core/builder/share/engine-feature-assets.ts`
- `src/api/builder/schema.ts`

测试/文档证据：

- `src/core/builder/test/project-extension-builder-hooks.spec.ts`
- `src/core/builder/test/run-error-hook.spec.ts`
- `src/core/builder/test/run-plugin-task-error.spec.ts`
- `src/core/builder/test/pack-auto-atlas-option.spec.ts`
- `src/core/builder/test/physics-default-material.spec.ts`
- `src/core/builder/test/texture-compress-tool-resolver.spec.ts`
- `docs/dev/build-extension-hooks-20260612.md`

#### `wechatgame`

相关 commit：

- `12ee11a feat(builder): add wechatgame platform support`
- `79565b6`：调整 build runtime 下的 `wechatgame` config。

相关文件：

- `src/core/builder/platforms/wechatgame/**`
- `src/api/builder/schema.ts`
- `src/core/builder/share/platforms-options.ts`

测试/文档证据：

- `src/core/builder/test/wechatgame-platform.spec.ts`
- `vitests/suites/build/wechatgame-editor-baseline-parity.test.ts`
- `vitests/shared/wechatgame-baseline-parity.ts`
- `docs/dev/build/facts/wechatgame-source-inventory-20260615.md`

缺口：`separateEngine`、open data context、run stage 等高级能力仍有待验证或实现。

#### isolated Node build runtime / Editor facade / error hook

相关 commit：

- `79565b6`：normal build 使用 `build-nodejs`。
- `60cdb69`：Editor facade。
- `ec2d9e6`：hook runner 接入 facade。
- `6b467dc`：lazy load asset APIs。
- `eba56ba`：`save-asset-meta`。
- `ca9cc4c`：internal timer 策略。
- `2e743de`：fact-based AssetDB messages。
- `6a90f40` / `ab83cd7`：error hook / fatal。

相关文件：

- `src/core/extensions/editor-facade.ts`
- `src/core/builder/worker/builder/manager/hook-runner.ts`
- `src/core/builder/worker/builder/index.ts`
- `src/api/builder/builder.ts`
- `packages/cc-module/src/preload.ts`

测试/文档证据：

- `src/core/extensions/test/editor-facade.spec.ts`
- `src/core/builder/test/run-error-hook.spec.ts`
- `src/core/builder/test/build-error-hook-invocation.spec.ts`
- `src/core/builder/test/project-extension-builder-hooks.spec.ts`
- `docs/superpowers/plans/2026-06-16-project-extension-editor-facade-and-strict-hooks.md`

#### configuration owner model

相关 commit：

- `bb9a207`：owner map。
- `b3075ef`：migration stale cache。
- `1c27c0f`：owner map hardening。
- `ca52bf1`：runtime/persisted config 分离。
- `af0baef`：refresh registered instances。
- `230ac59`：schema overlay assertions。

相关文件：

- `src/core/configuration/script/owner-map.ts`
- `src/core/configuration/script/manager.ts`
- `src/core/configuration/script/config.ts`
- `src/core/configuration/migration/**`
- `src/api/configuration/configuration.ts`

测试/文档证据：

- `src/core/configuration/test/owner-map.test.ts`
- `src/core/configuration/test/manager-editor-files.test.ts`
- `src/core/configuration/test/config-owner-guard.test.ts`
- `src/core/configuration/test/cocos-migration-loader.test.ts`
- `src/core/configuration/test/manager.test.ts`
- `docs/superpowers/plans/2026-06-13-cocos-config-editor-owned-runtime-merge.md`

结论：`cocos.config.json` 被收敛为 CLI-owned overlay；Editor-owned `builder` / `engine` / `script` / `scene` 等配置从 Editor files/profile 读取，只在 runtime merge。

#### runtime-preview / Vitest fixture

相关 commit：

- 从 `9893999` 起的一系列 runtime-preview baseline、routes、settings、browser entry、startup、fixture migration。
- 代表性 commit 包括 `e925a34`、`4e4ac9a`、`b15b7e9`、`c527678`、`8271c7e`、`56fdc58`。

相关文件：

- `src/runtime-preview/**`
- `static/runtime-preview/**`
- `vitests/**`
- `workflow/build-runtime-preview-app.js`

测试/文档证据：

- `vitests/suites/runtime-preview/**`
- `vitests/shared/**`
- `docs/dev/runtime-preview/acceptance/matrix.md`
- `docs/dev/runtime-preview/facts/**`

缺口：acceptance matrix 标注多项 `partial`，尤其主测试项目真实 child process/browser 集成、pack/redirect/extension runtime trigger、CLI/editor output consistency 尚未全闭环。

### adapter 侧明确验证缺口

- `packages/cocos-cli-types` / DTS generated package：`BASE..ADAPTER` 未见直接文件改动；不能证明 adapter 已覆盖 generated API package。
- `@cocos/asset-db` vendor 维护流程：本地包只有 `build` script，未见稳定 re-vendor/sync/patch 脚本；需要官方 npm baseline 与本地 package 逻辑 diff。
- `wechatgame` 高级能力：`separateEngine`、run stage、open data context 等仍是未完成或待验证。
- `Editor` facade 只覆盖已识别的 AssetDB message；其他 Editor API 设计为 fail-fast，不能视为完整 Editor runtime。
- runtime-preview 验收未全绿；文档明确部分项仍为 `partial`。
- 本阶段是 read-only 分析，未运行 Jest/Vitest 复验。

## 自定义 npm 依赖分析

### 已确认的 package 声明事实

主线程已直接读取 `BASE`、`OFFICIAL`、`ADAPTER`、`REBASED` 的 `package.json`：

| 引用 | version | `@cocos/asset-db` | `cc` | `build` script | `engines.pink` |
| --- | --- | --- | --- | --- | --- |
| `BASE` | `0.0.1-alpha.28` | `3.0.0-alpha.10` | `file:./packages/cc-module` | 无 `generate:dts` | `>=0.0.1.21` |
| `OFFICIAL` | `0.0.1-alpha.30` | `3.0.0-alpha.10` | `file:./packages/cc-module` | 追加 `npm run generate:dts` | `>=0.0.1.24` |
| `ADAPTER` | `0.0.1-alpha.28` | `file:./packages/asset-db` | `file:./packages/cc-module` | 无 `generate:dts` | `>=0.0.1.21` |
| `REBASED` | `0.0.1-alpha.30` | `file:./packages/asset-db` | `file:./packages/cc-module` | 追加 `npm run generate:dts` | `>=0.0.1.24` |

结论：

- 官方 `BASE..OFFICIAL` 没有把 `@cocos/asset-db` 从 workspace 改成 registry；官方两端都是 registry package `3.0.0-alpha.10`。
- `@cocos/asset-db: file:./packages/asset-db` 是 adapter 自己引入，并在 `REBASED` 中被保留。
- `REBASED` 同时吸收了官方版本号、`engines.pink` 与 `build` script 的更新。

lockfile 证据：

| 引用 | root dependency | `node_modules/@cocos/asset-db` | `packages/asset-db` |
| --- | --- | --- | --- |
| `BASE` | `3.0.0-alpha.10` | version `3.0.0-alpha.10`, resolved `https://registry.npmjs.org/@cocos/asset-db/-/asset-db-3.0.0-alpha.10.tgz` | 不存在 |
| `OFFICIAL` | `3.0.0-alpha.10` | version `3.0.0-alpha.10`, resolved `https://registry.npmjs.org/@cocos/asset-db/-/asset-db-3.0.0-alpha.10.tgz` | 不存在 |
| `ADAPTER` | `file:./packages/asset-db` | `link: true`, resolved `packages/asset-db` | version `3.0.0-alpha.10` |
| `REBASED` | `file:./packages/asset-db` | `link: true`, resolved `packages/asset-db` | version `3.0.0-alpha.10` |

### rebase worktree 实际解析

在 `E:\own_space\engines\cocos-cli\.worktrees\rebase-adapter-to-386-origin-main-20260622` 执行 `require.resolve` 的结果：

- `@cocos/asset-db/package.json` 解析到 `packages\asset-db\package.json`。
- `cc/package.json` 解析到 `packages\cc-module\package.json`。

这证明当前 rebase worktree 的验证环境实际使用 adapter 本地 workspace package，不是官方 registry `@cocos/asset-db`。

### 后续依赖分析范围

- `cc` / `packages/cc-module` 需要下一轮同等级分析，因为 adapter 修改了 `preload.ts` 和 runtime mode 行为。
- `packages/cocos-cli-types` 需要下一轮同等级分析，因为官方和 `REBASED` 都涉及 DTS snapshot 差异。
- `@cocos/ccbuild`、`@cocos/lib-programming`、`@cocos/module-system` 本轮不判为 adapter 自定义依赖；但它们仍是 build/runtime 调用链的重要事实源，后续分析具体 build 行为时应按官方 package API/产物核对。

### 本地 package 维护流程初步线索

已有文档包含本地 `asset-db` vendor 流程线索，但自动化维护流程未落地：

- `docs/superpowers/plans/2026-06-13-asset-db-custom-source.md` 明确写过从 `node_modules/@cocos/asset-db/*` 复制到 `packages/asset-db` 的步骤，并要求 root `files` 白名单包含 `packages/asset-db`。
- 同一计划中曾设计 `packages/asset-db/scripts/extract-official-package.js` 和 `docs/dev/build/facts/asset-db-upgrade-path.md`，命令示例为 `node packages/asset-db/scripts/extract-official-package.js 3.0.0-alpha.10`。
- 当前仓库和 `adapter-to-386` 历史中均未发现 `packages/asset-db/scripts/extract-official-package.js` 或 `docs/dev/build/facts/asset-db-upgrade-path.md`。因此应记录为“计划中设计过，但未落地自动 re-vendor 流程”。

已有事实文档说明本地 `asset-db` 的动机：

- `docs/dev/build/facts/meta-library-editor-parity-20260613.md` 记录冲突集中在 `@cocos/asset-db` record manager 写入 schema / migration 策略。
- 同一文档记录“本轮已在 CLI 侧实现 local `@cocos/asset-db` internal record compatibility”，并列出验证命令：`npm --prefix packages/asset-db run build` 和 `npx jest src/core/assets/test/asset-db-internal-record.test.ts src/core/assets/test/config-sync.test.ts --runInBand`。
- `docs/dev/modules/asset-db.md` 记录当前 `@cocos/asset-db` 由 local package `packages/asset-db` 接管，并要求修改 local package 前先用行为测试锁定 registry package 或当前 local mirror 行为。

### 自定义依赖识别结果

| 依赖 | 是否自定义 | 结论 |
| --- | --- | --- |
| `@cocos/asset-db` | 是 | 官方 `BASE` / `origin/main` 都是 registry `3.0.0-alpha.10`；adapter / `REBASED` 改为 `file:./packages/asset-db`。 |
| `cc` / `packages/cc-module` | 需要后续深入分析 | 官方和 adapter 都是 `cc=file:./packages/cc-module`，但 adapter 修改了 `packages/cc-module/src/preload.ts`，新增 `EngineRuntimeMode`，并用 `runtimeMode/editor` 控制 `globalThis.CC_EDITOR`。 |
| `packages/cocos-cli-types` | 需要后续深入分析 | 官方更新 package version `0.0.1-alpha.28.1 -> 0.0.1-alpha.30.1` 和 DTS snapshot；`REBASED` 相对官方 snapshot 仍有 `67 insertions / 10 deletions`。 |
| `@cocos/ccbuild`、`@cocos/lib-programming`、`@cocos/module-system` | 本轮不判为 adapter 自定义依赖 | 三者在 `origin/main`、`adapter-to-386`、`REBASED` 的 spec、lock version、resolved、integrity 一致；但仍是 build/runtime 调用链的重要事实源。 |

### `@cocos/asset-db` 官方 npm baseline

`origin/main` 的官方 baseline：

- `package.json` spec：`@cocos/asset-db = 3.0.0-alpha.10`
- `package-lock.json`：
  - version: `3.0.0-alpha.10`
  - resolved: `https://registry.npmjs.org/@cocos/asset-db/-/asset-db-3.0.0-alpha.10.tgz`
  - integrity: `sha512-pEgYyRwm7548Zf8B+T/7mnCLIcoDqvPGZtwW3GnIKYcbLuYz+qXDpUIisx4ACAGg19G4XZwHF1U1/PHdfOjaTg==`
- `npm pack @cocos/asset-db@3.0.0-alpha.10` 返回同一 integrity。
- 解包位置：`C:\Users\Nobody\AppData\Local\Temp\cocos-cli-asset-db-baseline-20260622`。
- 官方 package 文件数：35，包含 `index.js`、`index.d.ts`、`libs/**/*.js`、`libs/**/*.d.ts`、`package.json`。
- 官方 metadata：`main=index.js`；无 `types`、无 `exports`、无 `bin`；dependencies 为 `fast-glob`、`fs-extra`、`node-uuid`、`workflow-extra`；有 test/build/release/publish scripts 和 devDependencies。

### 官方 package vs adapter local package 差异

metadata 差异：

- local package 增加 `private: true`。
- local scripts 变为 `build: tsc -p tsconfig.json`。
- local package 移除官方 release/publish/devDependencies。

文件差异：

- local 新增 `.npmignore`、`tsconfig.json`、`src/libs/{console,data,dependency,info,migrator}.ts` 等可维护源码。
- 当前工作区还存在 `packages/asset-db/node_modules/*`；官方 tarball 无这些文件，local `.npmignore` 排除了 `node_modules/`。
- `index.js`、`index.d.ts`、`libs/utils.*` 与官方一致。
- `libs/asset-db.js`、`console.*`、`data.*`、`dependency.*`、`info.*`、`migrator.*` 与官方不一致。

关键行为差异：

- `AssetDB.prepareStart()`：local 对 `internal` 使用 `.internal-info1.0.0.json`；官方使用 `.${name}-info.json`，即 `.internal-info.json`。
- `InfoManager`：local 增加 `editorCompatibility`，对 `.internal-info1.0.0.json` 保持 Editor `version/map/missing` 形状和绝对路径；非 internal 仍走当前相对路径 schema。
- `DependencyManager`：local 增加 `editorCompatibility`，对 `.internal-dependency.json` 保持 Editor 顶层 `path/uuid` 形状；非 internal 输出 `version/data.path/data.uuid`。
- `DataManager`：local 对 `.internal-data.json` 已存在记录执行 preserve，避免 `empty/update/setValue` 覆盖 Editor baseline；非 internal 行为保持可变。
- `DependencyManager` 增加 `restoreAssociatedMap()`，读取 cache 后重建 associated map。

维护风险：

- `src/libs` 与 `libs` 基本对应。
- 但 `asset-db.js` 的 `prepareStart()` patch 没有对应 `src/libs/asset-db.ts`，仍是直接改 generated/runtime JS 的维护风险。

### `@cocos/asset-db` 决策

当前 `origin/main` 没升级 `@cocos/asset-db`，且官方 `3.0.0-alpha.10` 不包含 adapter 的 internal record parity patch。

决策建议：

- 本次 rebase 应继续保留 local `packages/asset-db`。
- 不建议回 registry；回 registry 会丢失 `.internal-info1.0.0.json`、`.internal-dependency.json`、`.internal-data.json` 的 Editor parity 行为，直接回归 `BUILD-ISSUE-007` 风险。
- 本次不需要 re-vendor 官方新包，因为官方 baseline version/resolved/integrity 未变。
- 如果未来官方版本变化，必须先 re-vendor 新 tarball，再重新应用 adapter patch，不能沿用旧 vendored package。

仍需验证：

- 运行 `src/core/assets/test/asset-db-internal-record.test.ts`。
- build 后做真实 `library/.internal-*` baseline 对比。
- 核对 Editor 在相同 engine source mtime 下是否也会写 `.internal-info1.0.0.json` 的 `time` 差异。
- 为 `packages/asset-db` 落地可执行 re-vendor/upgrade 脚本，避免未来官方升级时手工覆盖。

## rebase 冲突与间接影响审计

### 直接冲突

`git merge-tree --write-tree --name-only --messages origin/main adapter-to-386` 报告 7 个 content conflict。

| 文件 | 官方意图 | adapter 意图 | `REBASED` 结果 | 风险 | 需要验证 |
| --- | --- | --- | --- | --- | --- |
| `src/api/builder/builder.ts` | 增加 `builder-create-build-template` API，调用 core `createBuildTemplate` | `BuilderApi` 支持 `getProjectPath`，通过 isolated Node process 执行 build | isolated build 和 create template API 都保留 | 子进程 build 返回码、MCP schema、template API 组合后未证明 | `builder-api-build.spec.ts`、`lib-create-build-template.spec.ts`、DTS/schema 生成 |
| `src/api/builder/schema.ts` | 增加 `SchemaBuildTemplateName`、`SchemaCreateBuildTemplateResult`、`logDest`，并从 query result omit `logDest` | 增加 `wechatgame` platform schema | 两者都保留 | `logDest` 是 runtime option，不应污染 persisted/query config；`wechatgame` union 与 template schema 可能互相影响 | schema snapshot、`wechatgame-platform.spec.ts`、query platform schema tests |
| `src/core/assets/asset-config.ts` | 对齐 Creator：`temp/asset-db`、project `library` | 保留 project extension asset-db mount resolver，并让 internal/library 行为适配 3.8.6 | 采用官方 temp/library 路径，同时保留 extension resolver | project/internal/extension library root 共享或隔离策略可能影响 record/source meta | `asset-db-internal-record.test.ts`、`extension-asset-db-mounts.spec.ts`、runtime-preview source meta Vitest |
| `src/core/builder/index.ts` | log sink、`logDest`、stage progress callback、query schema/template/check API | `init(platform, projectRoot)` 注册 project extension build hooks，失败时跑 `runErrorHook` | 两者都保留 | log sink restore、error hook 时序、project extension 注册只在指定 platform 路径发生 | `execute-build-stage-task.spec.ts`、`run-error-hook.spec.ts`、`project-extension-builder-hooks.spec.ts` |
| `src/core/builder/manager/plugin.ts` | 平台配置 schema、i18n display materialize、`queryPlatformConfig`、`getPlatformBuildSchema`、`createBuildTemplate` | project extension builder discovery/register，fatal diagnostics | 两者都保留 | 官方 schema/materialize 与 adapter extension config 合并可能互相覆盖；template copy 需真实路径验证 | `query-platform-build-schema.spec.ts`、`project-extension-builder-hooks.spec.ts` |
| `src/core/builder/worker/builder/asset-handler/script/index.ts` | 官方新增 script build 内 static compile check | adapter 保留 build profile/commonjs fallback 路径，避免重复或错误 static check | `REBASED` 删除官方 `runStaticCompileCheck`，保留 worker `logDest` forwarding | 明确未跟随官方；静态编译错误是否由其他链路覆盖未证明 | static compile error fixture、commonjs fallback、build script tests |
| `src/core/configuration/test/manager.test.ts` | 围绕 temp/library 结构更新测试 | Editor-owned config + CLI overlay owner model | 以 adapter owner model 为主，补充 reload/migrate runtime assertions | 测试偏 mock，不能证明真实 `cocos.config.json` 与 Editor-owned files 合流 | `manager.test.ts`、`owner-map.test.ts`、真实 fixture migration 验证 |

### 间接影响

- npm/package 来源：`origin/main` 使用 registry `@cocos/asset-db: 3.0.0-alpha.10`；`REBASED` 使用 `file:./packages/asset-db`，lockfile 中 `node_modules/@cocos/asset-db` 为 link。`cc` 仍是 `file:./packages/cc-module`。
- 实际解析：rebase worktree 中 `@cocos/asset-db/package.json` 指向 `packages\asset-db\package.json`，`cc/package.json` 指向 `packages\cc-module\package.json`。
- `packages/engine`：rebase worktree 中是 junction，目标为 `D:\workspace\engines\cocos\3.8.6`。
- `node_modules`：`node_modules/cc` junction 到 `packages/cc-module`；`node_modules/@cocos/asset-db` junction 到 `packages/asset-db`。
- generated files：`origin/main..REBASED` 涉及 `packages/cocos-cli-types/__tests__/__snapshots__/dts-snapshot.test.ts.snap`、`static/runtime-preview/**`、`workflow/build-runtime-preview-app.js`；`ADAPTER..REBASED` 还改变 `packages/cocos-cli-types` 测试/包、`static/i18n/*/configuration.json`、`workflow/generate-schema.js`。
- runtime-preview：`vitests/package.json` 存在并定义独立 Vitest package；`src/runtime-preview/package.json` 和 `src/runtime-preview/preview-app/package.json` 不存在，preview app 依赖 root script `build:runtime-preview-app`。
- build/test scripts：`build` 已追加 `npm run generate:dts`；`compile` 不跑 `generate:dts`；`build:runtime-preview-app` 不在 `build` / `compile` 链上，需要单独验证。

### `REBASED` 实际处理风险

`REBASED` 多数文件不是简单取一边，而是 adapter 行为叠加官方新增 API/schema/log 功能。

风险优先级：

1. `src/core/builder/worker/builder/asset-handler/script/index.ts` 明确丢弃官方 static compile check。必须证明静态编译错误仍由其他链路覆盖，或记录为 deliberate divergence。
2. 本地 vendored `@cocos/asset-db` 覆盖官方 registry package。必须用 package logic 测试证明 internal record/source meta/library path 行为，不能用 `npm run compile` 或 `npm run build` 通过替代。
3. `asset-config.ts` 同时采用官方 `temp/asset-db` / `library` 路径和 adapter extension resolver，project/internal/extension library 边界需要测试证明。
4. `configuration` 测试偏 mock，真实 Editor files/profile 与 `cocos.config.json` 合流仍需 fixture 验证。

## 验证矩阵

| 命令 | 工作目录 | 前置环境 | 覆盖风险 | 未覆盖风险 | 预期判定 |
| --- | --- | --- | --- | --- | --- |
| `rtk node -e "for (const id of ['@cocos/asset-db/package.json','cc/package.json']) console.log(id, require.resolve(id))"` | rebase worktree | `npm install` 已完成 | package 实际解析 | 不验证逻辑 | 指向 `packages/asset-db`、`packages/cc-module` |
| `rtk pwsh -NoProfile -Command "Get-Item packages/engine,node_modules/cc,node_modules/@cocos/asset-db"` | rebase worktree | junction 存在 | engine/package link | 不验证 engine 内容版本 | engine 指向 3.8.6，两个 node_modules 指向本地包 |
| `rtk npm --prefix packages/asset-db run build` | rebase worktree | 依赖已安装 | vendored asset-db TS/runtime 一致性 | 不覆盖 CLI 调用行为 | exit 0 |
| `rtk npx jest src/core/assets/test/asset-db-internal-record.test.ts src/core/assets/test/extension-asset-db-mounts.spec.ts` | rebase worktree | `COCOS_CLI_TEST_ENGINE_ROOT=D:\workspace\engines\cocos\3.8.6` | internal record、source meta、extension mount | 不覆盖真实 Editor baseline | exit 0 |
| `rtk npx jest src/core/builder/test/query-platform-build-schema.spec.ts src/core/builder/test/lib-create-build-template.spec.ts src/core/builder/test/execute-build-stage-task.spec.ts` | rebase worktree | root deps | 官方 builder schema/template/progress | 不覆盖真实 build output | exit 0 |
| `rtk npx jest src/core/builder/test/project-extension-builder-hooks.spec.ts src/core/builder/test/run-error-hook.spec.ts src/core/builder/test/wechatgame-platform.spec.ts src/core/builder/test/builder-api-build.spec.ts` | rebase worktree | root deps | adapter extension hooks、wechatgame、isolated build | 不覆盖完整 Creator build | exit 0 |
| `rtk npx jest src/core/configuration/test/manager.test.ts src/core/configuration/test/owner-map.test.ts src/core/configuration/test/manager-editor-files.test.ts` | rebase worktree | root deps | configuration owner model | mock 多，真实迁移有限 | exit 0 |
| `rtk npm run compile` | rebase worktree | root deps、engine junction | TS、schema、static web 基础生成 | 不跑 DTS snapshot，不跑 package behavior | exit 0，随后 generated diff 可解释 |
| `rtk npm run build` | rebase worktree | 同上 | compile + `generate:dts` | 不覆盖 runtime-preview app 单独 build | exit 0，DTS snapshot 与已提交一致 |
| `rtk npm run build:runtime-preview-app` | rebase worktree | root deps | preview-app TS 和 static bundle 同步 | 不跑浏览器行为 | exit 0，`static/runtime-preview/preview-app/*` 无非预期 diff |
| `rtk npm --prefix vitests test -- suites/runtime-preview/source-meta-editor-parity.test.ts suites/runtime-preview/cli-generated-output-integration.test.ts suites/runtime-preview/browser-runtime-smoke.test.ts` | `vitests` 或 root with `--prefix` | 3.8.6 engine、fixture 可用、浏览器依赖可用 | runtime-preview、source meta、真实 CLI output | 成本高，环境敏感 | exit 0 或记录 fixture/env 缺口 |
| `rtk git diff --exit-code -- packages/cocos-cli-types static/runtime-preview static/i18n workflow/generate-schema.js` | rebase worktree | build 后 | generated files 是否同步 | 不证明逻辑正确 | 无 diff；有 diff 则需提交或解释 |

### 已验证事实与仍需验证

已验证：

- `merge-tree` 报告 7 个直接 content conflict。
- rebase worktree `git status --short --branch` clean；主工作区有未跟踪 docs/report。
- package 实际解析和 junction 指向已确认。
- `REBASED` 相对 `origin/main` 保留本地 `packages/asset-db`、runtime-preview、`wechatgame`、extension hooks、`cc-module` preload 等改动。
- `REBASED` 相对 `ADAPTER` 纳入官方 version/pink、`generate:dts`、builder template/schema/logDest/query platform schema 等改动。

仍需验证：

- 官方 static compile check 被删除后，静态编译错误是否仍被 build command 覆盖。
- vendored `@cocos/asset-db` 与官方 `3.0.0-alpha.10` 的差异是否全部必要且被测试覆盖。
- `packages/cc-module` 的 `runtimeMode` / `CC_EDITOR` 对 normal build 与 runtime-preview 的影响。
- generated files 在 `npm run build`、`build:runtime-preview-app` 后是否无漂移。
- Vitest runtime-preview suite 在当前 3.8.6 engine fixture 下是否通过。

## 当前结论与风险

### 当前结论

1. 官方 `BASE..OFFICIAL` 没有升级 `@cocos/asset-db`，也没有引入 `packages/asset-db` workspace。`packages/asset-db` 是 adapter 自己 vendored 的 local package。

2. `REBASED` 对 npm/package 的处理方向是：吸收官方 root version、`engines.pink`、`build -> generate:dts` 更新，同时保留 adapter 的 local `@cocos/asset-db`。就当前官方版本未变这一事实看，该方向合理，但必须补行为验证。

3. `@cocos/asset-db` local package 不是简单 mirror，包含 internal record parity patch：
   - `.internal-info1.0.0.json`
   - `.internal-dependency.json`
   - `.internal-data.json`
   - Editor compatibility shape
   - associated map restore

4. 当前不建议回退到 registry `@cocos/asset-db@3.0.0-alpha.10`，否则会回归 `BUILD-ISSUE-007` 风险。

5. 官方 builder API 变化较大，`REBASED` 大体采用“官方 API + adapter extension/wechatgame/isolated runtime”的合并方向，但仍需测试证明 schema/check/template/progress/log sink 没有互相破坏。

6. `script/index.ts` 删除官方 static compile check 是当前最明确的 deliberate divergence。它不能只用历史经验解释，必须用 static compile error / CommonJS fallback / build script fixture 验证替代覆盖。

7. `cc` / `packages/cc-module` 和 `packages/cocos-cli-types` 已被识别为需要下一轮同等级深入分析的对象：
   - `cc-module` 涉及 `EngineRuntimeMode`、`CC_EDITOR`、normal build 与 runtime-preview 行为。
   - `cocos-cli-types` 涉及官方 DTS snapshot 更新和 `REBASED` 额外 snapshot 差异。

### 主要风险

| 风险 | 等级 | 原因 | 下一步 |
| --- | --- | --- | --- |
| local `@cocos/asset-db` 行为未重新跑 focused test | 高 | local package 覆盖官方 registry package，且包含关键 runtime patch | 跑 `packages/asset-db` build、internal record tests、真实 library baseline 对比 |
| static compile check 被删除 | 高 | `REBASED` 明确未跟随官方新增逻辑 | 增加或运行 static compile error fixture、CommonJS fallback、build script tests |
| `asset-db.js` patch 无 TS source | 中高 | `prepareStart()` patch 仍在 runtime JS，没有 `src/libs/asset-db.ts` | 落地 source 或记录为维护风险 |
| re-vendor/upgrade 脚本未落地 | 中高 | 计划中设计过，但仓库无 `extract-official-package.js` | 新增可执行 re-vendor 流程，或明确手工流程和校验 |
| builder schema/check/template/progress 合并未充分验证 | 中 | 官方 API 与 adapter extension/wechatgame 交叉 | 跑 builder focused Jest 和 DTS/schema |
| runtime-preview 未全闭环 | 中 | `vitests` 保留，但 acceptance matrix 有 `partial` | 按 fixture 条件跑 Vitest 或记录环境缺口 |
| `cc-module` / `cocos-cli-types` 尚未同等级分析 | 中 | 已识别为关键候选，但本轮只深入 `asset-db` | 开下一轮专门分析 |

## 证据命令

已执行：

```powershell
rtk git merge-base adapter-to-386 origin/main
rtk git for-each-ref --format="%(refname:short) %(upstream:short) %(objectname:short)" refs/heads/main refs/remotes/origin/main refs/heads/adapter-to-386 refs/heads/codex/rebase-adapter-to-386-origin-main-20260622
rtk git rev-list --left-right --count adapter-to-386...origin/main
rtk git rev-list --left-right --count origin/main...codex/rebase-adapter-to-386-origin-main-20260622
rtk git status --short --branch --untracked-files=all
rtk git status --short --branch --untracked-files=all
rtk node -e "const cp=require('child_process'); const refs=[...]; ..."
rtk node -e "const fs=require('fs'); for (const p of ['@cocos/asset-db/package.json','cc/package.json']) ..."
rtk git diff --unified=20 71b2ad89883e2fb73383f599a1a80c17400328c6..origin/main -- repo.json package.json
rtk rg -n "local `?@cocos/asset-db|packages/asset-db|internal record|record manager|re-vendor|vendor|sync" docs/dev/build/facts/meta-library-editor-parity-20260613.md docs/superpowers/plans/2026-06-13-asset-db-custom-source.md docs/dev/modules/asset-db.md
rtk pwsh -NoProfile -Command "Test-Path packages/asset-db/scripts/extract-official-package.js; Test-Path docs/dev/build/facts/asset-db-upgrade-path.md"
```

子代理证据命令摘要：

- 官方更新分析：`git log --oneline --reverse BASE..origin/main`、`git diff --stat BASE..origin/main`、`git diff --name-status BASE..origin/main`、重点文件 diff。
- adapter 目标分析：`git log --oneline --reverse BASE..adapter-to-386`、`git diff --stat BASE..adapter-to-386`、主题 commit `git show`。
- npm 依赖分析：`npm pack @cocos/asset-db@3.0.0-alpha.10`、官方 tarball 与 `packages/asset-db` 文件/hash/API diff、文档/历史搜索。
- rebase 审计：`git merge-tree --write-tree --name-only --messages origin/main adapter-to-386`、`origin/main..REBASED` 与 `ADAPTER..REBASED` diff、rebase worktree package resolve/junction 检查。
