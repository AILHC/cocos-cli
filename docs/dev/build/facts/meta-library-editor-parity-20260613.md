# CLI Build 写入 `.meta` 与 `library` 顶层 JSON 验证记录

日期：2026-06-13

相关正式模块文档：

- [Builder Module](../../modules/builder.md)
- [AssetDB Module](../../modules/asset-db.md)
- [Configuration Module](../../modules/configuration.md)
- [Scripting Module](../../modules/scripting.md)

## 验证目标

验证 CLI build 在主测试项目中是否会额外改写 `.meta` 与 `library` 顶层 JSON，并判断写入结果是否与 Editor baseline 一致。

本轮不要求 CLI 禁止写 `.meta` 或 `library` 顶层 JSON。判断标准是：同一 Editor baseline 下，CLI 写出的 importer `ver`、字段结构、默认值、文件命名和 data shape 应与 Editor 行为一致。

## Baseline

- CLI 仓库：`E:\own_space\engines\cocos-cli`
- 主测试项目：`E:\own_space\engines\cocos-test-projects`
- `.meta` baseline：主测试项目当前 git 提交。用户已确认 Editor 打开项目产生的大量 `.meta` 迁移变更已经提交。
- `library` 顶层 JSON baseline：`E:\own_space\engines\cocos-cli\.codex-tmp\bak_test_projects_library_data_json`
- 构建配置：`E:\own_space\engines\cocos-test-projects\profiles\v2\packages\web-mobile.json`
- 构建输出：`E:\own_space\engines\cocos-test-projects\build\codex-cli-output\cli-side-effect-check`

## Editor baseline 产物事实

来源：`E:\own_space\engines\cocos-cli\.codex-tmp\bak_test_projects_library_data_json`。当前阶段以用户提供的 Editor backup 作为权威产物 baseline；若后续要证明 Editor 内部 `AssetDB` 版本或 patch，应作为附加事实，不替代这个产物 baseline。

文件集合共 10 个顶层 JSON：

| 文件 | 字节数 | 顶层结构 | raw SHA256 | canonical JSON SHA256 |
| --- | ---: | --- | --- | --- |
| `.assets-data.json` | 1395112 | 5494 个 uuid-like keys | `e60c6a434862a0a5b491ca7c27a75f567980f285edd7577c87bbb077fec99900` | `0eff4382e4ed4ba1fb94f90263a887e459d3e46ea53c1e0a9a39702ccb909001` |
| `.assets-dependency.json` | 162981 | `path` / `uuid` | `8d3481be81c24e0301ac9bc1aa23f01e5d94cf3bd83d51bbe5bddeeef60133ed` | `4b587acfb7c6898906e8ed4cad0ca1737764060477d3ef642175e84e0eec6b88` |
| `.assets-info1.0.0.json` | 886206 | `version` / `map` / `missing` | `6fe120933f56cb841806035c2a4e5f7f8d6090de8643e20f4dfc1cac8b1835f3` | `10361cda61d9748415a301eaf97233e7a4d90379a77c33e93115fa29a985a72d` |
| `.internal-data.json` | 113080 | 597 个 uuid-like keys | `b623f3500205a5626772e9415f519f004f94f22e5c7cc922ecd9859bdaf2765a` | `c9f297d95c17718018c8bba32b871274ba9f398414b450bb111bbc447ec4c572` |
| `.internal-dependency.json` | 287569 | `path` / `uuid` | `3a5e00e3acb20dfd89b34597fd0fffdc65f5af44eca78caa576b9bf1ff40e992` | `2198a77e1523946bb3dd2db5eebbca9e81b3958a0211f7fc23fb4180441f6648` |
| `.internal-info1.0.0.json` | 173288 | `version` / `map` / `missing` | `3f13a618531a013e62f8eda36512ca7c5ba07d0cd4da5d514568a17b84e56a2b` | `f38c9de32bdebb10eee1543b3150741f36cbef70d5f40b003a3e46c5df8fecac` |
| `.localization-editor-data.json` | 2844 | 19 个 uuid-like keys | `5abb4da13d7a1f909ed1e1aa6212eb6efb2062a4015a5ff7ab89827ab7ccaf72` | `790d1c0d3a1845df88c6bcaf989ae14aee38eb35090a34665a5064ea37f0e357` |
| `.localization-editor-info1.0.0.json` | 7421 | `version` / `map` / `missing` | `9742d0ae6ea1b1d87b3fa5d3a8b1a72ebd2e1e5b3ec0fabc7ec0f7e77654fddd` | `0925a3b9b27c9f29a69b327d82862bfd76e73d2cb29c81085e526e9fc6d0099f` |
| `.view-state-group-data.json` | 449 | 3 个 uuid-like keys | `aebd73e9cf21aaa6f2028ca01ef5e85728fc114abd666bfd0769595ba1edc5c7` | `184fa3da67e2b321a889f6a85fe86ca655fbea5f2ace837d9a498167fe02eae3` |
| `.view-state-group-info1.0.0.json` | 1170 | `version` / `map` / `missing` | `ac57c8614d982fa3f25570e0cdc2569ebd9f939b34c63511ad73a4c78b978eaa` | `bbd1a76a4c280d71d25532ac149f0095b4c8bd5a6ffe55a06a7778950f841412` |

