# 构建适配会话复盘 - 2026-06-16

本文记录会话 `019ecf6b-204a-7aa2-96ce-c1d991560cdb`（线程名：理解并评审执行计划）中，围绕 project extension builder hook、`Editor` facade、真实 `feature-c` 构建和浏览器运行烟测得到的进度、事实、问题和经验。逐次构建证据见 [feature-c-web-mobile-cli-build-20260616.md](feature-c-web-mobile-cli-build-20260616.md)，问题状态以 [../issues.md](../issues.md) 为准。

## 范围

本轮工作的目标不是把 `feature-c/extensions/build-ex` 的 SDK、hotupdate、cfg merge、混淆、字体替换、资源删除或 `.meta` 改写逻辑复制进 CLI。CLI 侧只负责提供 Editor-like project extension host：

- 扫描并加载项目级 `extensions/*/package.json` 的 `contributions.builder`。
- 为 project extension hook 安装受限 `Editor` facade。
- 把 project extension hook failure 标记为 fatal，避免“hook 失败但构建成功”的假阳性产物。
- `Editor.Message` 只支持已由真实源码或日志确认的调用，并委托现有 CLI AssetDB API；未知 API 必须显式失败。

## 构建适配进度

已完成：

- `BUILD-ISSUE-014`：project extension builder hook 已接入 normal build。CLI 可发现并执行项目 extension 的 builder hook，project extension hook metadata 标记为 `source: "project-extension"`、`fatal: true`、`editorFacade: true`。
- `BUILD-ISSUE-016`：受限 `Editor` facade 已覆盖真实 `feature-c/build-ex` 本轮调用清单：`asset-db.query-asset-meta`、`save-asset-meta`、`query-uuid`、`refresh-asset`、`reimport-asset`、`save-asset`、`move-asset`、`delete-asset`。`move-asset` 兼容 Editor 侧 `override` 并映射到 CLI 内部 `overwrite`。
- 高频验证已从真实 `feature-c` 切换到主测试项目临时 fixture。fixture 复现真实 `build-ex` 的 Editor 调用形态，构建成功并验证 `Editor.Project.path`、meta 写入、save/move/delete asset 操作确实生效。
- 真实 `feature-c` no-atlas + skip texture checkpoint 已成功执行 `build-ex:onBeforeBuild` 和 `build-ex:onAfterBuild`，未再出现 `Editor is not defined` 或 `Unsupported Editor.Message`，`index.html` 中 `__REPLACE_GAME_BUILD_CFG__` 已被替换为 `__GAME_BUILD_CFG__`。
- `BUILD-ISSUE-018`：`packAutoAtlas=false` gating 已修复。当前只有 `packAutoAtlas === false` 时跳过 `packImage()`；字段缺省和 `true` 保持自动图集路径。
- `BUILD-ISSUE-019`：无 3D physics backend 时输出 `db:/internal/physics/default-physics-material` 的问题已修复。实现已改为读取 engine `cc.config.json`，按 `includeModules` 的 feature graph 递归判断 `dependentAssets`，不再写死 backend feature 名称。

仍未完成或仍需跟踪：

- `BUILD-ISSUE-015`：真实 `feature-c` 默认 Node heap 在 `Package scripts` 阶段 OOM。12GB heap 可越过该阶段，但 production 默认策略仍需确认 Editor 或业务发布链路是否设置 heap。
- `BUILD-ISSUE-017`：真实 `feature-c` 原始 `packAutoAtlas=true` 路径仍在 `Pack Images start` 后出现 worker exit 和长时间无进展。当前证据把范围收敛到 image pack / atlas / worker lifecycle，不是单纯 texture compression 可执行程序缺失。
- `BUILD-ISSUE-020`：真实打包机用 CocosCreator `--build "configPath=...;debug=$DEBUG;sourceMaps=true;packages=$PACKAGES;..."` 在同一份平台 config 上覆盖 debug/release 参数；当前 cocos-cli 没有 Creator-compatible `--build` 分号参数入口，也未完整暴露 `debug`、`sourceMaps`、`packages` 覆盖。
- `@tbmp/mp-cloud-sdk` / `swan is not defined`、循环依赖、`cc property undefined type` 等日志仍是非目标风险，不能因为当前 web-mobile checkpoint 通过就判定业务运行完全无风险。
- runtime preview 的 internal asset 查询策略与 normal build feature graph 策略不同。当前修复只针对 normal build 产物一致性；若后续 runtime preview 暴露同类问题，需要另行基于其入口事实判断。

