# adapter-to-386 官方同步合并前分析

## 状态

- 初始分析日期：2026-07-09
- 最新刷新日期：2026-07-13
- `adapter`：`adapter-to-386`
- `target`：`origin/main`
- `BASE`：`c71c446428da66b77ae8e8c6714c9cc35ac094d2`
- `TARGET`：`3b526b9d86519df1ee5046550aaa202d860ab15d`
- `ANALYZED_ADAPTER`：`8f52bece43b2512590d28870d7c3f05031299235`，表示 production code 分析基线；后续新增仅为本轮 docs commits，实际执行起点由计划记录为 `START_ADAPTER`
- remote 拓扑：
  - `origin`：`https://github.com/AILHC/cocos-cli.git`
  - `upstream`：`https://github.com/cocos/cocos-cli.git`
- fork main 同步结果：
  - 2026-07-09 首次同步：`origin/main` 从 `c71c446428da66b77ae8e8c6714c9cc35ac094d2` fast-forward 到 `6d4bf9fa4f86f294be8fb3c6ba979a4605571f1e`。
  - 2026-07-10 冻结检查发现官方继续前进到 `610c6b3d5f8608680a7374970bad99262ff25e02`，原报告的 `TARGET` 已过期。
  - 更新 refs 后 `git rev-list --left-right --count origin/main...upstream/main` 为 `0 3`。
  - 已再次执行 fast-forward push：`origin/main == upstream/main == 610c6b3d5f8608680a7374970bad99262ff25e02`。
  - 编写并对抗审查执行计划期间，官方又新增 4 个 commits，最新 head 变为 `d373afbca8c519bc75f6e68c1526b3d7f6a2536b`。
  - 再次确认 `origin/main...upstream/main` 为 `0 4` 后执行 fast-forward push；当前 `origin/main == upstream/main == d373afbca8c519bc75f6e68c1526b3d7f6a2536b`。
  - 2026-07-13 `git ls-remote upstream refs/heads/main` 显示官方又前进 7 个 commits；`git fetch upstream main` 于 15:20 成功，随后仅在确认 fork main 无独有提交后 fast-forward push。当时 `origin/main == upstream/main == 5c2b76a60899c6558bb1461e907b68a4567c412c`。
  - 提交刷新文档前的 freshness gate 又发现官方前进到 `84000ea12364f877431cb487e121951dc223c595`。`git fetch upstream main` 成功；首次 fork push 因 GitHub TLS handshake 失败而未改变远端，明确报告后重试成功。当时 `origin/main == upstream/main == 84000ea12364f877431cb487e121951dc223c595`。
  - graphics 增量短复审期间，reviewer 的独立 freshness check 发现官方再次前进到 `65644d59c5106f3c261de35af5c2d7b90d796f41`。本地 `git fetch upstream main` 成功，确认 `origin/main...upstream/main` 为 `0 2` 后执行 fast-forward push；当时 `origin/main == upstream/main == 65644d59c5106f3c261de35af5c2d7b90d796f41`。
  - 用户确认 `65644d59` 计划后、写入批准记录前，freshness gate 发现官方新增 `3b526b9d86519df1ee5046550aaa202d860ab15d`。`git fetch upstream main` 成功，确认 `origin/main...upstream/main` 为 `0 1` 后执行 fast-forward push；当前 `origin/main == upstream/main == 3b526b9d86519df1ee5046550aaa202d860ab15d`。
- 当前工作区状态：
  - 刷新分析前 `adapter-to-386@d53e465c91bbd82eb42f28a7abf278426a167d69` clean，相对 `ANALYZED_ADAPTER` 只有 4 个已提交 docs commits。
  - 尚未创建 `.worktrees/official-sync`，也未进入 merge / rebase 状态。

本报告是合并前分析报告，不是合并复盘。实际进入 merge / rebase 后，完成或中止时还需要另写复盘。

## 范围

- `BASE..target`：70 个官方 commits。
- `BASE..ANALYZED_ADAPTER`：335 个本地 commits。刷新到 `3b526b9d` 时当前 adapter 为 339 个独有 commits，新增 4 个均为本轮 docs-only commits，production code delta 未变化。
- 本次已使用 `git merge-tree --write-tree --name-only --messages d53e465c91bbd82eb42f28a7abf278426a167d69 3b526b9d86519df1ee5046550aaa202d860ab15d` 做可复现的只读冲突预测；存在冲突时预期退出码为 1，不能把该退出码误报为命令未执行。
- 已读取：
  - `docs/dev/architecture/official-sync-workflow.md`
  - `docs/dev/testing-spec.md`
  - `docs/dev/runtime-preview/testing-spec.md`
- 2026-07-09 已派两个只读审查代理分别分析官方意图和 adapter 意图。2026-07-10 因 target 新增 assets material API，再次完成官方增量审查和冲突方案对抗审查；对抗审查指出 partial preview options、companion option 归属、跨文件 heartbeat、vendored dependency 等遗漏，已回填 `C-01` 到 `C-08`。target 再次前进并新增 breaking PreviewService 后完成第三轮审查。2026-07-13 针对新增 7 个 commits 重新计算双边 delta 和 `merge-tree`，旧 target 的计划批准再次失效。
- 2026-07-13 首轮最新 target 对抗审查结论为 `revise`：纠正 sortingPlugin 业务语义和 Google Play 连带公开 FB 的遗漏，补 loader partial-cache rollback、Joint Texture Layout 三路径 parity、animation 重启落盘、Pink final-dist bridge、esbuild direct dependency、固定 SHA conflict evidence 与 build 生成物 diff。同两名 reviewer 对修订结果短复审后均为 `approved`；该批准不替代用户确认，也不授权进入 merge。
- 上述短复审固定的是 `5c2b76a6`。官方随后前进到 `84000ea1`，该批准对新增 graphics config 事实失效。graphics 业务语义 reviewer 对修订结果给出 `approved`，但 Git / 可执行性 reviewer 同时发现 target 已再次漂移，并指出 `C-04` 在 `engine/index.ts` 冲突解除前运行 Engine tests 的顺序不可执行；因此 `84000ea1` 仍未形成有效最终批准。
- 固定到 `65644d59` 后再次完成两路对抗审查。首轮均为 `revise`：要求把 Engine tests 延后到 `C-14` 解除 `engine/index.ts` 冲突后执行，拆分 Web Mobile 的 build/run URL 与 Pink host route/QR 流程，并把 Android/Web Mobile 的 compiled builder paths、i18n/static/intro、final dist/pack 验收放到完整 build 后。同两名 reviewer 对修订结果短复审后均为 `approved`；该批准只证明报告和计划具备决策/执行闭环，不替代用户确认，也不授权进入 merge。
- 用户随后明确确认 `65644d59` 计划，但批准记录尚未落盘时 target 已漂移到 `3b526b9d`。按 gate 规则，该确认只能作为旧 target 历史，不能自动批准新增 animation session 语义。
- 固定到 `3b526b9d` 后完成两路短审查。Git / 可执行性 reviewer 直接 `approved`；业务 reviewer 首轮要求修正 E2E 事件顺序，避免在 re-enter 前已消费 `assetChanged` 却误称跨 session suppression。计划已改为 save 前订阅事件、save 后立即 exit/re-enter，并强断言 current clip change 发生在 re-enter completed 之后；同 reviewer 复审为 `approved`。该批准仍不替代用户对新 target 的确认。

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