关键 schema 摘要：

| 文件 | version / 数量 | 顶层字段或 value shape |
| --- | --- | --- |
| `.internal-info1.0.0.json` | `version: 1.0.0`；`map: 1002`；`missing: 0` | 顶层字段为 `version` / `map` / `missing`，文件名带 `1.0.0` |
| `.internal-dependency.json` | `path: 88`；`uuid: 31` | 顶层字段为 `path` / `uuid`，没有 `data` / `version` 包裹 |
| `.internal-data.json` | 597 个 uuid-like keys | 每个 value 的字段形状为 `url` / `value` / `versionCode` |
| `.assets-info1.0.0.json` | `version: 1.0.0`；`map: 4898`；`missing: 0` | 同样使用 `*.info1.0.0.json` 旧文件名 |
| `.assets-dependency.json` | `path: 259`；`uuid: 185` | 同样使用顶层 `path` / `uuid` 旧结构 |

阶段性修复层级判断：

- Editor baseline 在项目 `library` 顶层保留旧 record schema，不是仅 key 顺序或格式化差异。
- CLI 当前 `internal.library` 也指向 `<project>/library`，这一路径策略本身与产物位置不冲突；冲突集中在 `@cocos/asset-db` record manager 写入 schema / migration 策略。
- 因此下一步优先在 vendored `packages/asset-db` 中实现可解释的 compatibility mode，使 CLI 写出的 `internal` 顶层 record 与 Editor baseline 的文件名和结构一致；除非后续发现 Editor 实际使用了不同 `internal.library` 策略，否则不优先修改 `src/core/assets/asset-config.ts`。

## Build 前检查

命令：

```powershell
git status --short
git diff --name-only -- ":(glob)**/*.meta"
git ls-files --others --exclude-standard -- ":(glob)**/*.meta"
```

结果：

- 主测试项目 build 前 `.meta` 无 dirty 输出。
- 当前项目 `library` 顶层 JSON 与 backup baseline 文件集合一致，共 10 个 JSON：
  - `.assets-data.json`
  - `.assets-dependency.json`
  - `.assets-info1.0.0.json`
  - `.internal-data.json`
  - `.internal-dependency.json`
  - `.internal-info1.0.0.json`
  - `.localization-editor-data.json`
  - `.localization-editor-info1.0.0.json`
  - `.view-state-group-data.json`
  - `.view-state-group-info1.0.0.json`
- build 前同名文件 raw SHA256 与 canonical JSON SHA256 均一致。
- build 前路径污染扫描未命中 `cocos-cli`、`library/cli`、`temp/cli` 或 `E:\own_space\engines\cocos-cli`。

## Build 命令

