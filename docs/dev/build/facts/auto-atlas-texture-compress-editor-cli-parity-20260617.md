# 自动图集与纹理压缩 Editor/CLI 对照验证 - 2026-06-17

## 输入

- CLI workspace：`E:\own_space\engines\cocos-cli`
- 主测试项目：`E:\own_space\engines\cocos-test-projects`
- Editor：`D:\cocos_editors\Creator\Creator\3.8.6\CocosCreator.exe`
- Engine root：`D:\workspace\engines\cocos\3.8.6`
- 原始 config：
  - `E:\own_space\engines\cocos-test-projects\buildConfig_web-mobile.json`
  - `E:\own_space\engines\cocos-test-projects\buildConfig_wechatgame.json`
- 派生 config：
  - `E:\own_space\engines\cocos-cli\.codex-tmp\auto-atlas-texture-compress-20260617\buildConfig_web-mobile-autoatlas-compress.json`
  - `E:\own_space\engines\cocos-cli\.codex-tmp\auto-atlas-texture-compress-20260617\buildConfig_wechatgame-autoatlas-compress.json`
- Target manifest：`E:\own_space\engines\cocos-cli\.codex-tmp\auto-atlas-texture-compress-20260617\target-manifest.json`

## 配置事实

- 两份原始 config 均为完整 `buildConfig_<platform>.json`，不是 Creator profile wrapper。
- 两份原始 config 均为 `packAutoAtlas=true`、`skipCompressTexture=false`。
- 两份原始 config 原本不包含本次 target scenes，因此本轮生成派生 config，并追加：
  - `db://assets/cases/2D/atlas-compress/atlas-compress.scene`
  - `db://assets/cases/2D/single-compress/single-compress.scene`
  - `db://assets/cases/2D/single-compress/compressWithGray.scene`
- 派生 config 已修正为追加 `{ uuid, url }` scene object，不使用裸 uuid string。
- `test.pac` 的 `userData.compressSettings.useCompressTexture=true`。
- `astc4x4.png` 的 `userData.compressSettings.useCompressTexture=true`，`presetId=edctr14XNOBKwkx22W6cdp`。
- `test.pac` 目录下 `sheep_jump_0.png` 到 `sheep_jump_4.png` 均进入 manifest，且每项都有 texture 与 sprite-frame subMeta。

## Preflight

- Editor、engine root、主测试项目、原始 config、target `.scene.meta`、`test.pac.meta`、`astc4x4.png.meta` 均存在。
- 四个计划输出目录在执行前均不存在。
- 执行前 git status 已记录：
  - `E:\own_space\engines\cocos-cli\.codex-tmp\auto-atlas-texture-compress-20260617\git-status-cli-before.txt`
  - `E:\own_space\engines\cocos-cli\.codex-tmp\auto-atlas-texture-compress-20260617\git-status-test-project-before.txt`
- 主测试项目执行前已有大量 dirty `.meta` 和未跟踪 `buildConfig_*.json`，本轮不回滚、不清理，只作为 before 状态。

## CLI Build

- 已执行 `rtk npm run build`，退出码为 `0`。
- 日志：`E:\own_space\engines\cocos-cli\.codex-tmp\auto-atlas-texture-compress-20260617\npm-build.log`
- 该步骤只构建当前 CLI `dist/`，尚未执行 CLI 对照构建。

## Editor Baseline

### web-mobile

- Output：`E:\own_space\engines\cocos-test-projects\build\editor-autoatlas-compress-web-mobile-20260617`
- Log：`E:\own_space\engines\cocos-cli\.codex-tmp\auto-atlas-texture-compress-20260617\editor-web-mobile.log`
- 进程退出码：`36`
- 输出目录存在，`fileCount=1140`。
- 日志计数：
  - `Pack Images start=4`
  - `Pack Images success=4`
  - `Compress image start=4`
  - `Compress image success=4`
  - `worker has exited=0`
  - `error=6`
  - `failed=1`
  - `ENOENT=1`
  - `EPERM=4`
  - `build success=2`
- 关键错误：
  - `Build Assets failed!`
  - `ENOENT: no such file or directory, open ...\assets\internal\index.js`
  - 多条 `EPERM: operation not permitted, rename ...\assets\internal\native\...`

### wechatgame

- Output：`E:\own_space\engines\cocos-test-projects\build\editor-autoatlas-compress-wechatgame-20260617`
- Log：`E:\own_space\engines\cocos-cli\.codex-tmp\auto-atlas-texture-compress-20260617\editor-wechatgame.log`
- 进程退出码：`36`
- 输出目录存在，`fileCount=588`。
- 日志计数：
  - `Pack Images start=6`
  - `Pack Images success=6`
  - `Compress image start=6`
  - `Compress image success=6`
  - `worker has exited=0`
  - `error=6`
  - `failed=1`
  - `ENOENT=1`
  - `EPERM=4`
  - `build success=3`
- 关键错误：
  - `Build Assets failed!`
  - `ENOENT: no such file or directory, open ...\assets\internal\index.js`
  - 多条 `EPERM: operation not permitted, rename ...\assets\internal\native\...`

## 自动图集结论

Editor 两个平台日志均出现 `Pack Images start` 与 `Pack Images success`，且没有 `worker has exited`。这说明本次 Editor baseline 已进入并完成自动图集阶段。

本轮未取得 target child texture / sprite-frame 的结构化 `uuidIndex -> packs` 证据。`editor-target-reference-summary.json` 的 `generated=false`，原因是当前脚本无法用可验证规则从产物 `config.*.json` 解析 target child / astc uuid 到 `packs` / `versions` 映射。因此自动图集结论只证明 Editor 构建触达并完成 `Pack Images` 日志阶段，不证明完整 target artifact baseline 可用。

但是，两个 Editor baseline 日志存在 `Build Assets failed!`、`ENOENT`、`EPERM`。虽然 `36` 是 Cocos Creator 3.8 官方命令行发布文档定义的 `Build success`，但该轮日志和后续重复任务证据表明输出目录被污染。因此本轮不能把任一 Editor 输出作为干净 baseline，也不能继续执行对应 CLI parity 判断。

## 纹理压缩结论

Editor 两个平台日志均出现 `Compress image start` 与 `Compress image success`。

Target texture `42a77d2e-7371-42cc-b0be-f9c0e52ce440` 在 `web-mobile` 日志中有明确压缩证据：

- `astcenc.exe -cl ...42a77d2e-7371-42cc-b0be-f9c0e52ce440.png ...42a77d2e-7371-42cc-b0be-f9c0e52ce440.astc 4x4 -medium`
- `Compress astc success ...42a77d2e-7371-42cc-b0be-f9c0e52ce440.astc`
- 后续也有 `Use cache compress image of {Asset(42a77d2e-7371-42cc-b0be-f9c0e52ce440)}`。

`wechatgame` 日志同样有 target uuid 的 cache 使用记录和全局 `Compress image success` 计数。但由于该轮日志后续存在 `Build Assets failed!`、`ENOENT`、`EPERM`，该证据只能说明纹理压缩阶段被触达，不能作为完整 baseline 通过证据。

## 平台结构结论

- `web-mobile`：Editor baseline tainted，未执行 CLI 对照构建。
- `wechatgame`：Editor baseline tainted，未执行 CLI 对照构建，未运行 `vitests/suites/build/wechatgame-editor-baseline-parity.test.ts`。
- 本轮未产生 CLI parity 结论。

