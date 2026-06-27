# Runtime Preview 显式刷新设计

日期：2026-06-27

关联问题：

- `RP-ISSUE-029`：runtime preview 支持显式刷新 AssetDB，并在脚本重编译完成后刷新页面。
- `RP-ISSUE-030`：runtime preview 需要个人且不纳入版本管理的 CLI 配置入口。

## 背景

当前 runtime preview 在启动阶段会执行 AssetDB import，并通过脚本 importer 或启动后的脚本同步调用 `scripting.compileScripts(...)`。server 进入 `preview:ready` 后，没有项目资源目录常驻 watcher。直接修改资源或脚本文件不会自动进入 AssetDB refresh / script compile 链路。

本轮目标不是新增 watcher，而是提供显式刷新能力：

- 用户或 agent 可通过 HTTP endpoint 触发 refresh。
- preview app 提供按钮触发 refresh。
- 可选 CLI 参数允许页面 reload 时执行一次 refresh check；默认关闭。
- 刷新失败不阻断当前 preview 正常运行，只做可见提示和日志记录。

## 非目标

- 本轮不新增个人配置文件读取。
- 本轮不实现常驻 filesystem watcher。
- 本轮不实现 HMR 或 SystemJS module-level invalidation。
- 本轮不改变 shared `library` / `temp/cli/programming` 默认策略。
- 本轮不把 route contract 通过等同于真实项目 browser 验收。

`RP-ISSUE-030` 单独跟踪后续个人配置入口。候选方向可包括 `<project>/profiles/v2/packages/cocos-cli.json`，但本轮不实现。

## 用户能力

### HTTP Endpoint

新增：

```text
POST /__runtime-preview/refresh
```

请求 body 可选：

```json
{
  "target": "db://assets/resources"
}
```

无 `target` 时刷新项目 `assets` 数据库根。`target` 支持 AssetDB URL 或位于已注册 AssetDB root 内的绝对路径；超出 AssetDB root 的路径返回失败 JSON，不执行扫描。

成功响应：

```json
{
  "ok": true,
  "refreshId": "...",
  "target": "db://assets",
  "changedAssetCount": 0,
  "scriptCompile": {
    "status": "done",
    "durationMs": 0
  },
  "durationMs": 0
}
```

refresh 操作失败返回 `200`，并用 `ok: false` 表示失败，避免浏览器把一次手动刷新失败归类为 preview route 失败。只有 malformed JSON、非 POST method 或 target schema 明显非法这类协议级错误才返回 `4xx`。操作失败 body 必须包含：

```json
{
  "ok": false,
  "refreshId": "...",
  "error": "..."
}
```

按钮和 browser 逻辑只根据 `ok` 判断是否 reload。

### Preview App 按钮

默认 toolbar 新增 `Refresh` 按钮。点击后：

1. 按钮进入 disabled / busy 状态。
2. 调用 `POST /__runtime-preview/refresh`。
3. 成功时记录 `window.__RUNTIME_PREVIEW_LAST_REFRESH__`，然后 `window.location.reload()`。
4. 失败时恢复按钮状态，并弹出可见错误提示；不 reload，不暂停游戏，不清当前 scene。

自定义 `preview-template/index.ejs` 可能不 include `cocosToolBar`。因此 preview app 启动后需要兜底检查：如果页面不存在 `#btn-runtime-refresh`，就在现有 `.toolbar` 内追加按钮；如果 `.toolbar` 也不存在，则注入一个轻量固定位置按钮。若项目模板完全绕开 CLI `cocosTemplate` / `/preview-app/index.js`，则不保证按钮存在。

### Reload Check CLI 参数

新增 CLI 参数：

```text
--refresh-on-reload
```

默认关闭。开启后，仅 root `/` 页面导航在返回 HTML 前执行一次 refresh check。该逻辑不挂到 `/settings.js`、script、library、scene 或 static route，避免一次页面加载触发多次扫描。

refresh-on-reload 失败时：

- server 继续返回正常 root HTML。
- 页面启动后通过 preview app 弹出 refresh failure 提示。
- 日志记录失败原因和耗时。
- 当前 preview 正常启动，不因 refresh failure 变成 500。

如果按钮调用 endpoint 成功后立即 reload，server 需要做 in-flight 或短时间去重，避免 `POST /__runtime-preview/refresh` 后的 root navigation 立刻再次执行同一轮 refresh。

## Server 设计

