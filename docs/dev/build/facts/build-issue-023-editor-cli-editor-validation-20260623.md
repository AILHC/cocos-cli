# BUILD-ISSUE-023 Editor -> CLI -> Editor 验证记录

日期：2026-06-23

## Environment

- project: `E:\own_space\engines\cocos-test-projects`
- engine: `D:\workspace\engines\cocos\3.8.6`
- repo: `E:\own_space\engines\cocos-cli\.worktrees\rebase-adapter-to-386-origin-main-20260622`
- branch: `codex/rebase-adapter-to-386-origin-main-20260622`
- commit: `256bfa13ee6787894c1f8f403a1e8a9a16096b1c`
- shared output historical gate: `COCOS_CLI_SHARED_LIBRARY_OUTPUT=1`
- 2026-06-24 default switch: shared project `library` output is production default; `COCOS_CLI_SHARED_LIBRARY_OUTPUT=0` is the emergency opt-out back to `library/cli`.

## Command deviations

计划中的命令需要按本机事实调整：

- `cce run --project E:\own_space\engines\cocos-test-projects` 在当前 `@xuyanfeng/cc-editor` 安装中无效，报 `unknown option '--project'`；本机 `cce cur` 已指向 `3.8.6 - E:/own_space/engines/cocos-test-projects`，验证使用 `cce run`。
- `preview --engine` 和 `build --engine` 不是当前 CLI 支持的参数；engine 由项目配置解析。runtime preview 日志显示 `engineRootSource=project-config`。
- `preview --runtime` 是长驻 server；验证以最新 `runtime-preview-*.log` 出现 `preview:ready` 为达成点，随后停止该 preview 进程。
- 测试项目在验证前已有大量 3D source `.meta` dirty 文件和 3 个未跟踪 `buildConfig_*.json`。因此 source `.meta` 结论只基于 A/B/C hash 快照差异，不基于 clean `git status`。

第一次 shared preview 尝试失败于端口占用：

```text
Error: listen EADDRINUSE: address already in use 127.0.0.1:9527
```

占用进程为前次遗留的：

```text
node.exe .\dist\cli.js preview --project E:\own_space\engines\cocos-test-projects --runtime
```

停止该进程后重跑通过到 `preview:ready`。该失败不归因于 shared library cache 实现。

## Directory sizes

shared gate 三段验证开始前：

```text
temp\asset-db	files=760	MiB=91.18
temp\cli\asset-db	files=134	MiB=88.53
library	files=12294	MiB=1,204.91
library\cli	files=5935	MiB=584.80
```

build validation 开始前：

```text
temp\asset-db	files=761	MiB=91.18
temp\cli\asset-db	files=134	MiB=88.53
library	files=12298	MiB=1,206.55
library\cli	files=5935	MiB=584.80
```

## Snapshot roots

```text
default: .codex-tmp\build-issue-023-validation-default-20260623-172632
shared:  .codex-tmp\build-issue-023-validation-shared-20260623-182930
build:   .codex-tmp\build-issue-023-validation-build-20260623-184127
```

## Default isolated output validation

`COCOS_CLI_SHARED_LIBRARY_OUTPUT` unset.

```text
A-editor -> B-cli-preview library-records: added=0 removed=0 changed=0
A-editor -> B-cli-preview library-output: added=0 removed=0 changed=0
A-editor -> B-cli-preview source-meta: added=0 removed=0 changed=0
B-cli-preview -> C-editor library-records: added=0 removed=0 changed=1
  changed: library\.assets-info1.0.0.json
B-cli-preview -> C-editor library-output: added=0 removed=0 changed=0
B-cli-preview -> C-editor source-meta: added=0 removed=0 changed=0
```

定点 hash：

```text
library/.assets-info1.0.0.json => A-editor:778573:437D83898876 | B-cli-preview:778573:437D83898876 | C-editor:778573:4D60946C6804 | pre:778573:D8C2D6A6E93C
library/.assets-data.json => A-editor:1345736:00B21C56FBD3 | B-cli-preview:1345736:00B21C56FBD3 | C-editor:1345736:00B21C56FBD3 | pre:1345736:00B21C56FBD3
library/.assets-dependency.json => A-editor:162981:6A66299ED6A6 | B-cli-preview:162981:6A66299ED6A6 | C-editor:162981:6A66299ED6A6 | pre:162981:6A66299ED6A6
```