```powershell
node .\dist\cli.js build `
  --project "E:\own_space\engines\cocos-test-projects" `
  --platform web-mobile `
  --build-config "E:\own_space\engines\cocos-test-projects\profiles\v2\packages\web-mobile.json" `
  --buildPath "project://build/codex-cli-output" `
  --outputName "cli-side-effect-check"
```

结果：

- Cocos build log 显示构建成功：
  - `Build completed successfully for web-mobile in 1 min 16 s`
  - `Build Dest: project://build/codex-cli-output/cli-side-effect-check`
- 最新日志：`E:\own_space\engines\cocos-test-projects\temp\logs\cocos-20260613012305.log`
- 命令被外层工具在 10 分钟后 timeout，因此未取得真实进程退出码。
- timeout 后检查 `node.exe` command line，未发现仍在运行的本次 `build` / `cli-side-effect-check` 进程。

## Build 后 `.meta` 差异

总数：

| 分类 | 数量 |
| --- | ---: |
| 全部 `.meta` 变更 | 290 |
| 3D 扩展名候选 `.gltf.meta` / `.glb.meta` / `.fbx.meta` | 286 |
| 非 3D 扩展名 `.meta` | 4 |

3D 候选按扩展名：

| 扩展名 | 数量 |
| --- | ---: |
| `.fbx.meta` | 28 |
| `.glb.meta` | 188 |
| `.gltf.meta` | 70 |

非 3D `.meta` 变更：

| importer | 数量 | 旧 `ver` | 新 `ver` | 字段变化 | 典型路径 | 判断 |
| --- | ---: | --- | --- | --- | --- | --- |
| `typescript` | 4 | `4.0.24` | `4.0.24` | `imported: true -> false` | `assets/cases/GFX/mipmapCheck/mipmapCheck.ts.meta` | 与 Editor baseline 不一致，需要定位 |

完整非 3D 路径：

- `assets/cases/GFX/mipmapCheck/mipmapCheck.ts.meta`
- `assets/cases/GFX/setMipRange/setMipRange-cube.ts.meta`
- `assets/cases/GFX/setMipRange/setMipRange-quad.ts.meta`
- `assets/cases/localization-editor/script/ChangeLanguage.ts.meta`

事实判断：

- 第一阶段可忽略 3D 相关 `.meta`。
- 非 3D `typescript` `.meta` 被 CLI build 改写，且不是 importer `ver` 迁移，而是 `imported` 状态被改为 `false`。
- 这不符合“CLI 可写 `.meta`，但写入结果要与 Editor baseline 一致”的要求。

## Build 后 `library` 顶层 JSON 差异

build 后当前项目顶层 JSON 文件集合变为：

- `.assets-data.json`
- `.assets-dependency.json`
- `.assets-info1.0.0.json`
- `.internal-data.json`
- `.internal-dependency.json`
- `.internal-info.json`
- `.localization-editor-data.json`
- `.localization-editor-info1.0.0.json`
- `.view-state-group-data.json`
- `.view-state-group-info1.0.0.json`

相对 baseline 的文件集合差异：

| 类型 | 文件 |
| --- | --- |
| 新增 | `.internal-info.json` |
| 缺失 | `.internal-info1.0.0.json` |

发生 canonical JSON 变化的文件：

| 文件 | 变化 |
| --- | --- |
| `.internal-data.json` | raw hash 与 canonical hash 均变化；顶层 key 数仍为 597；key 集合不变；50 个 value 变化 |
| `.internal-dependency.json` | raw hash 与 canonical hash 均变化；顶层结构从 `path` / `uuid` 变为 `data` / `version` |
| `.internal-info.json` | build 后新增；顶层 keys 为 `version` / `map` / `missing`；`version` 为 `1.0.1`；`map` 数量 1002 |
| `.internal-info1.0.0.json` | build 后缺失；baseline 中 `version` 为 `1.0.0`；`map` 数量 1002 |

`.internal-dependency.json` shape 对比：

| 来源 | 顶层 keys | 版本 / 数量 |
| --- | --- | --- |
| build 后项目文件 | `data`, `version` | `version: 1.0.0`；`data` 下 2 个 key |
| baseline 文件 | `path`, `uuid` | `path` 下 88 个 key；`uuid` 下 31 个 key |

