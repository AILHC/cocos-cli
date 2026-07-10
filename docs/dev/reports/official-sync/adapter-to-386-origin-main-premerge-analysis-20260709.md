# adapter-to-386 官方同步合并前分析

## 状态

- 初始分析日期：2026-07-09
- 最新刷新日期：2026-07-10
- `adapter`：`adapter-to-386`
- `target`：`origin/main`
- `BASE`：`c71c446428da66b77ae8e8c6714c9cc35ac094d2`
- `TARGET`：`610c6b3d5f8608680a7374970bad99262ff25e02`
- `ADAPTER`：`8f52bece43b2512590d28870d7c3f05031299235`
- remote 拓扑：
  - `origin`：`https://github.com/AILHC/cocos-cli.git`
  - `upstream`：`https://github.com/cocos/cocos-cli.git`
- fork main 同步结果：
  - 2026-07-09 首次同步：`origin/main` 从 `c71c446428da66b77ae8e8c6714c9cc35ac094d2` fast-forward 到 `6d4bf9fa4f86f294be8fb3c6ba979a4605571f1e`。
  - 2026-07-10 冻结检查发现官方继续前进到 `610c6b3d5f8608680a7374970bad99262ff25e02`，原报告的 `TARGET` 已过期。
  - 更新 refs 后 `git rev-list --left-right --count origin/main...upstream/main` 为 `0 3`。
  - 已再次执行 fast-forward push：`origin/main == upstream/main == 610c6b3d5f8608680a7374970bad99262ff25e02`。
  - 同步后 `origin/main...upstream/main` 为 `0 0`。
- 当前工作区状态：
  - `docs/dev/README.md` 有本轮文档修改
  - `docs/dev/runtime-preview/issues.md` 有本轮 issue 修改
  - `docs/dev/architecture/official-sync-workflow.md` 为本轮新增流程文档
  - `docs/dev/runtime-preview/facts/unified-preview-mcp-runtime-session-20260709.md` 为本轮新增事实记录

本报告是合并前分析报告，不是合并复盘。实际进入 merge / rebase 后，完成或中止时还需要另写复盘。

## 范围

- `BASE..target`：55 个官方 commits。
- `BASE..adapter`：335 个本地 commits。
- 本次已使用 `git merge-tree --write-tree --name-only --messages adapter-to-386 origin/main` 做只读冲突预测。
- 已读取：
  - `docs/dev/architecture/official-sync-workflow.md`
  - `docs/dev/testing-spec.md`
  - `docs/dev/runtime-preview/testing-spec.md`
- 2026-07-09 已派两个只读审查代理分别分析官方意图和 adapter 意图。2026-07-10 因 target 新增 assets material API，再次完成官方增量审查和冲突方案对抗审查；对抗审查指出 partial preview options、companion option 归属、跨文件 heartbeat、vendored dependency 等遗漏，已回填 `C-01` 到 `C-08`。

## 官方新增

### Preview 合同变化

官方 `695d7ff6` 将 `preview` 从单一路径拆成三类：

- 默认：动态 browser game preview，调用 `startGamePreview()`，不先 build。
- `--build`：legacy build-based preview，调用 `startPreview()`。
- `--scene-editor`：scene editor debug preview，调用 `startSceneEditorPreview()`。

这不是单纯新增 CLI 参数，而是默认 preview 行为变更。后续合并不得把默认 `preview` 退回旧的 build-first 语义。

### Browser preview 与 scene editor 分流

官方新增 `src/core/preview/*`，并将动态脚本资源路由集中到 `src/core/preview/scripting-routes.ts`。

重要合同：

- browser game preview 入口是 `/`。
- scene editor 入口是 `/scene-editor/`。
- browser preview route 注册优先级必须高于 scene middleware 的宽泛路由。
- `src/core/scene/scene.scripting.middleware.ts` 不应继续维护完整旧 `/scripting/*` 路由清单，而应使用共享 `scriptingRoutes`。

### Builder / stage task 合同变化

官方更新集中在 build lifecycle、stage task、log 和 progress：

