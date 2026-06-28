# feature-c Watch Refresh Performance 2026-06-27

## 范围

- 对应 issue：`RP-ISSUE-028`
- 测试层级：真实项目 production CLI 性能与行为验收。
- 项目：`D:\ps_copy\p6\trunk\Project\GameClient\feature-c`
- scene：`4c721bfe-0b6e-46c2-97f0-644adfdcba31`
- 脚本：`vitests/scripts/runtime-preview-feature-c-watch-refresh-performance.mjs`
- 是否构建 dist：已执行 `npm run compile`，exit code `0`，脚本使用本 worktree 的 `dist/cli.js`。
- 清理的环境变量：`COCOS_CLI_TEST_PROJECT_ROOT`、`COCOS_CLI_TEST_ENGINE_ROOT`、`COCOS_CLI_TEST_EDITOR_LIBRARY_REF`、`COCOS_CLI_TEST_EDITOR_PROGRAMMING_REF`、`COCOS_CLI_SHARED_LIBRARY_OUTPUT`。
- 源资源变更策略：只允许创建并清理 `assets/__cocos_cli_watch_probe__` 和 sibling `assets/__cocos_cli_watch_probe__.meta`；不得修改其他 feature-c source 文件或 `.meta`。
- JSON 输出：`D:\ps_copy\p6\trunk\Project\GameClient\feature-c\temp\codex-runtime-preview\feature-c-watch-refresh-performance-20260628-163223.json`
- 不能证明的边界：本脚本验证 production CLI、AssetDB refresh、watcher dirty-set、HTTP root reload 和 source cleanup；不证明真实 gameplay resource API。

## 命令

工作目录：`E:\own_space\engines\cocos-cli\.worktrees\runtime-preview-asset-watch-refresh`

```powershell
rtk pwsh -NoProfile -Command 'npm run compile'
rtk pwsh -NoProfile -Command 'Remove-Item Env:COCOS_CLI_TEST_PROJECT_ROOT -ErrorAction SilentlyContinue; Remove-Item Env:COCOS_CLI_TEST_ENGINE_ROOT -ErrorAction SilentlyContinue; Remove-Item Env:COCOS_CLI_TEST_EDITOR_LIBRARY_REF -ErrorAction SilentlyContinue; Remove-Item Env:COCOS_CLI_TEST_EDITOR_PROGRAMMING_REF -ErrorAction SilentlyContinue; Remove-Item Env:COCOS_CLI_SHARED_LIBRARY_OUTPUT -ErrorAction SilentlyContinue; node vitests/scripts/runtime-preview-feature-c-watch-refresh-performance.mjs --rounds 5 --port-start 20010'
```

## 验收断言

- `defaultOff`：不启用 `--watch-assets`，root `/` 不应触发 dirty-set refresh。
- `watchNoReload`：只启用 `--watch-assets`，endpoint 无 target 时走 dirty-set，不 fallback 到 `db://assets` root。
- `watchReloadNoChange`：每轮 root reload 的 `refreshResult.target === "dirty-set"`，`targets === []`，`scriptCompileStatus === "skipped"`，`changedAssetCount === null`，`rootRefresh === false`。
- `watchReloadChanged`：每轮只创建 `assets/__cocos_cli_watch_probe__/runtime-watch-refresh.json`，等待 watcher log 包含 `db://assets/__cocos_cli_watch_probe__/runtime-watch-refresh.json`，root reload 后 `targets` 包含该 target 且不包含 `db://assets` root。
- 清理检查必须满足：mutation 前 probe `git status` 为空；cleanup 后 probe `git status` 为空；`assets/__cocos_cli_watch_probe__`、`assets/__cocos_cli_watch_probe__.meta`、`assets/__cocos_cli_watch_probe__/runtime-watch-refresh.json.meta` 均不存在。

## 结果

| 模式 | rounds | root `/` p50 | refresh / endpoint p50 | dirty targets | root refresh |
| --- | ---: | ---: | ---: | --- | --- |
| default off | 5 | `271.092ms` | n/a | n/a | no |
| watch no reload | 5 | n/a | endpoint `4.394ms` / refresh `0ms` | `[]` | no |
| watch reload no change | 5 | `277.347ms` | refresh `0ms` | `[]` | no |
| watch reload changed | 5 | `2086.375ms` | refresh `353ms` | `db://assets/__cocos_cli_watch_probe__/runtime-watch-refresh.json` | no |

补充验证：

- `node --check vitests/scripts/runtime-preview-feature-c-watch-refresh-performance.mjs`：exit code `0`。
- `npm run compile`：exit code `0`，生成本轮 `dist/cli.js` 和 `dist/cocos.config.schema.json`。
- `node dist/cli.js preview --help`：exit code `0`，help 输出包含 `--watch-assets` 和 `--refresh-on-reload`。
- focused Vitest：`runtime-asset-dirty-store.test.ts`、`runtime-asset-change-watcher.test.ts`、`runtime-refresh-coordinator.test.ts`、`runtime-preview-express-server.test.ts`、`runtime-refresh-browser.test.ts`、`runtime-refresh-live-integration.test.ts`、`cli-startup.test.ts`、`launcher-runtime-preview.test.ts`，8 个文件、81 tests，exit code `0`。

性能观察：

- 空 dirty-set reload 不触发 `db://assets` root refresh，refresh p50 为 `0ms`。
- changed reload 每轮只刷新 probe file target，不包含 `db://assets` root，也不包含 probe parent directory target；refresh p50 为 `353ms`。
- 早期候选实现中 changed reload 因 probe parent directory target 和 AssetDB 自生成 `.meta` follow-up 触发重复 refresh，单轮约 `55s-62s`；本轮通过跳过非 pure-delete 父目录 target 和已成功 target 的 meta-only follow-up 修正。

## 清理检查

- `assets/__cocos_cli_watch_probe__` 是否删除：是，`Test-Path` 为 `False`。
- `assets/__cocos_cli_watch_probe__.meta` 是否删除：是，`Test-Path` 为 `False`。
- mutation 前 `git status --short -- assets/__cocos_cli_watch_probe__ assets/__cocos_cli_watch_probe__.meta`：每轮为空。
- mutation 后 cleanup 前 `git status --short -- assets/__cocos_cli_watch_probe__ assets/__cocos_cli_watch_probe__.meta`：每轮只出现受控 probe 目录，例如 `?? assets/__cocos_cli_watch_probe__/`。
- cleanup 后 `git status --short -- assets/__cocos_cli_watch_probe__ assets/__cocos_cli_watch_probe__.meta`：空。
- cleanup 后 file `.meta` 是否存在：`assets/__cocos_cli_watch_probe__/runtime-watch-refresh.json.meta` 的 `Test-Path` 为 `False`。

## 结论

`RP-ISSUE-028` 本轮 watch-assets dirty-set refresh 的 production CLI / feature-c 性能 gate 已通过。默认关闭；开启 `--watch-assets` 后无 target refresh 不 fallback 到 `db://assets` root；`--watch-assets --refresh-on-reload` 空 dirty-set reload 只做一次 dirty-set check；资源变更时只刷新 dirty file target，并保持 source probe cleanup clean。