`.internal-data.json` sample：

| uuid | baseline | build 后 |
| --- | --- | --- |
| `2be36297-9abb-4fee-8049-9ed5e271da8a` | `db://internal/default-video.mp4` 的 `value` 含 `depends` | `value` 为空对象 |
| `1263d74c-8167-4928-91a6-4e2672411f47` | `db://internal/primitives.fbx` 的 `versionCode: 1` | `versionCode: 3` |
| `bb0a6472-cd67-4afb-a031-94fca8f4cc92` | `db://internal/default_prefab/Camera.prefab` 的 `versionCode: 1` | `versionCode: 2` |

路径污染扫描：

- build 后顶层 JSON 未命中 `cocos-cli`、`library/cli`、`temp/cli` 或 `E:\own_space\engines\cocos-cli`。

事实判断：

- `library` 顶层 JSON 变化不是格式化或 key 顺序变化，而是 semantic schema / version / value 变化。
- 变化集中在 `internal` DB 顶层数据，已复现 `BUILD-ISSUE-007` 描述的风险。

## 源码定位事实

当前调用链：

- `src/core/launcher.ts`
  - `Launcher.build()` 先执行 `await this.import()`。
  - `Launcher.import()` 中执行 `initAssetDB()` / `startAssetDB()`。
- `src/core/assets/index.ts`
  - `initAssetDB()` 调用 `assetConfig.init()`、`assetManager.init()`、`assetDBManager.init()`。
  - `startAssetDB()` 调用 `assetDBManager.start()`。
- `src/core/assets/asset-config.ts`
  - `assets` DB：
    - `target`: `<project>/assets`
    - `readonly: false`
    - `library`: `<project>/library/cli`
  - `internal` DB：
    - `target`: `<engine>/editor/assets`
    - `readonly: true`
    - `library`: `<project>/library`
- `src/core/assets/manager/asset-db.ts`
  - `_createDB()` 会 `ensureDirSync(info.library)`，然后 `assetdb.create(info)`。
  - `_startDB()` 调用 `db.start({ hooks })`。

依赖版本：

- `@cocos/asset-db`: `3.0.0-alpha.10`
- `@cocos/ccbuild`: `2.3.19`

## 原因分析：4 个 `typescript` `.meta` 被改为 `imported: false`

直接日志证据：

- `.codex-tmp\build-cli-side-effect-check.out` 中出现 4 条 `Failed to import script`：
  - `E:\own_space\engines\cocos-test-projects\assets\cases\GFX\mipmapCheck\mipmapCheck.ts`
  - `E:\own_space\engines\cocos-test-projects\assets\cases\GFX\setMipRange\setMipRange-cube.ts`
  - `E:\own_space\engines\cocos-test-projects\assets\cases\GFX\setMipRange\setMipRange-quad.ts`
  - `E:\own_space\engines\cocos-test-projects\assets\cases\localization-editor\script\ChangeLanguage.ts`
- 4 条失败之后均有 `Importer exec failed`，对应 uuid 与 `.meta` diff 一致：
  - `5f331eb5-3c75-4fa0-889e-da62e9ab539c`
  - `be664726-5f3a-49bf-ace2-4140ed278dc4`
  - `0918247d-f1b9-410e-a533-be2b4f6fdd4f`
  - `8290efe8-d075-412f-8645-eb5442f14469`
- 失败原因相同：

```text
resolve_error_module_not_found:
{"specifier":"./core/l10n-manager","parentURL":"file:///E:/own_space/engines/cocos-test-projects/extensions/localization-editor/static/assets/l10n.ts"}
```

磁盘事实：

- `E:\own_space\engines\cocos-test-projects\extensions\localization-editor\static\assets\l10n.ts` 存在。
- `l10n.ts` 第一行是 `import l10n, { L10nManager } from './core/l10n-manager';`。
- `E:\own_space\engines\cocos-test-projects\extensions\localization-editor\static\assets\core\l10n-manager.ts` 实际存在。
- 因此错误不是物理文件缺失，而是当前 CLI scripting packer 在该阶段的 module graph / resolver 中没有把该相对依赖解析为可用模块。

