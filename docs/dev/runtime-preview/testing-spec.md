# Runtime Preview 测试规范

## 目的

本文是 runtime preview 专项测试和验收的入口规范，用于避免混用测试项目、历史 fixture、真实业务项目和环境变量。

本文是 [../testing-spec.md](../testing-spec.md) 的 runtime preview 专项补充，不替代项目级测试规范。任何 runtime preview 测试结论都必须先满足项目级规范中的测试层级、构建语义、项目/fixture 分类和环境变量边界。

结论、状态和验收入口仍以 `issues.md` 与 `acceptance/matrix.md` 为准；本文只定义测试分层、项目选择、环境变量使用边界和常用命令模板。

## 先读顺序

处理 runtime preview 测试、验收、反馈复现或环境变量前，按顺序读取：

1. `AGENTS.md`
2. `docs/dev/testing-spec.md`
3. `docs/dev/runtime-preview/testing-spec.md`
4. `docs/dev/runtime-preview/issues.md` 中对应 `RP-ISSUE-xxx`
5. 对应 `facts/` 事实文档
6. `docs/dev/runtime-preview/acceptance/matrix.md` 中对应验收项

如果对应 issue 或 facts 指定了真实项目，必须以该真实项目作为最终验收对象；不能用通用 Vitest fixture 代替。

## 测试分层

### 1. 短链路 Vitest / route contract

用途：

- 验证单个 resolver、route、settings provider、helper 行为。
- 用临时目录或最小 fixture 复现某个输入形态。
- 防止已定位 bug 回归。

不能证明：

- 真实 `dist/cli.js preview --runtime` 在真实项目上可用。
- browser runtime 已 ready。
- 项目配置、engine root、AssetDB import、library/temp 真实产物链路已闭环。

典型入口：

```powershell
npm --prefix vitests run test -- suites/runtime-preview/preview-app-route-contract.test.ts
```

要求：

- 测试名必须说明 fixture 语义，例如 `shared CLI sidecar records`、`frozen editor reference`、`legacy library/cli records`。
- 如果测试使用 `COCOS_CLI_TEST_*` 环境变量，必须知道它只是 Vitest fixture 输入，不是 production 默认行为。
- route contract 通过只能作为 `HTTP route contract` 证据；除非同时跑真实项目，否则不能把 issue 标为 `fixed`。

### 2. 主测试项目集成

用途：

- 覆盖主要核心功能、基础流程、资源类型、AssetDB import、library 产物、runtime preview 基础能力。
- 验证主测试项目真实 CLI child process、browser smoke 或相关集成脚本。

项目：

```text
E:\own_space\engines\cocos-test-projects
```

典型入口：

```powershell
$env:COCOS_CLI_TEST_PROJECT_ROOT='E:\own_space\engines\cocos-test-projects'
$env:COCOS_CLI_TEST_ENGINE_ROOT='D:\workspace\engines\cocos\3.8.6'
npm --prefix vitests run test -- suites/runtime-preview/main-test-project-cli-integration.test.ts
```

要求：

- 不需要 frozen Editor reference 的测试，不得设置 `COCOS_CLI_TEST_EDITOR_LIBRARY_REF` 或 `COCOS_CLI_TEST_EDITOR_PROGRAMMING_REF`。
- 如果测试目标是 production CLI path，应确认测试 helper 没有注入 reference env。
- 主测试项目通过不代表特定真实业务项目问题已闭环。

### 3. 真实项目复杂场景

用途：

- 验证业务项目、复杂依赖、复杂脚本、真实配置、大项目集成问题。
- 作为对应 issue 的真实项目验收证据。

当前已知真实项目线：

```text
D:\ps_copy\p6\trunk\Project\GameClient\feature-c
```

典型入口：

```powershell
npm --prefix vitests run diagnose:feature-c
```

`diagnose:feature-c` 是 fail gate。以下任一非空或非零都必须失败：

- `readyTimedOut`
- `pageErrors`
- `unhandledRejections`
- 同源 `failedRequests`
- 同源 `badResponses`
- `console.error`

要求：

- `feature-c` 相关环境变量只用于 feature-c 专项诊断，不得复制到其它项目验收。
- 如果 issue 指定另一个真实项目，例如 P7 `Client-fight-roguelike-migration`，必须按该 issue 的 facts 指定项目和场景验收，不能用 feature-c 代替。

### 4. 历史 reference / 旧 fixture

项目：

```text
E:\own_space\cocos_work_lab_38x
```

用途：

- 历史 reference。
- frozen Editor `library` / `temp/programming` fixture。
- 旧问题回归的最小事实来源。

禁止：

- 不得把它当作当前 runtime preview 主测试项目。
- 不得用它证明真实业务项目问题已修复。
- 不得把历史文档中的 `cocos_work_lab_38x` 命令复制为当前默认验收命令。

## 环境变量边界