## Git 副作用

执行后 status diff 文件：

- `E:\own_space\engines\cocos-cli\.codex-tmp\auto-atlas-texture-compress-20260617\git-status-cli-diff.txt`
- `E:\own_space\engines\cocos-cli\.codex-tmp\auto-atlas-texture-compress-20260617\git-status-test-project-diff.txt`

两份 diff 均为空，即相对本轮 before 快照没有新增 git status 差异。主测试项目 before 状态已有大量 dirty `.meta` 和未跟踪 `buildConfig_*.json`，本轮未尝试回滚。

## 证据文件

- `E:\own_space\engines\cocos-cli\.codex-tmp\auto-atlas-texture-compress-20260617\preflight-derive-manifest-summary.json`
- `E:\own_space\engines\cocos-cli\.codex-tmp\auto-atlas-texture-compress-20260617\target-manifest.json`
- `E:\own_space\engines\cocos-cli\.codex-tmp\auto-atlas-texture-compress-20260617\editor-artifact-summary.json`
- `E:\own_space\engines\cocos-cli\.codex-tmp\auto-atlas-texture-compress-20260617\editor-log-summary.json`
- `E:\own_space\engines\cocos-cli\.codex-tmp\auto-atlas-texture-compress-20260617\editor-target-reference-summary.json`
- `E:\own_space\engines\cocos-cli\.codex-tmp\auto-atlas-texture-compress-20260617\editor-web-mobile-key-lines.json`
- `E:\own_space\engines\cocos-cli\.codex-tmp\auto-atlas-texture-compress-20260617\editor-wechatgame-key-lines.json`

## 问题登记

本轮没有登记新的 CLI issue，因为 CLI 对照构建没有执行，无法判断 CLI 独有问题。

本轮主要阻断是 Editor baseline 自身异常：两个平台均在自动图集和纹理压缩阶段之后出现 `Build Assets failed!`、`ENOENT assets/internal/index.js`、`EPERM rename assets/internal/native/...`。该问题应先作为 Editor baseline / 测试项目输出污染问题单独排查，之后再继续 CLI parity；`exitCode 36` 本身不是失败信号。

## 补充排查：重复写同一输出目录

后续复查发现，异常不是两个平台并发构建，而是同一平台出现重复 build task 写同一个 `outputName` / `logDest`。

`web-mobile` 证据：

- `editor-web-mobile.log` line 1：`build Task (web-mobile) Start`，时间 `07:27:27`。
- `editor-web-mobile-runner-debug.log` 记录 runner start 时间为 `07:27:34.480`。
- `editor-web-mobile.log` line 1554：第二次 `build Task (web-mobile) Start`，时间 `07:28:20`。
- 第一次 task 到 line 2560 才 `Finished`，时间 `07:28:41`；第二次 task 在第一次结束前已经启动。
- 因此 `web-mobile` 至少有两个同平台 build task 重叠写入 `editor-autoatlas-compress-web-mobile-20260617`。

`wechatgame` 证据：

- `editor-wechatgame.log` line 1 和 line 5 在同一秒 `07:31:53` 连续出现两次 `build Task (wechatgame) Start`，配置内容相同。
- `editor-wechatgame.log` line 2566 又在 `07:33:12` 出现第三次 `build Task (wechatgame) Start`。
- 原始和派生 `wechatgame` config 的 `bundleConfigs` 中存在两个重复的 `{ "name": "start-scene", "root": "", "output": true }` 条目；这可能解释 start-scene/bundle 相关重复输出风险，但还不能单独证明它是全部重复启动的根因。

当前更具体判断：

- `EPERM rename ... assets/internal/native/...` 与 `ENOENT ... assets/internal/index.js` 很可能来自多个同平台 build task 共享同一个输出目录时的竞争写入。
- 该问题污染了 Editor baseline，本轮不能继续用这些产物作为 CLI parity baseline。
- 下一次验证必须先保证单平台单进程、唯一 `outputName`、唯一 `logDest`，并在启动前确认没有已有 Editor build 写同一目录。

## Clean Rerun：`clean-20260617-095214`

为排除上一轮同平台重复构建污染，本轮使用唯一输出目录和唯一日志文件，且由主会话顺序执行：

- Editor `web-mobile`：`editor-autoatlas-compress-web-mobile-clean-20260617-095214`
- Editor `wechatgame`：`editor-autoatlas-compress-wechatgame-clean-20260617-095214`
- CLI `web-mobile`：`cli-autoatlas-compress-web-mobile-clean-20260617-095214`
- CLI `wechatgame`：`cli-autoatlas-compress-wechatgame-clean-20260617-095214`

### Editor clean baseline

Editor 两个平台均只出现一次对应平台的 `build Task (...) Start`，没有上一轮的重复 task 重叠写入现象。

`web-mobile` 事实：

- 进程退出码：`36`
- 输出文件数：`988`
- `Pack Images success=2`
- `Compress image success=2`
- `Build Assets success=1`
- `Build Assets failed=0`
- `ENOENT=0`
- `EPERM=0`
- `ReferenceError: Editor is not defined=0`
- `Read json failed=0`
- `Invalid values chosen=0`

`wechatgame` 事实：

- 进程退出码：`36`
- 输出文件数：`588`
- `Pack Images success=2`
- `Compress image success=2`
- `Build Assets success=1`
- `Build Assets failed=0`
- `ENOENT=0`
- `EPERM=0`
- `ReferenceError: Editor is not defined=0`
- `Read json failed=0`
- `Invalid values chosen=0`

判断：

- clean baseline 已排除重复输出污染；日志层面两个 Editor 构建均完成自动图集和纹理压缩阶段，并且没有上一轮的 `Build Assets failed`、`ENOENT`、`EPERM`。
- `CocosCreator.exe` 进程退出码仍为 `36`。Cocos Creator 3.8 官方命令行发布文档将 `36` 定义为 `Build success`，因此本轮不应把 `36` 当作异常或失败信号。CLI 自身 `BuildExitCode.BUILD_SUCCESS` 为 `0`，这是本仓库 CLI 和 Editor 进程退出码语义不同造成的差异。

### CLI clean 对照

CLI `web-mobile`：

- 进程退出码：`0`
- 输出文件数：`999`
- `Pack Images start` 后出现自动图集相关错误。
- `ReferenceError: Editor is not defined=8`
- `sprite frame can't be load=29`
- `Read json failed=58`
- `Invalid values chosen=10`
- `texture compress task width asset=5`
- `Compress image success=1`
- `Build Assets success=2`

CLI `wechatgame`：

- 进程退出码：`0`
- 输出文件数：`595`
- `Pack Images start` 后出现自动图集相关错误。
- `ReferenceError: Editor is not defined=8`
- `sprite frame can't be load=29`
- `Read json failed=58`
- `Invalid values chosen=3`
- `texture compress task width asset=3`
- `Compress image success=1`
- `Build Assets success=2`

判断：

