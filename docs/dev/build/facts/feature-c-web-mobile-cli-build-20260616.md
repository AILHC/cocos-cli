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

## 待跟踪问题

- 默认 Node heap 对真实项目脚本打包不足，需确认 Editor/业务发布链路的 heap 策略。
- 真实 `feature-c/extensions/build-ex` 依赖 `Editor` global，当前 CLI extension host 只能调用 hook，不能执行这些 Editor runtime 业务逻辑。
- `@tbmp/mp-cloud-sdk` 加载期间出现 `swan is not defined`，需确认是否会影响真实目标平台构建产物。
- image pack 阶段读取带 query string 的 library JSON 失败，并移除 sprite frame，需确认是否与 Editor 行为一致。
- 原始 `packAutoAtlas=true` 路径仍在 `Pack Images start` 后无进展，需定位 image pack / atlas / worker lifecycle、错误传播和 fail-fast 策略。
- `packAutoAtlas=false` gating 已修复并验证；后续继续排查自动图集问题时，应使用原始 `packAutoAtlas=true` 路径复现。
