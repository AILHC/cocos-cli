# BUILD-ISSUE-026 NODEJS adapter 第一批实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` 或 `superpowers:executing-plans` 按任务逐步执行。本文步骤使用 checkbox (`- [ ]`) 跟踪。执行前必须重新确认本地仓库状态，不能假设当前 dirty 与本文完全一致。

**Goal:** 在 Cocos 3.8.6 engine 的 `build-nodejs` runtime 下补齐第一批 serialize / deserialize 直接相关的 `NODEJS` 分支，避免 CLI normal build 对资源、场景或 Prefab 重新序列化/反序列化时产生 `null` 或丢失构建期需要的数据。

**Architecture:** CLI production 默认策略不变，仍由 normal build 显式进入 `build-nodejs`，本计划只修改 3.8.6 engine 中已经由本地最新 `cocos4` 证明需要在 `NODEJS` 下继承 Editor 工具链能力的局部代码。第一批只覆盖 `_serialize()`、`_deserialize()`、constructor 初始化、dynamic deserialize owner tracking 和 macro 暴露，不处理 scene graph lifecycle、Editor registry 或新增 platform adapter 目录。

**Tech Stack:** Cocos 3.8.6 engine TypeScript、Cocos build-nodejs runtime、cocos-cli normal build、PowerShell + `rtk`、本地 `cocos4` reference。

---

## 基线事实

- CLI worktree：`E:\own_space\engines\cocos-cli\.worktrees\rebase-adapter-to-386-origin-main-20260622`
- 3.8.6 engine：`D:\workspace\engines\cocos\3.8.6`
- 3.8.6 engine HEAD：`ad15bc7297 fix: serialize sprite frames in nodejs build`
- cocos4 reference：`E:\own_space\engines\cocos4`
- cocos4 reference HEAD：`e2795f9ecd bump version to 4.0.0-alpha.23 (#163)`
- 已确认 `SpriteFrame._serialize()` 在 `build-nodejs` 下漏 `NODEJS` 会输出 `[[null],[2],0,[],[],[]]`，浏览器运行时报 `Cannot read properties of null (reading 'rect')`。
- `cocos4` 已更新到官方 `origin/v4.0.0` 最新提交后，重新初筛得到 25 个 `NODEJS` 命中文本差异；但第一批要改文件不变。

## 范围判定

第一批只处理：

```text
D:\workspace\engines\cocos\3.8.6\cocos\2d\assets\sprite-atlas.ts
D:\workspace\engines\cocos\3.8.6\cocos\2d\assets\sprite-frame.ts
D:\workspace\engines\cocos\3.8.6\cocos\asset\assets\image-asset.ts
D:\workspace\engines\cocos\3.8.6\cocos\serialization\deserialize.ts
D:\workspace\engines\cocos\3.8.6\cocos\serialization\deserialize-dynamic.ts
```

本轮不处理：

```text
D:\workspace\engines\cocos\3.8.6\cocos\asset\assets\texture-cube.ts
D:\workspace\engines\cocos\3.8.6\cocos\asset\assets\texture-cube.jsb.ts
D:\workspace\engines\cocos\3.8.6\cocos\game\game.ts
D:\workspace\engines\cocos\3.8.6\cocos\animation\exotic-animation\exotic-animation.ts
D:\workspace\engines\cocos\3.8.6\cocos\asset\assets\asset.ts
D:\workspace\engines\cocos\3.8.6\cocos\core\settings.ts
D:\workspace\engines\cocos\3.8.6\cocos\particle\animator\curve-range.ts
D:\workspace\engines\cocos\3.8.6\cocos\video\video-player.ts
D:\workspace\engines\cocos\3.8.6\pal\system-info\enum-type\platform.ts
D:\workspace\engines\cocos\3.8.6\cocos\core\data\class.ts
D:\workspace\engines\cocos\3.8.6\cocos\core\data\object.ts
D:\workspace\engines\cocos\3.8.6\cocos\scene-graph\component-scheduler.ts
D:\workspace\engines\cocos\3.8.6\cocos\scene-graph\component.ts
D:\workspace\engines\cocos\3.8.6\cocos\scene-graph\node-activator.ts
D:\workspace\engines\cocos\3.8.6\cocos\scene-graph\node-dev.ts
D:\workspace\engines\cocos\3.8.6\cocos\scene-graph\node.ts
D:\workspace\engines\cocos\3.8.6\cocos\scene-graph\scene.ts
D:\workspace\engines\cocos\3.8.6\cocos\asset\asset-manager\editor-path-replace.ts
```

