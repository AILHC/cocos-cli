# Runtime Preview Refresh Targets 2026-06-27

## 范围

- 测试层级：真实 AssetDB probe。
- 项目/fixture 分类：临时复制项目，来源为 `tests/fixtures/projects/asset-operation`，probe 运行时复制到系统临时目录后修改。
- engine root 输入：`COCOS_CLI_TEST_ENGINE_ROOT`。
- 环境变量：`COCOS_CLI_TEST_ENGINE_ROOT=<engine root for Vitest/probe harness>`；可选 `COCOS_CLI_REFRESH_PROBE_KEEP_TEMP=1` 用于保留临时项目诊断。
- 不能证明的边界：该 probe 只能证明当前临时 fixture、当前 CLI 源码加载链路和指定 engine root 输入下的 AssetDB refresh target 行为；不能证明 production 默认会从 `COCOS_CLI_TEST_ENGINE_ROOT` 解析 engine root，不能证明所有真实业务项目、browser runtime reload、脚本重编译和页面刷新协议已闭环。

## 结果

| target 类型 | target | API | 结果 | changedAssetCount 语义 |
| --- | --- | --- | --- | --- |
| DB root | `db://assets` | `assetOperation.refreshAsset` | `ok: true`；新增 `db://assets/refresh-root.json` 可通过 `assetQuery.queryAssetInfo(...)` 查询，`importer: json`，`type: cc.JsonAsset`，`imported: true`，`invalid: false`；观测事件为 `changed db://assets/resources` 和 `added db://assets/refresh-root.json`。 | 本次观测中返回 `17`，类型为 `number`。本次观测中 DB root refresh 的返回值包含 target 扫描范围内被 AssetDB 判定变化的资源数量，不等同于只新增的单个文件数。 |
| directory | `db://assets/resources` | `assetOperation.refreshAsset` | `ok: true`；新增 `db://assets/resources/refresh-dir.json` 可通过 `assetQuery.queryAssetInfo(...)` 查询，`importer: json`，`type: cc.JsonAsset`，`imported: true`，`invalid: false`；观测事件为 `changed db://assets/resources` 和 `added db://assets/resources/refresh-dir.json`。 | 本次观测中返回 `3`，类型为 `number`。本次观测中 directory refresh 的返回值包含目录本身及目录内资源变化，不等同于只新增的单个文件数。 |
| absolute file | `<project>/assets/resources/refresh-target-file.json` | `assetOperation.refreshAsset` | `ok: true`；修改后的 `db://assets/resources/refresh-target-file.json` 可通过 `assetQuery.queryAssetInfo(...)` 查询，`importer: json`，`type: cc.JsonAsset`，`imported: true`，`invalid: false`；观测事件为 `changed db://assets/resources/refresh-target-file.json`；library output hash 从 `4149f8f8caf3e742c91c8d864922116f8c5fe674f61ded497c511455139ddbfc` 变为 `c37fa3ee5f141f4b5bfa9dc9cba2102f61dd724fb51ea207702bece6dd578f5c`。 | 本次观测中返回 `1`，类型为 `number`。本次观测中 absolute file refresh 的返回值与被修改文件数量一致。 |

## Probe 命令

工作目录：`E:\own_space\engines\cocos-cli`

```powershell
rtk pwsh -NoProfile -Command "$env:COCOS_CLI_TEST_ENGINE_ROOT='<engine root for Vitest/probe harness>'; node vitests/scripts/runtime-preview-refresh-assetdb-probe.mjs"
```

本次实际运行：

```powershell
rtk pwsh -NoProfile -Command "$env:COCOS_CLI_TEST_ENGINE_ROOT='D:\workspace\engines\cocos\3.8.6'; node vitests/scripts/runtime-preview-refresh-assetdb-probe.mjs"
```

关键输出摘录：

```json
{
  "projectKind": "temporary-runtime-preview-fixture",
  "fixtureSource": "E:/own_space/engines/cocos-cli/tests/fixtures/projects/asset-operation",
  "engineRootInput": {
    "env": "COCOS_CLI_TEST_ENGINE_ROOT",
    "value": "D:/workspace/engines/cocos/3.8.6",
    "role": "probe harness input, not production default behavior evidence"
  },
  "targets": {
    "dbRoot": {
      "target": "db://assets",
      "ok": true,
      "changedAssetCount": 17,
      "observedAsset": "db://assets/refresh-root.json",
      "eventCount": 2
    },
    "directory": {
      "target": "db://assets/resources",
      "ok": true,
      "changedAssetCount": 3,
      "observedAsset": "db://assets/resources/refresh-dir.json",
      "eventCount": 2
    },
    "absoluteFile": {
      "target": "C:/Users/Nobody/AppData/Local/Temp/cocos-cli-refresh-probe-Ocnblc/project/assets/resources/refresh-target-file.json",
      "ok": true,
      "changedAssetCount": 1,
      "observedAsset": "db://assets/resources/refresh-target-file.json",
      "eventCount": 1,
      "libraryHashChanged": true
    }
  },
  "cleanupStatus": "removed"
}
```

本次命令同时输出 `Browserslist: browsers data (caniuse-lite) is 8 months old` warning；该 warning 不影响三类 AssetDB refresh target 的 `ok` 结果。

## 记录规则

- 如果三类 target 都输出 `ok: true`，后续 Task 2 可以把对应 target 继续映射到 `assetOperation.refreshAsset(...)`。
- 如果 `db://assets` 输出 `ok: false` 或无法稳定观测新增资源，后续 Task 2 不得继续假设 DB root refresh 可用；无 target 的全项目刷新必须改用 probe 证明可行的 API，例如 `assetDBManager.refresh()` 或逐 DB root operation，并把实际 API 记录到后续 facts / plan。
- `COCOS_CLI_TEST_ENGINE_ROOT` 只作为本 probe harness 输入记录，不得反向写入 production 默认策略。