- CLI 两个平台虽然 exit code 为 `0`，但日志不是干净成功。
- 自动图集在 CLI 中没有达到 Editor baseline：`assetManager.loadAny()` 触发 engine bundled loader 的 `queryExtension()`，该路径访问全局 `Editor`，CLI build 环境未安装该全局对象，产生 `ReferenceError: Editor is not defined`。随后读取 library JSON 时，路径中保留了 `?_t=...` cache-bust query，Windows 文件读取报 `ENOENT`，最终 sprite frame 被从 atlas 中移除。
- 纹理压缩在 CLI 中也没有达到 Editor baseline：CLI 使用 `E:\own_space\engines\cocos-cli\static\tools\PVRTexTool_win32\PVRTexToolCLI.exe`，文件版本为 `5.5.0`；Editor 3.8.6 使用 `D:\cocos_editors\Creator\Creator\3.8.6\resources\tools\PVRTexTool_win32\PVRTexToolCLI.exe`，文件版本为 `4.20.0`。同样的 `-f PVRTC1_4_RGB,UBN,lRGB` 参数在 CLI bundled tool 中报 `Invalid values chosen for Encode Format`，Editor baseline 未报该错误。

### wechatgame parity test

命令：

```powershell
npm --prefix "E:\own_space\engines\cocos-cli\vitests" test -- suites/build/wechatgame-editor-baseline-parity.test.ts
```

结果：

- 退出码：`1`
- 失败点：`collectTopLevelPartitionCounts(cliRoot)` 不等于 Editor baseline。
- Editor top-level counts：`assets=102`、`cocos-js=13`、`remote=447`、`root=11`、`src=11`、`subpackages=4`
- CLI top-level counts：`assets=109`、`cocos-js=13`、`remote=447`、`root=11`、`src=11`、`subpackages=4`

`assets` 分区差异与自动图集失败一致：

- Editor 产物包含 atlas 相关文件，例如 `main/import/1e/1e0d601e3...`、`main/native/1e/1e0d601e3...`。
- CLI 产物保留了多个原 sprite / texture uuid 的 import/native 文件，例如 `05a0ccff-8e54-44dc-93ea-69c1e783f56a`、`19272444-c230-4d7c-ac92-528de9fd0ea0`、`70e69a82-8855-4dd7-a56c-cf12e6c819dd`、`98b386d7-e228-483e-baeb-67dc00424799`、`de90306c-8ef3-499f-b422-854aae6c3fc7`。

### Clean rerun 结论

- 自动图集：Editor baseline 可触达并完成；CLI 触发流程但失败，产物不等价。
- 纹理压缩：Editor baseline 可触达并完成；CLI 触发流程但 PVRTC 压缩存在工具版本/参数兼容错误，日志不等价。
- `web-mobile`：CLI 构建 exit code 为 `0`，但日志和产物均不能判为通过。
- `wechatgame`：CLI 构建 exit code 为 `0`，但日志和产物均不能判为通过；现有 parity test 失败。

### Clean rerun 证据文件

- `E:\own_space\engines\cocos-cli\.codex-tmp\auto-atlas-texture-compress-clean-20260617-095214\clean-run-summary.json`
- `E:\own_space\engines\cocos-cli\.codex-tmp\auto-atlas-texture-compress-clean-20260617-095214\editor-web-mobile.log`
- `E:\own_space\engines\cocos-cli\.codex-tmp\auto-atlas-texture-compress-clean-20260617-095214\editor-wechatgame.log`
- `E:\own_space\engines\cocos-cli\.codex-tmp\auto-atlas-texture-compress-clean-20260617-095214\cli-web-mobile.log`
- `E:\own_space\engines\cocos-cli\.codex-tmp\auto-atlas-texture-compress-clean-20260617-095214\cli-wechatgame.log`
- `E:\own_space\engines\cocos-cli\.codex-tmp\auto-atlas-texture-compress-clean-20260617-095214\vitest-wechatgame-parity.log`

## Engine NODEJS editor-path-replace patch 验证：`engine-nodejs-editor-path-replace-20260617-120604`

本轮按设计修改 3.8.6 engine source：

- 修改文件：`D:\workspace\engines\cocos\3.8.6\cocos\asset\asset-manager\editor-path-replace.ts`
- 修改内容：从 `internal:constants` 增加 `NODEJS`；注册条件扩展为 `(EDITOR || PREVIEW || NODEJS) && !TEST`；在 `queryExtension()` 中优先走 `NODEJS` 分支；通过 `globalThis.AssetDB.queryAsset(uuid)?.meta?.files` 查询 import payload；仅当 `files` 为单文件 `[ ".cconb" ]` 或 `[ ".bin" ]` 时返回 `.cconb`；`AssetDB.queryAsset` 缺失时只 warning 一次并返回空字符串；不回退 `Editor.Message`。
- 未修改 CLI engine 初始化策略，仍保持当前 `CC_EDITOR=true` / `NODEJS + EDITOR` 运行形态。

Review：

- `gpt-5.3-codex-spark` worker 完成单文件 engine patch。
- spec review 首轮指出 `queryAsset` 裸调用会丢失 receiver，已改为 `assetDB.queryAsset(uuid)`。
- code quality review 复审结论为 `Approved`；残余风险为旧 `catch` 分支不会唤醒同 uuid `resolveMap` 等待者、`NODEJS=true` runtime 优先跳过 Editor/preview 分支、`console.warn` 可能受严格 changed-line lint 影响。

验证命令和结果：

- `rtk npm run compiler:engine`：退出码 `0`，`bin\.cache\dev-cli\editor\bundled\index.js` 和 `bin\.cache\dev-cli\web\bundled\index.js` 均包含 `editor-path-replace: NODEJS mode requires globalThis.AssetDB.queryAsset`。
- `rtk npm run build`：退出码 `0`。
- CLI `web-mobile` 构建：退出码 `0`，输出目录 `E:\own_space\engines\cocos-test-projects\build\cli-engine-nodejs-editor-path-replace-20260617-120604-web-mobile`。
- CLI `wechatgame` 构建：退出码 `0`，输出目录 `E:\own_space\engines\cocos-test-projects\build\cli-engine-nodejs-editor-path-replace-20260617-120604-wechatgame`。

本轮 CLI 日志计数：

| 平台 | `Editor is not defined` | `ReferenceError` | `sprite frame can't be load` | `Read json failed` | `ENOENT ... ?_t=` | `Pack Images success` | `Invalid values chosen` |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `web-mobile` | 0 | 0 | 29 | 58 | 58 | 0 | 7 |
| `wechatgame` | 0 | 0 | 29 | 58 | 58 | 0 | 3 |

判断：

- 本轮 engine patch 已消除 `BUILD-ISSUE-021` 中 `Editor.Message.request` 缺失导致的 `ReferenceError: Editor is not defined`。
- 自动图集仍未达到 Editor baseline。当前剩余失败已变为 `D:\workspace\engines\cocos\3.8.6\bin\.editor\engine-adapter.js` 读取本地 `library/*.json?_t=...`，Windows `open()` 未剥离 query string，导致 `ENOENT`，随后 sprite frame 被移出 atlas。
- `wechatgame` parity test 仍失败，失败点仍是 top-level partition counts：Editor `assets=102`，CLI `assets=109`。该差异与自动图集 sprite frame 未进入 atlas 后保留原资源一致。
- `Invalid values chosen` 仍存在，归属 `BUILD-ISSUE-022` 的 PVRTC tool resolver / tool version 问题，不属于本次 engine `NODEJS` 分支补丁。

证据文件：

- `E:\own_space\engines\cocos-cli\.codex-tmp\engine-nodejs-editor-path-replace-20260617-120604\paths.json`
- `E:\own_space\engines\cocos-cli\.codex-tmp\engine-nodejs-editor-path-replace-20260617-120604\cli-web-mobile.log`
- `E:\own_space\engines\cocos-cli\.codex-tmp\engine-nodejs-editor-path-replace-20260617-120604\cli-wechatgame.log`