结论：

- 默认 isolated `library/cli` output 下，CLI preview 没有改写 Editor `library` records、Editor `library` output 或 source `.meta`。
- 第二次 Editor open 自身改写了 `library/.assets-info1.0.0.json`；该变化不是 CLI preview 引入。

## Shared output gate validation

`COCOS_CLI_SHARED_LIBRARY_OUTPUT=1`.

runtime preview 日志：

```text
engineRoot=D:\workspace\engines\cocos\3.8.6
engineRootSource=project-config
asset-db:done durationMs=24432
settings:build:done durationMs=2302 scene= scripts=235 bundles=11
preview:ready durationMs=34352
```

分类 diff：

```text
A-editor -> B-cli-preview library-records: added=4 removed=0 changed=0
  added: library/.cli-assets
  added: library/.cli-assets-data.json
  added: library/.cli-assets-dependency.json
  added: library/.cli-assets-info.json
A-editor -> B-cli-preview library-output: added=0 removed=0 changed=336
  changed: library/01/01109121-4d7a-41e8-84ca-a7f2ce67b251@c0adb.json
  changed: library/01/017c5cf6-47b4-4189-8f8e-31ad5383f8fa@8ed34.json
  changed: library/02/0299d724-d932-4c2e-a4b3-b02ee408fc05@8b37b.json
  changed: library/03/03e3e683-bdab-48c2-8585-e56f5a349ad1@1d833.json
  changed: library/03/03e7e19d-d76f-4606-976e-62725d249a4a@6e2f9.json
  changed: library/04/04cc6394-7583-4371-88b7-6f5cf1aa1943@c8ce7.json
  changed: library/05/054daf25-262f-4267-92ba-e8bd2d1c2bb7@5f176.json
  changed: library/05/05737d93-f21c-4271-bd69-3aea577a2765@9678f.json
  changed: library/08/0865bcfc-b738-4367-bd83-f40131de5048@3f200.json
  changed: library/08/08aa84bf-500c-4728-a8b0-2efd8fbe3cb7@edaa8.json
A-editor -> B-cli-preview library-cli-output: added=0 removed=0 changed=0
A-editor -> B-cli-preview source-meta: added=0 removed=0 changed=0
B-cli-preview -> C-editor library-records: added=0 removed=0 changed=0
B-cli-preview -> C-editor library-output: added=0 removed=0 changed=0
B-cli-preview -> C-editor library-cli-output: added=0 removed=0 changed=0
B-cli-preview -> C-editor source-meta: added=0 removed=0 changed=0
```

定点 hash：

```text
library/.assets-info1.0.0.json => A-editor:778573:4D60946C6804 | B-cli-preview:778573:4D60946C6804 | C-editor:778573:4D60946C6804 | pre:778573:4D60946C6804
library/.assets-data.json => A-editor:1345736:00B21C56FBD3 | B-cli-preview:1345736:00B21C56FBD3 | C-editor:1345736:00B21C56FBD3 | pre:1345736:00B21C56FBD3
library/.assets-dependency.json => A-editor:162981:6A66299ED6A6 | B-cli-preview:162981:6A66299ED6A6 | C-editor:162981:6A66299ED6A6 | pre:162981:6A66299ED6A6
library/.cli-assets-info.json => A-editor:missing | B-cli-preview:609131:7FF4732940D7 | C-editor:609131:7FF4732940D7 | pre:missing
library/.cli-assets-data.json => A-editor:missing | B-cli-preview:1332584:54ECDFB15054 | C-editor:1332584:54ECDFB15054 | pre:missing
library/.cli-assets-dependency.json => A-editor:missing | B-cli-preview:90035:50A4FA66E80F | C-editor:90035:50A4FA66E80F | pre:missing
library/.cli-assets => A-editor:missing | B-cli-preview:138751:366F4AC51D83 | C-editor:138751:366F4AC51D83 | pre:missing
```

