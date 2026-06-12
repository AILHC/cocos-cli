# Source Meta Editor Baseline 事实记录

## Phase 0 工具事实

- `@xuyanfeng/cc-editor` npm 包版本：`1.0.26`。
- npm `bin` 暴露：`cc-editor` 和 `cce`，都指向 `bin/index.js`。
- 本机没有全局 `cce`：`where.exe cce` 未找到。
- 可用入口：`npm exec --package @xuyanfeng/cc-editor -- cce ...`。
- `cc-editor` 配置文件路径：`C:/Users/Nobody/cc-editor.json`。
- 当前配置中已存在 Editor：`3.8.3`、`3.8.4`；本次已登记 `3.8.6` 到 `D:/cocos_editors/Creator/Creator/3.8.6`。
- 当前配置中没有 project。

## Phase 0 `cc-editor` 源码事实

源码来源：`https://github.com/cocos-creator-plugin/cc-editor`，本地临时检出：`.codex-tmp/cc-editor-src`。

- `src/index.ts` 中 `add-editor <editor-name> <editor-path>` 和 `add-project <project-path>` 是非交互命令。
- `src/index.ts` 中 `use-editor`、`use-project`、`use-group` 是交互式选择命令，不适合作为自动 baseline 流程。
- `src/run.ts` 中 `openProject(editor, project)` 对 3.x Editor 使用：

```text
<CocosCreator.exe> --nologin --project <project>
```

- 为避免依赖全局 use 配置和交互式选择，Editor baseline 阶段使用源码确认过的完整命令形态，显式传入 Editor 3.8.6 executable 和 `editor-project` 副本路径。

## Phase 0 Editor 3.8.6 路径事实

- Editor executable：`D:\cocos_editors\Creator\Creator\3.8.6\CocosCreator.exe`。
- Editor bundled engine root：`D:\cocos_editors\Creator\Creator\3.8.6\resources\resources\3d\engine`。
- bundled engine `package.json` 中 `version` 为 `3.8.6`。
- bundled engine root 中存在 `cocos/animation`、`exports`、`bin`。

## Phase 0 CLI engine root 事实

本专项 CLI import 使用：

```text
package.json["cocos-cli"].enginePath=D:\workspace\engines\cocos\3.8.6
```

该路径是用户指定的自定义 engine root，`package.json.version` 为 `3.8.6`，并存在：

```text
bin\.editor\web-adapter.js
editor\library
```

已验证 `D:\cocos_editors\Creator\Creator\3.8.6\resources\resources\3d\engine` 虽然也是 3.8.6 bundled engine root，但缺少 CLI 当前预加载需要的 `bin\.editor\web-adapter.js`，不能作为本专项 CLI import 的 engine root。

## Phase 0 CLI import 触发方式事实

- 代码中没有独立公开的 `import` CLI command。
- runtime preview 路径会在 `Launcher.startRuntimePreview()` 中调用 `this.import()`。
- 已存在可终止测试 helper：`vitests/shared/runtime-preview-cli-process.ts`。
- `startRuntimePreviewCliProcess()` 会：
  - 启动 `node dist/cli.js preview --project <projectRoot> --runtime --host <host> --port <port>`；
  - 设置 `COCOS_CLI_TEST_PROJECT_ROOT` 和 `COCOS_CLI_TEST_ENGINE_ROOT`；
  - 等待 `preview:ready` 和 `/__runtime-preview/health`；
  - 提供 `close()` 清理进程并等待端口释放。

Phase 3 / Phase 4 / Phase 5 不使用前台长驻 `preview --runtime` 命令，改为复用该 helper 或等价的后台进程、ready 检测、timeout、cleanup 流程。

## Phase 0 Gate 结论

- `cc-editor/cce` 用法已验证到足以解释工具行为。
- Editor 3.8.6 executable 已确认。
- CLI 使用用户指定的自定义 3.8.6 engine root：`D:\workspace\engines\cocos\3.8.6`。
- CLI import 可终止触发方式已确认。

可以进入 Phase 1。

## Phase 1 项目状态事实

- 测试项目仓库：`E:\own_space\engines\cocos-test-projects`。
- 初始当前分支为 `v3.8.7`，不是目标分支。
- 远端存在明确分支：`origin/v3.8.6`。
- 已从 `origin/v3.8.6` 创建本地 `v3.8.6`，再创建专项分支：`codex/source-meta-editor-parity-386`。
- 专项分支工作树干净。
- `package.json` 存在。
- `package.json.creator.version` 在 `origin/v3.8.6` 上仍为 `3.8.4`，因此不能依赖 `cce open` 按项目版本自动选择 3.8.6 Editor。本专项直接使用 Editor 3.8.6 executable 打开项目副本。

