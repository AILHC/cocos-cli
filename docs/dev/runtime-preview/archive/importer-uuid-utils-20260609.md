# Runtime Preview Importer UuidUtils 兼容问题记录

记录时间：2026-06-09

## 问题

手动运行 runtime preview 时出现 importer 错误：

```text
Importer exec failed: {asset[D:\workspace\engines\cocos\3.8.6\editor\assets\primitives.fbx@aae0f](1263d74c-8167-4928-91a6-4e2672411f47@aae0f)}

TypeError: EditorExtends.UuidUtils.uuid is not a function
    at IDGenerator.getNewId (...\bin\.cache\dev-cli\editor\bundled\index.js:171082:44)
    at new Node (...\bin\.cache\dev-cli\editor\bundled\index.js:53821:34)
    at GltfConverter._getSceneNode (...\src\core\assets\asset-handler\assets\utils\gltf-converter.ts:1684:29)
```

## 触发链路

当前确认的触发链路：

1. CLI runtime preview warm-up 调用 `Engine.initEngine()`。
2. `Launcher.import()` 启动 AssetDB。
3. AssetDB 导入 engine internal asset：`D:\workspace\engines\cocos\3.8.6\editor\assets\primitives.fbx@aae0f`。
4. glTF / FBX prefab importer 进入 `GltfConverter.createScene()`。
5. `GltfConverter._getSceneNode()` 创建 engine `Node`。
6. engine `Node` 构造触发 `IDGenerator('Node.').getNewId()`。
7. 在 dev-cli editor 产物中，`EDITOR=true`，`IDGenerator.getNewId()` 对 `Node.` / `Comp.` 前缀调用 `EditorExtends.UuidUtils.uuid()`。
8. 当前 CLI `EditorExtends.UuidUtils` 来自 `src/core/base/utils/uuid.ts`，真实函数名是 `generate()`，没有 `uuid()` alias，导致 importer 失败。

## 事实来源

- Engine source: `D:\workspace\engines\cocos\3.8.6\cocos\core\utils\id-generator.ts`
- Engine generated cache: `D:\workspace\engines\cocos\3.8.6\bin\.cache\dev-cli\editor\bundled\index.js`
- CLI editor extends: `src/core/engine/editor-extends/index.ts`
- CLI UUID utils: `src/core/base/utils/uuid.ts`
- CLI glTF importer: `src/core/assets/asset-handler/assets/utils/gltf-converter.ts`
- 备份分支参考：
  - `E:\own_space\tmp-repos\runtime-preview-reference\cocos-cli-backup-runtime-preview-bad-20260606\src\core\scene\scene-process\engine-bootstrap.ts`
  - `E:\own_space\tmp-repos\runtime-preview-reference\cocos-cli-backup-runtime-preview-bad-20260606\docs\dev\runtime-preview-integration-alignment.md`

## 旧实现参考结论

备份分支中 scene-process bootstrap 曾补过以下 alias：

- `compressUUID -> compressUuid`
- `decompressUUID -> decompressUuid`
- `isUUID -> isUuid`
- `generate -> uuid`

当前主分支 `Engine.importEditorExtensions()` 只补了 `compressUUID -> compressUuid`，没有补 `uuid()`。runtime preview / AssetDB importer 不经过 scene-process bootstrap，因此旧 bootstrap 中的完整 alias 对 runtime preview importer 无效。

## 修复决策

修复位置不放在 glTF importer，也不单独处理 `primitives.fbx@aae0f`。原因：

- 错误不是该资源专有的资源内容问题，而是 engine editor runtime 与 CLI `EditorExtends.UuidUtils` API 命名不一致。
- engine `IDGenerator` 对 `Node.` / `Comp.` 都会调用 `UuidUtils.uuid()`，未来其他 importer 只要创建 editor `Node` / `Component` 也可能触发。
- scene-process bootstrap 已有同类兼容补丁，说明这是共享 editor host boundary 问题。

最终决策：

- 新增共享 helper：`src/core/engine/editor-extends/uuid-utils-compatibility.ts`
- `Engine.importEditorExtensions()` 调用该 helper。
- `scene-process/engine-bootstrap.ts` 复用同一个 helper，避免两个 bootstrap 维护两套 alias。

## 验证

已通过：

```powershell
rtk npm run build
```

已通过：

```powershell
rtk cmd /c "set COCOS_CLI_TEST_PROJECT_ROOT=E:/own_space/cocos_work_lab_38x&& set COCOS_CLI_TEST_ENGINE_ROOT=D:/workspace/engines/cocos/3.8.6&& set COCOS_CLI_TEST_EDITOR_LIBRARY_REF=E:/own_space/engines/cocos-cli/.codex-tmp/reference-library/cocos_work_lab_38x-editor-library-20260606&& set COCOS_CLI_TEST_EDITOR_PROGRAMMING_REF=E:/own_space/engines/cocos-cli/.codex-tmp/reference-temp/cocos_work_lab_38x-editor-programming-20260606&& npm --prefix vitests test -- suites/runtime-preview/editor-extends-uuid-utils.test.ts suites/runtime-preview/launcher-runtime-preview.test.ts"
```

结果：

- `editor-extends-uuid-utils.test.ts`: 1 test passed
- `launcher-runtime-preview.test.ts`: 3 tests passed
- real Launcher runtime preview path 完成 `asset-db:done` 和 `preview:ready`

最新相关日志：

- `E:\own_space\cocos_work_lab_38x\temp\preview-logs\runtime-preview-20260609-184016.log`

该日志中包含：

- `asset-db:done`
- `preview:ready`

未发现新的：

- `Importer exec failed`
- `EditorExtends.UuidUtils.uuid is not a function`

## 非本修复范围

`small-project-cli-integration.test.ts` 本轮仍可能失败在 browser DevTools active port 等待超时。该失败发生在 browser automation 启动/连接层，evidence 中 `networkRequestCount=0`，不代表 runtime importer 仍失败。

该问题需要单独归类为 browser automation / local Chrome profile / DevTools port 问题，不应混入 `primitives.fbx@aae0f` importer 修复。
