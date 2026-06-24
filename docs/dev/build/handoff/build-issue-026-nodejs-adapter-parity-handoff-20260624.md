# BUILD-ISSUE-026 handoff：3.8.6 build-nodejs NODEJS adapter 对齐

## 目标

继续排查并补齐 Cocos 3.8.6 engine 在 CLI normal build 的 `build-nodejs` runtime 下缺失的 `NODEJS adapter` 分支，避免资源、场景、Prefab 或 runtime settings 在 `CC_EDITOR=false`、`CC_NODEJS=true` 下重新序列化/反序列化产生错误数据。

本 handoff 只允许使用本地仓库对照：

- 3.8.6 engine：`D:\workspace\engines\cocos\3.8.6`
- cocos4 reference：`E:\own_space\engines\cocos4`
- 禁止联网读取远程源码或文档。

## 当前状态

CLI worktree：

```text
E:\own_space\engines\cocos-cli\.worktrees\rebase-adapter-to-386-origin-main-20260622
```

相关提交：

- CLI：`1939f6e docs(build): record spriteframe nodejs serialize fix`
- engine：`ad15bc7297 fix: serialize sprite frames in nodejs build`

engine 当前分支：

```text
D:\workspace\engines\cocos\3.8.6
branch: codex/nodejs-adapter-3.8.6
HEAD: ad15bc7297 fix: serialize sprite frames in nodejs build
```

engine repo 仍有无关 dirty：

```text
 M editor/assets/primitives.fbx.meta
?? .codegraph/
```

不要处理这些无关项。

CLI repo 也有大量既有 dirty / untracked 文件，不能顺手 stage 或提交。

## 已确认事实

### SpriteFrame runtime error 根因

主测试项目用 `buildConfig_web-mobile.json` 构建后，运行时报：

```text
Cannot read properties of null (reading 'rect')
at SpriteFrame._deserialize(...)
```

source map 映射到 3.8.6 `cocos/2d/assets/sprite-frame.ts`：

```ts
const data = serializeData as ISpriteFramesSerializeData;
const rect = data.rect;
```

所以直接原因是 `serializeData === null`。

构建产物中可见 bad custom instance：

```text
[[null],[2],0,[],[],[]]
```

对应 `cc.SpriteFrame`，例如：

```text
b730527c-3233-41c2-aaf7-7cdab58f9749@f9941
```

项目原始 library JSON 数据完整：

```text
E:\own_space\engines\cocos-test-projects\library\b7\b730527c-3233-41c2-aaf7-7cdab58f9749@f9941.json
```

根因是 3.8.6 `SpriteFrame._serialize()` 原本只在 `EDITOR || TEST` 下返回数据；CLI normal build 已切到 `build-nodejs`，即 `CC_EDITOR=false`、`CC_NODEJS=true`，因此会返回 `null`。

本轮已修复：

```diff
- import { EDITOR, TEST, BUILD } from 'internal:constants';
+ import { EDITOR, NODEJS, TEST, BUILD } from 'internal:constants';

- if (EDITOR || TEST) {
+ if (EDITOR || TEST || NODEJS) {
```

记录文档：

```text
docs/dev/build/facts/spriteframe-nodejs-serialize-runtime-20260624.md
```

### 缓存注意点

bad `SpriteFrame` compiled JSON 会写入：

```text
E:\own_space\engines\cocos-test-projects\temp\builder\asset-db
```

如果修 engine 后不清理该目录，构建仍可能复用旧 `release.json`，误判修复无效。

清理范围必须限定在项目 `temp\builder` 下：

```powershell
Remove-Item -LiteralPath "E:\own_space\engines\cocos-test-projects\temp\builder\asset-db" -Recurse -Force
Remove-Item -LiteralPath "E:\own_space\engines\cocos-test-projects\temp\builder\assets-mtime.json" -Force
```

## 本地 cocos4 初筛结果

已用本地脚本对比 `E:\own_space\engines\cocos4` 和 `D:\workspace\engines\cocos\3.8.6` 中 `cocos`、`pal`、`platforms` 下的 `NODEJS` 命中差异。

初筛发现约 20 个同路径差异：

```text
cocos/2d/assets/sprite-frame.ts
cocos/asset/asset-manager/editor-path-replace.ts
cocos/asset/assets/image-asset.ts
cocos/serialization/deserialize.ts
cocos/2d/assets/sprite-atlas.ts
cocos/animation/exotic-animation/exotic-animation.ts
cocos/asset/assets/asset.ts
cocos/core/data/class.ts
cocos/core/data/object.ts
cocos/core/settings.ts
cocos/particle/animator/curve-range.ts
cocos/scene-graph/component-scheduler.ts
cocos/scene-graph/component.ts
cocos/scene-graph/node-activator.ts
cocos/scene-graph/node-dev.ts
cocos/scene-graph/node.ts
cocos/scene-graph/scene.ts
cocos/serialization/deserialize-dynamic.ts
cocos/video/video-player.ts
pal/system-info/enum-type/platform.ts
```