## 关键问题与事实

### 默认 heap 不足

真实 `feature-c` 默认 Node heap 在 `Package scripts` 失败，退出码 `34`，日志包含 `Reached heap limit Allocation failed - JavaScript heap out of memory`。设置 `NODE_OPTIONS=--max-old-space-size=12288` 后可越过脚本打包。该事实只能说明本地验证需要更大 heap，不能直接推出 CLI 应默认修改 production heap。

### `packAutoAtlas=false` 曾未生效

早期临时配置设置 `packAutoAtlas=false` 后仍进入 `Pack Images start`，原因是 `BundleManager.buildAsset()` 无条件执行 `packImage()`。修复 gating 后，真实 `feature-c` no-atlas + skip texture 构建未再进入 `Pack Images start`，并成功生成 `index.html`。因此后续自动图集挂起必须回到 `packAutoAtlas=true` 路径复现。

### 自动图集和纹理压缩状态

自动图集完整路径尚未通过真实 `feature-c` 构建验证。已有事实是：原始 `packAutoAtlas=true`、`skipCompressTexture=false` 的 release-like 配置在 `Pack Images start` 后 worker 退出并长时间无进展；`debug=true`、`skipCompressTexture=true` 仍停在 `Pack Images start`。这说明当前 blocker 更接近自动图集 `packImage()` / worker lifecycle，而不是最终 texture compression 可执行程序缺失。

纹理压缩本身也不能判断为已通过：release-like 路径曾出现 `Compress astc success`，但随后停在 `execute compress task 2/24804` 附近；no-atlas + skip texture 成功构建刻意绕开了自动图集和最终纹理压缩，不能作为自动图集或纹理压缩通过的证据。

### 真实打包机参数覆盖方式

`D:\ps_copy\p6\tools\Packer\BuildWebMobileJenkins.sh`、`BuildWebMobileJenkins_QuickGame.sh` 和 `BuildWebMobileWithoutUploadJenkins.sh` 使用 CocosCreator `--build` 分号参数字符串。关键字段包括 `configPath=$WORKSPACE/Configs/$COCOS_BUILD_CONFIG`、`debug=$DEBUG`、`sourceMaps=true`、`outputName=$TAG-$PLATFORM-$ENV-build`、`buildPath=$WORKSPACE/build`、`packages=$PACKAGES`。因此真实打包机可以用同一份 `web-mobile` config 通过外部变量打 debug/release。