### 2026-07-10 第二次官方增量

`610c6b3d` 之后新增 4 个官方 commits：

| commit | 官方变化 | 对本分支的实际影响 |
| --- | --- | --- |
| `f1463d84` | 拆分 scene dump service access，解除 component / node / dump circular imports | 直接关系 MCP scene / prefab / component editing，应完整吸收并跑 scene editing regression |
| `8f4ba4b8` | breaking PreviewService、standalone `/preview` resource preview page、browser scene realm preview implementations、DTS/public service、static web assets | 新增 scene-enabled server stack 内的资源预览用户流程；不是默认 game preview，也不是 adapter runtime preview |
| `f5498282` | 新增 Creator config migration design 文档 | 文档直接接收，不改变 runtime contract |
| `d373afbc` | animation playback time sync 平滑修复并补 test | 影响 scene editor animation preview，应接收官方实现和 test |

PreviewService 的实际用户流程是：

```text
cocos preview --scene-editor
→ 启动 scene middleware / RPC server
→ 浏览器访问 /preview
→ 当前 tab 初始化独立 browser engine 与 Scene service realm
→ 页面通过 window.cli.Scene.Preview.open(uuid)
→ 当前 browser realm 根据 asset type 选择 material/model/mesh/prefab/skeleton/spine preview
→ 将 preview camera 挂到 mainWindow 并交互显示
```

该流程只预览资源，不修改或保存资源。`/preview` 依赖 scene-enabled server stack；当前源码中 `--scene-editor` 和 `start-mcp-server` 都会初始化这组 middleware，因此都可托管该 URL。但每个 `/preview` 或 `/scene-editor/` browser tab 都创建独立 browser engine / Scene service realm；只有 `start-mcp-server` 另行启动 MCP child scene worker，二者不共享 scene object memory。默认 game preview 和 `--runtime` 实例不应因为出现 `/preview` 文件名就被描述成具备 PreviewService。官方同时把 project root 加入 scripting file route allowlist，以便 scene preview 加载项目 library scripts；合并时必须验证 realpath / traversal 边界，不能把“项目可读”扩大成任意系统路径可读。

### 2026-07-13 官方增量

`d373afbc` 之后新增 7 个官方 commits：

| commit | 官方变化 | 实际用户 / 业务流程影响 |
| --- | --- | --- |
| `5bfedc2f` | iOS builder 改成 package + Pink custom build view，增加 developer team UI 和独立 view 构建 | 用户在 Pink 的 iOS 构建配置页选择 developer team；CLI compile / release 必须先生成并携带 browser view 与 extension host 产物，否则平台可查询但面板打不开 |
| `528cf8b9` | 缺少 build template 时由打印错误改为抛错 | 创建平台构建模板失败会成为可观察的 command/API failure，不再静默继续；调用方和 tests 必须按失败合同处理 |
| `eb20da14` | clip 编辑 / 保存前后重置并恢复 animation state | 用户边播放边改 clip、保存或 undo/redo 时，当前时间和组件绑定不应落到旧 clip instance，也不应把运行时采样值误写回资源 |
| `d0768c59` | 新增 Joint Texture Layout preview / resolve API，并把解析结果注入 preview 与 build settings | 项目配置用 skeleton / animation clip UUID 描述布局；CLI 从已导入 AssetDB 读取 hash、采样率、时长和 joints 数，计算纹理尺寸并提示设备风险，browser preview 与最终 build 使用同一 resolved layout |
| `0ed7df49` | 新增 `script.sortingPlugin` 配置，并把 UUID 顺序实时同步到 AssetDB 的 plugin script query | 用户修改项目 plugin script 顺序后，同一 CLI 实例的 `querySortedPlugins()`、preview / scene 加载和 build settings 应立即采用新顺序，不要求重启 AssetDB；它不改变 importer 执行顺序 |
| `65cf1ae3` | Google Play 改成 package + Pink custom view，注释掉整组 hidden-platform 过滤，增加 platform view / static asset build pipeline | 目标业务是公开 Google Play，但代码会连带公开未在本提交补齐的 `fb-instant-games`。推荐只解除 Google Play 隐藏并继续隐藏 FB；配置页可编辑 keystore、icon、API level 等字段，root `compile/build` 必须携带完整 view/static/package |
| `5c2b76a6` | 修复 scene editor 中 prefab / atlas 加载：补 native extension 查询、循环引用 cache、并发 load 去重和 native ready 等待 | 用户在 `/scene-editor/` 或 `/preview` 打开引用 atlas 的 prefab 时，ImageAsset 必须先获得真实宽高，SpriteFrame rect 不再被重置；循环 SpriteAtlas/SpriteFrame 和并发共享纹理不能死循环或返回半初始化对象 |

这 7 个提交没有修改 `packages/asset-db`、根 `@cocos/asset-db` 版本或 lockfile 中的 package ownership；官方仍使用 registry `3.0.0-alpha.10`。因此仍不触发 vendored AssetDB 升级，但 `asset-config.ts` 已成为新的直接冲突，必须把官方 live sorting 配置接到 adapter 的本地 AssetDB 路径和 records 设计上。

从用户决策角度，这次不是“多几个测试”而是增加了三条真实流程：平台配置面板的构建与发布、plugin script 加载/执行顺序的同实例热更新、scene browser realm 对 prefab/atlas 的完整加载。它们分别路由到 builder packaging、AssetDB plugin query / scripting consumers、scene engine bootstrap，不能混为 preview mode 冲突，也不能因文件自动合并就默认正确。

### 2026-07-13 第四次官方增量

`5c2b76a6` 之后新增 1 个官方 commit：

| commit | 官方变化 | 实际用户 / 业务流程影响 |
| --- | --- | --- |
| `84000ea1` | 暴露 `engine.graphics` 配置、metadata / i18n / public types，迁移旧 graphics/customPipeline，规范化 pipeline 与 `includeModules`，并让 normal preview modules route 读取磁盘 graphics | 用户在配置界面选择 new/legacy render pipeline、custom pipeline name 和 post-process 后，Engine live config、normal preview 和 build 必须得到同一 modules 集合；旧 Creator 配置迁移后不能丢 graphics。它直接改变 `C-04` 的配置真相源，并扩大 `C-14` 的 `engine/index.ts` 合并面 |

该提交只与 adapter delta 重叠 DTS snapshot 和 `src/core/engine/index.ts`，`merge-tree` 仍预测同一组 11 个直接冲突；但“冲突数没变”不代表计划不变。旧 `C-04` 依赖 adapter 自己后处理 graphics pipeline，而官方现在提供了结构化 `engine.graphics` 与单一 normalization helper，旧批准必须重新打开。