## Phase 1 CLI 项目配置适配事实

用户确认 CLI 需要项目配置文件和字段。真实测试项目 `E:\own_space\engines\cocos-test-projects` 的 `package.json` 已在专项分支做最小适配：

```json
{
  "creator": {
    "version": "3.8.6"
  },
  "version": "3.8.6",
  "cocos-cli": {
    "enginePath": "D:\\workspace\\engines\\cocos\\3.8.6"
  }
}
```

- 根字段 `version` 与 `creator.version` 都改为 `3.8.6`，与目标 Editor / engine 版本一致。
- 本次适配不检查、不修改用户已排除的 `assets/`、`settings/`、`profiles/` 配置文件。
- 有效 CLI import 应验证 `package.json["cocos-cli"].enginePath` 生效；`COCOS_CLI_TEST_ENGINE_ROOT` 只能作为 Vitest/专项测试环境的辅助事实，不应替代项目配置。
- 2026-06-11 中断过一次未适配 `package.json` 的 CLI import，产物已保存到测试项目 stash：`codex aborted cli import before package adaptation 20260611`，不作为有效 baseline。

## Phase 3 CLI import 阻塞事实

2026-06-11 18:17 左右，使用临时脚本直接启动：

```text
node E:\own_space\engines\cocos-cli\dist\cli.js preview --project E:\own_space\engines\cocos-test-projects --runtime --host 127.0.0.1 --port 19531
```

脚本显式删除 `COCOS_CLI_TEST_PROJECT_ROOT`、`COCOS_CLI_TEST_ENGINE_ROOT`、`COCOS_CLI_TEST_EDITOR_LIBRARY_REF`、`COCOS_CLI_TEST_EDITOR_PROGRAMMING_REF` 后启动 CLI。启动日志确认项目配置已生效：

```text
[runtime-preview] engineRoot=D:\workspace\engines\cocos\3.8.6
[runtime-preview] engineRootSource=project-config
```

本次 import 未到达 `preview:ready`，超时前报错：

```text
TypeError: Cannot convert undefined or null to object
at Object.migrate (...\dist\core\configuration\migration\register-migration.js:95:39)
[Migration] 迁移失败: engine
```

源码对应关系：

- `src/core/configuration/script/manager.ts` 在 `ConfigurationManager.initialize()` 中调用 `migrate()`。
- `migrate()` 调用 `migrateFromProject()`，再进入 `CocosMigrationManager.migrate()`。
- `src/core/configuration/migration/register-migration.ts` 的 `engine` 迁移器只判断 `oldConfig.modules` 是否存在，随后直接执行 `Object.keys(oldConfig.modules.configs)`。
- 真实测试项目 `settings/v2/packages/engine.json` 有 `modules.cache`、`modules.includeModules`、`modules.flags`，但没有 `modules.configs`。
- Editor baseline 副本打开后同一文件已被 Editor 3.8.6 升级为 `modules.configs.migrationsConfig` 与 `globalConfigKey` 结构。

结论：`package.json["cocos-cli"].enginePath` 适配已经生效；当时不能进入 `.anim.meta` importer 修复阶段，因为 CLI import 被旧 `engine.json` 迁移结构阻塞。失败 import 写出的 `assets/` 产物已保存到测试项目 stash：`codex failed project-config cli import before migration fix 20260611`。

## Phase 3 解除配置阻塞

用户确认不需要修改 preview runtime 触发方式，并要求直接把 Editor 打开过的项目 `settings` 复制到 CLI 要打开的真实测试项目。已执行：

```text
from: E:\own_space\engines\cocos-cli\.codex-tmp\source-meta-editor-parity\run-20260611-174959\editor-project\settings
to:   E:\own_space\engines\cocos-test-projects\settings
```

复制后真实测试项目出现预期配置 diff：

```text
package.json
settings/v2/packages/builder.json
settings/v2/packages/engine.json
settings/v2/packages/information.json
settings/v2/packages/scene.json
```

`settings/v2/packages/engine.json` 已包含：

```text
modules.configs.migrationsConfig
modules.globalConfigKey = migrationsConfig
```

再次运行 preview runtime 后通过迁移并到达 `preview:ready`：