该行为有官方依据：Cocos Creator 3.8 [命令行发布项目](https://docs.cocos.com/creator/3.8/manual/zh/editor/publish/publish-in-command-line.html) / [Publish from the Command Line](https://docs.cocos.com/creator/3.8/manual/en/editor/publish/publish-in-command-line.html) 文档说明 `--build` 指定构建参数、额外参数会覆盖默认参数，并列出 `configPath`、`outputName`、`buildPath`、`debug`、`packages` 等参数；[构建发布面板详解](https://docs.cocos.com/creator/3.8/manual/zh/editor/publish/build-panel.html) / [About the Build Panel](https://docs.cocos.com/creator/3.8/manual/en/editor/publish/build-panel.html) 说明 Build panel Export 的 JSON 在命令行里通过 `configPath` 使用；[构建选项介绍](https://docs.cocos.com/creator/3.8/manual/zh/editor/publish/build-options.html) / [General Build Options](https://docs.cocos.com/creator/3.8/manual/en/editor/publish/build-options.html) 记录了 `Source Maps` 和 `skipCompressTexture` 等通用构建选项。

当前 cocos-cli 只支持 `--build-config`，并额外暴露 `--buildPath`、`--outputName`、SDK/NDK 覆盖；没有 Creator-compatible `--build "k=v;..."` 入口。若后续要对齐真实打包机工作流，需要单独设计参数覆盖兼容，而不是把某次临时 JSON 改写当作等价行为。

### `Editor` facade 必须 fail fast

真实 `build-ex` 初始失败点从 `Editor is not defined` 变成 `Unsupported Editor.Message request: asset-db.save-asset-meta`。这是正确的中间状态：CLI 不应返回空对象、`true` 或 no-op 来让构建假成功。每新增一个支持的 `Editor.Message`，都必须先有真实调用事实，并委托现有 CLI API。

### 真实项目构建会修改源项目

真实 `feature-c/build-ex` 会移动 `assets/resources/cfg`、生成 merged cfg，并写入业务资源。一次 OOM 发生在 `onBeforeBuild` 完成之后，导致项目停留在 `assets/tmp_cfg` 中间态，后续构建因 `assets/resources/cfg` 缺失失败。真实项目不能作为高频循环，也不能在未获授权时用 broad `git restore` 或清理命令回滚。

### `cc.PhysicsMaterial` 不是业务源资源问题

浏览器运行时报 `Can not find class 'cc.PhysicsMaterial'` 和 `asset.addRef is not a function` 时，初始假设若指向业务 ResourceManager 或源资源，会偏离事实。按 uuid 追踪后确认坏资源来自 internal builtin：

```text
db:/internal/physics/default-physics-material
uuid: ba21476f-2866-4f81-9c4d-6e359316e448
```

旧产物输出了 `settings.physics.defaultMaterial`、`engine.builtinAssets` 和 `assets/internal/config` 映射，但 `cocos-js` 没有 `PhysicsMaterial` class，运行时将该资源反序列化成普通 `Object`，没有 `addRef()`。最终修复点应在 build 输出一致性，而不是业务 `ResourceManager` guard 或 runtime dummy class。

### dependent asset 处理要跟随 builder 架构

normal build 已经通过 engine `cc.config.json` 的 feature graph 处理模块依赖资源：

- `queryPreloadAssetList(includeModules, enginePath)` 递归遍历 `dependentAssets`、`dependentScripts`、`dependentModules`。
- internal bundle root assets 写入 `settings.engine.builtinAssets`。

`physicsConfig.defaultMaterial` 之前是独立 project setting root asset，绕开了这套 feature graph，导致无 3D physics backend 时仍输出默认 3D physics material。修复应复用 feature graph 判断该 uuid 是否由当前 `includeModules` 声明，而不是写死 `physics-cannon`、`physics-ammo`、`physics-builtin`、`physics-physx`。

## 验证证据索引

本轮关键验证包括：

```powershell
rtk proxy npx jest src/core/extensions/test/editor-facade.spec.ts --runInBand
rtk proxy npx jest src/core/builder/test/run-error-hook.spec.ts src/core/builder/test/run-plugin-task-error.spec.ts src/core/builder/test/project-extension-builder-hooks.spec.ts --runInBand
rtk proxy npx jest src/core/builder/test/pack-auto-atlas-option.spec.ts --runInBand
rtk proxy npx jest src/core/builder/test/physics-default-material.spec.ts --runInBand
rtk proxy npx jest src/core/builder/test/check-options.spec.ts src/core/builder/test/pack-auto-atlas-option.spec.ts --runInBand
rtk npm run build
```

真实 `feature-c` 最新 no-atlas + skip texture checkpoint：

- 输出目录：`D:\ps_copy\p6\trunk\Project\GameClient\feature-c\build\codex-p6-web-mobile-cli-editor-facade-physicsfix-20260616`
- 构建结果：`Build completed successfully for web-mobile in 8 min 49 s`
- 浏览器地址：`http://127.0.0.1:17896/index.html`
- CDP 主上下文采样：`cc.assetManager.assets.count=108`、`bad=[]`、`addRefError=null`
- 按该端口过滤的 console 未再出现 `Can not find class 'cc.PhysicsMaterial'`、`asset.addRef` 或目标 `TypeError`

主测试项目 feature graph 复验：

- 输出目录：`E:\own_space\engines\cocos-test-projects\build\codex-physics-material-repro-featuregraph-20260616`
- 构建结果：`Build completed successfully for web-mobile in 30 s`
- 产物中搜索 `ba21476f-2866-4f81-9c4d-6e359316e448`、`default-physics-material`、`PhysicsMaterial` 均无命中
- `src/settings.json` 中 `physics.physicsEngine` 为 `""`，无 `defaultMaterial`

## 经验和教训

- 先定位最早失败点。`__REPLACE_GAME_BUILD_CFG__`、`cc.PhysicsMaterial`、`asset.addRef`、业务脚本错误不能混在一起处理；前置 hook failure 消除后，才重新采样浏览器最早错误。
- 高频循环用主测试项目或临时 fixture，真实 `feature-c` 只做低频 checkpoint。真实项目构建耗时 8-25 分钟，且 build-ex 会修改源资产。
- 执行真实 `node .\dist\cli.js build` 前必须先 `npm run build`，否则容易用旧 `dist` 验证新源码。
- CLI 当前 build 选项是 `--outputName`，不是 `--output-name`。
- 在 `rtk pwsh` 命令中设置 env 时，直接写 `$env:NODE_OPTIONS=...` 容易被外层解析影响；可靠写法是 `[Environment]::SetEnvironmentVariable('NODE_OPTIONS','--max-old-space-size=12288','Process')`。
- Runtime asset type mismatch 要沿 uuid 查：源资产、产物 config/settings、internal bundle、engine includeModules、运行时 asset cache。不能只凭业务栈顶改业务代码。
- 不确定时不应迎合“先让它过”的方向。尤其是 `Editor.Message` 和 internal builtin asset，空 mock、dummy class、`addRef` guard 都会隐藏更深的不一致。
- Jest 中 `@cocos/ccbuild` / Rollup 相关 `CustomGC` open handle 是已观察到的噪声；只要 exit code 为 0，不应把它当作本轮失败。
- Playwright evaluate 有时在 isolated world 读不到 `window.cc`；需要检查运行时 Cocos 全局时，CDP `Runtime.evaluate` 主上下文更可靠。

## 后续建议

- 继续排查 `BUILD-ISSUE-017`，优先给 image pack / atlas worker 边界加诊断：worker 启动参数、退出码、最后处理 asset uuid、带 `?_t=` 的 library URL 是否被当作 filesystem path。
- 对 `BUILD-ISSUE-015` 补事实：确认 Editor CLI、业务发布脚本或 CI 是否设置 Node heap，再决定 CLI 是否需要诊断提示、文档化参数或子进程 heap 策略。
- 对 `BUILD-ISSUE-020` 补设计：决定支持 Creator-compatible `--build` string，还是显式增加 `--debug`、`--sourceMaps`、`--packages` 等覆盖参数；无论哪种都需要测试同一 config 的 debug/release 覆盖语义。
- 保持 `Editor` facade 的事实门槛：只有真实源码或可复现 fixture 证明需要某个 API，才新增支持；unsupported 继续 fail fast。
- 后续新增 runtime error 时，不复用 `BUILD-ISSUE-019`；按新的 console 栈、失败资源 uuid 和产物映射重新登记。