注意：本轮验证时主测试项目已有大量 `.meta` 脏改，CLI workspace 也已有 texture resolver 相关脏改；因此本节只作为 `Editor is not defined` 消除和剩余错误归因的验证，不声明 clean parity 已通过。

## BUILD-ISSUE-021 根因验证：`runtime-mode-validation-20260617`

本轮按计划文档 `docs/dev/build/plans/build-issue-021-root-cause-plan-20260617.md` 继续验证 runtime mode，不修改 production CLI 源码，不修改 3.8.6 engine 源码。

验证文件：

- Runtime smoke script：`E:\own_space\engines\cocos-cli\.codex-tmp\build-issue-021-runtime-smoke.js`
- `CC_EDITOR=true` smoke log：`E:\own_space\engines\cocos-cli\.codex-tmp\build-issue-021-runtime-smoke-editor-true.json`
- `CC_EDITOR=false` smoke log：`E:\own_space\engines\cocos-cli\.codex-tmp\build-issue-021-runtime-smoke-editor-false.json`
- `CC_EDITOR=false` build wrapper：`E:\own_space\engines\cocos-cli\.codex-tmp\build-issue-021-force-editor-false-build.js`
- `CC_EDITOR=false` build log：`E:\own_space\engines\cocos-cli\.codex-tmp\build-issue-021-editorfalse-web-mobile-20260617-validate-editorfalse-3.log`
- `BUILD + NODEJS` compiler script：`E:\own_space\engines\cocos-cli\.codex-tmp\build-issue-021-build-nodejs-engine.js`
- `BUILD + NODEJS` compiler log：`E:\own_space\engines\cocos-cli\.codex-tmp\build-issue-021-build-nodejs-engine.log`
- `BUILD + NODEJS` output：`E:\own_space\engines\cocos-cli\.codex-tmp\build-issue-021-build-nodejs-engine-out`

### 独立进程 preload smoke

使用同一 3.8.6 engine、同一 `requiredModules` 列表，分别启动独立 Node process 调用 `cc/preload`：

| mode | 退出码 | `CC_EDITOR` | `CC_NODEJS` | `CC_BUILD` | required modules | `downloader.appendTimeStamp` | `AssetDB.queryAsset` |
| --- | ---: | ---: | ---: | ---: | --- | ---: | --- |
| `editor=true` | 0 | true | true | false | 全部加载 | true | function |
| `editor=false` | 0 | false | true | false | 全部加载 | false | function |

判断：

- 在现有 `mode: 'EDITOR'`、`platform: 'NODEJS'` 编译产物不变的前提下，单独把 `preload({ editor: false })` 用于模块加载层是可行的。
- `editor=false` 会把 `downloader.appendTimeStamp` 从 `true` 降为 `false`，直接验证 `?_t=` 的来源是 `EDITOR_NOT_IN_PREVIEW`。
- `globalThis.AssetDB.queryAsset` 在 `editor=false` 下仍存在，说明 `AssetDB` 注入不依赖 `CC_EDITOR=true`。
- smoke 中尝试 `loadDynamic('internal:constants')` 失败，错误为 loader fetch 只支持 HTTP(S)。本轮未把该项作为失败条件，因为全局常量和 `appendTimeStamp` 已能观察目标事实；后续若需要精确读 `internal:constants`，应使用已注册模块 id 或 loader import map 中的实际 id。

### `CC_EDITOR=false` 真实 build 候选验证

使用临时 wrapper monkeypatch `cc/preload`，强制 `EngineManager.initEngine()` 内部的 `preload()` 收到 `editor=false`，然后通过 `CocosAPI.buildProject()` 调用 `web-mobile` 自动图集派生 config。

结果：

- 进程退出码为 `0`，但没有生成输出目录：`E:\own_space\engines\cocos-test-projects\build\cli-build-issue-021-editorfalse-web-mobile-20260617-validate-editorfalse-3` 不存在。
- 日志只进入 engine/game 初始化早期，没有进入 `Pack Images start`。
- 关键日志：
  - `Read json failed: "remote/internal/cc.config.json" (resolved: "") - ENOENT: no such file or directory, open ''`

判断：

- 不能把 `CC_EDITOR=false` 直接作为可实施修复。
- `editor=false` 在 preload/module 层能工作，但进入当前 `EngineManager.initEngine()` 的 `cc.game.init()` 后，internal bundle/config 路径语义发生变化，尝试读取 `remote/internal/cc.config.json` 并失败。
- 因此方案 A 需要继续定位 internal bundle 配置和 `builtinAssets` / `remoteBundles` / `serverURL` 组合，不能只改 `preload({ editor: false })`。

### `mode: 'BUILD' + platform: 'NODEJS'` 临时编译验证

使用 `@cocos/ccbuild.buildEngine()` 对 3.8.6 engine 执行临时编译：

- `mode: 'BUILD'`
- `platform: 'NODEJS'`
- `moduleFormat: 'system'`
- 输出：`E:\own_space\engines\cocos-cli\.codex-tmp\build-issue-021-build-nodejs-engine-out`

结果：

- 编译退出码为 `0`。
- 输出常量文件显示：
  - `CC_NODEJS=true`
  - `CC_EDITOR=false`
  - `EDITOR_NOT_IN_PREVIEW=false`
  - `CC_BUILD=true`
- 输出目录不存在当前 `cc/preload` 所需的 `editor/loader.js`。
- 输出目录根部也不存在 `loader.js`。
- 搜索 `cc/editor/serialization` 无结果，说明该 cocos4 风格 build output 不能直接满足当前 CLI `requiredModules`。

判断：

- 3.8.6 可以生成 `BUILD + NODEJS` 产物，但该产物结构与当前 `packages/cc-module/src/loader.ts` / `cc/preload` 期望的 `bin/.cache/dev-cli/editor/loader.js` 结构不同。
- 直接把 engine compiler 从 `mode: 'EDITOR'` 改为 `mode: 'BUILD'` 不是低风险一步到位方案；需要额外设计 CLI 专用 loader/output shape，或证明 normal build 不再需要 `cc/editor/*` required modules。

### 阶段性结论

- 根因方向仍成立：当前问题来自 `NODEJS` adapter 与 `EDITOR_NOT_IN_PREVIEW=true` 混合态。
- 单纯 runtime flag 分离不足以直接修复，因为 `cc.game.init()` 的 internal bundle/config 加载路径在 `CC_EDITOR=false` 下出现新阻塞。
- 单纯切到 cocos4 风格 `BUILD + NODEJS` 编译产物也不足以直接修复，因为当前 CLI 仍依赖 dev-cli editor loader 和 `cc/editor/*` modules。
- 下一步更合理的实现候选是计划文档中的方案 C/D：显式拆分 runtime mode，或定义受限 `editor-nodejs-build` 兼容层；如果继续探索方案 A，必须先解决 `remote/internal/cc.config.json` 的 internal bundle 配置问题。

## Texture Tool Resolver rerun：`tool-resolver-20260617-122851`

本轮验证 CLI 新增 texture compression tool resolver 后的显式工具切换能力。

注意：本节记录的是早期显式 `COCOS_CREATOR_RESOURCES_PATH` override 阶段事实；默认无 env 仍指向 `cli-bundled` 的结论已被后续 `overlay-creator-tools-20260617-134520` 覆盖。最终默认策略以“Creator 3.8.6 差异工具 overlay 默认验证”章节为准。