```text
[Migration] 所有迁移执行成功
[runtime-preview] engineRootSource=project-config
[runtime-preview] preview:ready
```

## Phase 3 `.anim.meta` parity 结果

运行：

```text
npm --prefix vitests test -- suites/runtime-preview/source-meta-editor-parity.test.ts
```

结果失败，失败原因回到本专项目标：

```text
Editor: ver=2.0.3 files=[".cconb"]
CLI:    ver=2.0.4 files=[".bin"]
```

19 个 `.anim.meta` 全部表现为相同差异，包括：

```text
cases/animation/Animations/AnimationEvent.anim.meta
cases/animation/Animations/cube_mainColor.anim.meta
cases/animation/Animations/Easing_Bounce.anim.meta
cases/animation/Animations/Easing_Linear.anim.meta
cases/animation/Animations/Easing_Sine.anim.meta
cases/animation/Animations/MaterialTexture(Animation Editor Case).anim.meta
cases/animation/Animations/sprite_color.anim.meta
cases/dynamic-mesh/Deserted/Ani/CamAnimation.anim.meta
cases/GFX/setMipRange/setMipRange-camera.anim.meta
cases/particle/res/rotate.anim.meta
cases/particle/res/trail-roation.anim.meta
cases/particle/res/trail3.anim.meta
cases/particle/res/translate.anim.meta
cases/scene/camera/dance.anim.meta
cases/ui/04.widget/widget.anim.meta
cases/ui/13.sprite-anim/run.anim.meta
cases/ui/24.motion-streak/move_around.anim.meta
resources/test_assets/testAnim.anim.meta
shared-res/tips/tips-animation.anim.meta
```

源码链路：

- `src/core/assets/asset-handler/config.ts` 将 `.anim` 注册到 `assets/animation-clip`。
- `src/core/assets/asset-handler/assets/animation-clip.ts` 中 `AnimationHandler.importer.version = '2.0.4'`。
- `AnimationHandler.import()` 读取 source `.anim`，`cc.deserialize()` 为 `AnimationClip`，调用 `serializeForLibrary(clip)`。
- `src/core/assets/asset-handler/assets/utils/serialize-library.ts` 对 `AnimationClip` 设置 `useCCON = true`，`EditorExtends.serialize()` 返回 `CCON` 后调用 `encodeCCONBinary()`，但返回 `extension: '.bin'`。
- `AnimationHandler.import()` 使用这个 `extension` 调 `asset.saveToLibrary(extension, data)`，`@cocos/asset-db` 因此把 source `.anim.meta.files` 写成 `.bin`。

历史失败基线结论：配置阻塞已经解除；真正原因是 CLI `animation-clip` importer 的版本和 CCON library extension 与 Editor 3.8.6 输出规则不一致。后续修复范围应限制在 `.anim` source importer：将 importer version 对齐 `2.0.3`，并让 `AnimationClip` CCON binary 写入 `.cconb`，不要扩大到其他资源类型，除非进一步事实证明共享 `serializeForLibrary()` 必须区分调用场景。该修复后续已执行，当前状态见本文“最终结论”。

## Phase 1 Editor baseline 副本事实

- run root：`E:\own_space\engines\cocos-cli\.codex-tmp\source-meta-editor-parity\run-20260611-174959`。
- Editor project 副本：`E:\own_space\engines\cocos-cli\.codex-tmp\source-meta-editor-parity\run-20260611-174959\editor-project`。
- CLI project：`E:\own_space\engines\cocos-test-projects`。
- 复制命令排除：`.git`、`library`、`temp`、`node_modules`、`.codex-tmp`。
- 复制结果：`4579` files，约 `437.99 m`。

## Phase 2 Editor baseline 事实

Editor 启动命令形态：

```text
D:\cocos_editors\Creator\Creator\3.8.6\CocosCreator.exe --nologin --project E:\own_space\engines\cocos-cli\.codex-tmp\source-meta-editor-parity\run-20260611-174959\editor-project
```

执行结果：

- Editor process pid：`40224`。
- baseline 副本 import 后 `library` 写入稳定。
- 发现 `.anim.meta` 数量：`19`。
- import 稳定后已停止 Editor process。
- Editor 打开副本后，副本 `package.json.creator.version` 被更新为 `3.8.6`；真实测试项目仓库未被 Editor 打开。

## Editor `.anim.meta` 事实