排除依据：

- `texture-cube.ts` / `texture-cube.jsb.ts` 只有 `EDITOR || NODEJS || TEST` 与 `EDITOR || TEST || NODEJS` 的顺序差异，语义等价。
- `game.ts` 只有 import 顺序差异，核心 `PREVIEW && !TEST && !EDITOR && !NATIVE && !NODEJS` 与 `(EDITOR || NODEJS)` 判断一致。
- `platforms/nodejs/engine/*` 在最新 `cocos4` 存在，但 3.8.6 没有整个 `platforms/nodejs` 目录；这不是同路径分支缺失，不能混入第一批。
- `exotic-animation.ts`、`asset.ts`、`settings.ts`、`curve-range.ts`、`video-player.ts`、`pal/system-info/enum-type/platform.ts` 仍是第三批低优先级候选；当前没有证据表明它们直接导致 `[[null],[type]]` 序列化错误或主测试项目 `web-mobile` runtime error，第一批验证通过后也不能把这些候选标记为已修复。
- `core/data/*` 与 `scene-graph/*` 涉及 `_id`、`_objFlags`、editor extras、component lifecycle、Prefab / Editor registry，影响面大，留到第二批单独验证。
- `editor-path-replace.ts` 在 3.8.6 已有本地 `NODEJS` 回迁实现，不是简单缺 `NODEJS` 分支，而是与最新 `cocos4` 在 `AssetDB.queryAsset`、extname 查询和 `cclegacy.assetManager.generalImportBase` fallback 上存在策略漂移；除非出现 extname / `AssetDB` / `generalImportBase` 相关失败，否则不抢进第一批。

## 修改任务

### Task 1: `SpriteAtlas._serialize()` 支持 `NODEJS`

**Files:**
- Modify: `D:\workspace\engines\cocos\3.8.6\cocos\2d\assets\sprite-atlas.ts`

- [ ] **Step 1: 对照源码**

Run:

```powershell
rtk pwsh -NoProfile -Command "Select-String -LiteralPath 'D:\workspace\engines\cocos\3.8.6\cocos\2d\assets\sprite-atlas.ts','E:\own_space\engines\cocos4\cocos\2d\assets\sprite-atlas.ts' -Pattern 'internal:constants|_serialize' -Context 2,8 -Encoding UTF8"
```

Expected:

```text
3.8.6 缺少 NODEJS import，_serialize() 只在 EDITOR || TEST 下返回 frames。
cocos4 使用 import { EDITOR, NODEJS, TEST }，并在 EDITOR || NODEJS || TEST 下返回 frames。
```

- [ ] **Step 2: 写最小 patch**

目标变更：

```ts
import { EDITOR, NODEJS, TEST } from 'internal:constants';
```

```ts
public _serialize (ctxForExporting: any): any {
    if (EDITOR || NODEJS || TEST) {
        const frames: string[] = [];
        for (const key in this.spriteFrames) {
            const spriteFrame = this.spriteFrames[key];
            frames.push(key);
            frames.push(spriteFrame._uuid);
        }
        return {
            name: this._name,
            spriteFrames: frames,
        };
    }
    return null;
}
```

- [ ] **Step 3: 局部检查**

Run:

```powershell
rtk pwsh -NoProfile -Command "Select-String -LiteralPath 'D:\workspace\engines\cocos\3.8.6\cocos\2d\assets\sprite-atlas.ts' -Pattern 'NODEJS|_serialize' -Context 2,8 -Encoding UTF8"
```

Expected: `NODEJS` import 存在，`_serialize()` 条件为 `EDITOR || NODEJS || TEST`。

### Task 2: `SpriteFrame` 剩余 `_atlasUuid` 分支支持 `NODEJS`

**Files:**
- Modify: `D:\workspace\engines\cocos\3.8.6\cocos\2d\assets\sprite-frame.ts`

- [ ] **Step 1: 对照源码**

Run:

```powershell
rtk pwsh -NoProfile -Command "Select-String -LiteralPath 'D:\workspace\engines\cocos\3.8.6\cocos\2d\assets\sprite-frame.ts','E:\own_space\engines\cocos4\cocos\2d\assets\sprite-frame.ts' -Pattern 'constructor|_atlasUuid|_deserialize|NODEJS' -Context 2,5 -Encoding UTF8"
```

Expected:

