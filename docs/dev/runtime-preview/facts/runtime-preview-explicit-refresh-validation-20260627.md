# Runtime Preview Explicit Refresh Validation 2026-06-27

## 范围

- 对应 issue：`RP-ISSUE-029`
- 测试层级：unit / route contract / browser UI integration / child-process live integration / performance probe / compile smoke。
- 代码范围：显式 `POST /__runtime-preview/refresh`、preview app `Refresh` 按钮、`--refresh-on-reload` opt-in reload check、script idle wait、refresh 后 cache invalidation。
- 项目与 fixture：
  - live integration 使用临时复制项目，来源为 `tests/fixtures/projects/asset-operation`。
  - route contract 使用 `COCOS_CLI_TEST_PROJECT_ROOT=E:\own_space\cocos_work_lab_38x` 和 frozen Editor reference。
  - performance probe 使用临时复制项目，未启动完整 browser / Cocos runtime。
- 不能证明的边界：未跑指定真实业务项目级 `preview --runtime` browser/runtime 验收；不能标记 `RP-ISSUE-029` 为 `fixed`。

## 最终验证命令与结果

工作目录：`E:\own_space\engines\cocos-cli`

### Focused runtime preview Vitest

```powershell
rtk pwsh -NoProfile -Command '$env:COCOS_CLI_TEST_ENGINE_ROOT="D:\workspace\engines\cocos\3.8.6"; $env:COCOS_CLI_TEST_PROJECT_ROOT="E:\own_space\cocos_work_lab_38x"; $env:COCOS_CLI_TEST_EDITOR_LIBRARY_REF="E:\own_space\engines\cocos-cli\.codex-tmp\reference-library\cocos_work_lab_38x-editor-library-20260606"; $env:COCOS_CLI_TEST_EDITOR_PROGRAMMING_REF="E:\own_space\engines\cocos-cli\.codex-tmp\reference-temp\cocos_work_lab_38x-editor-programming-20260606"; npm --prefix vitests run test -- suites/runtime-preview/runtime-refresh-coordinator.test.ts suites/runtime-preview/runtime-preview-express-server.test.ts suites/runtime-preview/runtime-refresh-entry-injection.test.ts suites/runtime-preview/preview-app-route-contract.test.ts suites/runtime-preview/runtime-refresh-browser.test.ts suites/runtime-preview/runtime-refresh-live-integration.test.ts'
```

结果：exit code `0`，`6` files / `61` tests passed。

覆盖点：

- refresh coordinator target normalization、越界拦截、并发复用、失败返回 `ok:false`。
- endpoint 协议：成功、malformed JSON、非 object JSON、method gate、body size gate。
- root reload：默认关闭不 refresh；`--refresh-on-reload` 开启时 root render 前 refresh；失败仍返回 HTML。
- custom template：没有 builtin toolbar 时仍注入 fixed fallback 按钮。
- browser button：点击后调用 endpoint，成功 reload；失败 toast，不 reload，不 `console.error`。
- live integration：临时 fixture 上，JSON resource 和 TypeScript script 均覆盖 endpoint refresh 与 root reload refresh，之后通过 HTTP readback 读取最新 `library` / `temp/cli/programming` 产物。

### ScriptManager Jest

```powershell
rtk pwsh -NoProfile -Command 'npm run test -- src/core/scripting/test/script-manager.test.ts --runInBand'
```

结果：exit code `0`，`33` tests passed。

已知输出：Jest 仍报告既有 `CustomGC` open handle；本次未把它作为失败处理，因为 exit code 为 `0` 且该提示来自既有 `@cocos/ccbuild` / Rollup native load 链路。

### TypeScript

```powershell
rtk pwsh -NoProfile -Command 'npx tsc -b --pretty false'
```

结果：exit code `0`。

### Compile

```powershell
rtk pwsh -NoProfile -Command 'npm run compile'
```

结果：exit code `0`。

已知输出：存在既有 circular dependency warning，路径集中在 `dist/core/scene/scene-process/service/*`。

### CLI Help Smoke

```powershell
rtk pwsh -NoProfile -Command 'node dist/cli.js preview --help | Select-String -- "--refresh-on-reload"'
```

结果：exit code `0`，输出包含：

```text
--refresh-on-reload                 Refresh AssetDB before serving the
```

### Performance Probe