### 2026-07-13 第五次官方增量

`84000ea1` 之后新增 2 个官方 commits：

| commit | 官方变化 | 实际用户 / 业务流程影响 |
| --- | --- | --- |
| `ddf84b61` | 将 `web-mobile` builder 迁移为 package，新增 Pink custom view / extension host 和独立 view build | 这里有两条 URL 流程：实际 build/run hook 把 preview URL 写入 `buildExitRes.custom`；Pink host 则根据 active project 注册 build output route，在面板加载或参数变化时生成 URL / QR，并在 WebGPU + 非 HTTPS 时隐藏 QR、显示 secure-context 提示。package path 从旧 `platforms/web-mobile/*` 迁到 `platforms/web-mobile/src/*`，public option type import、PluginManager 注册和发布物必须一致 |
| `65644d59` | 将 Android builder 迁移为 package，新增 Pink custom view / extension host、SDK/API level 查询、keystore file picker 和平台说明 | 用户在 Pink 的 Android 构建页配置 API level、debug/custom keystore、render backend、ABI 和加密等字段。FilePicker 负责 keystore 路径回写与校验；host 的 `getAndroidAPILevels`、`getNativeEngineInfo`、`openEngineSettings`、`openProgramSettings` 分别承担 SDK fallback、engine 信息和设置跳转。最终 CLI package 必须同时包含 builder config/hooks、browser view、Node host、i18n、static assets 和 platform intro |

这 2 个提交共修改 26 个文件，与 `BASE..adapter` 没有路径重叠，`merge-tree` 仍预测相同 11 个直接冲突。但它们扩大 `C-15` 的平台面板与发布流程：原计划只验收 iOS / Google Play 会漏掉 Android / Web Mobile 的 package path、view/host、SDK bridge、preview URL 和 pack contents。`C-03` 的 PluginManager package registration、`C-08` 的 root view build / release ownership也必须覆盖四个平台。

### 2026-07-13 第六次官方增量

`65644d59` 之后新增 1 个官方 commit：

| commit | 官方变化 | 实际用户 / 业务流程影响 |
| --- | --- | --- |
| `3b526b9d` | 修复 animation clip 自保存后退出并重新进入同一 animation session 时，AssetDB refresh 错误释放/重载当前 clip 的问题 | 用户编辑并保存 clip，离开 animation mode，再重新进入同一 clip 时，当前 `AnimationState.clip` 继续作为权威对象；Asset service 不释放该 clip，component 重新绑定当前 state，不把刚保存的 keyframes/events 替换成 stale reload。删除 clip 仍走原退出路径，非当前 clip 仍正常 refresh |

该提交只修改 animation/asset service 和对应 tests，共 3 个文件，与 `BASE..adapter` 没有路径重叠，`merge-tree` 仍预测相同 11 个直接冲突。它不新增 `C-ID`，但扩大 `C-11`：原计划已要求 save、reimport、第二进程重启 persistence，现在还必须在同一 scene worker 内覆盖 save -> exit -> re-enter -> AssetDB change event，证明 suppression 生命周期不会在 session dispose 时被提前清空，也不会误抑制普通资产刷新。

## 用户流程变化

本节把 preview 相关代码差异翻译为用户可见流程。以下流程来自源码阅读和 `BASE..target` / `BASE..adapter` diff 推断，尚未在实际 merge 后运行验证。

| 流程 | 触发方式 | 同一个 CLI server stack 内启动的能力 | 主要 URL / 入口 | scene realm / RPC | 能否切换到 scene editor | 边界 |
| --- | --- | --- | --- | --- | --- | --- |
| 官方默认 browser game preview | `cocos preview -j <project>` | AssetDB、builder settings、browser preview route、动态资源路由 | `/` | 否，按当前源码理解不启动完整 scene editor 链路 | 不能切到完整 scene editor；`/scene-editor/` 没有对应初始化 | 不是 adapter `--runtime`；不是 legacy build preview |
| 官方 legacy build preview | `cocos preview -j <project> --build` | import、HTTP server、builder build task、web platform preview result | build 返回的 preview URL | 否 | 否 | 这是旧 build-first 语义；不应作为默认 `preview` |
| 官方 scene editor debug preview | `cocos preview -j <project> --scene-editor` | import、HTTP server、builder init、scene middleware / RPC、browser preview route、shared scripting routes | `/scene-editor/`，并打印 `/` | 每个 browser tab 自建独立 scene realm；不是 MCP child worker | 同一 server stack 可访问 `/scene-editor/` 与 `/`，但切换 URL / tab 不等于共享 scene object；需 merge 后验证 | 只在 `--scene-editor` 启动路径成立；默认 `preview` 不具备该 scene editor 初始化 |
| 官方 standalone resource preview | 启动 `--scene-editor` 或 `start-mcp-server`，再访问 `/preview` 并输入 asset UUID | server 提供 scene middleware；每个 browser tab 初始化自己的 `Scene.Preview` service，按 asset type 创建交互预览实例；prefab / atlas 依赖通过 library info 恢复 native 数据并去重并发 load | `/preview` | browser tab 独立 realm；MCP 启动链路另有 child scene worker | 可访问同一 server stack 的 `/scene-editor/`、`/`；不同 tab 只共享 AssetDB / library / disk，不共享 scene object memory | 只做资源显示 / thumbnail，不修改或保存资产；不属于默认 game preview 或 `--runtime`；缓存命中也必须等待 ImageAsset / Texture native ready |
| adapter runtime preview | `cocos preview -j <project> --runtime` | runtime preview server、settings provider、programming output、diagnostics、watch / refresh、runtime asset routes | runtime preview server URL | 否，另一路 runtime 编排 | 不等价官方 scene editor；不能直接视为 scene editor 切换 | 保护 3.8.6 runtime preview、diagnostics、refresh 和 cache 语义 |
| 长期目标：统一 preview 实例 | 未来设计，不是本次官方同步已有能力 | normal preview、runtime preview、scene editor、MCP 按 URL / 参数切换，共享必要初始化和状态 | 待设计 | 按 URL / 参数按需启用 | 目标是可切换 | 已记录为后续 issue；不应混入本次 merge 冲突解决 |

### 实例与状态边界

- 官方 `cocos preview` 默认实例不是“所有 preview 能力实例”，而是 browser game preview 实例。
- 官方 `cocos preview --scene-editor` 会启动 scene middleware / RPC server；`/scene-editor/` 和 `/preview` 的每个 browser tab 分别初始化独立 browser scene realm，不是复用一个 child scene process。该 server stack 同时保留 browser game preview route，因此 URL 层可同时存在 `/`、`/scene-editor/` 和 `/preview`。
- adapter `cocos preview --runtime` 不是官方 browser preview 的别名；它有独立 runtime preview server、programming root、diagnostics、watch / refresh 状态。
- MCP 当前仍是另一个启动链路：它启动 child scene worker，同时托管可创建独立 browser scene realm 的 `/scene-editor/` 和 `/preview`。共享边界是 CLI main process、AssetDB、library 和 disk，不是 scene object memory。
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

