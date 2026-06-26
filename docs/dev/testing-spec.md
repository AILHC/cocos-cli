# 项目测试规范

## 目的

本文是本仓库所有测试、诊断和验收的入口规范，覆盖 Jest 单元测试、Vitest 集成测试、E2E、真实项目手工/自动验收和环境变量边界。

任何测试结论都必须说明：

- 测试层级是什么；
- 使用了哪个项目或 fixture；
- 设置了哪些环境变量；
- 能证明什么；
- 不能证明什么。

不得把低层级测试结果扩大解释为真实项目或 production 行为已闭环。

## 先读顺序

处理任何测试、验收、诊断脚本、环境变量或真实项目复现前，按顺序读取：

1. `AGENTS.md`
2. `docs/dev/testing-spec.md`
3. 相关专题的 `issues.md`、`facts/`、`acceptance/matrix.md` 或计划文档
4. 对应测试文件和 helper

如果专题还有专项测试规范，例如 `docs/dev/runtime-preview/testing-spec.md`，必须在项目级规范之后继续读取。

## 命令和环境原则

- 命令示例默认使用 PowerShell 语法；Windows 路径不得改写成 Bash 风格。
- 在 Codex / agent 会话中执行命令时，遵守仓库 `AGENTS.md` 和本机 `RTK.md` 的命令包装要求。
- 设置测试环境变量时，优先限定在当前 shell、当前命令或当前测试进程；不能把上一次测试留下的 env 当作隐式前提。
- 真实项目 production 验收前，除非 issue 明确要求，必须清理无关 `COCOS_CLI_TEST_*` env。
- 记录命令时必须写明工作目录；根目录脚本默认在仓库根目录运行，Vitest 脚本默认通过 `vitests/package.json` 运行。

## 测试层级

### 1. Jest 单元测试

入口：

```powershell
npm run test -- <path-or-pattern>
npx jest <path-or-pattern> --runInBand
```

常见范围：

- `src/core/**/test/*.test.ts`
- `src/core/**/test/*.spec.ts`
- `src/**/test/*.test.ts`
- `src/**/test/*.spec.ts`

用途：

- 验证单个模块、函数、配置解析、helper、adapter 或小型集成边界。
- 快速复现 bug 并固定回归测试。

不能证明：

- `dist` 已更新。
- CLI child process 可启动。
- 真实项目行为已通过。
- Browser/runtime/Editor parity 已闭环。

规则：

- 修改 production 代码前应优先补或更新相关 Jest 单测，除非该行为只能通过 Vitest/E2E/真实项目证明。
- 单测可使用 mock / fixture，但测试名和断言必须说明 fixture 语义。
- 不得为了测试通过引入 production 默认策略中不存在的 fallback。

### 2. TypeScript 编译检查

入口：

```powershell
npx tsc -b --pretty false
```

用途：

- 验证 TypeScript project references 编译通过。

不能证明：

- `dist/` 已清理并重新生成。
- static web、schema、dts、runtime preview app 产物已更新。
- CLI 可执行入口 `dist/cli.js` 已可用于真实验收。

禁止表述：

- 不得把 `tsc -b` 说成“已构建 CLI”。
- 不得用 `tsc -b` 替代真实 `dist` CLI 验收前的 `npm run compile` 或 `npm run build`。

### 3. 构建验证

入口：

```powershell
npm run compile
npm run build
```

语义：

- `npm run compile`：清理 build、准备 dts、执行 `tsc -b`、构建 static web、生成 schema。
- `npm run build`：在 `compile` 主要链路基础上额外生成 dts，是 release 级别更完整验证。

要求：

- 如果验收命令使用 `node dist/cli.js ...`，必须先运行 `npm run compile` 或 `npm run build`，除非本轮明确只验证已存在的旧 `dist` 行为。
- 如果只运行 `tsc -b`，最终汇报必须明确“没有构建 dist”。

### 4. Vitest 集成 / 专项测试

入口：

```powershell
npm --prefix vitests run test -- <suite-path>
```

常见范围：

- `vitests/suites/runtime-preview/**`
- `vitests/suites/build/**`
- `vitests/shared/**` helper
- `vitests/scripts/**` 诊断脚本