实现范围：

- 新增 `src/core/builder/worker/builder/asset-handler/texture-compress/tool-resolver.ts`。
- `compressPVR()` 不再直接拼 `GlobalPaths.staticDir/tools/PVRTexTool_*`，改为消费 resolver 结果。
- resolver 支持 `COCOS_CLI_PVRTEXTOOL_PATH`、`COCOS_CLI_TEXTURE_TOOLS_ROOT`、`COCOS_CREATOR_RESOURCES_PATH`、`COCOS_CREATOR_ROOT`、CLI bundled fallback。
- resolver 选择日志输出实际 `path`、`source`、`version`。

基础验证：

- `rtk npm test -- --runTestsByPath src/core/builder/test/texture-compress-tool-resolver.spec.ts`：通过，`16/16`。
- `rtk npm run build`：通过。
- 默认无 override 的 dist smoke：`source=cli-bundled`，`version=5.5.0`，路径为 `E:\own_space\engines\cocos-cli\static\tools\PVRTexTool_win32\PVRTexToolCLI.exe`。
- 设置 `COCOS_CREATOR_RESOURCES_PATH=D:\cocos_editors\Creator\Creator\3.8.6\resources` 的 dist smoke：`source=creator-resources`，`version=4.20.0`，路径为 `D:\cocos_editors\Creator\Creator\3.8.6\resources\tools\PVRTexTool_win32\PVRTexToolCLI.exe`。

构建设置：

- `COCOS_CREATOR_RESOURCES_PATH=D:\cocos_editors\Creator\Creator\3.8.6\resources`
- `web-mobile` config：`E:\own_space\engines\cocos-cli\.codex-tmp\tool-resolver-20260617-122851\buildConfig_web-mobile-autoatlas-compress.json`
- `wechatgame` config：`E:\own_space\engines\cocos-cli\.codex-tmp\tool-resolver-20260617-122851\buildConfig_wechatgame-autoatlas-compress.json`

构建结果：

| 平台 | exit code | `pvrtc tool resolved` | `compress pvrtc success` | `Compress image success` | `Invalid values chosen` | `texture compress task width asset` |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `web-mobile` | 0 | 7 | 7 | 1 | 0 | 0 |
| `wechatgame` | 0 | 3 | 3 | 1 | 0 | 0 |

resolver 日志均为：

```text
pvrtc tool resolved: path=D:\cocos_editors\Creator\Creator\3.8.6\resources\tools\PVRTexTool_win32\PVRTexToolCLI.exe, source=creator-resources, version=4.20.0
```

`wechatgame` parity test：

- 命令设置：
  - `COCOS_CLI_TEST_ENGINE_ROOT=D:\workspace\engines\cocos\3.8.6`
  - `COCOS_CREATOR_RESOURCES_PATH=D:\cocos_editors\Creator\Creator\3.8.6\resources`
  - `COCOS_CLI_WECHATGAME_BASELINE_DIR=E:\own_space\engines\cocos-test-projects\build\editor-autoatlas-compress-wechatgame-20260617`
  - `COCOS_CLI_WECHATGAME_OUTPUT_DIR=E:\own_space\engines\cocos-test-projects\build\tool-resolver-20260617-122851-wechatgame`
  - `COCOS_CLI_WECHATGAME_BASELINE_CONFIG=E:\own_space\engines\cocos-cli\.codex-tmp\tool-resolver-20260617-122851\buildConfig_wechatgame-autoatlas-compress.json`
- 结果：退出码 `1`。
- 失败点：top-level partition counts 不一致，Editor `assets=102`，CLI `assets=112`；`cocos-js=13`、`remote=447`、`root=11`、`src=11`、`subpackages=4` 一致。

判断：

- PVRTC tool version mismatch 已通过显式 `COCOS_CREATOR_RESOURCES_PATH` resolver 路径消除；两个平台均不再出现 `Invalid values chosen` 或 `texture compress task width asset`。
- 默认无 override 时仍 fallback 到 CLI bundled `PVRTexTool 5.5.0`，本轮不声明 production default 已自动匹配 Creator/engine 工具版本。
- `wechatgame` 完整 parity 仍未通过，当前失败在 `assets` 分区计数，不能归因到 PVRTC tool resolver；应继续按自动图集/资源产物差异链路排查。

证据文件：

- `E:\own_space\engines\cocos-cli\.codex-tmp\tool-resolver-20260617-122851\paths.json`
- `E:\own_space\engines\cocos-cli\.codex-tmp\tool-resolver-20260617-122851\cli-web-mobile.log`
- `E:\own_space\engines\cocos-cli\.codex-tmp\tool-resolver-20260617-122851\cli-wechatgame.log`

## Creator 3.8.6 差异工具 overlay 默认验证：`overlay-creator-tools-20260617-134520`

本轮根据最终决策调整：不复制 Editor 3.8.6 的整套 `resources/tools`，只把与当前仓库 `static/tools` 存在差异、且会影响本问题的工具文件放入 `static/tools/creator-3.8.6`。resolver 按具体工具相对路径做 overlay 查找；overlay 中没有差异文件时，继续回退到旧 `static/tools`。

工具 overlay 事实：

- 源目录：`D:\cocos_editors\Creator\Creator\3.8.6\resources\tools`
- overlay 目录：`E:\own_space\engines\cocos-cli\static\tools\creator-3.8.6`
- overlay 文件数：`2`
- overlay 文件：`PVRTexTool_win32\PVRTexToolCLI.exe`，ProductVersion `4.20.0`
- overlay 文件：`PVRTexTool_win32\compare.exe`
- 旧 CLI bundled PVRTC tool 仍保留：`E:\own_space\engines\cocos-cli\static\tools\PVRTexTool_win32\PVRTexToolCLI.exe`，ProductVersion `5.5.0`

resolver 优先级：

1. `COCOS_CLI_PVRTEXTOOL_PATH`，仅 `pvr` 使用。
2. `COCOS_CLI_TEXTURE_TOOLS_ROOT/<relativePath>`。
3. `COCOS_CREATOR_RESOURCES_PATH/tools/<relativePath>`。
4. `COCOS_CREATOR_ROOT/resources/tools/<relativePath>`。
5. `static/tools/creator-3.8.6/<relativePath>`。
6. `static/tools/<relativePath>`。

基础验证：

- `rtk npm test -- --runTestsByPath src/core/builder/test/texture-compress-tool-resolver.spec.ts`：通过，`20/20`。
- `rtk npm run build`：通过。
- 默认无 tool override 的 PVR dist smoke：`source=bundled-creator-3.8.6`，`version=4.20.0`，路径为 `E:\own_space\engines\cocos-cli\static\tools\creator-3.8.6\PVRTexTool_win32\PVRTexToolCLI.exe`。
- 显式设置 `COCOS_CLI_TEXTURE_TOOLS_ROOT=E:\own_space\engines\cocos-cli\static\tools` 的 PVR dist smoke：`source=explicit-tools-root`，`version=5.5.0`，路径为 `E:\own_space\engines\cocos-cli\static\tools\PVRTexTool_win32\PVRTexToolCLI.exe`。
- 默认无 tool override 的 `libwebp_win32\bin\cwebp.exe` dist smoke：`source=cli-bundled`，因为 overlay 没有 webp 差异文件。

构建设置：