`git merge-tree --write-tree --name-only --messages d53e465c91bbd82eb42f28a7abf278426a167d69 3b526b9d86519df1ee5046550aaa202d860ab15d` 预测直接冲突文件：

`TARGET=3b526b9d` 预测 11 个直接冲突文件，和 `65644d59` 相同；新 animation commit 没有新增路径重叠或直接冲突，但扩大 `C-11` 的 session / AssetDB refresh semantic conflict。以下按业务主题记录合并方案：

```text
.gitignore
packages/cocos-cli-types/__tests__/__snapshots__/dts-snapshot.test.ts.snap
src/commands/preview.ts
src/core/assets/asset-config.ts
src/core/builder/index.ts
src/core/builder/share/common-options-validator.ts
src/core/builder/worker/builder/asset-handler/bundle/index.ts
src/core/builder/worker/builder/manager/task-base.ts
src/core/engine/index.ts
src/core/launcher.ts
src/core/scene/scene.scripting.middleware.ts
```

| ID | 文件 / 主题 | 目标合并语义 | 具体打算怎么合 | 为什么这样合 | 不采用的方案 | 风险与验证 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `C-01` | `src/commands/preview.ts`、`src/core/launcher.ts` | 缺省 mode 是官方动态 browser game preview；`--build`、`--scene-editor`、`--runtime` 三个显式 mode 互斥 | 建立显式 mode selector，并按 mode 校验附属参数：`--host`、runtime diagnostics / cache / watch 参数只属于 runtime，`--platform`、`--build-config` 只属于 build，`--scene` 在 game/runtime 下分别按各自合同传递；不兼容参数显式报错。Launcher 接收官方四个入口，所有普通入口继续使用 adapter engine resolver，legacy build 调用 `init(platform, projectRoot)`，保留完整 `startRuntimePreview()`、runtime 独立日志和 cleanup | 官方三种 preview 与 adapter runtime preview 能力不等价；共存才能同时保护官方合同和 3.8.6 runtime 目标。参数归属明确后不会出现 silent no-op 或不可判断实例 | 不选整文件 official 或 adapter；不把默认 preview 接到 runtime；不让普通 preview 与 runtime server 在本次冲突中强行共享实例 | 高风险：初始化顺序、参数兼容、server route、browser dispose、runtime readiness、`close()`。验证 CLI mode / companion-option matrix、四个 launcher 路径、默认 `/`、`/scene-editor/`、runtime health/settings，并确认 runtime 不启动 scene RPC。`approved`（2026-07-13，`TARGET=3b526b9d`，用户确认） |
| `C-02` | `src/core/scene/scene.scripting.middleware.ts` + semantic conflict `src/core/preview/scripting-routes.ts` | `/scene-editor/` 使用官方 scene 专属入口，共享 scripting routes；effect settings 读取 adapter 输出；normal preview 的 modules route 按 `engine.graphics` 规范化磁盘配置，但 normal / scene 与 runtime programming workspace 仍分离 | 采用官方精简 middleware / routes 和 graphics normalization；effect 指向 `temp/cli/asset-db`。normal / scene 保持 `temp/programming`，runtime 保持 `temp/cli/programming`。modules route 与 `Engine.getConfig()` 使用同一 graphics helper，兼容旧 `customPipeline` 但不建立第二真相源 | route 架构和 graphics config 是官方合同，effect path 是 adapter 实际产物；workspace 仍属于两套 runtime。磁盘 modules route 若另写算法会和 live Engine 分叉 | 不恢复旧 middleware；不采用旧 effect path；不复制 graphics 算法；不把 normal preview 接到 runtime workspace | 高风险：route 顺序、目录与 live/disk config 分叉。验证 `/`、`/scene-editor/`、effect、QuickPack、graphics/customPipeline/modules matrix，并确认 normal / scene 不读 runtime root。`approved`（2026-07-13，`TARGET=3b526b9d`，用户确认） |
| `C-03` | `src/core/builder/index.ts` + semantic conflict `src/core/builder/manager/plugin.ts` | 官方 cache、log sink、stage runtime options、public exports 和缺失 build template 的显式失败生效；adapter project extension builders、error hook、partial preview options merge 与 preview settings parity 保留；只公开本轮已补齐的 Google Play，继续隐藏 `fb-instant-games` | 从官方 builder lifecycle 出发，保留 `init(platform, projectRoot?)`、`registerProjectExtensionBuilders()`、`runErrorHook()` 和 `createPreviewBuildOptions()`；接收官方 cache/log/stage/template throw。将 hidden filter 改为只保留 `fb-instant-games`，避免照搬注释后意外公开无完整 package/view 的平台。project extension 与内置 platform 重名仍显式失败 | runtime preview、project extension 和官方 platform package 都是有效合同；`65cf1ae3` 的业务目标是 Google Play，解除整个过滤器会产生未说明的额外产品入口 | 不吞掉 template error；不让 extension 覆盖内置 package；不连带公开 FB Instant Games | 高风险：normal/runtime settings、平台注册顺序、早失败和 hook。验证 Google Play 可见、FB 仍隐藏、name collision、template throw、stage options、extension hook。`approved`（2026-07-13，`TARGET=3b526b9d`，用户确认）（新 target 改变 PluginManager 语义，旧批准失效） |
| `C-04` | `src/core/builder/share/common-options-validator.ts` + `src/core/engine/graphics-config.ts` / migration / metadata / preview route | `engine.graphics` 是 pipeline / post-process 的结构化用户配置，和 `includeModules` 通过官方 helper 双向规范化；`Engine.getConfig()` 是 live production 真相源，旧 `customPipeline` 只作迁移兼容；physics dependent asset 仍不污染原对象 | 完整接收 official graphics types/helper/metadata/migration/tests，以 `normalizeIncludeModulesWithGraphics()` 统一 Engine、normal preview route 与 build。adapter 旧 graphics 后处理只保留尚未被 helper覆盖的 3.8.6 parity，不再第二次覆盖 modules。`physicsConfig` clone 后条件化 default material | `84000ea1` 正式提供了旧计划缺少的 graphics owner model；继续 adapter 独立后处理会重新形成双真相源。迁移和 `CUSTOM_PIPELINE_NAME` 唯一 metadata 也是用户可见合同 | 不保留双 loader/双 normalization；不继续暴露旧 `engine.customPipeline`；不原地修改 Engine config | 高风险：旧配置迁移、partial graphics、legacy/custom/post-process module matrix、live/disk/build 分叉。验证 migration、metadata 唯一键、连续配置切换、normal/runtime/build settings 和 physics pollution。`approved`（2026-07-13，`TARGET=3b526b9d`，用户确认）（`84000ea1` 改变本决策，旧批准失效） |
| `C-05` | `src/core/builder/worker/builder/asset-handler/bundle/index.ts` | 官方 preview internal assets 完整性、disabled platform 容错和 heartbeat 生效；adapter wechatgame / mini-game / packAutoAtlas / hook metadata 不回退 | 按处理阶段合并：internal builtin asset selection 使用官方规则；platform、bundle config 和 hook metadata 保留 adapter 分支；长循环加入官方 heartbeat，并保证 break / error 清理 timer | 这些行为位于同一大文件但服务不同产物阶段，必须按阶段组合，不能按整段选边 | 不用 adapter includeModules 裁剪 preview internal assets；不删除 adapter mini-game 输出逻辑 | 高风险：产物漏资源、分包变化、timer 泄漏。验证 preview builtin assets、wechatgame / mini-game bundle、packAutoAtlas、disabled platform 和 heartbeat。`approved`（2026-07-10，旧 target 已确认且新 target 未改变本决策） |
| `C-06` | `task-base.ts` 及 semantic conflict `worker/builder/index.ts`、stage manager、bundle heartbeat lifecycle | adapter hook runner、`IBuildHookInfo`、fatal / non-fatal 和 Editor facade 语义保留，同时具备官方 progress heartbeat | 以 adapter `loadAndRunBuildHook()` 调度为主干，在实际耗时调用前启动官方 heartbeat；联合审计 worker builder、stage manager 和 bundle，在 success、break、error、finally 路径统一停止 timer，再进入既有 hook / error 收尾 | hook 是 adapter project extension 合同；heartbeat 跨越多个自动合并文件，只解决 `task-base.ts` conflict 会留下生命周期缺口 | 不退回直接 `require + call`；不只修改直接冲突文件；不吞掉 fatal project hook | 高风险：重复 hook、错误吞掉、残留 timer。验证 fake timer heartbeat、一次调用、fatal/non-fatal、Editor facade、success/break/error 后无 timer。`approved`（2026-07-10，旧 target 已确认且新 target 未改变本决策） |
| `C-07` | DTS snapshot 与 assets public API | 官方 material、serialized asset、animation、cache 等 API 和 adapter API 同时真实存在，snapshot 只反映最终源码生成结果 | 先合并 API、schema 和 exports，吸收 material query / save 与 localized config map；保留 adapter APIs；最后运行 `npm run generate:dts` 和 snapshot test。Material save 本轮按官方基础实现接收，但不宣称具备 revision、并发事务或 prefab 通用编辑安全；localized label 仅作 presentation，自动化继续使用稳定 key / value | material API 确实写回 `.mtl` 并 reimport，符合结构化落盘方向；但完整 dump 覆盖存在 stale write 风险，schema 也不证明 effect/pass/property 语义合法。snapshot 手工合并无法证明实现与声明一致 | 不手工拼 snapshot；不删除任一边 API；不把本地化 label 当机器标识；不在本次同步中顺带设计统一资产事务层 | 高风险：lost update、非法 dump、API export 遗漏、extension lazy handler 顺序。验证 material core/API/lib 与 restart round-trip、config-map zh/en/raw 和 extension handler、DTS generation/snapshot；并把并发事务与强语义校验列为后续问题。`approved`（2026-07-13，`TARGET=3b526b9d`，用户确认） |
| `C-08` | semantic conflict：`.gitignore`、`package.json`、`package-lock.json`、vendored packages | 接收官方 CLI 版本、Pink 约束、DTS memory 参数和 platform view build scripts，同时继续由本仓库源码维护 `@cocos/asset-db`，保留 runtime preview 依赖和 scripts | 审计自动合并结果：保留 `file:./packages/asset-db`、`packages/asset-db` 发布文件、`@parcel/watcher`、runtime preview / release scripts；把官方 `build:platform-views` 同时接入最终 `build` / `compile`，并在 `.gitignore` 同时保留 platform view dist、runtime preview app dist、`.codex` 和 versioned Creator tools 规则。lockfile ownership 仍指向本地 package。本次不升级 `@cocos/asset-db` | 新 target 没有升级 AssetDB，却改变 compile / package 产物；只保留任一边 package scripts 都会静默漏掉 runtime app 或平台面板 | 不恢复 registry AssetDB；不删除任一 build pipeline；不为整理 lockfile顺带升级依赖 | 高风险：安装解析错误、compile 顺序或发布文件遗漏。验证 ignore contract、`npm ci`、`npm ls`、root pack dry-run、platform dist 和 runtime preview dist。`approved`（2026-07-13，`TARGET=3b526b9d`，用户确认）（`65cf1ae3` 修改 package / ignore 语义，旧批准失效） |
| `C-09` | semantic conflict：PreviewService、scene engine bootstrap、effect fallback、`/preview`、project file route | `--scene-editor` 和 `start-mcp-server` 的 scene stack 可托管 `/preview`，每个 browser tab 在独立 scene realm 中完整加载 material/model/mesh/prefab/skeleton/spine；引用 atlas 的 prefab 获得真实 native image 尺寸，不改变四种 preview mode | 接收 PreviewService、native extension recovery、循环依赖前置 cache、`nativeReady` / `inFlight` 去重和 adapter UUID helper；补官方遗漏的失败事务边界：依赖/native 失败时释放 Details/readiness/in-flight，并只移除本次插入的 partial cache，使第二次请求真实 fetch/deserialize。Engine resume 只调用一次；effect path 和 file realpath 边界仍按 adapter 决策 | 前置 cache 是断环所需，但官方失败路径可能留下半初始化 cache；“完整照搬官方”与“失败可重试”不能同时成立，必须做最小可靠性修正。PreviewService 仍不与 MCP child worker / runtime browser 共享 scene heap | 不回退并发加载修复；不保留失败 partial asset；不接到 runtime server；不允许双重 resume 或整个 projectRoot allowlist | 高风险：循环死锁、cache owner 误删、width=0 asset、effect/traversal。验证 cache 插入后的 dependency/native failure、清理只作用于本次对象、第二次真实重试、并发/循环/atlas 像素、双 tab cleanup。`approved`（2026-07-13，`TARGET=3b526b9d`，用户确认） |
| `C-10` | semantic conflict：dump `service-access` circular-import fix 与 Node / Component / Prefab editing | child scene worker 和 browser scene realm 都使用官方无环 service access；adapter 的节点引用、组件字段、Undo、dirty、save / reload 行为不回退 | 完整接收 `f1463d84` 的 service-access、dump encode/decode 和 node/component 调整；用 MCP prefab round-trip 和 browser scene bundle 双链路验证，不重引入旧静态 circular imports | 这是用户要求的 prefab/component 可操作对象落盘链路基础；官方修复应接收，但 module init 成功不等于引用恢复和保存仍正确 | 不保留旧 circular imports；不把 browser Preview prefab 副本当可编辑 prefab；不省略重启后 query | 高风险：service 注册时序、component path encode、node reference restore、Undo / save。验证 add/remove/recycle、节点排序、组件引用、save、进程重启后 query。`approved`（2026-07-13，`TARGET=3b526b9d`，用户确认） |
| `C-11` | semantic conflict：animation playback 约 60 Hz time sync、playing-state property query、clip edit/save state recreation、session re-enter refresh suppression | 播放中 property query 返回当前实时节点值而不 seek/sample；pause 后才做确定 frame sampling；编辑、保存、undo/redo、exit/re-enter 后继续绑定当前 clip instance 与编辑时间；当前 clip 的 AssetDB change 不释放 authoritative state，非当前 clip 和 delete 仍走正常 refresh / exit；stop / dispose 无残留 timer | 接收官方 animation sync、reset-before-edit、self-save snapshot restore 和 `preserveCurrentClipAssetForChange()` 协作；补 monotonic / cleanup、播放中编辑、save 后 state recreation / rebind、save -> exit -> re-enter -> assetChanged 单测，并增加真实 scene/MCP edit-save、AssetDB reimport、第二进程重启 query E2E | 新提交修复的不只是 timer，而是“用户边预览边改 clip”以及重新进入 session 时资源 cache、component 与运行态对象分叉；mock service test 不能证明 source 落盘和 reimport 后仍正确，单看 AssetService 也不能证明普通 refresh 未被过度抑制 | 不把运行时采样值写回 clip；不绑定 stale clip；不在 `_disposeSession()` 清空仍待消费的 self-save suppression；不以单进程 mock 代替落盘；不把所有 animation asset change 都跳过 | 高风险：suppression 泄漏、普通 refresh 被吞、删除后 session 残留、旧 state 复活、save/reimport 分叉。验证 current/non-current/delete matrix、同进程 re-enter、service tests、真实 `.anim` source 变化和第二 MCP process curve query / clip binding；E2E 不通过则明确列 residual，不能宣称可用。`approved`（2026-07-13，`TARGET=3b526b9d`，用户确认） |
| `C-12` | semantic conflict：DTS generator namespace / vendored `asset-db` import、缺失的 CI typecheck config 与吞错 workflow | 最终 DTS 同时表达官方 PreviewService / scene / assets / builder API 和 adapter APIs，`@cocos/asset-db/libs/filesystem`、`StatsQuery.ConstantManager` 可解析，官方 `check-dts.yml` 的 typecheck step 能对任意 `tsc` 非零状态真实失败 | 接收官方 generator postprocess 和 tests；补齐 workflow 已引用但 target 中不存在的 `packages/cocos-cli-types/tsconfig.typecheck.json`，以九个 public declarations 和 CI 复制的 `cc.d.ts` 为 roots；将 workflow 的 `grep ... || true` 过滤改为直接执行 `npx tsc -p ... --noEmit`，避免 `TS5058` 等 config 级错误被吞掉；最终源码完成后唯一一次生成，固定 types version `0.0.1-alpha.33.1`；运行完整 types tests、用显式 Git Bash 执行与 CI 相同的 command，以及 package pack dry-run | 新 target 修改 generator，并新增了既引用缺失 config、又可能吞掉 config 级错误的 workflow；只重建 snapshot或在本地另跑直连命令不能证明 CI / consumer contract | 不手工拼 snapshot；不保留旧相对 `./filesystem` import；不保留 workflow 的输出 grep / `|| true`；不采用 registry 动态生成的新版本号 | 高风险：声明可生成但 CI 或消费者 typecheck 失败。验证 postprocess focused test、九个 types contract tests、显式 `C:\Program Files\Git\bin\bash.exe -lc 'npx tsc -p packages/cocos-cli-types/tsconfig.typecheck.json --noEmit'`、snapshot 和 pack。`approved`（2026-07-13，`TARGET=3b526b9d`，用户确认） |
| `C-13` | direct conflict：`src/core/assets/asset-config.ts`；semantic conflict scripting configuration / plugin consumers | `script.sortingPlugin` 在配置初始化、late registry、update/remove/reload 后同步到当前 AssetDB；`querySortedPlugins()` 和 preview / scene / build plugin script consumers 在同一实例采用 UUID 顺序，adapter 的 library records 和 extension mounts 不回退 | 以 adapter AssetDB root/list/records 设计为主干，接入官方 `setSortingPlugin()`、初始 sync 和 configuration listeners；保留 stable UUID array 过滤。增加 listener ownership 检查，并验证 query、preview settings、scene script service、build data / bundle 都消费同一顺序 | 配置存放在 AssetDB runtime config，但业务效果是 plugin script 加载/执行顺序，不是 importer 顺序；整文件采用官方仍会把 adapter 输出路径和 mount ownership 退回旧值 | 不 keep adapter 丢 sorting；不 take official 丢 CLI library records；不声称它改变 import pipeline；不靠重启 CLI 才生效 | 高风险：listener 泄漏、consumer 顺序分叉、late registration race。验证初始/late/update/remove/reload、重复 init、query 与 preview/scene/build consumers、shared/non-shared library 和 extension mount。`approved`（2026-07-13，`TARGET=3b526b9d`，用户确认） |
| `C-14` | direct conflict：`src/core/engine/index.ts`；Joint Texture Layout + graphics normalization + adapter runtime mode | official joint texture 和 graphics config APIs 生效；game/preview/build 使用相同 resolved layouts / modules；adapter `EngineRuntimeMode`、3.8.6 engine root、UUID compatibility、browser-owned builtin/physics 语义保留 | 以 adapter EngineManager 生命周期为主干，同时叠加 official JTL resolver/API 和 `C-04` graphics helper/getConfig normalization；setting task 调同一 JTL resolver。保留 adapter runtimeMode / UUID helper，不恢复整文件 official 的 Node builtin/physics行为。该文件按两个主题联合解决、分别测试 | `84000ea1` 与 JTL 连续修改同一 EngineManager；先后手工套 patch 可能让 `getConfig()` normalization 或 init settings 覆盖另一主题。整文件选边仍会丢 adapter runtime contract | 不复制 JTL/graphics 算法；不把 UUID 原样透传；不因 graphics/JTL 回退 runtimeMode | 高风险：getConfig 调用顺序、missing asset、modules/layout settings 分叉。验证 graphics matrix、JTL UUID/number/missing、真实 AssetDB、game/runtime/build parity 和 3.8.6 runtime mode。`approved`（2026-07-13，`TARGET=3b526b9d`，用户确认） |
| `C-15` | semantic conflict：iOS / Google Play / Android / Web Mobile packages、Pink views、PluginManager、workflow build scripts | Pink 用户能编辑 iOS developer team、Google Play 配置、Android SDK/API/keystore/backend 和 Web Mobile WebGPU，并在 Web Mobile build 后取得 preview URL / QR；FB Instant Games 不因过滤器被整段注释而意外出现；CLI compile/build/release 产物包含四个平台的 package metadata、static assets、browser view 和 extension host | 完整接收四个平台的 package 重组和 build scripts；只公开 Google Play并保留 FB hidden。同步迁移 Android / Web Mobile 的 config/hooks/type import path，把 view build 放入 root pipeline并审计最终 dist；保留 adapter project-extension metadata。platform scripts 直接 `require('esbuild')`，必须声明 root 直接 devDependency 并锁定，不能依赖偶然 hoist | 平台可见性、配置 bridge、builder hook path 和 package/view/发布能力必须成套；只验收新面板而不验证迁移后的 config/hooks 会让 UI 可用但实际 build 失效。未声明构建依赖也会让 lock 拓扑变化时 compile 突然失败 | 不手工提交 generated dist；不继续隐藏 Google Play；不公开未验收 FB；不保留 Android / Web Mobile 旧 import path；不依赖 transitive esbuild | 高风险：平台注册、Pink bridge、Android SDK 探测、Web preview URL、builder hooks、发布漏文件。验证 clean install 后四个平台 query/build，Google Play visible / FB hidden，最终 dist 的 view/host 实际加载与字段回写、pack 精确清单。`approved`（2026-07-13，`TARGET=3b526b9d`，用户确认） |

