# `feature-c` 真实项目 `web-mobile` CLI 构建事实 - 2026-06-16

本文记录使用真实项目 `D:\ps_copy\p6\trunk\Project\GameClient\feature-c` 和配置 `D:\ps_copy\p6\trunk\Project\GameClient\feature-c\build_configs\p6_buildConfig_web-mobile.json` 进行 CLI 打包时观察到的问题。记录目的是固定事实，后续继续排查时不要靠记忆或猜测推进。

## 输入配置

- `projectRoot`: `D:\ps_copy\p6\trunk\Project\GameClient\feature-c`
- `buildConfig`: `D:\ps_copy\p6\trunk\Project\GameClient\feature-c\build_configs\p6_buildConfig_web-mobile.json`
- `platform`: `web-mobile`
- `buildPath`: `project://build`
- 原配置 `outputName`: `web-mobile`
- 验证时使用独立 `outputName`，避免覆盖真实发布目录。
- 原配置关键字段：
  - `debug: false`
  - `skipCompressTexture: false`
  - `packAutoAtlas: true`
  - `mainBundleCompressionType: merge_dep`
  - `md5Cache: true`
  - `packages["build-ex"]` 包含 `buildVersion`、`hotupdate`、`sdkLogin`、`sdkEnv`、`sdkDebug`、`sdk_platform` 等业务字段。

## 项目工作区状态

构建前真实项目已有未提交改动：

```text
## feature-c
 M assets/scenes/start.scene
 M settings/v2/packages/engine.json
 M settings/v2/packages/information.json
?? build_configs/
```

本次验证不应把这些改动当作 CLI 构建产生的差异。

## Attempt 1: 默认 Node heap

命令：

```powershell
node .\dist\cli.js build --project "D:\ps_copy\p6\trunk\Project\GameClient\feature-c" --platform web-mobile --build-config "D:\ps_copy\p6\trunk\Project\GameClient\feature-c\build_configs\p6_buildConfig_web-mobile.json" --buildPath "project://build" --outputName "codex-p6-web-mobile-cli-check-20260616"
```

结果：

- 退出码：`34`
- 阶段：`Package scripts`
- 关键错误：

```text
FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory
worker has exited with code 134
```

- 输出目录：`D:\ps_copy\p6\trunk\Project\GameClient\feature-c\build\codex-p6-web-mobile-cli-check-20260616`
- 产物状态：目录存在但不完整，未生成 `index.html`，未生成 `build-ex-hook-report.json`。

当前判断：默认 Node heap 不足以完成该真实项目的脚本打包阶段。需要后续确认 Editor 命令行或项目发布脚本是否设置了更大的 heap；不能直接把本地手动 `NODE_OPTIONS` 当作 production 默认策略。

## Attempt 2: `NODE_OPTIONS=--max-old-space-size=12288`

命令同 Attempt 1，但设置：

```powershell
$env:NODE_OPTIONS="--max-old-space-size=12288"
```

输出目录：

```text
D:\ps_copy\p6\trunk\Project\GameClient\feature-c\build\codex-p6-web-mobile-cli-check-heap12g-20260616
```

结果：

- 运行超过 20 分钟后仍未完成，手工停止。
- 日志已越过默认 heap 下的 OOM，进入 `Build Assets` / `Pack Images` / texture compression。
- 日志出现 `execute compress task 0/24804, 12368...12408 in progress`。
- 至少出现一次 `Compress astc success`。
- stderr 多次出现：

```text
[Global] 未捕获的异常: the worker has exited
```

产物状态：目录存在但不完整，未生成 `index.html`，未生成 `build-ex-hook-report.json`。

当前判断：增大 Node heap 可以越过脚本打包 OOM，但构建继续暴露 texture compression / worker lifecycle 问题。

## Attempt 3: `NODE_OPTIONS=--max-old-space-size=12288` 后台长跑

输出目录：

```text
D:\ps_copy\p6\trunk\Project\GameClient\feature-c\build\codex-p6-web-mobile-cli-check-full-20260616
```

日志：

- stdout: `E:\own_space\engines\cocos-cli\.codex-tmp\p6-web-mobile-cli-check-full-20260616.stdout.log`
- stderr: `E:\own_space\engines\cocos-cli\.codex-tmp\p6-web-mobile-cli-check-full-20260616.stderr.log`

观察到的关键事实：

1. 真实项目 `extensions/build-ex` 被 CLI 加载并执行 hook，但多个 hook 报错：

