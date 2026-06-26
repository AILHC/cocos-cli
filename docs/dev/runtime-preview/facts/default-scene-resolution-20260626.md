# Runtime Preview 默认场景解析缺失事实记录

## 背景

2026-06-26 在真实业务项目上启动 `preview --runtime` 时，如果命令不显式传入 `--scene`，runtime preview 页面提示没有可加载场景；同一项目的 Editor 当前场景配置存在，且场景资源和 library JSON 产物也存在。

本记录只登记事实、复现条件和当前源码分析，不包含修复方案实现。

## 复现环境

- 操作系统：Windows，本地 shell 使用 PowerShell。
- CLI：当前仓库 `dist/cli.js`，通过 Node.js 启动。
- 引擎：项目配置解析到 Cocos Creator 3.8.6 engine root。
- 复现项目：P7 `Client-fight-roguelike-migration` 真实业务项目。
- 预览端口：`9528`。

为避免把本机盘符路径写入长期文档，下文使用环境代号：

- `<COCOS_CLI_ROOT>`：当前 `cocos-cli` 仓库。
- `<P7_ROGUELIKE_PROJECT>`：复现用 P7 真实业务项目。
- `<COCOS_ENGINE_ROOT>`：项目配置解析出的 Cocos Creator 3.8.6 engine root。

## 复现命令

不传 `--scene`：

```powershell
node <COCOS_CLI_ROOT>/dist/cli.js preview --runtime --project <P7_ROGUELIKE_PROJECT> --port 9528
```

## 复现条件

复现项目同时满足以下条件：

1. `settings/v2/packages/scene.json` 存在，并包含 Editor 当前场景：

```json
{
  "current-scene": "4c721bfe-0b6e-46c2-97f0-644adfdcba31"
}
```

2. 当前场景 UUID 对应 `assets/scenes/start.scene.meta`：

```json
"uuid": "4c721bfe-0b6e-46c2-97f0-644adfdcba31"
```

3. `profiles/v2/packages/preview.json` 不存在，因此没有 `general.start_scene`。

4. library 中存在场景 JSON：

```text
library/4c/4c721bfe-0b6e-46c2-97f0-644adfdcba31.json
```

5. 场景索引写在 CLI shared output 文件：

```text
library/.cli-assets-data.json
```

其中包含：

```json
"4c721bfe-0b6e-46c2-97f0-644adfdcba31": {
  "url": "db://assets/scenes/start.scene"
}
```

6. 以下两个 runtime preview resolver 当前查找的索引文件不存在：

```text
library/.assets-data.json
library/cli/.assets-data.json
```

## 实际现象

runtime preview 启动成功，HTTP server 可访问，但 settings 构建阶段没有 start scene：

```text
server:listening http://127.0.0.1:9528
settings:build:start scene=
settings:build:done durationMs=13265 scene= scripts=3026 bundles=6
preview:ready durationMs=612253
```

页面侧因为 `launchScene` 为空，进入空场景提示分支，表现为没有场景可加载。

在显式传入 `--scene 4c721bfe-0b6e-46c2-97f0-644adfdcba31` 后，`settings.js` 中的 `launch.launchScene` 会变为正确 UUID，但仍可复现另一层 scene resolver 问题：

```text
GET /scene-list
{"scenes":[],"currentScene":"4c721bfe-0b6e-46c2-97f0-644adfdcba31"}

GET /scene/4c721bfe-0b6e-46c2-97f0-644adfdcba31.json
404 {"error":"Scene asset JSON not found","uuid":"4c721bfe-0b6e-46c2-97f0-644adfdcba31"}
```

同时本地文件实际存在：

```text
library/4c/4c721bfe-0b6e-46c2-97f0-644adfdcba31.json
library/.cli-assets-data.json
```

因此显式 `--scene` 只能绕过 `settings.js` 的空 `launchScene`，不能修复 `/scene-list` 与 `/scene/<uuid>.json` 对 shared CLI records 的解析缺失。

## 源码事实

### 命令层只透传 `--scene`

`src/commands/preview.ts` 中 runtime 分支把 `options.scene` 传给 `Launcher.startRuntimePreview()`：

```ts
scene: options.scene,
```

这里没有读取 `settings/v2/packages/scene.json`。