新增 runtime refresh coordinator，职责：

- 串行化 refresh 请求。
- 校验 refresh target。
- 调用 AssetDB refresh。
- 等待脚本编译完成。
- 清理 runtime preview server cache。
- 记录指标和错误。

refresh 后必须清理：

- `PreviewSettingsProvider.invalidate()`。
- `ImportReplacementExtensionResolver.clear()`。

后续如果 scene list、bundle config 或其它 route 引入 server-lifetime cache，必须纳入同一 invalidation 边界。

脚本完成判定：

- 脚本 importer 会在 AssetDB refresh 中调用 `scripting.compileScripts(...)`。
- `scripting.compileScripts(...)` 内部等待 `PackerDriver.build(...)` 完成后返回。
- 对 refresh-on-reload 或 endpoint 返回前，还需要确认 `scripting.isCompiling()` 为 false，避免延迟编译或并发 build 残留。

并发语义：

- 同一时刻只执行一个 refresh。
- 相同 target 的并发请求复用同一 in-flight promise 或排队合并。
- 不同 target 在本轮仍串行执行，避免 AssetDB / packer-driver 并发写入。

## Error Handling

显式按钮失败：

- 不 reload。
- 不影响当前游戏运行。
- 使用现有 error overlay 能力或轻量弹窗提示 refresh failure。
- `console.error` 和 runtime preview log 记录 refreshId、target、duration 和 error。

reload check 失败：

- 不返回 500。
- 不阻断 root HTML。
- 页面启动后显示提示。
- `window.__RUNTIME_PREVIEW_REFRESH_ON_RELOAD__` 或等价状态保存本次失败信息，供测试和诊断读取。

HTTP endpoint 失败：

- 返回结构化 JSON。
- 不触发浏览器 reload。
- agent 可通过 `ok: false` 和 `error` 判断失败原因。

## 测试与验收

测试必须先读并遵守：

- `docs/dev/testing-spec.md`
- `docs/dev/runtime-preview/testing-spec.md`

### 单元 / Route Contract

覆盖：

- `POST /__runtime-preview/refresh` 成功响应。
- target 越界失败。
- refresh 失败返回结构化 JSON。
- 并发请求串行或复用。
- refresh 后 `settingsProvider.invalidate()` 和 import replacement extension cache clear 被调用。
- `--refresh-on-reload` 关闭时 root `/` 不触发 refresh。
- `--refresh-on-reload` 开启时 root `/` 只触发一次 refresh。
- reload check 失败仍返回 root HTML，并携带可提示的失败状态。

### Browser / Runtime Integration

需要证明：

- 普通资源更新：修改资源源文件，调用 refresh，reload 后 browser/runtime 读取到新内容。
- 脚本更新：修改 TS/JS 脚本，调用 refresh，reload 后 browser 执行新脚本产物。
- 按钮路径：点击 `Refresh` 按钮能调用 endpoint，成功后 reload。
- 自定义模板不 include toolbar 时，兜底按钮仍存在。
- refresh 失败时，页面显示提示且当前 preview 不被中断。

资源和脚本验收可使用临时复制项目或专项 fixture，不能直接改真实主测试项目源文件。结论必须说明项目/fixture 类型、环境变量、是否构建 `dist`，以及测试不能证明的边界。

### 性能数据

性能只针对 `--refresh-on-reload` opt-in，不作为默认行为依据。

至少记录三组：

1. 默认关闭：普通 reload baseline。
2. 开启且无变更：无变更扫描成本。
3. 开启且有资源或脚本变更：真实刷新成本。

每组记录：

- root `/` request 到 HTML 返回耗时。
- AssetDB refresh duration。
- script compile duration / skip 状态。
- settings generation duration。
- browser `window.__RUNTIME_PREVIEW_READY` elapsed。
- 如果复用 resource completion diagnostics，记录 all-resource completion 时间。

性能结果写入 `docs/dev/runtime-preview/facts/`，不能用一次本地体感作为默认开启依据。

## 文档与状态

实现完成后：

- 更新 `docs/dev/runtime-preview/issues.md` 中 `RP-ISSUE-029` 的计划 / 验收入口。
- 保持 `RP-ISSUE-030` 为后续项，除非本轮实际实现个人配置入口。
- 若真实项目验收未跑，不能把 `RP-ISSUE-029` 直接标为 `fixed`，最多记录已完成 route / fixture / browser integration 证据。