```text
Hook function onBeforeBuild of build plugin build-ex execution failed
ReferenceError: Editor is not defined
Hook function onBeforeInit of build plugin build-ex execution failed
ReferenceError: Editor is not defined
Hook function onAfterInit of build plugin build-ex execution failed
ReferenceError: Editor is not defined
Hook function onBeforeBundleDataTask of build plugin build-ex execution failed
ReferenceError: Editor is not defined
Hook function onAfterBundleDataTask of build plugin build-ex execution failed
ReferenceError: Editor is not defined
Hook function onBeforeBuildAssets of build plugin build-ex execution failed
ReferenceError: Editor is not defined
Hook function onBeforeBundleBuildTask of build plugin build-ex execution failed
ReferenceError: Editor is not defined
```

这些错误在本次观察中未立即中断构建。它说明 CLI 的 project extension builder host 能发现并调用真实 `build-ex`，但真实业务 hook 仍依赖 Editor runtime API，不能认为业务逻辑已经在 CLI 中可用。

2. 脚本加载阶段出现一次 platform SDK 相关异常：

```text
pack:///chunks/06/069ff13128d2c5ffa0f3eed1e88947803648fe36.js ReferenceError: swan is not defined
...
at _cjsLoader.define.@tbmp/mp-cloud-sdk
```

该异常未在本次观察中直接中断构建。当前只能记录为事实，后续需要确认它是否来自业务 SDK 顶层副作用、目标平台条件分支或 CLI packer-driver 的执行环境差异。

3. `Package scripts` 阶段成功：

```text
Build project scripts in (162429 ms) √
Build engine scripts in (1364 ms) √
run build task Package scripts success in 3 min 5 s√
```

4. 之后进入 `Build Assets` / `Pack Images` / texture compression。

5. stderr 在 atlas / image pack 阶段持续出现 library JSON 读取失败，例如：

```text
Read json failed: "D:\ps_copy\p6\trunk\Project\GameClient\feature-c\library/b0/b086284d-296d-4a56-a316-0cc8cae22eda@f9941.json?_t=1781587003974"
ENOENT: no such file or directory
sprite frame can't be load:b086284d-296d-4a56-a316-0cc8cae22eda@f9941, will remove it from atlas.
```

注意：日志中的文件名包含 query string `?_t=...`。当前尚未确认这是正常的 engine-adapter URL 形态、CLI 传参问题，还是 image pack/AssetDB 读取路径未剥离 query 的问题。

6. texture compression 进度几乎不推进：

```text
execute compress task 0/24804, 12408 in progress
Compress astc success ...
execute compress task 1/24804, 12408 in progress
execute compress task 2/24804, 12408 in progress
```

同时 stderr 出现大量：

```text
[Global] 未捕获的异常: the worker has exited
```

7. 当时检查进程树，只有主 `node.exe`，未看到继续存活的压缩 worker 或 `astc` 子进程。主进程仍存活，CPU 时间缓慢增长。

8. 后续按用户要求结束该构建进程；复查没有残留匹配 `codex-p6-web-mobile-cli-check-full-20260616` 的 `node.exe`。

当前判断：

- 不能简单判断为“缺少压缩应用程序”，因为日志中已经出现过一次 `Compress astc success`。
- 更符合当前证据的假设是：texture compression worker 已退出或部分退出，主构建流程没有有效 fail fast，导致构建长时间停留在压缩阶段。
- 后续应先用只改变 `skipCompressTexture` 的临时配置验证能否越过该阶段，再回头定位 compression worker 退出原因。

## 后续临时配置

为隔离 texture compression 变量，已生成临时配置：

```text
E:\own_space\engines\cocos-cli\.codex-tmp\p6_buildConfig_web-mobile-debug-skiptex.json
```

与原配置相比，仅用于验证的关键变化：

- `debug: true`
- `skipCompressTexture: true`
- `outputName: codex-p6-web-mobile-cli-debug-skiptex-20260616`

`packages["build-ex"]` 业务字段保持原样。该配置位于本仓库 `.codex-tmp`，没有改写真实项目的 `build_configs`。

## Attempt 4: `debug=true` 且 `skipCompressTexture=true`

临时配置：

```text
E:\own_space\engines\cocos-cli\.codex-tmp\p6_buildConfig_web-mobile-debug-skiptex.json
```

输出目录：

```text
D:\ps_copy\p6\trunk\Project\GameClient\feature-c\build\codex-p6-web-mobile-cli-debug-skiptex-20260616
```

日志：

- stdout: `E:\own_space\engines\cocos-cli\.codex-tmp\p6-web-mobile-cli-debug-skiptex-20260616.stdout.log`
- stderr: `E:\own_space\engines\cocos-cli\.codex-tmp\p6-web-mobile-cli-debug-skiptex-20260616.stderr.log`

与原配置相比，只改变验证变量：

