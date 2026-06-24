# BUILD-ISSUE-026 第二批与第三批 NODEJS adapter 回迁事实

## 基线

- CLI worktree：`E:\own_space\engines\cocos-cli\.worktrees\rebase-adapter-to-386-origin-main-20260622`
- 3.8.6 engine：`D:\workspace\engines\cocos\3.8.6`
- 3.8.6 engine branch：`codex/nodejs-adapter-3.8.6`
- cocos4 reference：`E:\own_space\engines\cocos4`
- cocos4 reference HEAD：`e2795f9ecde92621e5475fbd172ad7fc49ac6b05`
- 本轮前置 engine commit：
  - `144e8cacfb`：第一批 serialize / deserialize 分支补齐。
  - `36d472c365`：`.gitignore` 忽略 `.codegraph/`。
- 本轮第二批/第三批 engine commit：`16089a1b6e61a83fedd8c2ece921edf6efaf8523`

验证前确认：

- `packages\engine` 是 junction，目标为 `D:\workspace\engines\cocos\3.8.6`。
- engine repo 既有无关 dirty 仍为 `editor/assets/primitives.fbx.meta`，本轮未 stage、未 commit。

## 本轮 engine patch

修改文件：

```text
D:\workspace\engines\cocos\3.8.6\cocos\core\data\class.ts
D:\workspace\engines\cocos\3.8.6\cocos\core\data\object.ts
D:\workspace\engines\cocos\3.8.6\cocos\scene-graph\component-scheduler.ts
D:\workspace\engines\cocos\3.8.6\cocos\scene-graph\component.ts
D:\workspace\engines\cocos\3.8.6\cocos\scene-graph\node-activator.ts
D:\workspace\engines\cocos\3.8.6\cocos\scene-graph\node-dev.ts
D:\workspace\engines\cocos\3.8.6\cocos\scene-graph\node.ts
D:\workspace\engines\cocos\3.8.6\cocos\scene-graph\scene.ts
D:\workspace\engines\cocos\3.8.6\cocos\animation\exotic-animation\exotic-animation.ts
D:\workspace\engines\cocos\3.8.6\cocos\asset\assets\asset.ts
D:\workspace\engines\cocos\3.8.6\cocos\core\settings.ts
D:\workspace\engines\cocos\3.8.6\cocos\particle\animator\curve-range.ts
D:\workspace\engines\cocos\3.8.6\cocos\video\video-player.ts
D:\workspace\engines\cocos\3.8.6\pal\system-info\enum-type\platform.ts
```

变更摘要：

- 第二批 `core/data/*`、`scene-graph/*`：按最新 cocos4 对应实现，将 editor extras、component injected static props、`_checkMultipleComp`、Node / Component registry、scene activate、Node destroy detach、`NodeActivator` try-catch lifecycle 分支扩展到 `NODEJS`。
- `node-activator.ts`：`NODEJS` 下通过 `!NODEJS && Editor.Selection.getLastSelected(...)` 避免访问 `Editor.Selection`。
- `class.ts`：`define()` 中 RenderPipeline / RenderFlow / RenderStage 的 editor registration 分支扩展到 `NODEJS`，并按 cocos4 增加 `window.EditorExtends` guard。
- 第三批低优先级候选：补齐 `ExoticAnimation.split()`、`Asset.isDefault`、`Settings` 本地 JSON 读取、`CurveRange` editor curves、`VideoPlayer.__preload()` 和 `Platform.NODEJS_PAGE`。

未处理项：

- `editor-path-replace.ts` 仍保持 3.8.6 现有本地回迁策略。它与最新 cocos4 是策略漂移，不是同路径简单 `NODEJS` 分支缺失；本轮验证未出现 `AssetDB.queryAsset`、extname 或 `cclegacy.assetManager.generalImportBase` 相关失败。
- `platforms/nodejs/engine/*` 是 cocos4 新目录，3.8.6 没有同路径目录，本轮未迁移。

## Review

主会话 review：

- `git diff --check` 通过。
- staged 内容只包含上述 14 个目标文件。
- `editor/assets/primitives.fbx.meta` 保持 unstaged。

子代理 `Epicurus` review 结论：