新 target 对既有决策的补充：

- `C-01`：仍保持 game / build / scene-editor / runtime 四种 mode；resource PreviewService 是 scene-enabled 实例的附属 URL，不是第五种 mode。
- `C-02`：route topology 必须新增 `/preview` 和 `/scripting/effect-settings`，两个 effect endpoints 对齐同一 adapter output；raw file route 只允许 canonical engine / AssetDB library roots。
- `C-07`：仍只负责 Assets / Material API；Scene PreviewService、dump / animation 和 DTS generator 分别由 `C-09` 到 `C-12` 负责，不能把它们描述为 MCP Assets tools。
- `C-03` / `C-08`：官方新增 platform packages、template throw 和 compile scripts，旧批准失效；必须和新 `C-15` 一起确认，不能把 package build 当无业务影响的生成步骤。
- `C-09` / `C-11`：scene bootstrap 与 animation 又有用户可见修复，旧方案需扩展 prefab/atlas load 和 edit/save state recreation 验收。
- `C-13` 到 `C-15`：分别承接 plugin script 加载顺序、joint texture layout、平台配置面板三条新增流程。
- `C-04` / `C-14`：`84000ea1` 新增 graphics owner model 并再次修改 EngineManager；`C-04` 旧批准失效，两个主题必须在同一 `engine/index.ts` 冲突中联合实现、分别验收。
- `C-03` / `C-08` / `C-15`：`65644d59` 将 Android / Web Mobile 也迁入 platform package + Pink view pipeline；三项状态仍为 `proposed`，验收范围从 iOS / Google Play 扩大到四个平台。
- `C-11`：`3b526b9d` 把 self-save suppression 从单次 session 内扩展到 exit/re-enter，并让 AssetService 在当前 clip 有 authoritative state 时保留 cache；必须新增 current/non-current/delete 和 re-enter refresh matrix。

