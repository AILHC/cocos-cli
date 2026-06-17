# Auto Atlas Texture Compress Editor CLI Parity Plan

> 执行前必须等待用户确认。本计划只验证，不修改生产源码、不修改主测试项目资源、`.meta`、settings 或原始 build config。

## 目标

验证主测试项目 `E:\own_space\engines\cocos-test-projects` 在 `web-mobile` 与 `wechatgame` 两个平台上，Editor baseline 与当前 CLI 对照构建的自动图集和纹理压缩路径是否可用、是否存在 CLI 独有问题。

所有命令默认从 CLI workspace root `E:\own_space\engines\cocos-cli` 执行。外层命令统一使用 `rtk pwsh` 或 `rtk node`；`rtk pwsh` 内部调用 `git` / `npm` / `node` 视为同一条已由 `rtk` 包裹的命令。

## 已确认事实

- CLI workspace：`E:\own_space\engines\cocos-cli`
- 主测试项目：`E:\own_space\engines\cocos-test-projects`
- Editor：`D:\cocos_editors\Creator\Creator\3.8.6\CocosCreator.exe`
- Engine root：`D:\workspace\engines\cocos\3.8.6`
- 原始 config：`buildConfig_web-mobile.json` 与 `buildConfig_wechatgame.json` 都是完整 build config。
- 两份原始 config 均为 `debug=false`、`sourceMaps=true`、`md5Cache=true`、`packAutoAtlas=true`、`skipCompressTexture=false`。
- 两份原始 config 当前 scenes 不包含目标自动图集 / 纹理压缩 scenes，直接用原始 config 不能证明目标资源进入 build graph。
- 目标自动图集 scene：`db://assets/cases/2D/atlas-compress/atlas-compress.scene`，uuid `4437972c-9b71-4af0-aae3-251f640ee42a`。
- 目标纹理压缩 scene：`db://assets/cases/2D/single-compress/single-compress.scene`，uuid `ac48432f-ab9a-4c4c-89f6-11053a95abe4`。
- 灰度纹理压缩 scene：`db://assets/cases/2D/single-compress/compressWithGray.scene`，uuid `3f9ec14e-39d6-436d-b0a4-812e40bd974f`。
- 目标 `.pac`：`assets/cases/2D/atlas-compress/atlas/test.pac`，uuid `0d6a7d4c-9e04-4ea0-a0d9-0d3ce6101139`，`userData.compressSettings.useCompressTexture=true`。
- 目标 `.pac` 目录下存在 `sheep_jump_0.png` 到 `sheep_jump_4.png`，其 image / texture / sprite-frame subMeta 是证明自动图集进入 `packs` 的关键 target。
- 目标压缩贴图：`assets/cases/2D/single-compress/image/astc4x4.png`，uuid `42a77d2e-7371-42cc-b0be-f9c0e52ce440`，`userData.compressSettings.useCompressTexture=true` 且存在 `presetId`。
- 现有 `wechatgame` parity test：`vitests/suites/build/wechatgame-editor-baseline-parity.test.ts`。

## 输出隔离

本次只创建以下临时文件和构建目录，不删除已有目录：

- `.codex-tmp/auto-atlas-texture-compress-20260617/buildConfig_web-mobile-autoatlas-compress.json`
- `.codex-tmp/auto-atlas-texture-compress-20260617/buildConfig_wechatgame-autoatlas-compress.json`
- `.codex-tmp/auto-atlas-texture-compress-20260617/target-manifest.json`
- `.codex-tmp/auto-atlas-texture-compress-20260617/*.log`
- `.codex-tmp/auto-atlas-texture-compress-20260617/*.json`
- `E:\own_space\engines\cocos-test-projects\build\editor-autoatlas-compress-web-mobile-20260617`
- `E:\own_space\engines\cocos-test-projects\build\cli-autoatlas-compress-web-mobile-20260617`
- `E:\own_space\engines\cocos-test-projects\build\editor-autoatlas-compress-wechatgame-20260617`
- `E:\own_space\engines\cocos-test-projects\build\cli-autoatlas-compress-wechatgame-20260617`
- 执行后事实文档：`docs/dev/build/facts/auto-atlas-texture-compress-editor-cli-parity-20260617.md`

若任一输出目录已存在，停止并换新的唯一 `outputName`；不得删除旧目录。

## 通过标准

- Editor baseline 和 CLI 对照构建对同一平台使用同一份派生 config；唯一允许的命令行差异是 `outputName`。
- 派生 config 必须保留 `packAutoAtlas=true`、`skipCompressTexture=false`，并追加三个 target scenes。
- Editor baseline 自身失败时，对应平台不执行 CLI 对照构建，也不声明对应平台 CLI parity；若仍需 CLI 构建，只能作为单独诊断另行执行。
- Editor / CLI 构建都使用 7200 秒 watchdog；超时必须递归停止进程树。
- 自动图集结论必须基于 target `.pac` child texture / sprite-frame 的 `json.uuids` index 与 bundle config `packs` / `paths` / `versions` 结构化证据；`.pac` 文件名或 scene 文本命中只能作为辅助证据。
- 纹理压缩结论必须包含 target texture 的 `userData.compressSettings`、Editor/CLI 产物映射或日志中的压缩证据；共享 `temp/builder/CompressTexture` 只能作为辅助证据。
- `wechatgame` 必须通过既有 parity test，或记录第一个断言差异。
- 执行后必须比较主测试项目 git status before/after；若出现新的 `assets/**`、`settings/**`、源 `.meta` 改动，结论标记为“构建副作用待确认”。