- 建议提交。
- 阻塞问题：无。
- 非阻塞测试缺口：
  - `NODEJS` 路径依赖 `EditorExtends` / `_registerIfAttached` 注入，当前 smoke build/run 覆盖基本链路，但缺专门 adapter 注入契约测试。
  - `node-activator.ts` 的 `!NODEJS && Editor.Selection...` 保护建议后续补带 `internalOnLoad` component 的 adapter 级测试。
  - `video-player.ts`、`settings.ts` 目前只被真实项目构建间接覆盖，后续可补最小 fixture。

## 验证

### engine compiler

命令：

```powershell
rtk npm run compiler:engine
```

工作目录：

```text
E:\own_space\engines\cocos-cli\.worktrees\rebase-adapter-to-386-origin-main-20260622
```

结果：

- 退出码：`0`
- 结果：通过。
- 备注：仍有既有 `Rollup warning 'THIS_IS_UNDEFINED'`、`Unknown flag: USE_SORTING_2D` 和 Browserslist 过期提示。

### 主测试项目 build

先确认目标 builder cache 不存在：

```text
E:\own_space\engines\cocos-test-projects\temp\builder\asset-db
E:\own_space\engines\cocos-test-projects\temp\builder\assets-mtime.json
```

build 命令：

```powershell
rtk node .\dist\cli.js build --project "E:\own_space\engines\cocos-test-projects" --platform web-mobile --build-config "E:\own_space\engines\cocos-test-projects\buildConfig_web-mobile.json" --buildPath "E:\own_space\engines\cocos-test-projects\temp\cli-build-smoke" --outputName "build-issue-026-second-third-20260624"
```

结果：

- 退出码：`0`
- 产物：`E:\own_space\engines\cocos-test-projects\temp\cli-build-smoke\build-issue-026-second-third-20260624`
- 日志：`Build completed successfully for web-mobile in 1 min 55 s`
- 备注：仍有已知 `@tbmp/mp-cloud-sdk` bare specifier fallback、Browserslist、rollup TypeScript warning 类输出；build 仍成功。

### 产物扫描

命令：

```powershell
rtk rg --fixed-strings "[[null],[" "E:\own_space\engines\cocos-test-projects\temp\cli-build-smoke\build-issue-026-second-third-20260624\assets\main\import"
```

结果：

- `assets/main/import` 共 12 个文件。
- 无 `[[null],[` 命中。

### run 验证

后台执行：

```powershell
rtk node .\dist\cli.js run --platform web-mobile --dest "E:\own_space\engines\cocos-test-projects\temp\cli-build-smoke\build-issue-026-second-third-20260624"
```

结果：

- server 启动：`http://localhost:9527`
- preview URL：`http://localhost:9527/build/web-mobile/build-issue-026-second-third-20260624/index.html`
- `web-mobile:run completed in 1274ms`
- `[task:run]: success!`
- 返回 JSON：`{"code":0,"dest":"","custom":{"previewUrl":"http://localhost:9527/build/web-mobile/build-issue-026-second-third-20260624/index.html"}}`
- 浏览器侧捕获到普通日志：`[Browser LOG] [Spine] getSpineMemoryInfo 已注册`

run stdout/stderr 扫描未出现：

```text
Cannot read properties of null
Browser ERROR
SpriteFrame._deserialize
reading rect
TypeError
ReferenceError
```

run server 进程已清理；后续进程检查未发现目标 `node.exe .\dist\cli.js run ... build-issue-026-second-third-20260624` 残留。

## 当前结论

第二批 `core/data/*`、`scene-graph/*` 与第三批低优先级候选已完成最小回迁，并通过本轮验证：

- engine compiler 通过。
- 主测试项目 `web-mobile` build 通过。
- 产物 `assets/main/import` 未出现 `[[null],[`。
- run stage 成功，日志未出现目标 runtime / deserialize 错误。
- 资深子代理 review 无阻塞问题，建议提交。

BUILD-ISSUE-026 的直接 `NODEJS adapter` 分支回迁已覆盖 handoff 中的第一、第二、第三批候选。后续剩余风险主要是测试覆盖增强，以及只有在出现具体 `AssetDB.queryAsset`、extname 或 `generalImportBase` 相关失败时再单独处理 `editor-path-replace.ts` 策略漂移。