结论：

- CLI shared preview 没有删除或迁移 Editor `.assets-*` records。
- CLI shared preview 创建了 `.cli-assets-*` sidecar records。
- CLI shared preview 改写了 336 个 `library/<uuid-prefix>/...` output 文件。
- 第二次 Editor open 没有再改写这些 output，当前没有观察到 immediate back-and-forth rewrite。
- 336 个 shared output 改写在本轮尚未按 importer/value 差异逐项分类；2026-06-24 已按后续手测结论接受默认共享，字段级质量评估单独保留为 `BUILD-ISSUE-025`。

## Build validation

命令：

```powershell
rtk node .\dist\cli.js build --project E:\own_space\engines\cocos-test-projects --platform web-mobile --build-config E:\own_space\engines\cocos-test-projects\buildConfig_web-mobile.json --outputName codex-build-issue-023-shared-cache-validation
```

结果：失败，exit code `34`。

失败点：

```text
build-ex:onBeforeBuild failed
Hook function onBeforeBuild of build plugin build-ex execution failed
Error: Editor.Message send scheduled after hook scope
Error: Build plugin "build-ex" hook "onBeforeBuild" failed: Editor.Message send scheduled after hook scope
```

失败前后快照：

```text
pre-build -> post-build library-records: added=0 removed=0 changed=0
pre-build -> post-build library-output: added=0 removed=0 changed=0
pre-build -> post-build library-cli-output: added=0 removed=0 changed=0
pre-build -> post-build source-meta: added=0 removed=0 changed=0
```

定点 hash：

```text
library/.assets-info1.0.0.json => post-build:778573:4D60946C6804 | pre-build:778573:4D60946C6804
library/.assets-data.json => post-build:1345736:00B21C56FBD3 | pre-build:1345736:00B21C56FBD3
library/.assets-dependency.json => post-build:162981:6A66299ED6A6 | pre-build:162981:6A66299ED6A6
library/.cli-assets-info.json => post-build:609131:7FF4732940D7 | pre-build:609131:7FF4732940D7
library/.cli-assets-data.json => post-build:1332584:54ECDFB15054 | pre-build:1332584:54ECDFB15054
library/.cli-assets-dependency.json => post-build:90035:50A4FA66E80F | pre-build:90035:50A4FA66E80F
library/.cli-assets => post-build:138751:366F4AC51D83 | pre-build:138751:366F4AC51D83
```

结论：

- build validation 未通过，不能用作 shared output default 的验收证据。
- 本次 build 失败前没有观察到 AssetDB record、shared output、CLI output 或 source `.meta` 增量污染。
- build blocker 属于项目 `build-ex` hook / `Editor.Message` scope 行为，需单独处理或用不触发该 hook 的最小 fixture 补充 build 验证。

## Decision

- shared output ready for default: `yes` as of 2026-06-24 follow-up validation and user confirmation.
- 当前 production default: shared `assets.library = <project>/library` with CLI sidecar records under `<project>/library/.cli-assets-*`.
- emergency opt-out: `COCOS_CLI_SHARED_LIBRARY_OUTPUT=0` restores isolated `assets.library = <project>/library/cli` with records under `<project>/library/cli/.assets-*`.

Residual follow-up:

1. 共享 output 首次改写 336 个 `library/<uuid-prefix>/...` output 已拆到 `BUILD-ISSUE-025` 做字段级质量评估，不阻塞默认共享。
2. `temp/asset-db` 继续隔离，不随 project `library` 默认共享。
3. extension asset-db output 仍保持 `library/cli-extensions/<name>`，未随 project assets 默认共享。

Next action:

- 持续保留 `COCOS_CLI_SHARED_LIBRARY_OUTPUT=0` 作为 emergency opt-out。
- 后续按 `BUILD-ISSUE-025` 分类 336 个 output rewrite；如证明差异不可接受，再回退默认或补 importer parity。