- `debug: true`
- `skipCompressTexture: true`
- `outputName: codex-p6-web-mobile-cli-debug-skiptex-20260616`
- `packages["build-ex"]` 业务字段保持原样。

观察到的关键事实：

1. 真实 `build-ex` hook 仍被调用，仍重复报 `ReferenceError: Editor is not defined`。这与 Attempt 3 一致。

2. `@tbmp/mp-cloud-sdk` 相关脚本加载异常仍出现：

```text
pack:///chunks/06/069ff13128d2c5ffa0f3eed1e88947803648fe36.js ReferenceError: swan is not defined
...
at _cjsLoader.define.@tbmp/mp-cloud-sdk
```

3. `Package scripts` 阶段成功，耗时比 release 配置更长：

```text
Build engine scripts in (53111 ms) √
run build task Package scripts success in 3 min 45 s√
```

4. 构建随后进入：

```text
Build Assets start
Build bundles...
Pack Images start
```

5. stderr 包含大量缺失资源 warning，例如：

```text
The SpriteFrame used by component "cc.Sprite" is missing.
Node path: "map_20000/BuildMap_/y1/y2"
Missing uuid: "56caed62-0fb6-4372-bc2c-ed46ce4311df@f9941"

The Prefab used by node "New Node" is missing.
Node path: "Res/bg/New Node"
Missing uuid: "5d8f9aee-ed1d-46d6-bdf1-7f6910857ec4"
```

6. 即使 `skipCompressTexture=true`，stderr 仍持续出现：

```text
[Global] 未捕获的异常: the worker has exited
```

7. 90 秒采样结果：

```text
Running: true
CpuBefore: 317.7
CpuAfter: 317.7
StdoutBefore: 23709
StdoutAfter: 23709
StderrBefore: 1985575
StderrAfter: 1985575
```

进程树中只有主 `node.exe` 和 `conhost.exe`，没有继续存活的构建 worker、压缩 worker 或 `astc` 子进程。

8. 产物目录状态：

```text
Exists: true
HasIndex: false
HasReport: false
FileCount: 2
```

9. 该构建按用户要求继续观察后，因无 CPU 和日志进展被手工结束；复查没有残留匹配 `codex-p6-web-mobile-cli-debug-skiptex-20260616` 的 `node.exe`。

当前判断：

- `skipCompressTexture=true` 能排除“最终 texture compression 应用缺失”作为唯一原因。
- 挂起点仍在 `Pack Images start` 之后，因此更接近 image pack / atlas / worker lifecycle 问题，而不是单纯 astc/pngquant 等压缩可执行文件缺失。
- 缺失 sprite frame / prefab warning、带 query string 的 library JSON 读取失败、worker exit 三类现象可能有关联，但目前还没有足够证据确认因果关系。
- 后续应优先缩小 `Pack Images` 输入或对 image pack worker 边界加诊断：记录每个 worker 的启动参数、退出码、最后处理的 asset uuid、传给 `engine-adapter` 的 library URL 是否包含 `?_t=`。

## Attempt 5: `debug=true`、`skipCompressTexture=true` 且 `packAutoAtlas=false`

临时配置：

```text
E:\own_space\engines\cocos-cli\.codex-tmp\p6_buildConfig_web-mobile-debug-noatlas-skiptex.json
```

输出目录：

```text
D:\ps_copy\p6\trunk\Project\GameClient\feature-c\build\codex-p6-web-mobile-cli-debug-noatlas-skiptex-20260616
```

日志：

- stdout: `E:\own_space\engines\cocos-cli\.codex-tmp\p6-web-mobile-cli-debug-noatlas-skiptex-20260616.stdout.log`
- stderr: `E:\own_space\engines\cocos-cli\.codex-tmp\p6-web-mobile-cli-debug-noatlas-skiptex-20260616.stderr.log`

与 Attempt 4 相比，只新增一个验证变量：

- `packAutoAtlas: false`

观察到的关键事实：

1. `Package scripts` 阶段成功：

```text
Build project scripts in (152293 ms) √
Build engine scripts in (369 ms) √
run build task Package scripts success in 2 min 55 s√
```

2. 构建随后仍进入：

```text
Build Assets start
Build bundles...
Pack Images start
```

3. 90 秒采样结果：

```text
Running: true
CpuBefore: 433.7
CpuAfter: 433.7
StdoutBefore: 13357
StdoutAfter: 13357
StderrBefore: 1983362
StderrAfter: 1983362
```

4. 该构建被手工结束；复查没有残留匹配 `codex-p6-web-mobile-cli-debug-noatlas-skiptex-20260616` 的 `node.exe`。

代码事实：