| 环境变量 | 允许用途 | 禁止用途 |
| --- | --- | --- |
| `COCOS_CLI_TEST_PROJECT_ROOT` | Vitest fixture / 专项集成测试显式指定项目根。 | 不能作为 production 默认项目解析依据；不能替代 issue 指定的真实项目。 |
| `COCOS_CLI_TEST_ENGINE_ROOT` | Vitest fixture / 专项测试覆盖 engine root。 | 不能替代真实 production 项目配置 `package.json["cocos-cli"].enginePath` 的验收。 |
| `COCOS_CLI_TEST_EDITOR_LIBRARY_REF` | frozen Editor library reference，作为 compatibility baseline 或 test fixture。 | 不能注入 production real-project 验收；不能把 frozen output 当 production runtime 输入。 |
| `COCOS_CLI_TEST_EDITOR_PROGRAMMING_REF` | frozen Editor programming reference，作为 compatibility baseline 或 test fixture。 | 不能注入 production real-project 验收；不能掩盖 `temp/cli/programming` 或 shared programming 问题。 |
| `COCOS_CLI_SHARED_LIBRARY_OUTPUT` | 明确测试 shared / isolated project library output 策略。`0` 表示回退 isolated output；未设置时当前 production 默认是 shared output。 | 不能为了让测试通过静默切换 output 策略；每个测试必须说明为何设置。 |
| `COCOS_CLI_FEATURE_C_*` | feature-c 专项诊断和 evidence capture。 | 不能用于其它真实项目或通用 Vitest。 |
| `COCOS_CLI_TEST_BROWSER` | 指定 browser executable。 | 不能影响非 browser 测试结论。 |

运行 production real-project 验收前，除非 issue 明确要求，否则应清理 test env：

```powershell
Remove-Item Env:COCOS_CLI_TEST_PROJECT_ROOT -ErrorAction SilentlyContinue
Remove-Item Env:COCOS_CLI_TEST_ENGINE_ROOT -ErrorAction SilentlyContinue
Remove-Item Env:COCOS_CLI_TEST_EDITOR_LIBRARY_REF -ErrorAction SilentlyContinue
Remove-Item Env:COCOS_CLI_TEST_EDITOR_PROGRAMMING_REF -ErrorAction SilentlyContinue
```

## 构建与真实 `dist` 验收

如果验收命令使用：

```powershell
node dist/cli.js preview --runtime ...
```

则必须先构建或至少更新 `dist`：

```powershell
npm run compile
```

如果目标是 release 级验证，使用：

```powershell
npm run build
```

`npx tsc -b --pretty false` 只能证明 TypeScript 编译通过；不能证明 `dist/cli.js` 已更新，也不能作为真实 `dist` CLI 验收的构建证据。

## 真实项目验收模板

当 issue 指定真实项目时，验收步骤必须写明项目路径、scene、端口、构建命令和 HTTP 检查。

以 `RP-ISSUE-023` 为例，facts 指定的是 P7 `Client-fight-roguelike-migration`，不是通用 fixture。若绝对路径未知，必须先向用户确认或从事实记录中定位；不能猜测。

模板：

```powershell
npm run compile

Remove-Item Env:COCOS_CLI_TEST_PROJECT_ROOT -ErrorAction SilentlyContinue
Remove-Item Env:COCOS_CLI_TEST_ENGINE_ROOT -ErrorAction SilentlyContinue
Remove-Item Env:COCOS_CLI_TEST_EDITOR_LIBRARY_REF -ErrorAction SilentlyContinue
Remove-Item Env:COCOS_CLI_TEST_EDITOR_PROGRAMMING_REF -ErrorAction SilentlyContinue

node E:\own_space\engines\cocos-cli\dist\cli.js preview --runtime --project <P7_ROGUELIKE_PROJECT> --host 127.0.0.1 --port 9528
```

另开 shell 或用可终止 helper 检查：

```powershell
Invoke-WebRequest 'http://127.0.0.1:9528/settings.js' | Select-Object -ExpandProperty Content
Invoke-WebRequest 'http://127.0.0.1:9528/scene-list' | Select-Object -ExpandProperty Content
Invoke-WebRequest 'http://127.0.0.1:9528/scene/4c721bfe-0b6e-46c2-97f0-644adfdcba31.json' | Select-Object -ExpandProperty Content
```

通过条件：

- `/settings.js` 中 `launch.launchScene` 是目标 scene UUID。
- `/scene-list` 返回 scenes 包含目标 scene，`currentScene` 是目标 scene UUID。
- `/scene/<uuid>.json` 返回 200，且对应真实 `library/<prefix>/<uuid>.json`。
- browser 验收需要额外检查 ready signal、pageerror、failed request、bad response 和 `console.error`。

## 状态回填规则

- 只跑短链路 Vitest：issue 最多记录为“已补 route/unit regression”，不能标 `fixed`。
- 跑主测试项目集成：只能证明主测试项目能力，不自动证明真实业务项目。
- 跑真实项目并满足对应 facts / matrix 验收：才能把对应 issue 标为 `fixed`。
- matrix 的 `done` 必须表示该验收项在声明范围内闭环；如果还缺真实项目验证，应保持 `partial`。

## 禁止项

- 禁止把 `COCOS_CLI_TEST_PROJECT_ROOT=E:\own_space\cocos_work_lab_38x` 当作当前默认验收命令。
- 禁止把 frozen Editor reference env 注入 production real-project 验收。
- 禁止用 `COCOS_CLI_TEST_ENGINE_ROOT` 掩盖项目配置缺失。
- 禁止把 `tsc -b` 说成已构建 `dist`。
- 禁止把 route contract 通过说成 browser runtime 或真实项目通过。
- 禁止在真实项目路径不明确时声称“知道用哪个项目测试”。