### 用户确认记录

用户于 2026-07-13 确认固定 `TARGET=3b526b9d86519df1ee5046550aaa202d860ab15d`、计划 revision `cdf003820d981502153e7d447bfd39eba54c32b3` 下的 `C-01`、`C-02`、`C-03`、`C-04`、`C-07`、`C-08`、`C-09`、`C-10`、`C-11`、`C-12`、`C-13`、`C-14`、`C-15`。`C-05`、`C-06` 沿用 2026-07-10 的有效批准，因此 `C-01` 到 `C-15` 已全部批准。该确认只关闭合并前决策 gate；用户明确要求本会话不进入 merge。后续会话必须先重新执行 freshness gate，并以本次批准 commit 之后的实际 `adapter-to-386` HEAD 记录 `START_ADAPTER`；若 target、业务语义、验收标准或 stop condition 发生变化，相关决策立即退回 `proposed`。

2026-07-14 执行阶段复查发现 `upstream/main` 已前进到 `df01f317b88b6901733d4e4a9fb0eba2220578e0`，`origin/main` 与固定 `TARGET` 仍为 `3b526b9d86519df1ee5046550aaa202d860ab15d`。用户确认本轮继续合入已批准的固定 snapshot，不追踪执行期间继续前进的官方 head。流程 gate 相应修正为：远端 head 正常前进只作为下一轮同步事实；本轮仅在固定 target 对象不存在，或更新官方 ref 后 target 不再是当前 `upstream/main` 的 ancestor 时停止。该确认不改变 `C-01` 到 `C-15` 的业务方案、验收标准或 merge parent 要求。