- 未设置 `COCOS_CLI_PVRTEXTOOL_PATH`
- 未设置 `COCOS_CLI_TEXTURE_TOOLS_ROOT`
- 未设置 `COCOS_CREATOR_RESOURCES_PATH`
- 未设置 `COCOS_CREATOR_ROOT`
- `web-mobile` config：`E:\own_space\engines\cocos-cli\.codex-tmp\overlay-creator-tools-20260617-134520\buildConfig_web-mobile-autoatlas-compress.json`
- `wechatgame` config：`E:\own_space\engines\cocos-cli\.codex-tmp\overlay-creator-tools-20260617-134520\buildConfig_wechatgame-autoatlas-compress.json`

构建结果：

| 平台 | exit code | `pvrtc tool resolved` | `compress pvrtc success` | `Compress image success` | `Invalid values chosen` | `texture compress task width asset` |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `web-mobile` | 0 | 7 | 7 | 1 | 0 | 0 |
| `wechatgame` | 0 | 3 | 3 | 1 | 0 | 0 |

resolver 日志均为：

```text
pvrtc tool resolved: path=E:\own_space\engines\cocos-cli\static\tools\creator-3.8.6\PVRTexTool_win32\PVRTexToolCLI.exe, source=bundled-creator-3.8.6, version=4.20.0
```

`wechatgame` parity test：

- 命令设置：`COCOS_CLI_TEST_ENGINE_ROOT=D:\workspace\engines\cocos\3.8.6`，未设置任何 texture tool override env。
- Baseline：`E:\own_space\engines\cocos-test-projects\build\editor-autoatlas-compress-wechatgame-20260617`
- CLI output：`E:\own_space\engines\cocos-test-projects\build\overlay-creator-tools-20260617-134520-wechatgame`
- Config：`E:\own_space\engines\cocos-cli\.codex-tmp\overlay-creator-tools-20260617-134520\buildConfig_wechatgame-autoatlas-compress.json`
- 结果：退出码 `1`。
- 失败点：top-level partition counts 不一致，Editor `assets=102`，CLI `assets=112`；`cocos-js=13`、`remote=447`、`root=11`、`src=11`、`subpackages=4` 一致。

判断：

- `BUILD-ISSUE-022` 对当前 Creator 3.8.6 目标已修复：默认无 env 时 CLI 按 overlay 使用 Editor 3.8.6 `PVRTexTool 4.20.0`，两个平台不再出现 `Invalid values chosen` 或 `texture compress task width asset`。
- 未发生差异的工具不复制、不切换。例如 `webp` 当前仍默认使用 `static/tools` 下旧 CLI bundled tool。
- 旧 CLI bundled `PVRTexTool 5.5.0` 仍可通过显式 `COCOS_CLI_TEXTURE_TOOLS_ROOT=E:\own_space\engines\cocos-cli\static\tools` 选择，用于诊断或后续升级验证。
- `wechatgame` 完整 parity 仍未通过，当前失败在 `assets` 分区计数，不能归因到 PVRTC tool resolver；继续归入自动图集/资源产物差异链路。

证据文件：

- `E:\own_space\engines\cocos-cli\.codex-tmp\overlay-creator-tools-20260617-134520\paths.json`
- `E:\own_space\engines\cocos-cli\.codex-tmp\overlay-creator-tools-20260617-134520\cli-web-mobile.log`
- `E:\own_space\engines\cocos-cli\.codex-tmp\overlay-creator-tools-20260617-134520\cli-wechatgame.log`

## BUILD-ISSUE-021 根因补充：`CC_EDITOR=false` 与 cocos4 `NODEJS` adapter 差异

验证现象：

- 独立 Node preload smoke 证明：`cc/preload({ editor: false })` 下 `CC_EDITOR=false`、`CC_NODEJS=true`、`CC_BUILD=false`，`AssetDB.queryAsset` 仍可用，`downloader.appendTimeStamp=false`。
- 真实 CLI build 强制 `editor=false` 后未进入 `Pack Images`，停在 engine 初始化阶段，日志出现：

```text
WARN Read json failed: "remote/internal/cc.config.json" (resolved: "") - ENOENT: no such file or directory, open ''
```

3.8.6 engine 链路：

- `cocos/asset/asset-manager/downloader.ts:116` 的 `downloadBundle()` 对非 URL bundle name 判断：如果 `bundleName` 在 `downloader.remoteBundles` 中，则路径拼为 `${remoteServerAddress}remote/${bundleName}`，后续读取 `${url}/config.json`。
- `cocos/asset/asset-manager/asset-manager.ts:433` 从 settings/options 读取 `remoteBundles`，`asset-manager.ts:445` 传给 `downloader.init()`。
- `src/core/engine/index.ts:422` 在 CLI 进程内 engine 初始化时固定传入 `remoteBundles: ['internal', 'main'].concat(bundles)`。
- `cocos/asset/asset-manager/builtin-res-mgr.ts:287` 仅在 `EDITOR` 为 true 时创建内存版 `BuiltinBundleName.INTERNAL` bundle；`CC_EDITOR=false` 时该分支不执行。
- `cocos/asset/asset-manager/builtin-res-mgr.ts:320` 的 `loadBuiltinAssets()` 仍会根据 `engine.builtinAssets` 决定是否加载 internal bundle；CLI 无 `serverURL` 初始化时 `src/core/engine/index.ts:391` 将 `builtinAssets` 设为 `[]`，空数组是 truthy，因此会继续尝试 `assetManager.loadBundle('internal')`。

因此，`CC_EDITOR=false` 后的失败不是 `AssetDB` 不存在，也不是 `editor-path-replace.ts` 的单点问题；直接原因是 3.8.6 在 `NODEJS + !EDITOR` 下没有注册 editor/Node 工具链需要的内存版 `internal` bundle，但 CLI 初始化又把 `internal` 声明为 `remoteBundle`，于是 engine 按普通 runtime 路径去读 `remote/internal/config.json`，node adapter 日志表现为 `remote/internal/cc.config.json`。

cocos4 对比：

- `E:\own_space\engines\cocos4\cocos\asset\asset-manager\builtin-res-mgr.ts:287` 已改为 `if (EDITOR || NODEJS)`，即 `NODEJS` 下也创建内存版 `internal` bundle。
- `E:\own_space\engines\cocos4\cocos\game\game.ts:996` 将浏览器 preview script 分支排除 `NODEJS`，并在 `(EDITOR || NODEJS)` 时走 `globalThis.cce.Script.init()`。
- `E:\own_space\engines\cocos4\cocos\asset\asset-manager\factory.ts:89`、`utilities.ts:138`、`shared.ts:39`、`url-transformer.ts:164`、`assets/asset.ts:199` 等也将若干 editor-only 工具链行为扩展到 `NODEJS`。
- `E:\own_space\engines\cocos4\cocos\asset\asset-manager\editor-path-replace.ts:97` 增加 `NODEJS` 分支，通过 `AssetDB` 或网络查询 extname，避免依赖 `Editor.Message`。

结论：