- build log sink 语义变成具体 `.log` 文件路径。
- 早失败路径也要先建立 log sink。
- `executeBuildStageTask()` 需要合并运行时注入的 `packages`、`platform`、`dest`、`logDest`。
- builder 对外导出 `clearCache`、`BuildCacheScope`、`ClearCacheResult`。
- 长任务加入 progress heartbeat，break / error 时必须停止 timer。

### Project live config / includeModules

官方修复 preview 和 build 对项目实时配置的尊重：

- `includeModules` 真相源倾向于 `Engine.getConfig()`。
- `engineModulesConfigKey` / `globalConfigKey` 必须保留。
- preview settings 与正式 build 的模块选择需要一致。
- 预览 internal builtin assets 不能按 `includeModules` 裁剪，应按全部 feature 的 dependent assets 准备，避免完整引擎运行时漏内置资源。

### Public API snapshot

`packages/cocos-cli-types/__tests__/__snapshots__/dts-snapshot.test.ts.snap` 承载大量官方 public API 增量，包括：

- animation editor scene-process APIs。
- `animationMask*` / `animationGraphVariant*`。
- serialized asset query / save APIs。
- asset property schema。
- whole `userData` update。
- material effect query、material dump query / save API。
- build cache APIs。
- upload hook 相关类型。

该文件不是普通测试噪音，合并时不能手工丢官方 API 面。

### 2026-07-10 官方增量

旧 `TARGET` `6d4bf9fa` 之后新增 3 个官方 commits：

| commit | 官方变化 | 对本分支的实际影响 |
| --- | --- | --- |
| `ea2c3d65` | engine compiler 支持无扩展名 `cc.config.json` 自动查找 `.ts` / `.js`，并补 import-map tests | 不产生直接冲突；应直接吸收并保留官方 tests |
| `e7207e6a` | 新增 material service、`AssetsApi` tools、library API、schema、public types 和 query / save tests | 直接补强“通过已导入资产的高层 API 修改并落盘”的能力，但仅覆盖 material，不等于 prefab / scene / component 通用编辑 |
| `610c6b3d` | `queryAssetConfigMap()` 返回本地化后的 display / description / nested `userDataConfig`，同时保留 raw config 查询路径，并激活 lazy handlers | 有利于 MCP / panel 显示可读配置；不改变 `@cocos/asset-db` npm 版本，也不替代 adapter vendored package |

material 用户流程来自官方 tests 和 API 实现：调用方先通过 effect / material query 获得 Creator-compatible dump，修改 dump 中的 technique、pass、defines、states 或 props，再调用 `assets-material-save`；service 将变更写回 `.mtl` 并刷新后再次 query 验证。该流程是可落盘的结构化编辑 API，应吸收。它没有提供“给 prefab 节点添加组件、设置组件节点引用”这类 scene graph 操作，不能把它描述成统一资产对象编辑能力已经完成。

对抗审查补充了两个边界：material save 是完整 dump 覆盖，没有 revision / mtime 冲突检测，不能视为多客户端共享编辑事务；config map localization 是 presentation contract，自动化不能用 label / displayName 作为稳定标识。官方 raw config 查询目前仍是内部能力，本次同步不顺带扩展 public contract。

本次增量没有修改 `package.json`、`package-lock.json` 或 `packages/asset-db`。官方和 npm registry 仍为 `@cocos/asset-db@3.0.0-alpha.10`，因此本次不触发 vendored `asset-db` 提取或升级流程。

## 用户流程变化

本节把 preview 相关代码差异翻译为用户可见流程。以下流程来自源码阅读和 `BASE..target` / `BASE..adapter` diff 推断，尚未在实际 merge 后运行验证。