## 高风险 semantic conflict

- `package.json` / `package-lock.json` 当前无 direct conflict，但官方和 adapter 都改了 package、workspace、generated tool 链，需要 merge 后做 dependency sanity。
- 官方新增 `src/core/preview/*`，adapter 新增 `src/runtime-preview/*`，文本不冲突但 preview 生命周期和 route contract 会冲突。
- 官方 `startPreview()` 改成 legacy build preview；adapter `startPreview()` 仍是旧 preview 入口。后续合并必须重命名或明确语义，不能靠函数名判断。
- 官方 `fillIncludeModulesFromProjectConfig()` 与 adapter 同名但职责不同，必须重新设计职责边界。
- `dts snapshot` 是生成物，必须在 API 合并后统一再生成。
- 官方 material API 与 adapter 的 AssetDB / engine root / temp output 改动没有 text conflict，但必须确认 material service 使用的是本轮 CLI 实例已经初始化的 assetManager、engine 和 effect 数据，不能只凭 API tests 推断 runtime preview / MCP 已共享同一状态。
- 官方 config map localization 返回面向当前语言的副本；调用方如果需要稳定 key 或原始 i18n token，必须使用 raw 查询路径，不能把本地化文本当持久化标识符。
- 官方 `/preview` resource preview、game preview `/preview/settings.js` 和 adapter runtime preview 名称相近但实例与 route owner 不同；必须以精确 URL、server stack、browser realm 和 MCP child worker 边界区分，不能因 `preview` 命名合并成一个 lifecycle。
- 官方 scripting file route 新增 project root allowlist，必须使用 canonical / real path 验证阻止 `..`、编码路径和 junction escape；普通 string prefix 不足以证明边界安全。
- `asset-config.ts` 的 text conflict 同时承载输出路径、records、extension mounts 和 sorting plugin live state，不能通过整文件选边解决。
- `engine/index.ts` 的 text conflict 同时承载 adapter runtime mode 与官方 Joint Texture Layout；必须确认 browser-owned physics/builtin 语义没有被官方代码块覆盖。
- 官方 platform views 在子 package 内使用 esbuild 并把 React / Pink 声明为 external；root compile 成功不自动证明发布包实际包含可加载 view / host 文件。
- 四个 platform `build-view.js` 直接 `require('esbuild')`，但 target 根 `package.json` 未直接声明 esbuild，只因 lockfile 中其它工具的 transitive dependency 被 hoist 才可能工作；合并不能固化这种隐式依赖。
- Android / Web Mobile 已从旧目录布局迁移到 package `src/`；public types、PluginManager、builder config/hooks 和 final dist 任一路仍引用旧路径，都会形成“平台面板能显示但构建阶段加载失败”的 semantic regression。
- `65cf1ae3` 注释整个 `HIDDEN_PLATFORMS` 后不仅公开 Google Play，也公开 `fb-instant-games`；后者没有本轮 package/view/验收，应视为 collateral semantic change，推荐继续隐藏。
- `5c2b76a6` 的 prefab/atlas loader 把 partial asset 先放入 cache 来断环；任何本地改写若改变 cache、`nativeReady`、`inFlight` 的先后顺序，都可能形成死锁或暴露 width=0 texture。
- `3b526b9d` 让当前 animation clip 的 runtime state 在 AssetDB change 时优先于普通 asset reload，并跨 session dispose 保留 self-save suppression。若 predicate 过宽会吞掉普通 refresh，过窄则 re-enter 后重新绑定 stale clip；delete 必须继续退出 session。