代码链路：

- `src/core/assets/asset-handler/assets/typescript.ts`
  - `TypeScriptHandler.importer.import()` 直接调用 `JavascriptHandler.importer.import(asset)`。
- `src/core/assets/asset-handler/assets/javascript.ts`
  - 非 plugin script 会调用 `scripting.compileScripts([{ type, uuid, filePath, importer, userData }])`。
  - `compileScripts()` 抛错时打印 `Failed to import script ${asset.source}`，然后继续抛出错误。
- `node_modules/@cocos/asset-db/libs/task.js`
  - `ImportTask.importAsset()` 在 importer 抛错时设置 `t.invalid = true`、`t.importError = error`。
  - 该流程不会走到成功分支的 `t.imported = true`。
  - import 前会执行 `t.reset()`，`Asset.reset()` 内会设置 `this.imported = false`；后续 `t.save()` 写回 `.meta`，因此 `.meta.imported` 从 `true` 变为 `false`。

补充事实：

- 同一次 build 后半段的 `buildScriptCommand` 日志中能看到 `localization-editor/static/assets/core/l10n-manager.ts` 被编进 `temp/cli/programming/packer-driver/targets/editor/chunks/...`。
- 这说明最终 build script 打包阶段能够处理部分 `localization-editor` 源文件；失败发生在 AssetDB 启动期的逐个 `typescript` importer 增量编译阶段。
- 当前更准确的判断是：AssetDB import 阶段调用 `scripting.compileScripts([single script])` 的时机或增量输入不完整，使 `db://localization-editor/l10n` 入口被解析到 `l10n.ts` 后，其相对依赖 `./core/l10n-manager` 没在当前 resolver/module graph 中可用。

阶段性结论：

- 4 个非 3D `.meta` 被改为 `imported: false` 是 AssetDB importer 失败后的直接结果。
- 根因不是 `.meta` schema 迁移，也不是 TypeScript importer `ver` 改变。
- 需要修的是 CLI AssetDB 启动期脚本增量编译与 extension AssetDB module graph 的对齐；不能通过忽略 `.meta` 写入或强行恢复 `imported: true` 掩盖。

## 原因分析：`library` 顶层 `internal` JSON 被改写

直接源码事实：

- CLI build 启动 `internal` AssetDB 时，当前配置明确把 `internal` DB 的 `library` 指向项目 `library` 根目录。
- `readonly: true` 只表示源资源数据库只读，不等于 library data readonly；本轮实测 `db.start()` 仍会写入项目 `library` 顶层 `internal` JSON。
- build 后生成的 `.internal-info.json` / `.internal-dependency.json` shape 与 Editor baseline 的 `.internal-info1.0.0.json` / `.internal-dependency.json` 不一致，说明 CLI 当前使用的 AssetDB 写入逻辑或配置没有对齐 Editor 的 internal DB data 结构。
- `src/core/assets/test/config-sync.test.ts` 当前测试也断言 `internal` DB 的 `library` 为 `<project>/library`，说明这不是偶发路径，而是当前 CLI 行为的一部分。

`@cocos/asset-db@3.0.0-alpha.10` 直接解释的写入差异：

- `node_modules/@cocos/asset-db/libs/asset-db.js`
  - `AssetDB.version` 为 `1.0.1`。
  - `AssetDB` 创建 `infoManager`、`dependencyManager`、`dataManager` 并在 `start()` / `save()` 链路中保存记录。
- `node_modules/@cocos/asset-db/libs/info.js`
  - `InfoManager.version` 为 `1.0.1`。
  - `_readRecordInfo(file)` 会优先读取 `file.replace(".json", "1.0.0.json")`。
  - 读到旧的 `*.info1.0.0.json` 后会执行 migration，并移除旧文件。
  - `saveImmediate()` 写当前 `*.info.json`，结构为 `version` / `map` / `missing`。