- `packAutoAtlas` 在 `src/api/builder/schema.ts`、`src/core/builder/@types/public/options.ts`、`src/core/builder/share/builder-config.ts` 中存在。
- `BundleManager.buildAsset()` 直接执行：

```typescript
await this.packImage();
await this.compressImage();
await this.outputAssets();
```

- `BundleManager.packImage()` 没有检查 `this.options.packAutoAtlas`。

当前判断：

- Attempt 5 不能证明“关闭自动图集后仍挂”，因为当前 CLI 没有真正按 `packAutoAtlas=false` 跳过 `packImage()`。
- 这是独立问题：构建配置声明的 `packAutoAtlas=false` 在当前 normal build 路径中不生效。
- 修复 `packAutoAtlas` gating 后，需重新执行 no-atlas + skip texture 构建，才能继续隔离真实 `Pack Images` 挂起根因。

## Attempt 6: 修复 `packAutoAtlas` gating 后重新执行 no-atlas + skip texture

代码变更：

- `BundleManager.buildAsset()` 仅在 `this.options.packAutoAtlas === false` 时跳过 `packImage()`；缺省值沿用默认自动图集行为。
- 新增单测覆盖 `packAutoAtlas=false` 跳过自动图集、`packAutoAtlas=true` 和字段缺省时仍执行自动图集。

验证命令：

```powershell
npx jest src/core/builder/test/pack-auto-atlas-option.spec.ts --runInBand --detectOpenHandles
npm run build
```

临时配置：

```text
E:\own_space\engines\cocos-cli\.codex-tmp\p6_buildConfig_web-mobile-debug-noatlas-skiptex.json
```

输出目录：

```text
D:\ps_copy\p6\trunk\Project\GameClient\feature-c\build\codex-p6-web-mobile-cli-debug-noatlas-skiptex-fixed-20260616
```

日志：

- stdout: `E:\own_space\engines\cocos-cli\.codex-tmp\p6-web-mobile-cli-debug-noatlas-skiptex-fixed-20260616.stdout.log`
- stderr: `E:\own_space\engines\cocos-cli\.codex-tmp\p6-web-mobile-cli-debug-noatlas-skiptex-fixed-20260616.stderr.log`

观察到的关键事实：

1. 构建未再出现 `Pack Images start`。`Build Assets` 阶段直接进入：

```text
Build Assets start
Build bundles...
Output asset in bundles start
```

2. `Package scripts` 成功：

```text
run build task Package scripts success in 2 min 31 s√
```

3. `Build Assets` 成功：

```text
Output asset in bundles success
Output asset in bundles success
run build task Build Assets success in 22 min 46 s√
```

4. 最终构建成功：

```text
Build completed successfully for web-mobile in 25 min 46 s
Build completed successfully! Build Dest: project://build/codex-p6-web-mobile-cli-debug-noatlas-skiptex-fixed-20260616
```

5. 产物状态：

```text
Exists: true
HasIndex: true
HasReport: false
FileCount: 36026
TotalMB: 1929.8
```

6. 平台 `web-mobile` public hook 仍能成功执行，例如：

```text
web-mobile:onAfterBuild completed ✓
```

但真实 `feature-c/extensions/build-ex` 中依赖 `Editor` global 的 hook 仍失败：

```text
Hook function onAfterBuild of build plugin build-ex execution failed
ReferenceError: Editor is not defined
```

因此这次“构建成功”不表示真实 `build-ex` 的 SDK、hotupdate、cfg merge、混淆、字体替换、资源删除或 `.meta` 改写等业务逻辑已在 CLI 中完成。

7. stderr 中仍有大量缺失资源 warning 和 `[Global] 未捕获的异常: the worker has exited`。这些错误没有阻止 no-atlas + skip texture 构建完成，但仍是需要单独诊断的异常信号。

当前判断：

- `packAutoAtlas=false` 的 CLI gating 已按配置生效，并通过单测和真实项目构建验证。
- Attempt 4/5 的挂起根因被进一步收敛到自动图集 `packImage()` 路径，而不是最终 texture compression 应用缺失。
- `build-ex` 业务 hook 仍未真实可用，问题属于 Editor runtime API 兼容/迁移范围，不能用空 mock 当作完成。

## Attempt 7: 对 Attempt 6 产物做浏览器运行烟测

产物目录：

```text
D:\ps_copy\p6\trunk\Project\GameClient\feature-c\build\codex-p6-web-mobile-cli-debug-noatlas-skiptex-fixed-20260616
```

启动方式：

```powershell
python -m http.server 17890 --bind 127.0.0.1 --directory "D:\ps_copy\p6\trunk\Project\GameClient\feature-c\build\codex-p6-web-mobile-cli-debug-noatlas-skiptex-fixed-20260616"
```