### 启动 warm-up 没有默认场景兜底

`src/core/launcher.ts` 的启动预热调用为：

```ts
await settingsProvider.getPreviewSettings(options.scene ? { startScene: options.scene } : undefined);
```

当命令不传 `--scene` 时，传入 `undefined`，因此日志中的 `settings:build:start scene=` 为空。

### runtime scene resolver 不读 Editor 当前场景配置

`src/runtime-preview/server/preview-scenes.ts` 的 `readProfileStartScene()` 读取：

```text
profiles/v2/packages/preview.json
```

字段为：

```text
general.start_scene
```

它没有读取 Editor 当前场景配置：

```text
settings/v2/packages/scene.json
```

### fallback 场景列表没有覆盖 CLI shared output 文件名

`listPreviewScenes()` 通过 `loadAssetData()` 读取 asset data，而 `loadAssetData()` 固定读取：

```text
.assets-data.json
```

当前复现项目的实际索引文件是：

```text
.cli-assets-data.json
```

因此 fallback 的 `findFirstLoadableScene()` 无法枚举到 `start.scene`，即使对应 scene JSON 文件实际存在。

`resolveSceneJsonFile()` 也复用同一个 `loadAssetData()`，所以它同样无法识别 `.cli-assets-data.json` 中已有的 scene 记录，最终导致 `/scene/<uuid>.json` 返回 `Scene asset JSON not found`。

## 为什么读 `.assets-data.json` 而不是 `.cli-assets-data.json`

从 git 历史看，这不是项目资源问题，而是两个阶段的实现没有同步：

1. `e153735bb`（2026-06-09，`fix runtime preview scene loading`）新增 `src/runtime-preview/server/preview-scenes.ts`。该提交中 `loadAssetData(root)` 直接写死读取 `join(root, '.assets-data.json')`。当时 runtime preview scene resolver 的事实来源是 Editor / legacy AssetDB records。
2. `256bfa13`（2026-06-23，`feat(asset-db): bootstrap cli sidecar records`）新增 `bootstrapAssetsSidecarRecords()`，开始为 CLI sidecar records 生成 `.cli-assets-data.json` 等文件。
3. `00279bcd`（2026-06-24，`fix(build): default to shared asset library`）把默认策略改成 shared project library：`COCOS_CLI_SHARED_LIBRARY_OUTPUT !== '0'` 时，assets library 使用 `library`，records 使用 `library/.cli-assets-data.json`、`library/.cli-assets-info.json`、`library/.cli-assets-dependency.json` 和 `library/.cli-assets`。
4. 同一个 `00279bcd` 只同步了 `Launcher.startRuntimePreview()` 的 `projectLibraryRoot`，让 runtime preview 默认指向 `library`；没有同步 `preview-scenes.ts` 的 record file name 选择逻辑。

也就是说，`preview-scenes.ts` 的 `getProjectLibraryRoots()` 已经会查 `library`，但 `loadAssetData()` 在每个 root 下仍只找 `.assets-data.json`。shared output 默认化后，当前 CLI 真实 records 名称变成 `.cli-assets-data.json`，两者产生错位。

## 最近修改相关判断

最近相关修改的核心目标是让 CLI / runtime preview 默认共享项目级 `library`，同时用 `.cli-*` sidecar records 避免覆盖 Editor records。这个策略本身和 `AssetConfig` 当前配置一致：

```text
assets library: library
assets records data: library/.cli-assets-data.json
```

但 runtime preview 的 scene resolver 没有走 `AssetConfig`，也没有读取 runtime context 中的 record paths；它只从 physical library root 推导固定文件名 `.assets-data.json`。因此最近 shared output 改动扩大了问题暴露面：

- shared output 默认开启前，`projectLibraryRoot` 常见为 `library/cli`，对应 records 是 `library/cli/.assets-data.json`，旧 resolver 可以读到。
- shared output 默认开启后，`projectLibraryRoot` 变为 `library`，对应 records 是 `library/.cli-assets-data.json`，旧 resolver 读不到。

这解释了为什么当前真实项目里 `library/.cli-assets-data.json` 有 `start.scene` 记录，但 `/scene-list` 仍为空。

## 当前判断

