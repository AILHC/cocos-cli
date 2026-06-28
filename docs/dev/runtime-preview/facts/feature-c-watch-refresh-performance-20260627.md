# feature-c Watch Refresh Performance 2026-06-27

## 范围

- 对应 issue：`RP-ISSUE-028`
- 测试层级：真实项目 production CLI 性能与行为验收。
- 项目：`D:\ps_copy\p6\trunk\Project\GameClient\feature-c`
- scene：`4c721bfe-0b6e-46c2-97f0-644adfdcba31`
- 脚本：`vitests/scripts/runtime-preview-feature-c-watch-refresh-performance.mjs`
- 是否构建 dist：运行前必须先执行 `npm run compile`，脚本使用 `dist/cli.js`。
- 清理的环境变量：`COCOS_CLI_TEST_PROJECT_ROOT`、`COCOS_CLI_TEST_ENGINE_ROOT`、`COCOS_CLI_TEST_EDITOR_LIBRARY_REF`、`COCOS_CLI_TEST_EDITOR_PROGRAMMING_REF`、`COCOS_CLI_SHARED_LIBRARY_OUTPUT`。
- 源资源变更策略：只允许创建并清理 `assets/__cocos_cli_watch_probe__` 和 sibling `assets/__cocos_cli_watch_probe__.meta`；不得修改其他 feature-c source 文件或 `.meta`。
- 不能证明的边界：未启动完整 browser / Cocos runtime；不证明真实 gameplay resource API；不把 fixture 结论外推到 feature-c。

## 命令

工作目录：`E:\own_space\engines\cocos-cli\.worktrees\runtime-preview-asset-watch-refresh`

```powershell
rtk pwsh -NoProfile -Command 'npm run compile'
rtk pwsh -NoProfile -Command 'Remove-Item Env:COCOS_CLI_TEST_PROJECT_ROOT -ErrorAction SilentlyContinue; Remove-Item Env:COCOS_CLI_TEST_ENGINE_ROOT -ErrorAction SilentlyContinue; Remove-Item Env:COCOS_CLI_TEST_EDITOR_LIBRARY_REF -ErrorAction SilentlyContinue; Remove-Item Env:COCOS_CLI_TEST_EDITOR_PROGRAMMING_REF -ErrorAction SilentlyContinue; Remove-Item Env:COCOS_CLI_SHARED_LIBRARY_OUTPUT -ErrorAction SilentlyContinue; node vitests/scripts/runtime-preview-feature-c-watch-refresh-performance.mjs --rounds 5'
```

## 当前状态

- 脚本已新增，`node --check vitests/scripts/runtime-preview-feature-c-watch-refresh-performance.mjs` 通过。
- 尚未记录 feature-c 实跑结果；`npm run compile` 在当前 worktree 失败，未生成可用于 production CLI 验收的 `dist/cli.js`。
- compile 失败原因集中在本 worktree engine/cc 开发依赖不完整：`packages/engine/bin/.declarations/cc.d.ts` 和 `cc.editor.d.ts` 不存在，`tsc -b` 报大量 `cc` 导出缺失；compile 清理后 launcher child-process 还缺少 `dist/cocos.config.schema.json` 与 `node_modules/cc/preload`。

## 验收断言

- `defaultOff`：不启用 `--watch-assets`，root `/` 不应触发 dirty-set refresh。
- `watchNoReload`：只启用 `--watch-assets`，endpoint 无 target 时走 dirty-set，不 fallback 到 `db://assets` root。
- `watchReloadNoChange`：每轮 root reload 的 `refreshResult.target === "dirty-set"`，`targets === []`，`scriptCompileStatus === "skipped"`，`changedAssetCount === null`，`rootRefresh === false`。
- `watchReloadChanged`：每轮只创建 `assets/__cocos_cli_watch_probe__/runtime-watch-refresh.json`，等待 watcher log 包含 `db://assets/__cocos_cli_watch_probe__/runtime-watch-refresh.json`，root reload 后 `targets` 包含该 target 且不包含 `db://assets` root。
- 清理检查必须满足：mutation 前 probe `git status` 为空；cleanup 后 probe `git status` 为空；`assets/__cocos_cli_watch_probe__`、`assets/__cocos_cli_watch_probe__.meta`、`assets/__cocos_cli_watch_probe__/runtime-watch-refresh.json.meta` 均不存在。

## 结果

未运行 feature-c production CLI 性能脚本。原因：`npm run compile` 未通过，不能按测试规范使用不存在或旧的 `dist/cli.js` 作为验收对象。

已运行的前置验证：

- `node --check vitests/scripts/runtime-preview-feature-c-watch-refresh-performance.mjs`：exit code `0`。
- `node dist/cli.js preview --help`：exit code `0`，help 输出包含 `--watch-assets`。
- `node vitests/scripts/runtime-preview-feature-c-watch-refresh-performance.mjs --rounds 1`：命令超时，手动结束本次启动的脚本/preview 子进程；未形成完整 feature-c JSON 性能结果。
- runtime preview focused Vitest 组合带主测试项目/frozen reference env：exit code `1`；dirty store、watcher、coordinator、server、browser、live integration、CLI startup 均通过，launcher child-process 子项因当前 worktree 缺少 `dist/cocos.config.schema.json` 和 `node_modules/cc/preload` 失败。

## 清理检查

- `assets/__cocos_cli_watch_probe__` 是否删除：是，`Test-Path` 为 `False`。
- `assets/__cocos_cli_watch_probe__.meta` 是否删除：是，`Test-Path` 为 `False`。
- mutation 前 `git status --short -- assets/__cocos_cli_watch_probe__ assets/__cocos_cli_watch_probe__.meta`：待运行后记录。
- mutation 后 cleanup 前 `git status --short -- assets/__cocos_cli_watch_probe__ assets/__cocos_cli_watch_probe__.meta`：待运行后记录。
- cleanup 后 `git status --short -- assets/__cocos_cli_watch_probe__ assets/__cocos_cli_watch_probe__.meta`：空。
- cleanup 后 file `.meta` 是否存在：`assets/__cocos_cli_watch_probe__/runtime-watch-refresh.json.meta` 的 `Test-Path` 为 `False`。

## 结论

当前只有脚本语法验证，不能把 `RP-ISSUE-028` 标为 `fixed`。必须等 feature-c performance gate、compile、CLI help smoke 和完整测试通过后再回填 fixed 结论。