访问地址：

```text
http://127.0.0.1:17890/index.html
```

观察到的关键事实：

1. 页面能加载，标题为：

```text
Cocos Creator | Client
```

2. DOM 中存在 `GameCanvas`：

```text
id: GameCanvas
width: 1280
height: 720
clientWidth: 1280
clientHeight: 720
```

3. 静态服务器日志中，启动阶段采样到的本地产物请求均为 `200`，包括：

```text
/index.html
/src/settings.b58d8.json
/assets/main/config.a78d9.json
/assets/main/index.a78d9.js
/assets/resources/config.5fa89.json
/assets/resources/index.5fa89.js
/cocos-js/_virtual_cc-Cjt4rBEL.js
```

4. 浏览器 console 持续报业务运行时错误：

```text
TypeError: Cannot read properties of undefined (reading '0')
    at CCCameraCaptureHelper.init (http://127.0.0.1:17890/assets/main/index.a78d9.js:77925:45)
    at GameWorld.init (http://127.0.0.1:17890/assets/main/index.a78d9.js:202385:39)
    at InitMode.gd_update (http://127.0.0.1:17890/assets/main/index.a78d9.js:232926:25)
    at ModeManager.gmode_update (http://127.0.0.1:17890/assets/main/index.a78d9.js:256528:37)
    at GameWorld.on_update (http://127.0.0.1:17890/assets/main/index.a78d9.js:202431:29)
```

5. console 同时反复出现：

```text
【ta】track_once client_load_config
```

当前判断：

- 该产物“能被浏览器加载并创建 Cocos canvas”，但不能判断为“正常可运行”。
- 当前烟测失败点是业务脚本运行时异常，不是采样范围内的静态资源 404。
- 由于 Attempt 6 已确认真实 `build-ex` 业务 hook 仍因 `Editor is not defined` 未执行，不能排除该运行时异常与缺失的业务构建处理有关；但当前没有足够证据确认直接因果。

## Attempt 8: project extension `Editor` facade checkpoint

代码基线：

```text
6b467dc fix: lazy load Editor facade asset APIs
```

先执行：

```powershell
npm run build
```

结果：通过，`dist/cli.js` 已更新。

第一次真实构建命令沿用计划中的 `--output-name` 参数，CLI 立即失败：

```text
error: unknown option '--output-name'
(Did you mean --outputName?)
```

因此本次 checkpoint 改用当前 CLI 支持的 `--outputName`：

```powershell
$env:NODE_OPTIONS="--max-old-space-size=12288"
node .\dist\cli.js build --project D:\ps_copy\p6\trunk\Project\GameClient\feature-c --platform web-mobile --build-config D:\ps_copy\p6\trunk\Project\GameClient\feature-c\build_configs\p6_buildConfig_web-mobile.json --outputName codex-p6-web-mobile-cli-editor-facade-checkpoint-20260616 *> .codex-tmp\p6-web-mobile-editor-facade-checkpoint.stdout.log
```

结果：构建在 `build-ex:onBeforeBuild` fail fast，退出码非 0。关键日志：

```text
build-ex:onBeforeBuild starting...
[build-ex]  build-ex onBeforeBuild
[build-ex]  D:\ps_copy\p6\trunk\Project\GameClient\feature-c/assets/resources/cfg
Error: Unsupported Editor.Message request: asset-db.save-asset-meta
build-ex:(onError) start...
WARN  build-ex run onError
Error: Build plugin "build-ex" hook "onBeforeBuild" failed: Unsupported Editor.Message request: asset-db.save-asset-meta
```

观察到的关键事实：

1. 日志中未再出现 `ReferenceError: Editor is not defined` 或 `Editor is not defined`。
2. `build-ex` module 顶层和 `onBeforeBuild` 已能进入 `Editor.Project.path` 依赖路径之后的业务代码，日志打印到项目资源路径：

```text
D:\ps_copy\p6\trunk\Project\GameClient\feature-c/assets/resources/cfg
```

3. unsupported `Editor.Message` 没有被 no-op 或空 mock 掩盖，而是以 `Unsupported Editor.Message request: asset-db.save-asset-meta` 中断构建。
4. project extension hook failure 已触发现有 `onError` 流程，日志中出现 `build-ex run onError`。
5. 因构建在 4% 处中断，未生成本次 output 的 `index.html`，无法验证 `__REPLACE_GAME_BUILD_CFG__` 替换。

当前判断：