## 推荐路线

不在当前 dirty 主工作区直接执行实际 merge。推荐并已写入通用规范的路线：

1. 长期保留 `.worktrees/official-sync`，每轮从准确的 `ADAPTER` HEAD 新建 `SYNC_BRANCH`，本轮建议 `codex/official-sync-20260713-3b526b9d`。
2. 当前 target 要求重新确认 `C-01` 到 `C-04`、`C-07` 到 `C-15`。全部 gate 通过后，才可在长期 worktree 执行 `git merge --no-ff --no-commit 3b526b9d86519df1ee5046550aaa202d860ab15d`。不 rebase，不改写 `adapter-to-386` 历史。
3. 按子系统分批解冲突：
   - preview / launcher / scene route。
   - builder init / stage task / common options。
   - bundle / hook runner / progress heartbeat。
   - assets API 源码、tests 和 generated DTS snapshot。
   - AssetDB sorting config、Engine joint texture layout、platform view packaging。
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
| Plugin script order live sync | sortingPlugin init/late/update/remove/reload + query / preview / scene / build consumer tests | repo 根目录 | plugin script 加载顺序与 adapter AssetDB ownership 同时保留 | 不证明具体第三方 plugin 脚本自身逻辑正确 |
| Scene PreviewService | focused service / route / security tests + atlas prefab `/preview` browser smoke + scene editing / animation restart E2E | repo 根目录 + 隔离项目 | resource preview、native asset ready / dedup、scene dump fixes、animation save / exit / re-enter refresh suppression、source reimport / second-process query、project file allowlist | 不证明 runtime preview 或其它资产类型事务 |
| Joint Texture Layout | resolver / AssetDB state tests + game/runtime/build settings comparison | repo 根目录 + 隔离项目 | skeleton/clip UUID resolution、device tip、preview/build parity | 不证明所有 GPU / device limit |
| Engine graphics | migration / metadata / Engine tests + normal/runtime/build settings matrix | repo 根目录 + 隔离项目 | graphics owner、pipeline/modules normalization、旧配置迁移和三路径一致性 | 不证明所有自定义 render pipeline 业务逻辑 |
| Platform views | iOS / Google Play / Android / Web Mobile schema 与 builder hook tests、`npm run build:platform-views`、host load、root pack dry-run | repo 根目录 | 四个平台的 Pink 配置、迁移后 builder path 和发布物完整性 | 不证明真实签名 / 商店发布成功 |
| Runtime import map | 3.8.6 extensionless `cc.config.json` override browser/runtime smoke | repo 根目录 + 真实或受控项目 | 官方 extensionless fix 与 adapter runtime programming route 相容 | 不证明其他 engine 版本 |
| Dependency | lockfile inspection、`npm ls @cocos/asset-db @parcel/watcher` | repo 根目录 | vendored asset-db 和 runtime watcher 依赖所有权 | 不证明 AssetDB runtime 行为 |
| DTS | dts snapshot 相关测试 / 生成命令 | repo 根目录 | public API 快照 | 不证明 runtime 行为 |
| 真实项目 | 按 issue/facts 指定项目执行 | repo 根目录和真实项目 | 真实业务项目风险 | 不可泛化到所有项目 |

如果使用 `node dist/cli.js ...` 做真实 CLI 验收，必须先运行 `npm run compile` 或明确说明使用旧 `dist`。

## 需要确认的问题

旧 target 的执行路线、`C-01` 到 `C-08`、preview mode 边界和“不夹带统一实例新架构”曾被确认，但两次 target 漂移已使相关批准按规则失效。进入实际 merge 前剩余 gate：

- 重新确认 `C-01` / `C-02` / `C-07` 的新 target 补充边界。
- 确认 `C-09`：PreviewService / scene bootstrap / effect fallback / file route。
- 确认 `C-10`：dump circular-import fix 与 prefab/component 落盘回归。
- 确认 `C-11`：animation 60 Hz 实时同步、timer cleanup、self-save 后 exit/re-enter 与 AssetDB refresh suppression。
- 确认 `C-12`：DTS generator postprocess、完整 types contract 和 vendored import。
- 确认 `C-03` / `C-08` / `C-15`：PluginManager、platform package views、compile / release / pack 产物与 vendored ownership。
- 确认 `C-13`：scripting sorting plugin 与 adapter AssetDB 输出 / mounts / listener lifecycle。
- 确认 `C-04`：official engine.graphics owner / migration / modules normalization 与 adapter physics / 3.8.6 parity。
- 确认 `C-14`：Joint Texture Layout、graphics normalization 与 adapter EngineRuntimeMode / 3.8.6 settings 的联合 Engine merge。
- 审查并确认已刷新到 `TARGET=3b526b9d` 的 `docs/superpowers/plans/2026-07-10-adapter-to-386-official-merge.md`。
- 提交本轮刷新文档，确认 `ANALYZED_ADAPTER..START_ADAPTER` 只有 docs 变化。

## 后续复盘检查点

完成或中止实际 merge 后，复盘至少检查：

- 实际冲突是否与本报告预测一致。
- `startPreview()`、`startGamePreview()`、`startSceneEditorPreview()`、`startRuntimePreview()` 的最终语义是否清晰。
- `scene.scripting.middleware.ts` 是否保留官方 route architecture，且 adapter 产物路径未丢。
- `common-options-validator.ts` 是否出现双重 includeModules 真相源。
- hook runner 与 progress heartbeat 是否同时保留。
- dts snapshot 是否由生成流程更新。
- AssetDB sorting listeners 是否重复注册，且未覆盖 adapter records / mounts。
- game preview、runtime preview 和 build 是否使用同一 Joint Texture Layout resolver 结果。
- iOS / Google Play / Android / Web Mobile 是否同时具备平台 schema、迁移后的 builder path、view/host bundle 和发布包文件。
- atlas prefab 是否在真实 browser realm 中得到非零 texture 尺寸，且并发/circular load 无残留 promise。
- 是否需要回填 `docs/dev/architecture/official-sync-workflow.md`。