| Meta path | importer | ver | files |
| --- | --- | --- | --- |
| `assets/cases/animation/Animations/AnimationEvent.anim.meta` | `animation-clip` | `2.0.3` | `[".cconb"]` |
| `assets/cases/animation/Animations/cube_mainColor.anim.meta` | `animation-clip` | `2.0.3` | `[".cconb"]` |
| `assets/cases/animation/Animations/Easing_Bounce.anim.meta` | `animation-clip` | `2.0.3` | `[".cconb"]` |
| `assets/cases/animation/Animations/Easing_Linear.anim.meta` | `animation-clip` | `2.0.3` | `[".cconb"]` |
| `assets/cases/animation/Animations/Easing_Sine.anim.meta` | `animation-clip` | `2.0.3` | `[".cconb"]` |
| `assets/cases/animation/Animations/MaterialTexture(Animation Editor Case).anim.meta` | `animation-clip` | `2.0.3` | `[".cconb"]` |
| `assets/cases/animation/Animations/sprite_color.anim.meta` | `animation-clip` | `2.0.3` | `[".cconb"]` |
| `assets/cases/dynamic-mesh/Deserted/Ani/CamAnimation.anim.meta` | `animation-clip` | `2.0.3` | `[".cconb"]` |
| `assets/cases/GFX/setMipRange/setMipRange-camera.anim.meta` | `animation-clip` | `2.0.3` | `[".cconb"]` |
| `assets/cases/particle/res/rotate.anim.meta` | `animation-clip` | `2.0.3` | `[".cconb"]` |
| `assets/cases/particle/res/trail-roation.anim.meta` | `animation-clip` | `2.0.3` | `[".cconb"]` |
| `assets/cases/particle/res/trail3.anim.meta` | `animation-clip` | `2.0.3` | `[".cconb"]` |
| `assets/cases/particle/res/translate.anim.meta` | `animation-clip` | `2.0.3` | `[".cconb"]` |
| `assets/cases/scene/camera/dance.anim.meta` | `animation-clip` | `2.0.3` | `[".cconb"]` |
| `assets/cases/ui/04.widget/widget.anim.meta` | `animation-clip` | `2.0.3` | `[".cconb"]` |
| `assets/cases/ui/13.sprite-anim/run.anim.meta` | `animation-clip` | `2.0.3` | `[".cconb"]` |
| `assets/cases/ui/24.motion-streak/move_around.anim.meta` | `animation-clip` | `2.0.3` | `[".cconb"]` |
| `assets/resources/test_assets/testAnim.anim.meta` | `animation-clip` | `2.0.3` | `[".cconb"]` |
| `assets/shared-res/tips/tips-animation.anim.meta` | `animation-clip` | `2.0.3` | `[".cconb"]` |

可以进入 Phase 3。

## 后续观察：`.cconb` 二进制产物未完全对齐

在将 CLI `.anim` source `.meta` 写回规则调整到 Editor 3.8.6 的 `ver=2.0.3`、`files=[".cconb"]` 后，重新运行 CLI import，并补齐 Editor baseline project 的 19 个 `.anim` 对应 `.cconb` 产物。

对比范围：

- Editor baseline project：`E:\own_space\engines\cocos-cli\.codex-tmp\source-meta-editor-parity\run-20260611-174959\editor-project`
- CLI project：`E:\own_space\engines\cocos-test-projects`
- 对比对象：19 个 `.anim.meta` 对应 `library/<uuid-prefix>/<uuid>.cconb`
- 对比方式：文件 size 与 SHA256 byte-level comparison

对比结果：

```text
TOTAL=19 SAME=3 DIFF=16 MISSING=0
```

结论：

- `.anim` source `.meta` parity 已验证通过，目标差异已从 `.meta` 层面消除。
- `.cconb` library 二进制产物仍未与 Editor 3.8.6 完全 byte-identical。
- 该差异不是 Editor baseline 未生成导致，`MISSING=0`。
- 目前只记录为独立后续问题，暂不继续追查 Editor 3.8.6 对 `.anim` 的 import/serialize 细节。

## 最终结论

- `.anim` source `.meta` parity 已完成：CLI import 后写回的 `.anim.meta` 与 Editor 3.8.6 baseline 对齐。
- 当前修复不代表所有 `assets/**/*.meta` 资源类型都已完成 Editor parity；其它资源类型仍按 [../issues.md](../issues.md) 的 `RP-ISSUE-008` 追踪。
- `.cconb` byte-level parity 是独立后续观察，不影响 `.anim.meta.files` 从 `.bin` 修正为 `.cconb` 的 source `.meta` parity 结论。