用途：

- 验证跨模块行为、runtime preview HTTP contract、build parity、engine source probe、真实 CLI helper 等。
- 使用临时目录、主测试项目、frozen Editor reference 或专项 fixture 构造可重复证据。

不能证明：

- 所有真实业务项目都通过。
- 未运行的真实 CLI child process 或 browser integration 已通过。
- production 环境变量默认策略已改变。

规则：

- `vitests/vitest.config.ts` 要求 `COCOS_CLI_TEST_ENGINE_ROOT`；这只是 Vitest harness 需要，不代表 production 使用该 env。
- 使用 `COCOS_CLI_TEST_PROJECT_ROOT` 的测试必须说明项目属于主测试项目、历史 reference、临时 fixture 还是真实项目专项。
- 使用 frozen Editor reference env 时，必须标明其角色：`hard input`、`compatibility baseline`、`test fixture` 或 `not used`。

### 5. E2E 测试

入口：

```powershell
npm run test:e2e
npm run test:e2e:debug
```

相关目录：

- `e2e/`
- `tests/fixtures/projects/`

用途：

- 验证 CLI 命令、MCP/API、项目 fixture 操作和端到端行为。

规则：

- E2E 默认 fixture 是测试项目副本，不是真实业务项目。
- `test:e2e:debug` 可保留 workspace；最终结论必须说明是否有保留文件、缓存或生成物。
- 修改 CLI 命令行为时，优先确认是否需要补 E2E，而不只跑单元测试。

### 6. 真实项目验收

用途：

- 验证 issue 指定的真实业务项目问题是否闭环。
- 作为将 issue 标为 `fixed` 的最终证据之一。

要求：

- 必须使用 issue / facts 指定的真实项目路径；路径未知时必须先确认，不能猜。
- 必须说明是否先构建 `dist`。
- 必须清理无关 `COCOS_CLI_TEST_*` env，除非 issue 明确要求。
- 必须记录命令、端口、scene、核心 HTTP/browser 检查结果、日志路径和失败 gate。

真实项目验收不能被以下结果替代：

- 单元测试通过。
- Vitest route contract 通过。
- 主测试项目通过。
- `tsc -b` 通过。

## 项目和 fixture 分类

| 分类 | 典型路径 | 用途 | 不能证明 |
| --- | --- | --- | --- |
| 内置小 fixture | `tests/fixtures/projects/*` | Jest/E2E 轻量输入。 | 真实业务项目行为。 |
| 临时 fixture | `.codex-tmp/*`、系统 temp 目录 | 单测或 Vitest 构造特定输入形态。 | production 默认行为。 |
| 主测试项目 | `E:\own_space\engines\cocos-test-projects` | 核心功能、资源类型、AssetDB import、runtime preview 基础能力、build parity。 | 特定真实业务项目问题已修复。 |
| 历史 reference / 旧 fixture | `E:\own_space\cocos_work_lab_38x` | 历史事实、frozen Editor reference、旧回归来源。 | 当前主测试项目或真实项目验收。 |
| 真实项目复杂场景 | 例如 `D:\ps_copy\p6\trunk\Project\GameClient\feature-c` | 业务项目、复杂依赖、大项目集成、browser/runtime strict gate。 | 其它真实项目问题。 |
| issue 指定真实项目 | 由对应 `facts/` 指定 | 对应 issue 的最终验收对象。 | 通用能力闭环。 |

## 环境变量边界