不传 `--scene` 时没有默认场景，以及显式传 `--scene` 后 `/scene-list` 为空、`/scene/<uuid>.json` 404，原因不是项目缺少场景，也不是场景 JSON 缺失，而是 runtime preview 默认场景解析链路缺少两类兼容：

1. 未读取 Editor 当前场景配置 `settings/v2/packages/scene.json`。
2. fallback 场景列表只读取 `.assets-data.json`，没有覆盖当前 shared output 的 `.cli-assets-data.json`。

短期绕法是显式传入：

```powershell
--scene 4c721bfe-0b6e-46c2-97f0-644adfdcba31
```

长期修复应让 runtime preview 在没有显式 `--scene` 时仍能从项目真实配置和当前 CLI library 产物中解析默认可加载场景。

## 2026-06-26 候选修复记录

当前分支已实现候选代码修复，修复范围限定在 runtime preview scene resolver 和默认 scene 解析；但尚未用 P7 `Client-fight-roguelike-migration` 真实项目构建 `dist` 后启动 `preview --runtime` 验收，因此本记录不能作为真实项目闭环证据。

1. `src/runtime-preview/server/preview-scenes.ts` 在 `projectLibraryRoot` 为 `<project>/library` 时，按 shared output 默认语义先读取 `<project>/library/.cli-assets-data.json`；如果 shared sidecar records 不存在，再兼容 legacy isolated output `<project>/library/cli/.assets-data.json`；最后才兼容 frozen / Editor 形态的 `<project>/library/.assets-data.json`。
2. `/scene-list` 和 `/scene/<uuid>.json` 现在可在只存在 `library/.cli-assets-data.json` 与 `library/<prefix>/<uuid>.json` 的 shared output fixture 中返回 scene 记录和 scene JSON。
3. `resolveRuntimePreviewStartScene()` 在没有 URL `scene`、没有 CLI `--scene`，且 `profiles/v2/packages/preview.json` 不提供有效 `general.start_scene` 时，会读取 `settings/v2/packages/scene.json` 的 `current-scene`，并只在该 scene 能通过当前 scene records 解析时作为默认 scene；否则回退到 first loadable scene。
4. `current_scene` keyword 也使用上述 Editor current scene 解析；无法解析时保持 first loadable scene fallback。

新增回归测试：

```text
vitests/suites/runtime-preview/preview-app-route-contract.test.ts
```

覆盖：

- shared CLI sidecar records 优先于 stale `library/cli/.assets-data.json`。
- shared sidecar records 缺失时，legacy `library/cli/.assets-data.json` 优先于 editor/frozen `library/.assets-data.json`。
- 不传 scene 时使用 `settings/v2/packages/scene.json` 的 `current-scene` 生成 `/settings.js`。

验证命令：

```powershell
$env:COCOS_CLI_TEST_PROJECT_ROOT='E:\own_space\cocos_work_lab_38x'
$env:COCOS_CLI_TEST_ENGINE_ROOT='D:\workspace\engines\cocos\3.8.6'
$env:COCOS_CLI_TEST_EDITOR_LIBRARY_REF='E:\own_space\engines\cocos-cli\.codex-tmp\reference-library\cocos_work_lab_38x-editor-library-20260606'
$env:COCOS_CLI_TEST_EDITOR_PROGRAMMING_REF='E:\own_space\engines\cocos-cli\.codex-tmp\reference-temp\cocos_work_lab_38x-editor-programming-20260606'
npm run test -- suites/runtime-preview/preview-app-route-contract.test.ts
```

结果：`22 passed`。

待补真实验收：

```powershell
node <COCOS_CLI_ROOT>/dist/cli.js preview --runtime --project <P7_ROGUELIKE_PROJECT> --port 9528
```

验收点：

- 不传 `--scene` 时 `/settings.js` 中 `launch.launchScene` 为 `4c721bfe-0b6e-46c2-97f0-644adfdcba31`。
- `/scene-list` 返回包含该 UUID 的 scenes，且 `currentScene` 为该 UUID。
- `/scene/4c721bfe-0b6e-46c2-97f0-644adfdcba31.json` 返回 200，并来自 `library/4c/4c721bfe-0b6e-46c2-97f0-644adfdcba31.json`。