## 执行计划

### 1. Preflight

1. 确认 Editor、engine root、主测试项目、两份原始 config、target `.scene.meta`、`test.pac.meta`、`astc4x4.png.meta` 都存在。
2. 记录 CLI workspace 和主测试项目执行前 `git status --short` 到 `.codex-tmp/.../git-status-*-before.txt`。
3. 检查四个输出目录均不存在。
4. 读取两份原始 config，确认 `packAutoAtlas=true`、`skipCompressTexture=false`，且三个 target scenes 当前确实缺失。

### 2. 生成派生 config

从原始 `buildConfig_web-mobile.json` 与 `buildConfig_wechatgame.json` 生成临时 config：

- 追加 target scenes：
  - `4437972c-9b71-4af0-aae3-251f640ee42a`
  - `ac48432f-ab9a-4c4c-89f6-11053a95abe4`
  - `3f9ec14e-39d6-436d-b0a4-812e40bd974f`
- 保留原始构建开关，特别是 `packAutoAtlas=true` 与 `skipCompressTexture=false`。
- 派生 config 内写入 Editor `outputName` 仅用于人工检查；实际 Editor / CLI 命令仍显式传入各自唯一 `outputName`。

生成后立即脚本检查两份派生 config 的 target scene coverage 全部为 `true`。

### 3. 生成 target manifest

生成 `.codex-tmp/.../target-manifest.json`，字段必须包含：

- `scenes[]`：三个 target scene 的 `url`、`meta`、`uuid`、`importer`。
- `autoAtlas[]`：`test.pac` 的 `url`、`meta`、`uuid`、`importer`、`userData.compressSettings`、`removeTextureInBundle`、`removeImageInBundle`、`removeSpriteAtlasInBundle`。
- `autoAtlas[].children[]`：从 `assets/cases/2D/atlas-compress/atlas` 枚举 `/^sheep_jump_\d+\.png\.meta$/`，记录每个 child image 的 `uuid`、`subMetas.texture.uuid`、`subMetas.sprite-frame.uuid`、`packable`、`atlasUuid`。
- `compressedTextures[]`：`astc4x4.png` 的 `uuid`、texture / sprite-frame subMeta uuid、`userData.compressSettings`。

Manifest 生成脚本必须断言：

- `test.pac.userData.compressSettings.useCompressTexture === true`
- `astc4x4.png.userData.compressSettings.useCompressTexture === true`
- `astc4x4.png.userData.compressSettings.presetId` 存在
- `autoAtlas[0].children.length >= 5`
- 每个 `autoAtlas[0].children[]` 都有 texture subMeta 和 sprite-frame subMeta

### 4. 构建当前 CLI

运行：

```powershell
rtk npm run build
```

失败则停止后续 CLI 对照构建，只记录 CLI build failure。

### 5. Editor baseline 构建

分别构建：

- `web-mobile`：`outputName=editor-autoatlas-compress-web-mobile-20260617`
- `wechatgame`：`outputName=editor-autoatlas-compress-wechatgame-20260617`

命令必须使用：

- `--project E:\own_space\engines\cocos-test-projects`
- `--build stage=build;configPath=<derived config>;platform=<platform>;buildPath=E:\own_space\engines\cocos-test-projects\build;outputName=<editor output>;logDest=<editor log>`
- `Start-Process -WindowStyle Hidden`
- `Wait-Process -Timeout 7200`
- 超时时调用递归 `Stop-Tree`：

```powershell
function Stop-Tree([int]$Id) {
  Get-CimInstance Win32_Process -Filter "ParentProcessId=$Id" | ForEach-Object { Stop-Tree ([int]$_.ProcessId) }
  Stop-Process -Id $Id -Force -ErrorAction SilentlyContinue
}
```

`Wait-Process` 返回后必须 `$p.Refresh()`，若 `$p.ExitCode` 为 `$null`，记录异常并停止对应平台判断。

### 6. CLI 对照构建

分别构建：

- `web-mobile`：`outputName=cli-autoatlas-compress-web-mobile-20260617`
- `wechatgame`：`outputName=cli-autoatlas-compress-wechatgame-20260617`

命令必须使用当前 `dist\cli.js`：

```powershell
node .\dist\cli.js build --project E:\own_space\engines\cocos-test-projects --platform <platform> --build-config <derived config> --buildPath E:\own_space\engines\cocos-test-projects\build --outputName <cli output>
```

同样使用 7200 秒 watchdog、递归 `Stop-Tree`、stdout/stderr 重定向到 `.codex-tmp/.../cli-*.log`。

### 7. 日志检查

对 Editor 和 CLI 日志搜索：