| 流程 | 触发方式 | 同一个 CLI 实例内启动的能力 | 主要 URL / 入口 | scene process / RPC | 能否切换到 scene editor | 边界 |
| --- | --- | --- | --- | --- | --- | --- |
| 官方默认 browser game preview | `cocos preview -j <project>` | AssetDB、builder settings、browser preview route、动态资源路由 | `/` | 否，按当前源码理解不启动完整 scene editor 链路 | 不能切到完整 scene editor；`/scene-editor/` 没有对应初始化 | 不是 adapter `--runtime`；不是 legacy build preview |
| 官方 legacy build preview | `cocos preview -j <project> --build` | import、HTTP server、builder build task、web platform preview result | build 返回的 preview URL | 否 | 否 | 这是旧 build-first 语义；不应作为默认 `preview` |
| 官方 scene editor debug preview | `cocos preview -j <project> --scene-editor` | import、HTTP server、builder init、scene process、scene middleware、browser preview route、shared scripting routes | `/scene-editor/`，并打印 `/` | 是 | 源码意图上同一实例可在 `/scene-editor/` 与 `/` 间切换；需 merge 后验证 | 只在 `--scene-editor` 启动路径成立；默认 `preview` 不具备该 scene editor 初始化 |
| adapter runtime preview | `cocos preview -j <project> --runtime` | runtime preview server、settings provider、programming output、diagnostics、watch / refresh、runtime asset routes | runtime preview server URL | 否，另一路 runtime 编排 | 不等价官方 scene editor；不能直接视为 scene editor 切换 | 保护 3.8.6 runtime preview、diagnostics、refresh 和 cache 语义 |
| 长期目标：统一 preview 实例 | 未来设计，不是本次官方同步已有能力 | normal preview、runtime preview、scene editor、MCP 按 URL / 参数切换，共享必要初始化和状态 | 待设计 | 按 URL / 参数按需启用 | 目标是可切换 | 已记录为后续 issue；不应混入本次 merge 冲突解决 |

### 实例与状态边界

- 官方 `cocos preview` 默认实例不是“所有 preview 能力实例”，而是 browser game preview 实例。
- 官方 `cocos preview --scene-editor` 才会启动 scene process / RPC；该路径同时保留 browser preview route，因此一个实例内可能同时存在 `/` 和 `/scene-editor/`。
- adapter `cocos preview --runtime` 不是官方 browser preview 的别名；它有独立 runtime preview server、programming root、diagnostics、watch / refresh 状态。
- MCP 当前仍是另一个启动链路，不在官方这次 preview 变动中。
- 后续合并如果只看函数名 `startPreview()`，会误判实例能力。必须以“命令 -> 初始化链路 -> URL -> 状态共享”判断。

### 决策影响

| 决策 | 用户流程结果 | 风险 |
| --- | --- | --- |
| 只采用官方 preview 实现 | 默认 `preview` 和 `--scene-editor` 符合官方新合同，但丢 adapter `--runtime` runtime preview 流程 | 破坏 runtime preview 诊断、watch / refresh 和 3.8.6 适配 |
| 只保留 adapter preview 实现 | `--runtime` 保留，但官方默认 browser preview、`--build`、`--scene-editor` 新合同回退 | 破坏官方用户预期，且丢 `/` 与 `/scene-editor/` 分流 |
| 语义合并 | 默认 `preview` 采用官方 browser game preview；`--scene-editor` 采用官方 scene editor debug preview；`--build` 保留 legacy；`--runtime` 接回 adapter runtime preview | 需要明确命名和生命周期，防止多个 route / settings provider / close cleanup 互相覆盖 |

## 本地保护目标

### Runtime preview

adapter 的核心目标之一是保留独立 runtime preview server：

- `preview --runtime`。
- `--host`。
- `--settings-timeout-ms`。
- `--script-load-concurrency`。
- `--clear-programming-cache`。
- `--refresh-on-reload`。
- `--watch-assets`。
- startup diagnostics、compile diagnostics、programming output inspection、watch / refresh lifecycle。

官方 browser preview 与 adapter runtime preview 不是等价能力；应共存，而不是互相覆盖。

### Engine root 与 3.8.6 runtime

adapter 保护：

- engine root 从项目配置和 CLI 初始化链路解析。
- build 路径可切到 `build-nodejs` runtime。
- 不依赖旧全局固定 `GlobalPaths.enginePath` 作为唯一事实源。

### Project extension builder hooks

adapter 保护：

- `init(platform, projectRoot)` 注册 project extension builders。
- hook 通过统一 runner 执行，不只是 `require + call`。
- 保留 `IBuildHookInfo`、fatal / non-fatal、Editor facade、project-extension source 等语义。
- build 异常路径需要执行 `runErrorHook()`。

### Project config / preview settings parity

adapter 保护：

