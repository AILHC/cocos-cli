# Runtime Preview Explicit Refresh Performance 2026-06-27

## 范围

- 测试层级：源码链路 performance probe；真实 `Launcher.import()`、真实 AssetDB、真实 `assetOperation.refreshAsset(...)`、真实 `scripting.waitForIdle(...)`、真实 `startRuntimePreviewServer()` root HTTP。
- 项目/fixture 分类：临时复制项目，来源为 `tests/fixtures/projects/asset-operation`；运行时复制到系统临时目录，排除 `build`、`library`、`temp` 后重新生成输出。
- engine root 输入：`COCOS_CLI_TEST_ENGINE_ROOT=D:\workspace\engines\cocos\3.8.6`，仅作为测试 harness 输入，不是 production 默认策略证据。
- 环境变量：运行前清理 `COCOS_CLI_TEST_PROJECT_ROOT`、`COCOS_CLI_TEST_EDITOR_LIBRARY_REF`、`COCOS_CLI_TEST_EDITOR_PROGRAMMING_REF`、`COCOS_CLI_SHARED_LIBRARY_OUTPUT`。
- 是否构建 dist：`distUsed:false`；脚本通过 `ts-node/register/transpile-only` 读取当前源码。
- settings provider：脚本内轻量 `PreviewSettingsProvider`，用于隔离 root reload 时 AssetDB scan / script idle wait 成本；不是完整 `builder.getPreviewSettings(...)` 性能。
- Browser：未启动完整 browser / Cocos runtime。
- 不能证明的边界：不能证明真实业务项目、完整 browser runtime、真实 builder settings、DevTools 网络 waterfall、shared `temp/programming` 并发场景或 production 默认 engine root 解析性能。

## 命令

工作目录：`E:\own_space\engines\cocos-cli`

```powershell
rtk pwsh -NoProfile -Command 'Remove-Item Env:COCOS_CLI_TEST_PROJECT_ROOT -ErrorAction SilentlyContinue; Remove-Item Env:COCOS_CLI_TEST_EDITOR_LIBRARY_REF -ErrorAction SilentlyContinue; Remove-Item Env:COCOS_CLI_TEST_EDITOR_PROGRAMMING_REF -ErrorAction SilentlyContinue; Remove-Item Env:COCOS_CLI_SHARED_LIBRARY_OUTPUT -ErrorAction SilentlyContinue; $env:COCOS_CLI_TEST_ENGINE_ROOT="D:\workspace\engines\cocos\3.8.6"; node vitests/scripts/runtime-preview-refresh-performance.mjs'
```

本次命令 exit code 为 `0`。输出包含 Cocos engine 初始化日志、`Browserslist` 数据过期 warning；warning 不影响 JSON 结果。

## 结果

采样轮次：每组 `5` 轮。单位：ms。`p50` 为 median，`p95` 使用 5 轮样本中的第 5 个排序值。

| 场景 | rounds | root `/` min | root `/` p50 | root `/` p95 | root `/` max | AssetDB refresh min | AssetDB refresh p50 | AssetDB refresh p95 | AssetDB refresh max |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| default off | 5 | 5.121 | 5.957 | 26.904 | 26.904 | N/A | N/A | N/A | N/A |
| on no change | 5 | 124.912 | 130.159 | 152.905 | 152.905 | 120.334 | 124.379 | 141.354 | 141.354 |
| on changed | 5 | 224.645 | 228.125 | 246.537 | 246.537 | 219.858 | 222.806 | 241.833 | 241.833 |

| 场景 | script idle wait min | script idle wait p50 | script idle wait p95 | script idle wait max | settings generation min | settings generation p50 | settings generation p95 | settings generation max | refresh total p50 | refresh total p95 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| default off | N/A | N/A | N/A | N/A | 0.019 | 0.019 | 0.019 | 0.019 | N/A | N/A |
| on no change | 0.013 | 0.014 | 0.102 | 0.102 | 0.005 | 0.006 | 0.010 | 0.010 | 124 | 142 |
| on changed | 0.015 | 0.018 | 0.020 | 0.020 | 0.006 | 0.006 | 0.006 | 0.006 | 223 | 241 |

## 观察

- `--refresh-on-reload` 默认关闭时，root `/` 请求没有触发 AssetDB refresh；`assetDbRefreshMs`、`scriptCompileMs`、`refreshTotalMs` 均为 `N/A`。
- 开启 `refreshOnReload` 后，即使源文件无新增修改，本 fixture 的 `assetOperation.refreshAsset('db://assets')` 仍返回 `changedAssetCount:17`；该数值与 `runtime-preview-refresh-targets-20260627.md` 中 DB root refresh 观测一致，不等同于“本轮新增 17 个文件”。
- `script idle wait` 在本 fixture 中接近 `0ms`，说明脚本相关耗时主要已经包含在 AssetDB refresh / importer 链路内；本数据不能外推到大型真实项目。
- `on changed` 每轮写入不同 JSON resource 内容和不同 TypeScript marker，脚本输出 chunk hash 每轮不同，证明性能脚本不是用常量结果填充。
- `readyMs` 在脚本 JSON 中为启动期 `prepareRuntimePreview` 的一次性耗时快照，各 root round 相同；本 facts 不将其作为 root reload 性能指标。

## 结论

`--refresh-on-reload` 仍应保持默认关闭。该临时 fixture 上 opt-in 成本 p50 为：

- 无变化 reload check：root `/` 约 `130.159ms`，其中 AssetDB refresh 约 `124.379ms`。
- 有资源和脚本变化 reload check：root `/` 约 `228.125ms`，其中 AssetDB refresh 约 `222.806ms`。

以上数据支持“页面 reload 检查 AssetDB”必须显式 opt-in；不支持默认开启。
