# BUILD-ISSUE-026 第一批 NODEJS adapter 回迁事实

## 基线

- CLI worktree：`E:\own_space\engines\cocos-cli\.worktrees\rebase-adapter-to-386-origin-main-20260622`
- 3.8.6 engine：`D:\workspace\engines\cocos\3.8.6`
- 3.8.6 engine branch：`codex/nodejs-adapter-3.8.6`
- 3.8.6 engine base HEAD：`ad15bc7297be411556bea2de5e3d0c29eb108acd`
- cocos4 reference：`E:\own_space\engines\cocos4`
- cocos4 reference HEAD：`e2795f9ecde92621e5475fbd172ad7fc49ac6b05`

验证前确认：

- `packages\engine` 是 junction，目标为 `D:\workspace\engines\cocos\3.8.6`。
- `COCOS_CLI_TEST_ENGINE_ROOT` 未指向非目标 engine。
- engine repo 既有无关 dirty 仍为 `editor/assets/primitives.fbx.meta` 和 `.codegraph/`，本轮未处理。

## 最新 cocos4 初筛结论

`cocos4@e2795f9ecd` 相比旧 handoff 使用的 `cocos4@821928733b` 后，`NODEJS` 文本差异集合新增了：

```text
cocos/asset/assets/texture-cube.ts
cocos/asset/assets/texture-cube.jsb.ts
cocos/game/game.ts
platforms/nodejs/engine/asset-manager.js
platforms/nodejs/engine/fs-utils.js
```

第一批范围没有因此扩大：

- `texture-cube.ts` / `texture-cube.jsb.ts` 只是 `EDITOR || NODEJS || TEST` 与 `EDITOR || TEST || NODEJS` 顺序差异，语义等价。
- `game.ts` 只是 import 顺序差异，关键判断逻辑一致。
- `platforms/nodejs/engine/*` 是 cocos4 新增目录，3.8.6 没有同路径目录；不能当作同路径 `NODEJS` 分支缺失混入第一批。

仍保留为第三批或低优先级候选：

```text
cocos/animation/exotic-animation/exotic-animation.ts
cocos/asset/assets/asset.ts
cocos/core/settings.ts
cocos/particle/animator/curve-range.ts
cocos/video/video-player.ts
pal/system-info/enum-type/platform.ts
```

`core/data/*` 与 `scene-graph/*` 仍属于第二批，涉及 `_id`、`_objFlags`、editor extras、component lifecycle 和 prefab/editor registry，不能与 serialize / deserialize 第一批混改。

`editor-path-replace.ts` 在 3.8.6 已有本地 `NODEJS` 回迁实现，与最新 cocos4 是策略漂移，不是简单缺 `NODEJS` 分支；除非出现 `AssetDB.queryAsset`、extname 或 `cclegacy.assetManager.generalImportBase` 相关失败，否则不进入第一批。

## 本轮 engine patch

修改文件：

```text
D:\workspace\engines\cocos\3.8.6\cocos\2d\assets\sprite-atlas.ts
D:\workspace\engines\cocos\3.8.6\cocos\2d\assets\sprite-frame.ts
D:\workspace\engines\cocos\3.8.6\cocos\asset\assets\image-asset.ts
D:\workspace\engines\cocos\3.8.6\cocos\serialization\deserialize.ts
D:\workspace\engines\cocos\3.8.6\cocos\serialization\deserialize-dynamic.ts
```

变更摘要：

- `sprite-atlas.ts`：导入 `NODEJS`，`_serialize()` 条件扩展为 `EDITOR || NODEJS || TEST`。
- `sprite-frame.ts`：`_serialize()` 保持上一轮修复；constructor 和 `_deserialize()` 中 `_atlasUuid` 处理扩展为 `EDITOR || NODEJS`。
- `image-asset.ts`：constructor 中 `_exportedExts = null` 扩展为 `EDITOR || NODEJS`。
- `deserialize.ts`：`deserialize._macros` 外层条件扩展为 `EDITOR || TEST || NODEJS`。
- `deserialize-dynamic.ts`：导入 `NODEJS`，并把 `ignoreEditorOnly`、root owner tracking、Component create path、field owner/propName 恢复路径扩展到 `NODEJS`。

主会话 review：