```text
3.8.6 已有 NODEJS import 且 _serialize() 已是 EDITOR || TEST || NODEJS。
仍需补 constructor 和 _deserialize() 中 _atlasUuid 的 EDITOR || NODEJS 条件。
```

- [ ] **Step 2: 写最小 patch**

目标 constructor 片段：

```ts
constructor (name?: string) {
    super(name);

    if (EDITOR || NODEJS) {
        // Atlas asset uuid
        this._atlasUuid = '';
    }
}
```

目标 `_deserialize()` 片段：

```ts
if (EDITOR || NODEJS) {
    self._atlasUuid = data.atlas ? data.atlas : '';
}
```

- [ ] **Step 3: 局部检查**

Run:

```powershell
rtk pwsh -NoProfile -Command "Select-String -LiteralPath 'D:\workspace\engines\cocos\3.8.6\cocos\2d\assets\sprite-frame.ts' -Pattern 'if \\(EDITOR \\|\\| NODEJS\\)|_atlasUuid|_serialize' -Context 2,5 -Encoding UTF8"
```

Expected: `_atlasUuid` 初始化和 `_deserialize()` 恢复均在 `EDITOR || NODEJS` 下执行。

### Task 3: `ImageAsset` constructor 初始化 `_exportedExts`

**Files:**
- Modify: `D:\workspace\engines\cocos\3.8.6\cocos\asset\assets\image-asset.ts`

- [ ] **Step 1: 对照源码**

Run:

```powershell
rtk pwsh -NoProfile -Command "Select-String -LiteralPath 'D:\workspace\engines\cocos\3.8.6\cocos\asset\assets\image-asset.ts','E:\own_space\engines\cocos4\cocos\asset\assets\image-asset.ts' -Pattern '_exportedExts|constructor|_serialize|NODEJS' -Context 2,5 -Encoding UTF8"
```

Expected:

```text
3.8.6 _serialize() 已支持 EDITOR || NODEJS || TEST。
constructor 中 _exportedExts = null 仍只在 EDITOR 下执行，cocos4 是 EDITOR || NODEJS。
```

- [ ] **Step 2: 写最小 patch**

目标 constructor 片段：

```ts
if (EDITOR || NODEJS) {
    this._exportedExts = null;
}
```

- [ ] **Step 3: 局部检查**

Run:

```powershell
rtk pwsh -NoProfile -Command "Select-String -LiteralPath 'D:\workspace\engines\cocos\3.8.6\cocos\asset\assets\image-asset.ts' -Pattern '_exportedExts|if \\(EDITOR \\|\\| NODEJS\\)|_serialize' -Context 2,5 -Encoding UTF8"
```

Expected: `_exportedExts = null` 在 `EDITOR || NODEJS` 下执行，`_serialize()` 仍保持 `EDITOR || NODEJS || TEST`。

### Task 4: `deserialize._macros` 暴露给 `NODEJS`

**Files:**
- Modify: `D:\workspace\engines\cocos\3.8.6\cocos\serialization\deserialize.ts`

- [ ] **Step 1: 对照源码**

Run:

```powershell
rtk pwsh -NoProfile -Command "Select-String -LiteralPath 'D:\workspace\engines\cocos\3.8.6\cocos\serialization\deserialize.ts','E:\own_space\engines\cocos4\cocos\serialization\deserialize.ts' -Pattern '_macros|NODEJS|assignAssetsBy|parseUuidDependencies' -Context 2,8 -Encoding UTF8"
```

Expected:

```text
Details.prototype.assignAssetsBy 已在 EDITOR || NODEJS || TEST 下存在。
3.8.6 末尾 deserialize._macros 仍没有外层 EDITOR || TEST || NODEJS 条件，或未包含 NODEJS 条件。
cocos4 明确用 if (EDITOR || TEST || NODEJS) 暴露 deserialize._macros。
```

- [ ] **Step 2: 写最小 patch**

目标片段：

```ts
if (EDITOR || TEST || NODEJS) {
    deserialize._macros = {
        EMPTY_PLACEHOLDER,
        CUSTOM_OBJ_DATA_CLASS,
        CUSTOM_OBJ_DATA_CONTENT,
        CUSTOM_OBJ_DATA_CONTEXT,
        CLASS_KEYS,
        CLASS_VALUES,
        CLASS_TYPE,
        CLASS_NAME,
        CLASS_FLAGS,
        MASK_CLASS,
        MASK_VALUE,
        MASK_TYPE,
        DataTypeID,
        File,
        InstanceType,
    };
}
```