- `node_modules/@cocos/asset-db/libs/dependency.js`
  - `DependencyManager.version` 为 `1.0.0`。
  - migration 会把旧的 `path` / `uuid` 顶层结构迁移为 `{ data: { path, uuid }, version }`。
  - `saveImmediate()` 按新 schema 写回。

因此，本轮 observed diff 的直接来源是：

- CLI 使用的 `@cocos/asset-db@3.0.0-alpha.10` 在启动 `internal` DB 时，对项目 `library` 根目录下的 internal records 执行了当前 AssetDB record migration / save。
- `.internal-info1.0.0.json -> .internal-info.json` 是 `InfoManager` 的当前文件命名与 migration 行为。
- `.internal-dependency.json` 从 `path` / `uuid` 变为 `data` / `version` 是 `DependencyManager` 的 schema migration 行为。
- `.internal-data.json` 的 50 个 value 变化来自 `internal` DB 启动后重新 import / dataManager update，表现为 `versionCode` 或 `value.depends` 等字段变化。

与 extension mount 的关系：

- `resolveProjectExtensionAssetDbMounts()` 会把项目 extension 的 `asset-db.mount` 加入 `assetDBList`。
- `localization-editor` 的 mount target 是 `extensions/localization-editor/static/assets`。
- CLI 为 extension mount 配置的 library 是 `<project>/library/cli-extensions/localization-editor`。
- 因此本轮顶层 `internal` JSON 变化不是 `localization-editor` extension mount 写到顶层导致；顶层变化来自 `internal` DB 使用 `<project>/library`。

阶段性结论：

- `library` 顶层 internal JSON 被改写已经不是 `fact-gap`，而是可重复事实。
- 当前直接原因是 CLI build 启动 `internal` AssetDB，且 `internal.library` 指向项目 `library` 根目录；`@cocos/asset-db@3.0.0-alpha.10` 随后按自身当前 record version 写回。
- 仍需补充的事实是 Editor baseline 使用的 AssetDB record 写入版本和配置来源：Editor 是使用旧 AssetDB record schema、额外 wrapper、迁移开关，还是不同的 internal DB library 策略。
- 修复目标应是让 CLI 的 internal DB record 写入与 Editor 一致，而不是简单禁止 `library` 写入。

## 2026-06-13 Task 6 build 前门槛检查

本轮已在 CLI 侧实现 local `@cocos/asset-db` internal record compatibility，并通过 focused tests：

```powershell
rtk pwsh -NoProfile -Command "npm --prefix packages/asset-db run build"
rtk pwsh -NoProfile -Command "npx jest src/core/assets/test/asset-db-internal-record.test.ts src/core/assets/test/config-sync.test.ts --runInBand"
```

验证时的 commit：

- CLI：`0071c72`
- 主测试项目：`5f735ccb`

但主测试项目未满足 Task 6 build 前 baseline 门槛，因此没有继续执行 CLI build。

`.meta` 当前已有 diff，按资源后缀分类：

- `.glb`: 188
- `.gltf`: 70
- `.fbx`: 28
- `.ts`: 3

`library` 顶层 internal JSON 文件集合也已经与 Editor baseline 不一致：

- 主测试项目当前文件：
  - `.internal-data.json`
  - `.internal-dependency.json`
  - `.internal-info.json`
- Editor baseline 文件：
  - `.internal-data.json`
  - `.internal-dependency.json`
  - `.internal-info1.0.0.json`

结论：

- 不能在该 dirty baseline 上继续运行 build 并声明 CLI side effect 已修复。
- 需要先把主测试项目恢复到 Editor baseline：至少 `.meta` diff 清零，并保证 `library` 顶层 internal JSON 文件集合、raw hash、canonical hash 与 baseline 一致。
- 本轮只记录 build 前门槛失败事实，不更新 `docs/dev/build/issues.md`。

### 2026-06-13 补充更正

后续确认 `.internal-info.json` 是旧 CLI 逻辑运行后留下的污染文件，不应作为新逻辑兼容入口。Editor baseline 使用 `.internal-info1.0.0.json`，因此 CLI 的 `internal` DB info record 应直接读写 `.internal-info1.0.0.json`。

