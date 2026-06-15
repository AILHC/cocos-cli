# BUILD-ISSUE-009 3D Source Meta Editor Alignment 执行计划

日期：2026-06-15

## 目标

修复 CLI build 改写 3D source `.gltf/.glb/.fbx.meta` 后与 Editor 3.8.6 baseline 不一致的问题。

判断标准：

- `gltf/fbx` 顶层 importer `ver` 与 Editor baseline 对齐。
- `gltf-animation` subMeta importer `ver` 与 Editor baseline 对齐。
- 3D animation library files 使用 `.cconb`，不被写成 `.bin`。
- `userData` 改写经确认允许存在，不作为本次失败条件。

禁止方案：

- 禁止 `.meta` 写入。
- build 后回滚 source `.meta`。
- 用测试缓存、临时目录污染或手工编辑后的产物反推 production 默认策略。

## 事实依据

- `docs/dev/build/issues.md` 中 `BUILD-ISSUE-009` 记录的差异集中在 `.glb.meta`、`.gltf.meta`、`.fbx.meta`。
- `docs/dev/build/facts/meta-library-editor-parity-20260613.md` 记录样本差异：
  - 顶层 `gltf` importer `ver: 2.3.13 -> 2.3.14`。
  - `gltf-animation` subMeta `ver: 1.0.17 -> 1.0.18`。
  - 3D animation files 从 `.cconb` 被写成 `.bin`。
  - `legacyFbxImporter`、`allowMeshDataAccess`、`meshOptimizer` 等 `userData` 字段被补写。
- `src/core/assets/asset-handler/assets/fbx.ts` 通过 spread 复用 `GltfHandler`，因此 `.fbx.meta` 顶层 importer version 跟随 `gltf.ts`。
- 用户确认：
  - `userData` 改写可以接受。
  - version 必须对齐 Editor，不是按测试需要任意改号。
  - version 与 `.cconb` 要同轮修复。

## 执行步骤

- [x] 复核 `BUILD-ISSUE-009`、事实文档和相关 importer 源码。
- [x] 将 `GltfHandler.importer.version` 对齐为 `2.3.13`。
- [x] 将 original 3D animation library file 保存为 `.cconb`。
- [x] 将 `GltfAnimationHandler.importer.version` 对齐为 `1.0.17`。
- [x] 将 `gltf-animation` sub asset library file 保存为 `.cconb`。
- [x] 修正 `gltf-animation` original animation 读取链路，直接读取 `.cconb` 并通过 `decodeCCONBinary()` / `deserialize()` 还原 `AnimationClip`。
- [x] 扩展 `collectSourceMetaSnapshot()` 支持多 suffix，保持默认 `.anim.meta` 兼容。
- [x] 新增 `.gltf.meta` / `.glb.meta` / `.fbx.meta` Editor baseline parity 测试。
- [x] 按用户确认口径，在 3D parity 测试中递归忽略 `userData`，继续强校验 `ver`、`files` 和 subMeta 结构。
- [x] 运行 `npm run build`。
- [x] 运行受控 CLI build，确认 `.cconb` 保存和读取链路都生效。
- [x] 运行 3D source meta parity 测试。
- [x] 运行既有 `.anim.meta` parity 测试。
- [x] 更新 `docs/dev/build/issues.md` 和 `docs/dev/build/facts/meta-library-editor-parity-20260613.md`。

## 执行中调整

最初计划只忽略顶层默认 `userData` key。实际验证时，`assets/resources/light-probe/Knight/E_Knight.fbx.meta` 仍存在 broader `userData` 差异，例如 `assetFinder.materials` 和 `materials` 内容差异；这些仍属于用户已确认允许改写的 `userData` 范围。

因此最终测试口径调整为递归忽略 `userData` 字段本身，但不忽略 `ver`、`files`、`importer`、`imported`、`subMetas` 等非 `userData` 结构字段。

## 验证结论

- `npm run build` 通过。
- 受控 CLI build 通过，修正后不再出现本问题相关的 `__original-animation-*.bin` 读取失败。
- `vitests/suites/build/3d-source-meta-editor-alignment.test.ts` 通过。
- `vitests/suites/runtime-preview/source-meta-editor-parity.test.ts` 通过。
- `BUILD-ISSUE-009` 已在问题台账中标记为 `fixed`。