- `fillIncludeModulesFromProjectConfig()` 可从项目配置补 `includeModules`。
- preview settings 下按项目配置修正 graphics pipeline。
- 3D physics 默认材质只在对应 feature 存在时补，不应无条件注入。

官方已部分覆盖 live config，但来源、pipeline、physics 条件化不完全等价。

### Mini-game / wechatgame bundle

adapter 保护：

- `wechatgame` platform support。
- mini-game bundle explicit configs 输出语义。
- `packAutoAtlas` 开关。
- project extension / Editor facade hook 在 bundle 阶段的传递。

官方相关修复只覆盖部分 bundle/live config，不等价覆盖 adapter 的 mini-game 目标。

## 冲突预测

`git merge-tree --write-tree --name-only --messages adapter-to-386 origin/main` 预测直接冲突文件：

最新 `TARGET` 仍预测 8 个直接冲突文件；官方新增 assets material API 只扩大 DTS snapshot 冲突内容，没有新增源码 text conflict。以下按业务主题记录经过对抗审查的合并方案：

| ID | 文件 / 主题 | 目标合并语义 | 具体打算怎么合 | 为什么这样合 | 不采用的方案 | 风险与验证 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `C-01` | `src/commands/preview.ts`、`src/core/launcher.ts` | 缺省 mode 是官方动态 browser game preview；`--build`、`--scene-editor`、`--runtime` 三个显式 mode 互斥 | 建立显式 mode selector，并按 mode 校验附属参数：`--host`、runtime diagnostics / cache / watch 参数只属于 runtime，`--platform`、`--build-config` 只属于 build，`--scene` 在 game/runtime 下分别按各自合同传递；不兼容参数显式报错。Launcher 接收官方四个入口，所有普通入口继续使用 adapter engine resolver，legacy build 调用 `init(platform, projectRoot)`，保留完整 `startRuntimePreview()`、runtime 独立日志和 cleanup | 官方三种 preview 与 adapter runtime preview 能力不等价；共存才能同时保护官方合同和 3.8.6 runtime 目标。参数归属明确后不会出现 silent no-op 或不可判断实例 | 不选整文件 official 或 adapter；不把默认 preview 接到 runtime；不让普通 preview 与 runtime server 在本次冲突中强行共享实例 | 高风险：初始化顺序、参数兼容、server route、browser dispose、runtime readiness、`close()`。验证 CLI mode / companion-option matrix、四个 launcher 路径、默认 `/`、`/scene-editor/`、runtime health/settings，并确认 runtime 不启动 scene RPC。`proposed` |
| `C-02` | `src/core/scene/scene.scripting.middleware.ts` + semantic conflict `src/core/preview/scripting-routes.ts` | `/scene-editor/` 使用官方 scene 专属入口，动态 scripting routes 由 game preview 和 scene editor 共享；effect settings 读取 adapter 实际输出目录，但 normal / scene 与 runtime programming workspace 仍分离 | 采用官方精简后的 scene middleware 和 `scriptingRoutes`；只把共享 route 中 `effect.bin` 对齐为 `temp/cli/asset-db`。normal / scene QuickPack 继续使用官方 `temp/programming`，runtime 继续走自己的 routes 和 `temp/cli/programming` | route 架构属于官方合同，effect path 属于 adapter 真实 AssetDB 输出；programming workspace 则仍属于两套不同 runtime，不能因相似路径混用 | 不恢复旧完整 middleware；不采用官方旧 effect path；不把普通 browser preview 接到 runtime programming workspace | 高风险：middleware 注册顺序和目录边界。验证 `/`、`/scene-editor/`、effect-settings、QuickPack、import-map、静态资源，并确认 normal / scene 不读取 runtime workspace。`proposed` |
| `C-03` | `src/core/builder/index.ts` | 官方 cache、log sink、stage runtime options 和 public exports 生效；adapter project extension builders、error hook、partial preview options merge 与 preview settings parity 保留 | 从官方 builder lifecycle 出发，保留 `init(platform, projectRoot?)`、`registerProjectExtensionBuilders()`、`runErrorHook()` 和 `createPreviewBuildOptions()`；检查所有 instance build / legacy preview 调用点传入 `projectRoot`；接收官方 `clearCache` exports、`.log` 规范化、早失败 log sink 和 stage options merge | runtime preview 的 `server` / `startScene` 等 partial options 必须先与平台默认配置合并；遗漏 `createPreviewBuildOptions()` 会生成不完整 settings。其余 adapter hooks 与官方 lifecycle 属于正交 contract | 不把 extension hooks 挪回裸 `require + call`；不删除 partial preview options merge；不保留 adapter 旧 logDest / stage merge 行为 | 高风险：normal/runtime settings、早失败和 hook 失败路径。验证 builder init、两类 preview settings、stage packages/platform/dest/logDest、clear cache、extension hook success/error。`proposed` |
| `C-04` | `src/core/builder/share/common-options-validator.ts` | `includeModules` 只有一个 production 真相源，同时保留 adapter 对 preview graphics pipeline 和 physics dependent asset 的修正，且不修改 Engine config 原对象 | 采用官方 `Engine.getConfig()`、`engineModulesConfigKey`、`globalConfigKey` resolver 唯一决定 modules。graphics pipeline 作为独立 preview 后处理；如果仍需 `CocosConfigLoader`，只能读取 pipeline，禁止覆盖 modules。`physicsConfig` 必须 clone 后再按 dependent asset 添加或删除 default material | 双 loader 会产生顺序依赖；直接修改 `Engine.getConfig().physicsConfig` 会污染同进程后续 build。adapter 的 pipeline / dependent asset 是额外约束，不应被一起删除 | 不保留两个 modules 真相源；不采用官方无条件 physics default material；不原地修改 Engine config | 高风险：配置 shape、进程内 live config 和 preview parity。验证 config key、空/显式 modules、legacy/custom pipeline、有/无 3D physics，以及连续 build 不互相污染。`proposed` |
| `C-05` | `src/core/builder/worker/builder/asset-handler/bundle/index.ts` | 官方 preview internal assets 完整性、disabled platform 容错和 heartbeat 生效；adapter wechatgame / mini-game / packAutoAtlas / hook metadata 不回退 | 按处理阶段合并：internal builtin asset selection 使用官方规则；platform、bundle config 和 hook metadata 保留 adapter 分支；长循环加入官方 heartbeat，并保证 break / error 清理 timer | 这些行为位于同一大文件但服务不同产物阶段，必须按阶段组合，不能按整段选边 | 不用 adapter includeModules 裁剪 preview internal assets；不删除 adapter mini-game 输出逻辑 | 高风险：产物漏资源、分包变化、timer 泄漏。验证 preview builtin assets、wechatgame / mini-game bundle、packAutoAtlas、disabled platform 和 heartbeat。`proposed` |
| `C-06` | `task-base.ts` 及 semantic conflict `worker/builder/index.ts`、stage manager、bundle heartbeat lifecycle | adapter hook runner、`IBuildHookInfo`、fatal / non-fatal 和 Editor facade 语义保留，同时具备官方 progress heartbeat | 以 adapter `loadAndRunBuildHook()` 调度为主干，在实际耗时调用前启动官方 heartbeat；联合审计 worker builder、stage manager 和 bundle，在 success、break、error、finally 路径统一停止 timer，再进入既有 hook / error 收尾 | hook 是 adapter project extension 合同；heartbeat 跨越多个自动合并文件，只解决 `task-base.ts` conflict 会留下生命周期缺口 | 不退回直接 `require + call`；不只修改直接冲突文件；不吞掉 fatal project hook | 高风险：重复 hook、错误吞掉、残留 timer。验证 fake timer heartbeat、一次调用、fatal/non-fatal、Editor facade、success/break/error 后无 timer。`proposed` |
| `C-07` | DTS snapshot 与 assets public API | 官方 material、serialized asset、animation、cache 等 API 和 adapter API 同时真实存在，snapshot 只反映最终源码生成结果 | 先合并 API、schema 和 exports，吸收 material query / save 与 localized config map；保留 adapter APIs；最后运行 `npm run generate:dts` 和 snapshot test。Material save 本轮按官方基础实现接收，但不宣称具备 revision、并发事务或 prefab 通用编辑安全；localized label 仅作 presentation，自动化继续使用稳定 key / value | material API 确实写回 `.mtl` 并 reimport，符合结构化落盘方向；但完整 dump 覆盖存在 stale write 风险，schema 也不证明 effect/pass/property 语义合法。snapshot 手工合并无法证明实现与声明一致 | 不手工拼 snapshot；不删除任一边 API；不把本地化 label 当机器标识；不在本次同步中顺带设计统一资产事务层 | 高风险：lost update、非法 dump、API export 遗漏、extension lazy handler 顺序。验证 material core/API/lib 与 restart round-trip、config-map zh/en/raw 和 extension handler、DTS generation/snapshot；并把并发事务与强语义校验列为后续问题。`proposed` |
| `C-08` | semantic conflict：`package.json`、`package-lock.json`、vendored packages | 接收官方 CLI 版本、Pink 约束和 DTS memory 参数，同时继续由本仓库源码维护 `@cocos/asset-db`，保留 runtime preview 依赖和 scripts | 审计自动合并结果：保留 `file:./packages/asset-db`、`packages/asset-db` 发布文件、`@parcel/watcher`、runtime preview / release scripts；lockfile root、link 和 package entry 必须仍指向本地 package。本次不升级 `@cocos/asset-db`，因为官方和 registry 都仍是 `3.0.0-alpha.10` | dependency 文件虽无 text conflict，但错误自动合并会在 install 时把 runtime 和 vendored ownership 静默改变，必须作为高风险 semantic conflict 明确确认 | 不恢复 registry `@cocos/asset-db`；不为整理 lockfile 顺带升级依赖；不覆盖官方版本与 Pink 要求 | 高风险：安装解析到错误包或漏 watcher。验证 lockfile entries、`npm ls @cocos/asset-db @parcel/watcher`、compile/install sanity。`proposed` |