注意：这只是文本级初筛，不代表全部应立即修改。

## 建议分批

### 第一批：build 序列化/反序列化直接相关

优先处理这些文件：

```text
cocos/2d/assets/sprite-atlas.ts
cocos/2d/assets/sprite-frame.ts
cocos/serialization/deserialize.ts
cocos/serialization/deserialize-dynamic.ts
cocos/asset/assets/image-asset.ts
```

原因：

- `sprite-atlas.ts` 和 `sprite-frame.ts` 同类，`_serialize()` 仍可能在 `build-nodejs` 下输出 `null`。
- `sprite-frame.ts` 虽已修 `_serialize()`，但 constructor 和 `_deserialize()` 中 `_atlasUuid` 仍只在 `EDITOR` 下处理；cocos4 是 `EDITOR || NODEJS`。
- `deserialize.ts` / `deserialize-dynamic.ts` 影响 compiled/dynamic 反序列化、`ignoreEditorOnly`、引用恢复和 dependency scan。
- `image-asset.ts` 的 `_serialize()` 已有 `NODEJS`，但 constructor 中 `_exportedExts` 仍只在 `EDITOR` 下初始化；cocos4 是 `EDITOR || NODEJS`。

### 第二批：scene graph / core data 工具链

候选：

```text
cocos/core/data/class.ts
cocos/core/data/object.ts
cocos/scene-graph/component-scheduler.ts
cocos/scene-graph/component.ts
cocos/scene-graph/node-activator.ts
cocos/scene-graph/node-dev.ts
cocos/scene-graph/node.ts
cocos/scene-graph/scene.ts
```

这些分支涉及 `_id`、`_objFlags`、`editorOnly`、EditorExtends registry、component lifecycle try/catch、Prefab / scene 同步语义。不能一次性无脑改，需要结合当前 CLI build 是否会执行对应路径逐项验证。

### 第三批：低优先级或单独判断

候选：

```text
cocos/animation/exotic-animation/exotic-animation.ts
cocos/asset/assets/asset.ts
cocos/core/settings.ts
cocos/particle/animator/curve-range.ts
cocos/video/video-player.ts
pal/system-info/enum-type/platform.ts
```

这些可能仍需要对齐，但未必阻塞当前主测试项目 `web-mobile` build/run。需要用具体复现或 smoke 判断。

## 推荐工作流

1. 只用本地 cocos4 做参考。
2. 对每个候选文件阅读 3.8.6 与 cocos4 同区域源码，不只看一行 diff。
3. 每批做最小 patch，避免混入格式化。
4. patch 后执行 engine 编译：

```powershell
Set-Location "E:\own_space\engines\cocos-cli\.worktrees\rebase-adapter-to-386-origin-main-20260622"
rtk npm run compiler:engine
```

5. 清理主测试项目 bad builder cache：

```powershell
Remove-Item -LiteralPath "E:\own_space\engines\cocos-test-projects\temp\builder\asset-db" -Recurse -Force
Remove-Item -LiteralPath "E:\own_space\engines\cocos-test-projects\temp\builder\assets-mtime.json" -Force -ErrorAction SilentlyContinue
```

6. 用用户指定 config 构建：

```powershell
node .\dist\cli.js build --project "E:\own_space\engines\cocos-test-projects" --platform web-mobile --build-config "E:\own_space\engines\cocos-test-projects\buildConfig_web-mobile.json" --buildPath "E:\own_space\engines\cocos-test-projects\temp\cli-build-smoke" --outputName "<new-output-name>"
```

7. 扫描产物：

```powershell
Set-Location "E:\own_space\engines\cocos-test-projects\temp\cli-build-smoke\<new-output-name>"
rg "\[\[null\],\[[0-9]+\]" assets/main/import
```

期望没有命中。

8. 运行验证：

```powershell
node .\dist\cli.js run --platform web-mobile --dest "E:\own_space\engines\cocos-test-projects\temp\cli-build-smoke\<new-output-name>"
```

检查 run log 不出现：

```text
Cannot read properties of null
Browser ERROR
```

## 禁止事项

- 禁止访问远程仓库或网页查 cocos4。
- 禁止把 cocos4 代码整批无筛选照搬到 3.8.6。
- 禁止为了让测试通过改变 CLI production 默认策略。
- 禁止用 no-op / 空对象 / 静默 mock 掩盖 unsupported `Editor.Message` 或 asset lifecycle 问题。
- 禁止清理 `assets/`、`library/`、`.meta` 或非目标 `temp` 目录。
- 禁止 stage 或提交无关 dirty 文件。

## 交付物建议

新会话完成每一批后至少提交：

- engine patch commit，说明具体补齐的 `NODEJS` 分支。
- CLI docs commit，更新本 issue 的事实或新增 facts 文档。
- 验证摘要：engine compiler、主测试项目 build/run、产物 `[[null],[type]]` 扫描结果。