- extension host/fail-fast 方向正确：前置失败从 `Editor is not defined` 前移修复为明确缺失 `asset-db.save-asset-meta` 支持。
- 下一步应避免把真实 `feature-c` 作为高频构建循环。先读取真实 `feature-c/extensions/build-ex/source/hooks.ts` 中的 Editor 调用清单，在主测试项目临时副本中复现这些调用；真实 `feature-c` 仅作为低频 checkpoint。不能提前用空返回值模拟完整 Editor。

## Attempt 9: 主测试项目 fixture 复现 `build-ex` Editor 调用清单

用户指出真实项目 `feature-c` 构建耗时高，不应作为高频验证循环；应使用主测试项目，尽量还原 `feature-c` 真实 `build-ex` 对 Editor 的调用。按此调整验证策略后，读取真实 `feature-c/extensions/build-ex/source/hooks.ts`，确认本轮需要覆盖的 `Editor.Message` 调用包括：

```text
asset-db.query-asset-meta
asset-db.save-asset-meta
asset-db.query-uuid
asset-db.refresh-asset
asset-db.reimport-asset
asset-db.save-asset
asset-db.move-asset
asset-db.delete-asset
```

代码基线：

```text
ca9cc4c fix: ignore internal AssetDB timers in Editor facade
```

随后补齐受限 `Editor` facade 的 AssetDB message 支持，全部委托现有 `assetManager`：

- `query-asset-meta` -> `assetManager.queryAssetMeta()`
- `save-asset-meta` -> `assetManager.saveAssetMeta()`
- `query-uuid` -> `assetManager.queryUUID()`
- `refresh-asset` -> `assetManager.refreshAsset()`
- `reimport-asset` -> `assetManager.reimportAsset()`
- `save-asset` -> `assetManager.saveAsset()`
- `move-asset` -> `assetManager.moveAsset()`，并将 Editor 侧真实传入的 `override` option 映射为 CLI 内部的 `overwrite`
- `delete-asset` -> `assetManager.removeAsset(..., { useTrash: false })`

单测验证：

```powershell
npx jest src/core/extensions/test/editor-facade.spec.ts --runInBand
npx jest src/core/builder/test/run-error-hook.spec.ts src/core/builder/test/run-plugin-task-error.spec.ts src/core/builder/test/project-extension-builder-hooks.spec.ts --runInBand
npm run build
```

结果：

- `src/core/extensions/test/editor-facade.spec.ts` 19 条通过。
- hook/fatal/onError 相关 20 条通过。
- `npm run build` 通过，`dist/cli.js` 已更新。

fixture 验证方式：

- 从 `tests/fixtures/projects/asset-operation` 复制临时项目：

```text
E:\own_space\engines\cocos-cli\.codex-tmp\asset-operation-build-ex-facade
```

- 在临时项目注入最小 `extensions/build-ex`，只复现真实 `build-ex` 的 Editor 调用形态，不复制 SDK、hotupdate、cfg merge、混淆、字体替换、资源删除等业务逻辑。
- hook module 顶层读取 `Editor.Project.path`。
- `onBeforeBuild` 依次执行 `query-asset-meta`、`save-asset-meta`、`refresh-asset`、`query-uuid`、`save-asset`、`reimport-asset`、`move-asset`、`delete-asset`，其中 `move-asset` 使用真实 `build-ex` 调用形态 `{ override: true, rename: true }`；并用 `Editor.Message.send()` 覆盖 queued `reimport-asset` 与零延迟 timer 内 `refresh-asset`。
- 只修改临时项目中的 `assets/atlas.meta` 和 `assets/facade_tmp/*`。

构建命令：

```powershell
node .\dist\cli.js build --project .codex-tmp\asset-operation-build-ex-facade --platform web-mobile --build-config .codex-tmp\asset-operation-build-ex-facade\build-ex-facade-config.json --outputName codex-build-ex-facade-fixture *> .codex-tmp\asset-operation-build-ex-facade.stdout.log
```

结果：退出码 `0`，构建成功：

```text
build-ex:onBeforeBuild starting...
asset-change db://assets/atlas
asset-change db://assets/facade_tmp
asset-change db://assets/facade_tmp/source.txt
asset-change db://assets/facade_tmp/moved.txt
asset-delete db://assets/facade_tmp/delete.txt
asset-change db://assets/atlas/star.png
build-ex:onBeforeBuild completed in 732ms
Build completed successfully for web-mobile in 20 s
Build Dest: project://build/codex-build-ex-facade-fixture
```

验证结果：

1. 未出现：

```text
Unsupported Editor.Message
Editor is not defined
```

2. hook marker 存在，且 module load 与 hook execution 看到的 `Editor.Project.path` 一致：

