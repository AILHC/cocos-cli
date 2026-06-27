# feature-c Explicit Refresh Performance 2026-06-27

## 范围

- 对应 issue：`RP-ISSUE-029`
- 测试层级：真实项目 `dist/cli.js preview --runtime` HTTP 性能采样。
- 项目：`D:\ps_copy\p6\trunk\Project\GameClient\feature-c`
- 场景：`4c721bfe-0b6e-46c2-97f0-644adfdcba31`
- CLI：`E:\own_space\engines\cocos-cli\dist\cli.js`
- 脚本：`vitests/scripts/runtime-preview-feature-c-refresh-performance.mjs`
- 轮次：每组 `5` 轮。
- 源资源变更策略：本次不主动修改 feature-c `assets/` 或 source `.meta`；只允许 runtime preview 自身更新 `library`、`temp`、log 和诊断 JSON。
- 清理的环境变量：`COCOS_CLI_TEST_PROJECT_ROOT`、`COCOS_CLI_TEST_ENGINE_ROOT`、`COCOS_CLI_TEST_EDITOR_LIBRARY_REF`、`COCOS_CLI_TEST_EDITOR_PROGRAMMING_REF`、`COCOS_CLI_SHARED_LIBRARY_OUTPUT`。
- 不能证明的边界：未启动 browser / Cocos runtime；未验证 `resources.load`、组件脚本运行态或页面 ready；未覆盖真实文件变更后的 target-specific refresh；不能把本结果外推到其它项目。

## 命令

工作目录：`E:\own_space\engines\cocos-cli`

```powershell
rtk pwsh -NoProfile -Command 'Remove-Item Env:COCOS_CLI_TEST_PROJECT_ROOT -ErrorAction SilentlyContinue; Remove-Item Env:COCOS_CLI_TEST_ENGINE_ROOT -ErrorAction SilentlyContinue; Remove-Item Env:COCOS_CLI_TEST_EDITOR_LIBRARY_REF -ErrorAction SilentlyContinue; Remove-Item Env:COCOS_CLI_TEST_EDITOR_PROGRAMMING_REF -ErrorAction SilentlyContinue; Remove-Item Env:COCOS_CLI_SHARED_LIBRARY_OUTPUT -ErrorAction SilentlyContinue; node vitests/scripts/runtime-preview-feature-c-refresh-performance.mjs --rounds 5'
```

结果：exit code `0`。

JSON 输出：

`D:\ps_copy\p6\trunk\Project\GameClient\feature-c\temp\codex-runtime-preview\feature-c-refresh-performance-20260627-163104.json`

runtime preview logs：

- default off：`D:\ps_copy\p6\trunk\Project\GameClient\feature-c\temp\preview-logs\runtime-preview-20260627-163122.log`
- refresh-on-reload：`D:\ps_copy\p6\trunk\Project\GameClient\feature-c\temp\preview-logs\runtime-preview-20260627-163818.log`

## 结果

单位：ms。`p50` 为 5 轮样本 median，`p95` 为 5 轮样本排序后的第 5 个值。

| 场景 | 请求 | min | p50 | p95 | max | refresh total p50 | script compile p50 | changedAssetCount |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| default off | root `/` | `332.199` | `390.279` | `582.090` | `582.090` | N/A | N/A | N/A |
| default off | `POST /__runtime-preview/refresh` | `57866.060` | `59862.402` | `67075.109` | `67075.109` | `59856` | `2` | `27978` |
| `--refresh-on-reload` | root `/` | `59966.203` | `61382.994` | `71125.481` | `71125.481` | `60017` | `2` | `27978` |

启动耗时：

| 场景 | port | startup |
| --- | ---: | ---: |
| default off | `19820` | `117646ms` |
| `--refresh-on-reload` | `19821` | `87645ms` |

## 事实

- feature-c 默认关闭 `refresh-on-reload` 时，root `/` 只返回 HTML，p50 约 `390ms`，不会触发 AssetDB refresh。
- feature-c 无源变更情况下，显式 endpoint 的 `db://assets` root refresh p50 约 `59.9s`。
- feature-c 无源变更情况下，`--refresh-on-reload` root `/` p50 约 `61.4s`，其中 coordinator `refreshTotalMs` p50 约 `60.0s`。
- `changedAssetCount` 每轮均为 `27978`，这不是“本轮新增 27978 个文件”，而是当前 AssetDB root refresh API 在 feature-c 上返回的大范围变更/处理计数。
- `scriptCompileMs` p50 约 `2ms`。本次没有主动修改脚本源文件，因此该值只说明 refresh 后 idle wait 很快，不说明大脚本变更后的编译成本。

## 结论

- feature-c 真实项目数据强烈支持 `--refresh-on-reload` 继续默认关闭。
- 对 feature-c 这种大项目，默认对 `db://assets` 做全量 root refresh 会把一次页面 reload 拉到约 1 分钟量级，不适合作为常规页面刷新路径。
- 后续若要让 feature-c 体验可用，应优先做 target-specific refresh：例如只 refresh 修改文件或修改目录，而不是 root `db://assets`。
- 如果需要验证真实“资源/脚本修改后”的速度，应另开受控实验：选择可安全修改的临时资源或 feature-c 副本，分别测 absolute file target、directory target 和 root target，不能直接在真实业务项目源资源上试写。

## 教训

- 小 fixture 上 `db://assets` root refresh 的百毫秒级结果不能外推到 feature-c；真实大项目必须单独采样。
- `changedAssetCount` 在 root refresh 上只能作为 API 返回事实记录，不能作为新增/修改文件数量解释。
- endpoint refresh 和 reload refresh 的性能不同但同量级；页面 reload 多出的 HTML render 成本相对 feature-c root refresh 成本不显著。
- feature-c 真实项目采样必须清理 `COCOS_CLI_TEST_*` 和 frozen reference env，否则会把测试 fixture 语义混进 production real-project 验收。