### 用户确认记录

用户于 2026-07-10 确认 `C-01` 到 `C-08` 按上述修订方案执行，并确认本次不夹带 normal/runtime/scene editor/MCP 同实例新架构。表格中的 `proposed` 是对抗审查结束时的提案状态；本记录将这些提案统一推进为 `approved`。后续如果源码事实要求改变任一目标语义，必须按对应 `C-ID` 重新确认。

## 高风险 semantic conflict

- `package.json` / `package-lock.json` 当前无 direct conflict，但官方和 adapter 都改了 package、workspace、generated tool 链，需要 merge 后做 dependency sanity。
- 官方新增 `src/core/preview/*`，adapter 新增 `src/runtime-preview/*`，文本不冲突但 preview 生命周期和 route contract 会冲突。
- 官方 `startPreview()` 改成 legacy build preview；adapter `startPreview()` 仍是旧 preview 入口。后续合并必须重命名或明确语义，不能靠函数名判断。
- 官方 `fillIncludeModulesFromProjectConfig()` 与 adapter 同名但职责不同，必须重新设计职责边界。
- `dts snapshot` 是生成物，必须在 API 合并后统一再生成。
- 官方 material API 与 adapter 的 AssetDB / engine root / temp output 改动没有 text conflict，但必须确认 material service 使用的是本轮 CLI 实例已经初始化的 assetManager、engine 和 effect 数据，不能只凭 API tests 推断 runtime preview / MCP 已共享同一状态。
- 官方 config map localization 返回面向当前语言的副本；调用方如果需要稳定 key 或原始 i18n token，必须使用 raw 查询路径，不能把本地化文本当持久化标识符。