| 环境变量 | 允许用途 | 禁止用途 |
| --- | --- | --- |
| `COCOS_CLI_TEST_PROJECT_ROOT` | Vitest / Jest / 专项集成测试显式指定测试项目。 | 不能作为 production 默认项目解析依据；不能替代 issue 指定真实项目。 |
| `COCOS_CLI_TEST_ENGINE_ROOT` | Vitest harness、专项测试覆盖 engine root。 | 不能替代真实项目配置 `package.json["cocos-cli"].enginePath` 的验收。 |
| `COCOS_CLI_TEST_EDITOR_LIBRARY_REF` | frozen Editor library reference，作为 baseline 或 fixture。 | 不能注入 production real-project 验收；不能把 frozen output 当 production 输入。 |
| `COCOS_CLI_TEST_EDITOR_PROGRAMMING_REF` | frozen Editor programming reference，作为 baseline 或 fixture。 | 不能注入 production real-project 验收。 |
| `COCOS_CLI_SHARED_LIBRARY_OUTPUT` | 明确测试 shared / isolated library output。 | 不能静默切换 production 策略来让测试通过。 |
| `COCOS_CLI_TEST_BROWSER` | 指定 browser executable。 | 不能影响非 browser 测试结论。 |
| `COCOS_CLI_FEATURE_C_*` | feature-c 专项诊断。 | 不能复制到其它真实项目或通用测试。 |
| `COCOS_CLI_SOURCE_META_PROJECT_ROOT`、`COCOS_CLI_EDITOR_PROJECT_ROOT` | source meta / Editor parity 专项。 | 不能作为普通 runtime preview 或 build 验收项目。 |

运行真实项目 production 验收前，除非 issue 明确要求，应清理 test env：

```powershell
Remove-Item Env:COCOS_CLI_TEST_PROJECT_ROOT -ErrorAction SilentlyContinue
Remove-Item Env:COCOS_CLI_TEST_ENGINE_ROOT -ErrorAction SilentlyContinue
Remove-Item Env:COCOS_CLI_TEST_EDITOR_LIBRARY_REF -ErrorAction SilentlyContinue
Remove-Item Env:COCOS_CLI_TEST_EDITOR_PROGRAMMING_REF -ErrorAction SilentlyContinue
```

## 选择测试的规则

### 修改纯函数、配置解析、resolver 小逻辑

最低要求：

- 对应 Jest 单元测试或 Vitest route/unit 测试。
- `npx tsc -b --pretty false`。

如果行为影响 CLI 入口或真实产物，还需要更高层级验证。

### 修改 CLI 命令、Launcher、engine root、project root

最低要求：

- 对应 Jest/Vitest launcher 或 command 测试。
- 至少一个真实 CLI child process 或 E2E 验证，除非明确说明无法运行。
- 不能只依赖 `COCOS_CLI_TEST_ENGINE_ROOT`，必须验证 production 项目配置路径或 CLI 初始化路径。

### 修改 AssetDB、builder、library/temp output

最低要求：

- 对应 Jest 单测。
- 如涉及产物路径或 Editor parity，补 Vitest parity / integration。
- 如涉及真实项目 build-ex 或业务 hook，只能低频跑真实项目，并记录 source asset 副作用。

### 修改 runtime preview

先读：

```text
docs/dev/runtime-preview/testing-spec.md
```

最低要求按影响面选择：

- route/resolver：Vitest route contract。
- Launcher/settings/output：launcher/runtime preview integration。
- browser/runtime：browser smoke 或真实项目诊断。
- issue 指定真实项目：必须用该真实项目验收后才能标 `fixed`。

### 修改 E2E helper、MCP、API 或 CLI packaging

最低要求：

- 对应 Jest 单元测试。
- 相关 `npm run test:e2e` 子集或完整 E2E。
- 若使用 `dist/cli.js`，先 `npm run compile` 或说明使用旧 dist。

## 状态和结论表述

允许：

- “Jest 单元测试通过。”
- “Vitest route contract 通过。”
- “TypeScript 编译检查通过。”
- “已构建 dist，并用真实项目 X 验证通过。”
- “当前只完成候选修复，真实项目验收未跑。”

禁止：

- 把 `tsc -b` 说成已构建 `dist`。
- 把 route contract 通过说成 browser runtime 通过。
- 把主测试项目通过说成 issue 指定真实项目通过。
- 把 `COCOS_CLI_TEST_*` 环境变量下的结果说成 production 默认行为。
- 路径未知时声称知道测试项目。
- 未跑真实项目验收就把真实项目 issue 标为 `fixed`。

## 记录要求

新增或修改测试相关文档时，必须写清：

- 测试层级；
- 项目/fixture 分类；
- 命令；
- 环境变量；
- 是否构建 `dist`；
- 通过条件；
- 该测试不能证明的边界。

问题状态写入对应专题 `issues.md`；验收状态写入对应 `acceptance/matrix.md`；事实证据写入 `facts/`。