已恢复主测试项目 `library` 顶层 internal JSON 到用户提供的 Editor baseline：

- 删除 stale `.internal-info.json`。
- 从 `.codex-tmp/bak_test_projects_library_data_json` 恢复：
  - `.internal-data.json`
  - `.internal-dependency.json`
  - `.internal-info1.0.0.json`

恢复后 hash 检查：

- `.internal-data.json`: `RawEqual = True`，`CanonicalEqual = True`
- `.internal-dependency.json`: `RawEqual = True`，`CanonicalEqual = True`
- `.internal-info1.0.0.json`: `RawEqual = True`，`CanonicalEqual = True`

CLI 侧修正提交：`03d8ffc fix: use editor internal info record path`。

当前仍未继续执行主测试项目 build，因为测试项目还有既有 `.meta` diff。该 diff 需要先清理或明确作为独立 baseline，否则 build 后无法判断新的 CLI side effect。

## 2026-06-13 当前 3D `.meta` diff 与修复方向

主测试项目当前仍有 3D source `.meta` diff：

- `.glb.meta`: `188`
- `.gltf.meta`: `70`
- `.fbx.meta`: `28`

样本事实：

- `assets/shared-res/models/astronaut/Astronaut.gltf.meta`
  - `ver: 2.3.13 -> 2.3.14`
  - 新增 `userData` 默认字段：
    - `legacyFbxImporter: false`
    - `allowMeshDataAccess: true`
    - `addVertexColor: false`
    - `generateLightmapUVNode: false`
    - `meshOptimizer`
- `assets/shared-res/models/robot-expressive/RobotExpressive.glb.meta`
  - 顶层 `ver: 2.3.13 -> 2.3.14`
  - 顶层 `files` 从 `__original-animation-*.cconb` 改为 `__original-animation-*.bin`
  - `gltf-animation` subMeta `ver: 1.0.17 -> 1.0.18`
  - `gltf-animation` subMeta `files: [".cconb"] -> [".bin"]`

对应源码入口：

- `src/core/assets/asset-handler/assets/gltf.ts`
  - 当前 `GltfHandler.importer.version = "2.3.14"`。
  - `validateMeta()` 会向 `asset.meta.userData` 补齐新的默认字段。
  - `saveOriginalAnimations()` 使用 `serializeForLibrary(animation)` 返回的 extension 保存原始动画。
- `src/core/assets/asset-handler/assets/gltf/animation.ts`
  - 当前 `gltf-animation` importer version 为 `1.0.18`。
  - 当前导入时使用 `serializeForLibrary(animationClip)` 返回的 extension 保存 sub asset。
- `src/core/assets/asset-handler/assets/utils/serialize-library.ts`
  - 对 `AnimationClip` 开启 `useCCON` 后，`CCON` binary 当前返回 `extension: ".bin"`。

与历史 `.anim.meta` 问题的关系：

- 历史 `.anim.meta` parity 问题已经证明：CLI 不能通过禁止写 `.meta` 或 build 后回滚解决 source `.meta` diff。
- 当时修复是把 `.anim` importer 对齐 Editor 3.8.6：
  - `animation-clip` importer `ver = "2.0.3"`。
  - `AnimationClip` library 产物写为 `.cconb`，从而 source `.anim.meta.files = [".cconb"]`。
- 当前 3D `.meta` diff 应采用同类修复路径：建立 `.gltf/.glb/.fbx.meta` Editor baseline parity 测试，然后让 `gltf` / `fbx` / `gltf-animation` importer 的 version、默认 `userData` schema、animation library extension 与 Editor baseline 一致。

阶段性修复方向：