## 推荐路线

不在当前 dirty 主工作区直接执行实际 merge。推荐并已写入通用规范的路线：

1. 长期保留 `.worktrees/official-sync`，每轮从准确的 `ADAPTER` HEAD 新建 `SYNC_BRANCH`，本轮建议 `codex/official-sync-20260710-610c6b3d`。
2. `C-01` 到 `C-08` 已获得用户确认；还必须完成并确认可执行计划 `docs/superpowers/plans/2026-07-10-adapter-to-386-official-merge.md`，才可在长期 worktree 执行 `git merge --no-ff --no-commit origin/main`。不 rebase，不改写 `adapter-to-386` 历史。
3. 按子系统分批解冲突：
   - preview / launcher / scene route。
   - builder init / stage task / common options。
   - bundle / hook runner / progress heartbeat。
   - assets API 源码、tests 和 generated DTS snapshot。
4. 代码合并完成后再生成 dts snapshot，不手工拼 snapshot。
5. 合并时若出现未预测冲突或源码事实推翻已确认方案，保留 merge 现场并回到决策表重新确认，不静默改变方向。
6. 验证通过后，在主工作区可安全更新的前提下让 `adapter-to-386` 通过 `git merge --ff-only <SYNC_BRANCH>` 接收已验证 merge commit；长期 worktree 不删除。