```json
{
  "projectPathAtLoad": "E:\\own_space\\engines\\cocos-cli\\.codex-tmp\\asset-operation-build-ex-facade",
  "projectPathAtHook": "E:\\own_space\\engines\\cocos-cli\\.codex-tmp\\asset-operation-build-ex-facade",
  "platform": "web-mobile",
  "sourceUuid": "649f5d18-eef7-4a2d-b55f-63d38eecebf8"
}
```

3. `onError` marker 不存在，说明本次 fixture hook 没有走错误恢复路径。

4. 临时项目 `assets/atlas.meta` 被 `save-asset-meta` 写入：

```json
"userData": {
  "buildExFacadeFixture": "all-editor-asset-db-messages",
  "projectName": "asset-operation-build-ex-facade"
}
```

5. 临时项目 `assets/facade_tmp/source.txt` 经 `save-asset` 后被 `move-asset` 移动为 `moved.txt`，内容为：

```text
facade saved through save-asset
```

6. 临时项目 `assets/facade_tmp/delete.txt` 已被 `delete-asset` 删除。

当前判断：

- 受限 `Editor` facade 已能覆盖真实 `feature-c/build-ex` 本轮源码清单中出现的 AssetDB message，并且没有用空 mock、`true` 或 no-op 掩盖行为。
- 本轮高频验证应继续使用主测试项目临时 fixture。真实 `feature-c` 只在 fixture 覆盖完整调用清单后作为低频 checkpoint，用于确认是否还有未被源码清单覆盖的运行时调用或业务数据问题。

## Attempt 10: 真实 `feature-c` no-atlas + skip texture checkpoint 与运行烟测

代码基线：

```text
2e743de feat: support fact-based Editor asset-db messages
```

构建前已执行：

```powershell
npm run build
```

结果：通过，`dist/cli.js` 已更新。

真实项目仍使用临时 no-atlas + skip texture 配置，避免回到已知 `packAutoAtlas=true` 挂起路径：

```text
E:\own_space\engines\cocos-cli\.codex-tmp\p6_buildConfig_web-mobile-debug-noatlas-skiptex.json
```

第一次命令因 `rtk pwsh` 中 `$env:NODE_OPTIONS` 写法被错误展开，实际未给当前 `node` 设置 12GB heap，构建在 `Package scripts` 阶段 OOM：

```text
FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory
```

该次 OOM 发生在 `build-ex:onBeforeBuild` 已完成之后，真实 `build-ex` 已将 `assets/resources/cfg` 临时移动到 `assets/tmp_cfg`，失败后项目资源目录停留在中间态。随后用正确的 process env 写法重新构建时，因 `assets/resources/cfg` 缺失立即失败：

```text
Error: ENOENT: no such file or directory, scandir 'D:\ps_copy\p6\trunk\Project\GameClient\feature-c\assets\resources\cfg'
```

恢复 `assets/tmp_cfg` 到 `assets/resources/cfg` 及对应 `.meta` 后，使用正确 env 重新执行：

```powershell
[Environment]::SetEnvironmentVariable('NODE_OPTIONS','--max-old-space-size=12288','Process')
node .\dist\cli.js build --project D:\ps_copy\p6\trunk\Project\GameClient\feature-c --platform web-mobile --build-config .codex-tmp\p6_buildConfig_web-mobile-debug-noatlas-skiptex.json --outputName codex-p6-web-mobile-cli-editor-facade-final-heap12g-rerun-20260616 *> .codex-tmp\p6-web-mobile-editor-facade-final-heap12g-rerun.stdout.log
```

输出目录：

```text
D:\ps_copy\p6\trunk\Project\GameClient\feature-c\build\codex-p6-web-mobile-cli-editor-facade-final-heap12g-rerun-20260616
```

构建结果：退出码 `0`，最终成功：

```text
build-ex:onBeforeBuild starting...
build-ex:onBeforeBuild completed in 70865ms
...
web-mobile:onAfterBuild completed
build-ex:onAfterBuild starting...
build-ex:onAfterBuild completed in 81851ms
Build completed successfully for web-mobile in 12 min 16 s
Build Dest: project://build/codex-p6-web-mobile-cli-editor-facade-final-heap12g-rerun-20260616
```

本次真实构建观察到：

1. 未出现 `Unsupported Editor.Message`。
2. 未出现 `ReferenceError: Editor is not defined`。
3. `build-ex:onBeforeBuild` 和 `build-ex:onAfterBuild` 均执行完成。
4. 最终 `index.html` 存在。
5. 最终 `index.html` 未包含 `__REPLACE_GAME_BUILD_CFG__`；已写入 `__GAME_BUILD_CFG__`，采样字段包括 `buildVersion:"1.0"`、`gameDebug:true`、`sdkEnv:"sandbox"`、`packageId:"1"`。
6. `Build Assets` 成功期间仍出现 `[Global] 未捕获的异常: the worker has exited`，但本次 no-atlas + skip texture 构建未被该日志阻断。