1. 先建立 3D source `.meta` Editor baseline，范围至少覆盖当前 diff 中的 `.gltf`、`.glb`、`.fbx`。
2. 对齐 `gltf` / `fbx` 顶层 importer version 与 Editor baseline；不能只看当前 CLI 版本号。
3. 对齐 `gltf-animation` subMeta version 与 Editor baseline。
4. 对齐 3D animation 产物 extension：当前样本显示 CLI 把 Editor baseline 的 `.cconb` 改成 `.bin`，应参考 `.anim.meta` 的处理方式，在确认 Editor baseline 后把相关 `AnimationClip` 保存路径收敛为 `.cconb`。
5. 对齐默认 `userData` 写入策略：如果 Editor baseline 没有写入新增默认字段，CLI 不应在 source `.meta` 中补写这些字段；如果 Editor baseline 已升级，则以 Editor baseline 为准。
6. 修复后用真实测试项目和 Editor baseline 做 source `.meta` JSON parity，而不是只比较字段片段。

## 2026-06-13 当前 TypeScript `.meta` diff 与失败原因

当前测试项目中仍有 3 个 `.ts.meta` diff：

- `assets/cases/GFX/mipmapCheck/mipmapCheck.ts.meta`
- `assets/cases/GFX/setMipRange/setMipRange-cube.ts.meta`
- `assets/cases/GFX/setMipRange/setMipRange-quad.ts.meta`

diff 内容相同，均为：

```text
imported: true -> false
```

可用构建日志：`.codex-tmp/build-cli-side-effect-check.out`。

日志事实：

- 3 个脚本均出现 `Failed to import script`。
- 对应 `Importer exec failed` 的错误相同：

```text
resolve_error_module_not_found:
{"specifier":"./core/l10n-manager","parentURL":"file:///E:/own_space/engines/cocos-test-projects/extensions/localization-editor/static/assets/l10n.ts"}
```

阶段性判断：

- 这 3 个 `.ts.meta` 不是各自脚本源码语法错误导致。
- 直接原因是 TypeScript importer 调用 scripting compile 流程时，底层 packer/resolver 因 `localization-editor/static/assets/l10n.ts` 的相对依赖 `./core/l10n-manager` 解析失败而抛错。
- AssetDB importer 抛错后，资源 import 流程不会进入成功分支；`Asset.reset()` 已把 `imported` 置为 `false`，随后 `.meta` 被保存，因此出现 `imported: true -> false`。
- 该日志来自移除 `localization-editor` 前的构建；移除后需要在干净 `.meta` baseline 上重新构建，才能确认这 3 个 `.ts.meta` 是否仍会被当前 CLI 改写。

修复方向：

- 如果移除 `localization-editor` 后不再复现，则当前 3 个 `.ts.meta` 是旧构建残留，应先恢复 baseline 后重新验证。
- 如果仍复现，应继续定位 TypeScript importer 的 `scripting.compileScripts()` 输入和 module graph；修复目标是让 importer 成功，不能强行恢复 `imported: true` 或禁止 `.meta` 写回。

## 阶段结论

- CLI build 在当前 Editor baseline 后会额外改写 `.meta`。
- 其中非 3D `.meta` 有 4 个 `typescript` 文件被改为 `imported: false`，需要修复或确认 Editor 是否应有同样行为。
- CLI build 会改写项目 `library` 顶层 `internal` JSON，且写入内容与 Editor baseline 不一致。
- 问题不是路径污染，也不是仅格式化变化；核心是 `internal` DB 使用项目 `library` 根目录并通过当前 CLI AssetDB 写出不同 schema/version。
- 本轮只记录验证事实，不更新正在重构的 `docs/dev/build/issues.md`。

## 后续修改方向

1. 先对齐 Editor 启动 internal DB 时使用的 data JSON 命名、版本和 dependency schema，确认 Editor 是通过配置、AssetDB 版本、migration 还是额外 wrapper 决定这些产物。
2. 修 CLI 的 `internal` DB 初始化配置或 AssetDB 启动链路，使其写出的 `library` 顶层 JSON 与 Editor baseline 一致。
3. 针对 4 个 `typescript` `.meta`，定位 `imported` 被置为 `false` 的来源；不能简单禁止 `.meta` 写入，而应确保与 Editor importer 状态一致。
4. 修复后重复本文件中的 build 前 baseline、受控 build、`.meta` diff、`library` 顶层 JSON canonical diff 验证。