推荐合并原则：

- 默认吸收官方 public contract 和官方 route architecture。
- adapter runtime preview 作为 `--runtime` 独立路径接回，不覆盖官方默认 browser preview。
- builder 同时保留官方 progress/log/cache/stage 注入和 adapter project extension hooks。
- 证据不足的 preview / route / output path 不直接 `keep adapter`，而是通过 focused tests 验证后决定。

## 验证矩阵

制定或执行验证前已读取 `docs/dev/testing-spec.md` 和 `docs/dev/runtime-preview/testing-spec.md`。

| 类别 | 命令 / 入口 | 工作目录 | 覆盖风险 | 不能证明 |
| --- | --- | --- | --- | --- |
| TypeScript | `npx tsc -b --pretty false` | repo 根目录 | 类型和 project references | 不证明 `dist` 已构建 |
| Build compile | `npm run compile` | repo 根目录 | 更新 `dist`、schema、static web 等 | 不证明真实项目 runtime preview 已通过 |
| Builder unit | focused Jest around builder / hooks / options | repo 根目录 | project extension hooks、log sink、stage options | 不证明真实 build parity |
| Runtime preview Vitest | `npm --prefix vitests run test -- suites/runtime-preview/...` | repo 根目录 | route、launcher、settings、refresh | 不证明特定真实项目通过 |
| Build Vitest | `npm --prefix vitests run test -- suites/build/...` | repo 根目录 | wechatgame、bundle、editor parity 边界 | 不证明所有平台构建通过 |
| Assets API | focused tests for material service/API/lib、asset config map i18n、serialized assets | repo 根目录 | material dump query/save 落盘、localized/raw config contract、API bridge | 不证明 prefab / scene / component 通用编辑 |
| Runtime import map | 3.8.6 extensionless `cc.config.json` override browser/runtime smoke | repo 根目录 + 真实或受控项目 | 官方 extensionless fix 与 adapter runtime programming route 相容 | 不证明其他 engine 版本 |
| Dependency | lockfile inspection、`npm ls @cocos/asset-db @parcel/watcher` | repo 根目录 | vendored asset-db 和 runtime watcher 依赖所有权 | 不证明 AssetDB runtime 行为 |
| DTS | dts snapshot 相关测试 / 生成命令 | repo 根目录 | public API 快照 | 不证明 runtime 行为 |
| 真实项目 | 按 issue/facts 指定项目执行 | repo 根目录和真实项目 | 真实业务项目风险 | 不可泛化到所有项目 |

如果使用 `node dist/cli.js ...` 做真实 CLI 验收，必须先运行 `npm run compile` 或明确说明使用旧 `dist`。

## 需要确认的问题

本轮执行路线、`C-01` 到 `C-08`、preview mode 边界和“不夹带统一实例新架构”均已确认。进入实际 merge 前剩余 gate：

- 审查并确认 `docs/superpowers/plans/2026-07-10-adapter-to-386-official-merge.md` 的执行步骤、停止条件和验收矩阵。
- 提交当前 dirty 文档，确认 `ANALYZED_ADAPTER..START_ADAPTER` 只有 docs 变化。

## 后续复盘检查点

完成或中止实际 merge 后，复盘至少检查：

- 实际冲突是否与本报告预测一致。
- `startPreview()`、`startGamePreview()`、`startSceneEditorPreview()`、`startRuntimePreview()` 的最终语义是否清晰。
- `scene.scripting.middleware.ts` 是否保留官方 route architecture，且 adapter 产物路径未丢。
- `common-options-validator.ts` 是否出现双重 includeModules 真相源。
- hook runner 与 progress heartbeat 是否同时保留。
- dts snapshot 是否由生成流程更新。
- 是否需要回填 `docs/dev/architecture/official-sync-workflow.md`。