- cocos4 不是“简单把 CLI preload 切成 `editor=false`”，而是让 `NODEJS` 继承一组原本只挂在 `EDITOR` 下的工具链能力，同时避免 `EDITOR_NOT_IN_PREVIEW` 的 timestamp 副作用。
- 3.8.6 若只补 `editor-path-replace.ts`，最多消除 `Editor.Message` 缺失；一旦真正切到 `CC_EDITOR=false`，还会缺少 `builtin-res-mgr`、`factory`、`utilities`、`shared`、`game` 等 Node 工具链兼容分支。
- 根因方向应定为：3.8.6 engine 缺少 cocos4 风格的 `NODEJS` adapter 语义；CLI 当前 `editor:true` 初始化只是绕过了这些缺口，但引入 `EDITOR_NOT_IN_PREVIEW` timestamp，导致 BUILD-ISSUE-021 的 `?_t=`、pack miss 和 auto-atlas/texture-compress 资源差异。

## BUILD-ISSUE-021 执行验证：`build-nodejs-nodejs-adapter-20260617`

本轮按计划将 CLI normal build runtime 拆成显式 `build-nodejs`，同时按 cocos4 对照回迁 3.8.6 engine 必要 `NODEJS` adapter 分支。

### CLI runtime mode

修改范围：

- `packages/cc-module/src/preload.ts`
- `src/core/engine/index.ts`
- `src/core/launcher.ts`

行为事实：

- `Engine.initEngine()` 默认保持 `editor-nodejs`，避免 scene/runtime-preview/programming 等共享入口被隐式切换。
- `Launcher.build()` 显式传入 `build-nodejs`。
- `build-nodejs` 下 `CC_EDITOR=false`、`CC_NODEJS=true`、`CC_BUILD=false`，`cc.assetManager.downloader.appendTimeStamp=false`。

### 3.8.6 engine source

第一批按 cocos4 对照回迁：

- `cocos/asset/asset-manager/builtin-res-mgr.ts`
- `cocos/asset/asset-manager/factory.ts`
- `cocos/asset/asset-manager/shared.ts`
- `cocos/asset/asset-manager/utilities.ts`
- `cocos/asset/asset-manager/deserialize.ts`
- `cocos/asset/asset-manager/url-transformer.ts`
- `cocos/asset/asset-manager/editor-path-replace.ts`
- `cocos/game/game.ts`

验证中继续暴露并修复的必要分支：

- `pal/utils.ts`：`setTimeoutRAF()` 需要在 `NODEJS` 下走 `setTimeout`，否则 nodejs adapter 的空 `requestAnimationFrame` 会让 `asyncify()` 永不回调，`cc.game.init()` 卡在 internal bundle 加载。
- `cocos/core/data/utils/requiring-frame.ts`：`legacyCC._RF.reset` 需要在 `EDITOR || NODEJS` 下定义，否则 `@cocos/lib-programming` 的 executor reload 会失败。
- `cocos/serialization/deserialize.ts`：`Details.prototype.assignAssetsBy` 需要在 `EDITOR || NODEJS || TEST` 下定义，否则 build asset dependency scan 无法把 uuid 引用转为 asset placeholder。
- `cocos/asset/assets/image-asset.ts`、`texture-base.ts`、`texture-2d.ts`、`texture-cube.ts`、`render-texture.ts` 及对应 `*.jsb.ts`：构建期 `_serialize()` 需要支持 `NODEJS`，否则 auto-atlas 生成的 `Texture2D` 在 `build-nodejs` 下会序列化成 `instances: [null]`。
- `cocos/asset/assets/texture-2d.ts` 和 `texture-2d.jsb.ts` 同时按 cocos4 记录 `ctxForExporting.dependsOn('_textureSource', uuid)`，保证 mipmap ImageAsset 依赖进入 compiled JSON 依赖表。

### 中间失败与根因

按时间顺序：

- `remote/internal/cc.config.json`：3.8.6 `builtin-res-mgr.ts` 只在 `EDITOR` 注册内存版 `internal` bundle，`CC_EDITOR=false` 后落入 remote bundle 路径。
- `cc.game.init()` 不 resolve：3.8.6 `pal/utils.ts` 在 `NODEJS + !EDITOR` 下使用空 `requestAnimationFrame`。
- `cc.cclegacy._RF.reset is not a function`：3.8.6 `requiring-frame.ts` 只在 `EDITOR` 下定义 reset。
- `details.assignAssetsBy is not a function`：3.8.6 `deserialize.ts` 只在 `EDITOR || TEST` 下定义 dependency asset assignment helper。
- `getRootData(...) is null`：3.8.6 texture/image `_serialize()` 只在 `EDITOR || TEST` 下返回构建数据，`NODEJS + !EDITOR` 下返回 `null` 或空数据。

### 验证结果

基础验证：

- `rtk npm run compiler:engine`：通过。
- `rtk npm run build`：通过。
- 最小 `Texture2D` serialize smoke：`build-nodejs` 下 `rootData` 为 `{ base, mipmaps }`，不再是 `null`。

真实构建：

- 平台：`web-mobile`
- Config：`E:\own_space\engines\cocos-cli\.codex-tmp\bundled-creator-tools-20260617-132404\buildConfig_web-mobile-autoatlas-compress.json`
- Engine：`D:\workspace\engines\cocos\3.8.6`
- Project：`E:\own_space\engines\cocos-test-projects`
- Output：`E:\own_space\engines\cocos-test-projects\build\cli-build-issue-021-current-web-mobile-20260617-after-texture-serialize`
- 退出码：`0`
- `Pack Images success`：已出现。
- `Compress image success`：已出现。
- `Build Assets success`：已出现。
- `result.code=0`。
- 运行时快照：`CC_EDITOR=false`、`CC_PREVIEW=false`、`CC_NODEJS=true`、`CC_BUILD=false`、`appendTimeStamp=false`。

`wechatgame` 首轮 `build-nodejs` 真实构建：

- 平台：`wechatgame`
- Config：`E:\own_space\engines\cocos-cli\.codex-tmp\bundled-creator-tools-20260617-132404\buildConfig_wechatgame-autoatlas-compress.json`
- Engine：`D:\workspace\engines\cocos\3.8.6`
- Project：`E:\own_space\engines\cocos-test-projects`
- Output：`E:\own_space\engines\cocos-test-projects\build\cli-build-issue-021-current-wechatgame-20260617-after-texture-serialize`
- 退出码：`0`
- `Pack Images success`：已出现。
- `Compress image success`：已出现。
- `Build Assets success`：已出现。
- 运行时快照：`CC_EDITOR=false`、`CC_PREVIEW=false`、`CC_NODEJS=true`、`CC_BUILD=false`、`appendTimeStamp=false`。

该轮 `wechatgame` parity 仍失败，失败点已不再是自动图集 `?_t=` 或 `Editor.Message`：

- Editor baseline `assets=102`，CLI `assets=99`，其余 `cocos-js=13`、`remote=447`、`root=11`、`src=11`、`subpackages=4` 一致。
- CLI 缺失 3 个压缩产物：
  - `main/native/13/13fc3621-bc33-4f1a-b417-37913c192fca.a6a0a.pvr`
  - `main/native/86/86111909-d8dd-4c9d-87f5-da84db8c9031.52d4d.astc`
  - `main/native/f8/f8048f67-ba80-4b35-9450-33cf6254fbf3.a9f1f.pvr`
- 对应源资源为：
  - `assets/cases/2D/single-compress/image/pvrtc2_rgb_a.png.meta`
  - `assets/cases/2D/single-compress/image/astc10x10.png.meta`
  - `assets/cases/2D/single-compress/image/pvrtc4_rgb_a.png.meta`