- `git diff --check` 通过。
- diff 只包含目标 5 个 engine 文件，共 13 行增删。
- 未 stage、未 commit。

## 验证

### engine compiler

命令：

```powershell
rtk pwsh -NoProfile -Command 'Set-Location "E:\own_space\engines\cocos-cli\.worktrees\rebase-adapter-to-386-origin-main-20260622"; rtk npm run compiler:engine'
```

结果：

- 退出码：`0`
- 结果：通过。
- 备注：仍有既有 `Rollup warning 'THIS_IS_UNDEFINED'`、`Unknown flag: USE_SORTING_2D` 和 Browserslist 过期提示。

### 主测试项目 build

先清理目标 builder cache：

```powershell
Remove-Item -LiteralPath "E:\own_space\engines\cocos-test-projects\temp\builder\asset-db" -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath "E:\own_space\engines\cocos-test-projects\temp\builder\assets-mtime.json" -Force -ErrorAction SilentlyContinue
```

build 命令：

```powershell
rtk node .\dist\cli.js build --project "E:\own_space\engines\cocos-test-projects" --platform web-mobile --build-config "E:\own_space\engines\cocos-test-projects\buildConfig_web-mobile.json" --buildPath "E:\own_space\engines\cocos-test-projects\temp\cli-build-smoke" --outputName "build-issue-026-first-batch-20260624"
```

结果：

- 退出码：`0`
- 产物：`E:\own_space\engines\cocos-test-projects\temp\cli-build-smoke\build-issue-026-first-batch-20260624`
- 日志：`Build completed successfully for web-mobile in 2 min 35 s`
- 备注：仍有已知 `@tbmp/mp-cloud-sdk` bare specifier fallback、Browserslist、rollup TypeScript warning 类输出；build 仍成功。

### 产物扫描

命令：

```powershell
rtk rg "\[\[null\],\[[0-9]+\]" assets/main/import
```

结果：

- `assets/main/import` 无 `[[null],[type]]` 命中。

### run 验证

首次直接执行：

```powershell
rtk node .\dist\cli.js run --platform web-mobile --dest "E:\own_space\engines\cocos-test-projects\temp\cli-build-smoke\build-issue-026-first-batch-20260624"
```

该命令 10 分钟未退出。源码复核显示 web 平台 `run` 会 `startServer()` 并保持 server 事件循环，因此不能把“不自然退出”直接判定为失败。

随后用后台进程执行同一 `run`：

- stdout 记录 server 启动在 `http://localhost:9528`。
- `web-mobile:run completed in 449ms`。
- `[task:run]: success!`
- 返回 JSON：`{"code":0,"dest":"","custom":{"previewUrl":"http://localhost:9528/build/web-mobile/build-issue-026-first-batch-20260624/index.html"}}`
- 浏览器侧捕获到普通日志：`[Browser LOG] [Spine] getSpineMemoryInfo 已注册`
- 扫描 run stdout/stderr 与最近 builder logs，未出现：
  - `Cannot read properties of null`
  - `Browser ERROR`
  - `SpriteFrame._deserialize`
  - `reading 'rect'`

限制：

- in-app Browser 直接导航同一 localhost URL 时页面显示 `This page crashed`，且 Browser Use 安全策略拒绝继续读取该页日志。本轮未绕过该限制改用其它浏览器控制通道。
- 因此本轮 run 验证依据是 CLI run stage 返回 `code:0`、server URL 可 HTTP 访问、CLI 捕获的 browser log，以及日志固定字符串扫描未出现目标错误。

## 当前结论

第一批 serialize / deserialize 直接相关 `NODEJS` adapter 回迁已经完成并通过本轮验证：

- engine compiler 通过。
- 主测试项目 `web-mobile` build 通过。
- 产物不再出现 `[[null],[type]]`。
- run stage 成功，日志未出现 `SpriteFrame._deserialize` / `Cannot read properties of null` / `Browser ERROR` 目标错误。

但 BUILD-ISSUE-026 不能整体关闭：

- 第二批 `core/data/*` 与 `scene-graph/*` 尚未逐项验证。
- 第三批低优先级候选尚未逐项验证。
- `editor-path-replace.ts` 与最新 cocos4 策略漂移尚未用具体失败驱动处理。