浏览器运行烟测：

- 本地静态服务：`http://127.0.0.1:17892/index.html`
- 产物目录：`D:\ps_copy\p6\trunk\Project\GameClient\feature-c\build\codex-p6-web-mobile-cli-editor-facade-final-heap12g-rerun-20260616`
- Codex Browser webview attach 两次超时，改用本机 Playwright + Chrome headless 采样 15 秒。

运行观察：

1. 页面加载完成，标题为 `Cocos Creator | Client`。
2. `window.__GAME_BUILD_CFG__` 存在，关键字段为：

```json
{
  "buildVersion": "1.0",
  "gameDebug": true,
  "sdkEnv": "sandbox",
  "packageId": "1"
}
```

3. DOM 中存在 `GameCanvas`：

```text
id: GameCanvas
width: 1280
height: 720
clientWidth: 1280
clientHeight: 720
```

4. 采样范围内关键本地产物请求均为 `200`，包括 `index.html`、`settings.320c5.json`、`assets/main/config.a78d9.json`、`assets/resources/config.7dc7d.json`、`assets/resources/index.7dc7d.js`、`assets/main/index.a78d9.js` 和 `cocos-js` 资源。
5. 未出现旧产物中的 `__REPLACE_GAME_BUILD_CFG__ is not defined`。
6. 运行期仍有 console error：

```text
Can not find class 'cc.PhysicsMaterial'
TypeError: asset.addRef is not a function
    at ResourceManager.onLoad (http://127.0.0.1:17892/assets/main/index.a78d9.js:319720:21)
```

7. 还有非阻断性采样噪声：`favicon.ico` 404，以及 `cc._imgName`、`cc.render3D`、`AKNativeVideoPlayer`、`AKVideoPlayer` 相关 warning。
8. 15 秒采样中未再观察到 Attempt 7 的 `CCCameraCaptureHelper.init` 栈。

当前判断：

- 真实 `feature-c/build-ex` 在本轮 no-atlas + skip texture checkpoint 中已能通过受限 `Editor` facade 完成 `onBeforeBuild` 和 `onAfterBuild`，`__GAME_BUILD_CFG__` 注入也已完成；这验证了本轮 `asset-db` facade 对真实调用清单的覆盖。
- 该产物仍不能判断为“无运行时错误”：当前最新运行期错误是 `cc.PhysicsMaterial` class 缺失和 `ResourceManager.onLoad` 中 `asset.addRef is not a function`。
- 这些运行时错误发生在 `build-ex` 已完成且 `__GAME_BUILD_CFG__` 已注入之后，后续应按产物资源/engine module/runtime asset type 继续对比 Editor 或业务发布产物。
- 真实项目工作树存在构建副作用：`assets/resources/merged_cfg_0.json` 至 `assets/resources/merged_cfg_3.json` 从 `{}` 变为合并后的配置内容；`assets/product.meta`、`assets/tmp_cfg.meta` 内容 diff 为空但 `git status` 仍显示 modified。未用宽泛 git restore 自动回滚这些真实项目文件。

## 待跟踪问题

- 默认 Node heap 对真实项目脚本打包不足，需确认 Editor/业务发布链路的 heap 策略。
- 真实 `feature-c/extensions/build-ex` 已能在 no-atlas + skip texture checkpoint 中完成 `onBeforeBuild` 和 `onAfterBuild`；后续新增 Editor API 支持仍应先用主测试项目 fixture 复现真实调用，再低频运行真实 `feature-c`。
- `@tbmp/mp-cloud-sdk` 加载期间出现 `swan is not defined`，需确认是否会影响真实目标平台构建产物。
- image pack 阶段读取带 query string 的 library JSON 失败，并移除 sprite frame，需确认是否与 Editor 行为一致。
- 原始 `packAutoAtlas=true` 路径仍在 `Pack Images start` 后无进展，需定位 image pack / atlas / worker lifecycle、错误传播和 fail-fast 策略。
- `packAutoAtlas=false` gating 已修复并验证；后续继续排查自动图集问题时，应使用原始 `packAutoAtlas=true` 路径复现。
- 最新 no-atlas + skip texture 产物浏览器烟测能加载 canvas，`__GAME_BUILD_CFG__` 已注入，但仍报 `cc.PhysicsMaterial` class 缺失和 `asset.addRef is not a function`，需对比 Editor 产物或业务发布产物确认 engine module、资源输出和 runtime asset type 差异。