```powershell
rtk pwsh -NoProfile -Command 'Remove-Item Env:COCOS_CLI_TEST_PROJECT_ROOT -ErrorAction SilentlyContinue; Remove-Item Env:COCOS_CLI_TEST_EDITOR_LIBRARY_REF -ErrorAction SilentlyContinue; Remove-Item Env:COCOS_CLI_TEST_EDITOR_PROGRAMMING_REF -ErrorAction SilentlyContinue; Remove-Item Env:COCOS_CLI_SHARED_LIBRARY_OUTPUT -ErrorAction SilentlyContinue; $env:COCOS_CLI_TEST_ENGINE_ROOT="D:\workspace\engines\cocos\3.8.6"; node vitests/scripts/runtime-preview-refresh-performance.mjs'
```

结果：exit code `0`，三组各 `5` 轮。完整数据见 `runtime-preview-explicit-refresh-performance-20260627.md`。

性能摘要：

| 场景 | root `/` p50 | AssetDB refresh p50 | script idle wait p50 | 结论 |
| --- | ---: | ---: | ---: | --- |
| default off | `5.957ms` | N/A | N/A | 默认关闭时 root `/` 不触发 AssetDB scan。 |
| on no change | `130.159ms` | `124.379ms` | `0.014ms` | 即使无源文件改动，DB root refresh 仍有明确成本。 |
| on changed | `228.125ms` | `222.806ms` | `0.018ms` | 资源和脚本变更后，主要成本仍来自 AssetDB refresh / importer 链路。 |

## 事实记录

- `assetOperation.refreshAsset('db://assets')` 在临时 fixture 上可刷新项目 `assets` DB root；`changedAssetCount` 在 DB root 场景观测为 `17`，不能解释为“本轮新增 17 个文件”。
- 显式 endpoint refresh 与 root reload refresh 都必须等待 `scripting.waitForIdle()`，否则脚本输出可能尚未完成。
- endpoint 操作失败返回 HTTP `200` + JSON `ok:false`，协议错误才返回 `4xx`；browser 侧失败只 toast，不 reload。
- `--refresh-on-reload` 默认关闭；性能数据支持继续默认关闭，而不是默认每次 reload 扫 AssetDB。
- custom preview template 不 include toolbar 时，按钮依靠 server HTML 注入 installer 兜底，不依赖 `Ui` 构造成功。
- 本轮 live integration 证明的是 HTTP output readback，不是完整 browser Cocos `resources.load` / component script runtime 语义。

## 成功做法

- 先用真实 AssetDB probe 确认 `db://assets`、目录和文件 target 行为，再定 coordinator 策略，避免靠猜 API。
- 将 refresh 语义集中在 coordinator：target normalization、AssetDB refresh、script idle wait、cache invalidation、日志和错误结构统一处理。
- browser failure path 使用 toast 和结构化状态，不把一次 refresh 失败扩大成 preview 页面失败。
- `--refresh-on-reload` 做成 CLI opt-in，并用性能采样说明默认关闭的依据。
- 主会话对 subagent 结果做了复核：发现 live integration 只覆盖 root reload 后，补齐 endpoint refresh 的真实读回验证。

## 失败与教训

- 第一次 focused Vitest 命令漏设 `COCOS_CLI_TEST_PROJECT_ROOT` 和 frozen Editor reference，导致 `preview-app-route-contract.test.ts` 23 个用例因环境变量缺失失败。教训：运行 runtime preview route contract 前必须按 `docs/dev/runtime-preview/testing-spec.md` 补齐 fixture env，缺 env 的失败不能当代码回归。
- 子代理初版 live integration 只证明 root reload refresh，未证明 endpoint refresh 后资源/脚本读到最新。教训：对“刷新后读取最新”这类需求，要逐条映射到 endpoint path 和 reload path，不能用一条路径代表另一条。
- 性能 facts 初版曾包含与脚本输出不匹配的 `readyMs` 解释。教训：facts 只能写脚本实际输出和主会话复跑数据；派生指标必须说明来源和边界。
- issues 中链接到计划文档时，计划文件不能留在 untracked 状态，否则台账入口会断链。教训：问题台账、计划、facts 必须一起提交。
- `RP-ISSUE-029` 不能因为 focused tests 和临时 fixture 通过就标 `fixed`。教训：真实业务项目 browser/runtime 验收是独立层级，必须单独记录。

## 后续待补

- 指定真实业务项目 `preview --runtime` 验收：覆盖实际 browser runtime resource/script 读取、console/page error、network failure 和 reload 行为。
- 若要实现个人非版本管理 CLI 配置，按 `RP-ISSUE-030` 另起计划，不混入本轮显式 refresh 实现。