- 三份候选 `buildConfig_wechatgame-autoatlas-compress.json` 的关键字段一致，不能归因于 config mismatch。
- `temp/builder/CompressTexture/compress-info.json` 显示这三个 uuid 已进入任务收集，但 `compressOptions` 只剩 `png`；根因是 CLI `src/core/builder/platforms/wechatgame/config.ts` 的 `textureCompressConfig.support` 未包含 Editor baseline 使用的 `pvrtc_2bits_rgb_a`、`pvrtc_4bits_rgb_a`、`astc_10x10` 等格式。

补齐 `wechatgame` platform support 后复验：

- 单测：`rtk npm test -- src/core/builder/test/wechatgame-platform.spec.ts --runInBand`，7 tests passed。
- CLI build：`rtk npm run build` 通过。
- `wechatgame` 输出：`E:\own_space\engines\cocos-test-projects\build\cli-build-issue-021-current-wechatgame-20260617-after-platform-support`
- `wechatgame` 构建退出码：`0`
- 日志中新增目标压缩产物：
  - `86111909-d8dd-4c9d-87f5-da84db8c9031.astc`
  - `13fc3621-bc33-4f1a-b417-37913c192fca.pvr`
  - `f8048f67-ba80-4b35-9450-33cf6254fbf3.pvr`
- parity：`npm --prefix vitests test -- suites/build/wechatgame-editor-baseline-parity.test.ts`，1 test passed。

### Review 后入口修复与最终复验

最终 review 发现两个必须补齐的事实：

- `src/api/builder/builder.ts` 的 `BuilderApi.build()` 会直接调用 `core/builder.build()`，不经过 `Launcher.build()`；因此从 `CocosAPI.startup()` 或 MCP server 进入的 build 仍会复用已启动进程的 `editor-nodejs` runtime，无法获得 normal build 需要的 `build-nodejs`。
- MCP tool registry 保存的是 class prototype，`McpMiddleware` 执行 tool 时原先直接把 prototype 当 instance 调用；只在 `CocosAPI._init()` 创建 `new BuilderApi(() => this._projectPath)` 不足以修复 MCP 路径。
- 3.8.6 dev-cli 编译产物中 `NODEJS=true` 是编译常量；Editor-like 场景通过 `CC_EDITOR=true` 进入 `editor-nodejs` 时也同时满足 `NODEJS`。因此 `editor-path-replace.ts` 不能把 `NODEJS` 分支放在 `EDITOR` 分支前，否则会破坏原 Editor `Editor.Message.request('asset-db', 'query-asset-info')` 行为。

对应修复：

- `CocosAPI.startup(projectPath)` 后，`BuilderApi` 保存 projectPath provider；`BuilderApi.build()` 在已知 projectPath 时写入临时 options JSON，并用独立 Node 子进程执行 `CocosAPI.buildProject(projectPath, platform, options)`，从而重新经过 `Launcher.build()` 的 `build-nodejs` 初始化。未知 projectPath 时保留旧 direct fallback。
- `McpMiddleware` 接受 projectPath provider；`start-mcp-server` 与 MCP 测试 helper 传入当前 projectPath；执行 `BuilderApi` tool 时创建带 provider 的真实 `BuilderApi` 实例。
- parent process 通过 sentinel JSON 读取子进程 build result，并在 `finally` 清理临时 options 文件。
- `editor-path-replace.ts` 的分支顺序保持 `EDITOR` 优先、`NODEJS` 次之，并在异常路径 drain 同 uuid 的 `resolveMap` 等待队列。

新增验证：

- `rtk npm test -- src/core/builder/test/builder-api-build.spec.ts src/core/builder/test/wechatgame-platform.spec.ts --runInBand`：2 suites / 9 tests passed。
- `rtk npm run build`：通过。
- `rtk npm run compiler:engine`：通过。
- `wechatgame` after-review-fixes 输出：`E:\own_space\engines\cocos-test-projects\build\cli-build-issue-021-current-wechatgame-20260617-after-review-fixes`
- after-review-fixes 构建退出码：`0`；日志包含 `Pack Images success`、`Compress image success`、`Build Assets success`。
- after-review-fixes 运行时快照：`CC_EDITOR=false`、`CC_PREVIEW=false`、`CC_NODEJS=true`、`CC_BUILD=false`、`appendTimeStamp=false`。
- after-review-fixes parity：`npm --prefix vitests test -- suites/build/wechatgame-editor-baseline-parity.test.ts`，1 test passed。
- after-review-fixes 构建日志未命中：`Editor is not defined`、`Read json failed`、`remote/internal/cc.config.json`、`sprite frame can`、`ENOENT.*?_t=`。

残余警告：

- `Failed to resolve CommonJS bare specifier "@tbmp/mp-cloud-sdk"`：项目脚本依赖问题，build 已按现有 fallback 继续。
- `You are explicitly specifying undefined type ... ShieldNode`：项目脚本类型 warning。
- `@cocos/rollup-plugin-typescript` 对 engine 源有既有 TS warning。

未完成验证：

- runtime preview、scene process、programming facet 尚未完整回归。
- MCP/API startup 已覆盖 build 子进程隔离路径和 MCP middleware tool 调用路径单元测试，但尚未跑真实 MCP server HTTP 端到端构建。

## BUILD-ISSUE-021 产物运行验证补充

### web-mobile 浏览器运行验证

验证对象：

- 输出目录：`E:\own_space\engines\cocos-test-projects\build\cli-build-issue-021-current-web-mobile-20260617-after-texture-serialize`
- 本地 URL：`http://127.0.0.1:18121/index.html`

验证过程：

- 用本地静态服务打开上述 `web-mobile` 输出目录。
- 使用 in-app browser 打开 `index.html`。
- 读取 browser console：`error` 数量为 `0`。
- 读取 browser log：出现 `LoadScene db://assets/cases/animation/EasingMethods.scene: 99.97412109375 ms`。
- 截图观察到场景已渲染：蓝色背景、`EasingMethods.scene` 中的 `Sine` 标签、运动曲线和中文说明文本。

判断：

- 本轮只能证明该 `web-mobile` 构建产物可在浏览器中启动并渲染首个加载 scene，且未观察到 console error。
- 本轮没有覆盖完整交互、全部 scene 切换或所有资源路径。

### wechatgame 微信开发者工具打开验证

验证对象：

- 输出目录：`E:\own_space\engines\cocos-test-projects\build\cli-build-issue-021-current-wechatgame-20260617-after-review-fixes`
- 产物入口检查：目录存在 `project.config.json`、`game.json`、`game.js`、`web-adapter.js`、`engine-adapter.js`。

工具定位：

- 通过 Windows 快捷方式定位到微信开发者工具安装路径：`E:\programs\微信web开发者工具\微信开发者工具.exe`。
- 同目录存在 CLI：`E:\programs\微信web开发者工具\cli.bat`。

执行命令：

```powershell
& "E:\programs\微信web开发者工具\cli.bat" open --project "E:\own_space\engines\cocos-test-projects\build\cli-build-issue-021-current-wechatgame-20260617-after-review-fixes" --lang zh
```

CLI 输出：

```text
× IDE may already started at port 41192, trying to connect
√ IDE 启动成功，HTTP 服务地址 http://127.0.0.1:28361
√ open
```

判断：

- 本轮证明该 `wechatgame` 构建目录可被微信开发者工具 CLI 作为项目打开。
- 本轮没有进一步读取微信开发者工具模拟器 console，也没有覆盖微信小游戏运行时完整交互。