如 3.8.6 的对象成员与上面顺序或内容已有差异，以 3.8.6 现有成员为准，只调整外层条件，不做成员重排。

- [ ] **Step 3: 局部检查**

Run:

```powershell
rtk pwsh -NoProfile -Command "Select-String -LiteralPath 'D:\workspace\engines\cocos\3.8.6\cocos\serialization\deserialize.ts' -Pattern 'if \\(EDITOR \\|\\| TEST \\|\\| NODEJS\\)|deserialize\\._macros' -Context 2,10 -Encoding UTF8"
```

Expected: `deserialize._macros` 只在 `EDITOR || TEST || NODEJS` 下赋值。

### Task 5: `deserialize-dynamic.ts` 对齐 build-time dynamic deserialize 分支

**Files:**
- Modify: `D:\workspace\engines\cocos\3.8.6\cocos\serialization\deserialize-dynamic.ts`

- [ ] **Step 1: 对照源码**

Run:

```powershell
rtk pwsh -NoProfile -Command "Select-String -LiteralPath 'D:\workspace\engines\cocos\3.8.6\cocos\serialization\deserialize-dynamic.ts','E:\own_space\engines\cocos4\cocos\serialization\deserialize-dynamic.ts' -Pattern 'internal:constants|ignoreEditorOnly|deserializedData|deserializedList|cclegacy.Component|EDITOR \\|\\| NODEJS|EDITOR \\|\\| NODEJS \\|\\| TEST' -Context 2,6 -Encoding UTF8"
```

Expected:

```text
3.8.6 未导入 NODEJS。
cocos4 在 dynamic deserialize 的 ignoreEditorOnly、deserializedList owner tracking、Component 创建路径和 object field 恢复路径上都把 NODEJS 纳入 Editor-like 工具链语义。
```

- [ ] **Step 2: 写最小 patch**

目标 import：

```ts
import { EDITOR, NODEJS, TEST, DEV, DEBUG, JSB, PREVIEW, SUPPORT_JIT } from 'internal:constants';
```

目标条件替换：

```ts
if ((PREVIEW || ((EDITOR || NODEJS) && self.ignoreEditorOnly)) && attrs[propName + POSTFIX_EDITOR_ONLY]) {
    continue;
}
```

```ts
if (PREVIEW || ((EDITOR || NODEJS) && self.ignoreEditorOnly)) {
    const mayUsedInPersistRoot = js.isChildClassOf(klass, cclegacy.Node);
    if (mayUsedInPersistRoot) {
        sources.push('d._id&&(o._id=d._id);');
    }
}
```

```ts
if (EDITOR || NODEJS || TEST) {
    this.deserializedData = this._deserializeObject(serializedRootObject, 0, this.deserializedList, `${0}`);
} else {
    this.deserializedData = this._deserializeObject(serializedRootObject, 0);
}
```

```ts
if (!((EDITOR || NODEJS) && js.isChildClassOf(klass, cclegacy.Component))) {
    const obj = createObject(klass);
    this._deserializeInto(value, obj, klass);
    return obj;
}
```

```ts
if (EDITOR || NODEJS || TEST) {
    obj[propName] = this._deserializeObject(source, id, obj, propName);
} else {
    obj[propName] = this._deserializeObject(source, id, undefined, propName);
}
```

```ts
} else if (EDITOR || NODEJS || TEST) {
    obj[propName] = this._deserializeObject(serializedField as SerializedObject, -1, obj, propName);
} else {
    obj[propName] = this._deserializeObject(serializedField as SerializedObject, -1);
}
```

- [ ] **Step 3: 局部检查**

Run:

```powershell
rtk pwsh -NoProfile -Command "Select-String -LiteralPath 'D:\workspace\engines\cocos\3.8.6\cocos\serialization\deserialize-dynamic.ts' -Pattern 'NODEJS|ignoreEditorOnly|deserializedData|cclegacy.Component|obj\\[propName\\]' -Context 2,5 -Encoding UTF8"
```

Expected: 上述所有条件均包含 `NODEJS`，且没有额外格式化或无关重排。

## 验证任务

### Task 6: 验证前环境复核

**Files:**
- CLI worktree: `E:\own_space\engines\cocos-cli\.worktrees\rebase-adapter-to-386-origin-main-20260622`
- Engine root: `D:\workspace\engines\cocos\3.8.6`

- [ ] **Step 1: 记录 engine override 与 packages/engine 指向**