- `error`
- `failed`
- `Pack Images start`
- `Pack Images success`
- `Compress`
- `texture`
- `worker has exited`
- `texture_compress_failed`
- `cache_compress_texture_missing`
- `ENOENT.*\?_t=`

判断规则：

- `Pack Images start` 后没有成功或后续构建完成证据，标记自动图集风险。
- 出现 `texture_compress_failed` 或 `cache_compress_texture_missing`，标记纹理压缩失败。
- 出现 `ENOENT ... ?_t=`，标记自动图集 / library URL 读取风险。

### 8. 产物证据采集

生成以下证据：

- `artifact-summary.json`：四个输出目录是否存在、文件总数、扩展名分布、texture-like 文件列表。
- `target-reference-summary.json`：target scenes、auto atlas children、compressed texture 的结构化引用证据。
- `bundle-config-summary.json`：每个 bundle config 的 `uuids`、`paths`、`packs`、`versions`、`extensionMap` 规模摘要。
- `compress-cache-snapshots.json`：`temp/builder/CompressTexture` 的文件列表、mtime、size，仅作辅助证据。

`target-reference-summary.json` 的采集逻辑必须按以下方式实现：

- 对每个 target UUID 生成三类 token：raw uuid、`compressUUID(uuid, true)`、`compressUUID(uuid, false)`；subAsset UUID 保留 `@xxxxx` 后缀。
- 解析每个产物里的 `config.*.json`。
- 先在 `json.uuids[]` 中定位 target token，记录命中的 `uuidIndex`。
- 再检查 `json.packs[*]` 是否包含这些 `uuidIndex`；自动图集是否进入 pack 必须优先以该 index 命中为证据。
- 检查 `json.paths` 中是否直接包含 target basename、raw uuid、compressed uuid，或通过 `uuidIndex` 关联到 target。
- 检查 `json.versions.import` / `json.versions.native` 是否通过 `uuidIndex` 关联到 target；不得只对 `versions` 文本做 UUID 字符串搜索。
- 仍可保留 raw text 命中列表，但只能作为辅助排查信息。

若 Editor 有 target child texture / sprite-frame 的 `uuidIndex -> packs` 证据而 CLI 没有，标记 CLI 自动图集差异。若 Editor 有 target compressed texture 的 `uuidIndex`、compressed output 或日志证据而 CLI 没有，标记 CLI 纹理压缩差异。

### 9. 运行 `wechatgame` parity test

运行：

```powershell
rtk pwsh -NoProfile -Command '& { $env:COCOS_CLI_WECHATGAME_BASELINE_DIR="E:\own_space\engines\cocos-test-projects\build\editor-autoatlas-compress-wechatgame-20260617"; $env:COCOS_CLI_WECHATGAME_OUTPUT_DIR="E:\own_space\engines\cocos-test-projects\build\cli-autoatlas-compress-wechatgame-20260617"; $env:COCOS_CLI_WECHATGAME_BASELINE_CONFIG="E:\own_space\engines\cocos-cli\.codex-tmp\auto-atlas-texture-compress-20260617\buildConfig_wechatgame-autoatlas-compress.json"; $env:COCOS_CLI_TEST_ENGINE_ROOT="D:\workspace\engines\cocos\3.8.6"; npm --prefix "E:\own_space\engines\cocos-cli\vitests" test -- suites/build/wechatgame-editor-baseline-parity.test.ts }'
```

失败时记录第一个断言差异，不声明 `wechatgame` parity 通过。

### 10. Side effect check

记录执行后状态并生成 diff：

- `.codex-tmp/.../git-status-cli-after.txt`
- `.codex-tmp/.../git-status-test-project-after.txt`
- `.codex-tmp/.../git-status-cli-diff.txt`
- `.codex-tmp/.../git-status-test-project-diff.txt`

若主测试项目 diff 出现新的 `assets/**`、`settings/**`、源 `.meta` 改动，事实文档必须标记“构建副作用待确认”。

### 11. 写事实文档

创建 `docs/dev/build/facts/auto-atlas-texture-compress-editor-cli-parity-20260617.md`，内容包括：

- 输入：Project、Editor、Engine root、原始 config、派生 config、target manifest。
- 配置事实：`packAutoAtlas`、`skipCompressTexture`、追加 target scenes、`userData.compressSettings`。
- Editor baseline：两个平台命令、退出码、输出目录、日志路径、关键阶段日志。
- CLI output：两个平台命令、退出码、输出目录、日志路径、关键阶段日志。
- 自动图集结论：target child texture / sprite-frame 的 `uuidIndex -> packs` / `paths` 结构化证据。
- 纹理压缩结论：target texture 的 `uuidIndex`、compressed output / log / cache 辅助证据。
- 平台结构结论：`wechatgame` parity test 结果；`web-mobile` 明确本次只做 build artifact parity，不做 browser smoke。
- Git 副作用：before/after status diff。
- 问题登记：若发现 CLI 独有失败，引用或新增 `BUILD-ISSUE-*`。

## 当前停止点

计划已写好并经过子代理 review。下一步必须等待用户确认后，才执行 Preflight、Editor build、CLI build 和证据采集。