Run:

```powershell
rtk pwsh -NoProfile -Command '$expected = [System.IO.Path]::GetFullPath("D:\workspace\engines\cocos\3.8.6"); $override = $env:COCOS_CLI_TEST_ENGINE_ROOT; if ($override) { $actual = [System.IO.Path]::GetFullPath($override); if ($actual -ne $expected) { throw "COCOS_CLI_TEST_ENGINE_ROOT points to unexpected engine: $actual" } }; Set-Location "E:\own_space\engines\cocos-cli\.worktrees\rebase-adapter-to-386-origin-main-20260622"; Get-Item -LiteralPath ".\packages\engine" | Format-List FullName,LinkType,Target; rtk git -C "D:\workspace\engines\cocos\3.8.6" rev-parse HEAD; rtk git -C "E:\own_space\engines\cocos4" rev-parse HEAD'
```

Expected:

```text
COCOS_CLI_TEST_ENGINE_ROOT 未设置，或设置为 D:\workspace\engines\cocos\3.8.6。
packages\engine 指向 D:\workspace\engines\cocos\3.8.6，或执行者记录当前实际 engine 解析路径并确认仍是目标 3.8.6 engine。
3.8.6 engine HEAD 为 ad15bc7297。
cocos4 HEAD 为 e2795f9ecde92621e5475fbd172ad7fc49ac6b05。
```

如果 `COCOS_CLI_TEST_ENGINE_ROOT` 指向其它路径，停止执行并先澄清；不能在错误 engine 上验证。

### Task 7: engine 编译验证

**Files:**
- Build input: `D:\workspace\engines\cocos\3.8.6`
- CLI command cwd: `E:\own_space\engines\cocos-cli\.worktrees\rebase-adapter-to-386-origin-main-20260622`

- [ ] **Step 1: 运行 engine compiler**

Run:

```powershell
rtk pwsh -NoProfile -Command "Set-Location 'E:\own_space\engines\cocos-cli\.worktrees\rebase-adapter-to-386-origin-main-20260622'; rtk npm run compiler:engine"
```

Expected:

```text
命令退出码为 0。
没有 TypeScript compile error。
```

### Task 8: 主测试项目 build 验证

**Files:**
- Project: `E:\own_space\engines\cocos-test-projects`
- Build config: `E:\own_space\engines\cocos-test-projects\buildConfig_web-mobile.json`
- Output root: `E:\own_space\engines\cocos-test-projects\temp\cli-build-smoke`

- [ ] **Step 1: 清理目标 builder cache**

Run:

```powershell
rtk pwsh -NoProfile -Command "Remove-Item -LiteralPath 'E:\own_space\engines\cocos-test-projects\temp\builder\asset-db' -Recurse -Force -ErrorAction SilentlyContinue; Remove-Item -LiteralPath 'E:\own_space\engines\cocos-test-projects\temp\builder\assets-mtime.json' -Force -ErrorAction SilentlyContinue"
```

Expected: 只清理 `temp\builder` 下的目标缓存，不清理 `assets/`、`library/`、`.meta` 或其它 `temp` 目录。

- [ ] **Step 2: 执行 normal build**

Run:

```powershell
rtk pwsh -NoProfile -Command "Set-Location 'E:\own_space\engines\cocos-cli\.worktrees\rebase-adapter-to-386-origin-main-20260622'; rtk node .\dist\cli.js build --project 'E:\own_space\engines\cocos-test-projects' --platform web-mobile --build-config 'E:\own_space\engines\cocos-test-projects\buildConfig_web-mobile.json' --buildPath 'E:\own_space\engines\cocos-test-projects\temp\cli-build-smoke' --outputName 'build-issue-026-first-batch-20260624'"
```

Expected:

```text
命令退出码为 0。
日志显示 build 完成。
```

### Task 9: 产物扫描与运行验证

**Files:**
- Build output: `E:\own_space\engines\cocos-test-projects\temp\cli-build-smoke\build-issue-026-first-batch-20260624`

- [ ] **Step 1: 扫描 bad custom instance**

Run:

```powershell
rtk pwsh -NoProfile -Command 'Set-Location "E:\own_space\engines\cocos-test-projects\temp\cli-build-smoke\build-issue-026-first-batch-20260624"; rtk rg "\[\[null\],\[[0-9]+\]" assets/main/import; if ($LASTEXITCODE -eq 1) { exit 0 }; exit $LASTEXITCODE'
```

Expected:

```text
无命中。
`rg` 无命中时原始退出码为 1，本步骤将其转换为通过；退出码 2 或其它错误仍视为失败。
```

- [ ] **Step 2: 运行 web-mobile 产物**

Run:

```powershell
rtk pwsh -NoProfile -Command "Set-Location 'E:\own_space\engines\cocos-cli\.worktrees\rebase-adapter-to-386-origin-main-20260622'; rtk node .\dist\cli.js run --platform web-mobile --dest 'E:\own_space\engines\cocos-test-projects\temp\cli-build-smoke\build-issue-026-first-batch-20260624'"
```

Expected:

```text
run log 不出现 Cannot read properties of null。
run log 不出现 Browser ERROR。
```

## 提交与文档任务

### Task 10: 记录事实与提交

**Files:**
- Modify or create: `E:\own_space\engines\cocos-cli\.worktrees\rebase-adapter-to-386-origin-main-20260622\docs\dev\build\facts\build-issue-026-nodejs-adapter-first-batch-20260624.md`
- Modify: `E:\own_space\engines\cocos-cli\.worktrees\rebase-adapter-to-386-origin-main-20260622\docs\dev\build\issues.md`

- [ ] **Step 1: 写 facts 文档**

文档必须记录：

```text
1. 3.8.6 engine HEAD 与 cocos4 reference HEAD。
2. 第一批实际修改文件。
3. 明确说明 texture-cube、game.ts、platforms/nodejs/engine/* 未纳入的原因。
4. engine compiler 结果。
5. 主测试项目 build 结果。
6. [[null],[type]] 扫描结果。
7. run 结果。
8. 未处理的第二批 / 第三批候选，以及 `platforms/nodejs/engine/*` 未纳入第一批的理由。
```

- [ ] **Step 2: 更新 issues.md**

将 `BUILD-ISSUE-026` 的当前结论从旧 `cocos4@821928733b` 初筛更新为最新 `cocos4@e2795f9ecd` 初筛与第一批验证结果。第一批通过不等于全量修复；只要第二批 / 第三批候选仍未逐项验证，状态仍应保持 `fact-gap`，或明确写成“第一批已完成，剩余 NODEJS adapter 候选仍 fact-gap”。

- [ ] **Step 3: 分别提交 engine 与 CLI docs**

Engine commit：

```powershell
rtk pwsh -NoProfile -Command "Set-Location 'D:\workspace\engines\cocos\3.8.6'; rtk git status --short; rtk git add cocos/2d/assets/sprite-atlas.ts cocos/2d/assets/sprite-frame.ts cocos/asset/assets/image-asset.ts cocos/serialization/deserialize.ts cocos/serialization/deserialize-dynamic.ts; rtk git commit -m 'fix: align nodejs build serialization branches'"
```

CLI docs commit：

```powershell
rtk pwsh -NoProfile -Command "Set-Location 'E:\own_space\engines\cocos-cli\.worktrees\rebase-adapter-to-386-origin-main-20260622'; rtk git status --short; rtk git add docs/dev/build/facts/build-issue-026-nodejs-adapter-first-batch-20260624.md docs/dev/build/issues.md docs/dev/build/plans/build-issue-026-nodejs-adapter-first-batch-plan-20260624.md; rtk git commit -m 'docs(build): plan nodejs adapter first batch'"
```

Expected:

```text
不 stage `editor/assets/primitives.fbx.meta`。
不 stage `.codegraph/`。
不 stage CLI worktree 中与 BUILD-ISSUE-026 无关的 dirty / untracked 文件。
```

## 禁止事项

- 禁止访问远程仓库或网页读取 Cocos 源码；`cocos4` reference 只使用本地 `E:\own_space\engines\cocos4`。
- 禁止整批照搬 `cocos4` 文件。
- 禁止修改 CLI production 默认策略。
- 禁止用 no-op、空对象或静默 mock 掩盖 `Editor.Message`、`AssetDB` 或 asset lifecycle 问题。
- 禁止清理 `assets/`、`library/`、项目 `.meta` 或非目标 `temp` 目录。
- 禁止 stage 或提交无关 dirty 文件。

## 自检结果

- Spec coverage：覆盖 handoff 第一批候选，并纳入最新 `cocos4@e2795f9ecd` 后新增差异的排除判断。
- Placeholder scan：无 `TBD`、`TODO`、`implement later`。
- Type consistency：所有文件路径、runtime 常量名、验证命令和 output name 在本文中保持一致。
