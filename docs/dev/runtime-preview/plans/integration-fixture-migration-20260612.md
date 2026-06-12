# Runtime Preview 集成 fixture 迁移计划

记录时间：2026-06-12

本文只定义迁移计划，等待确认后执行。目标是把可控、可复现、可长期回归的集成测试 fixture 从 `feature-c` 和历史小项目 `E:\own_space\cocos_work_lab_38x` 迁移或复刻到主测试项目 `E:\own_space\engines\cocos-test-projects`，同时保留 `feature-c` 作为真实复杂项目验证线。

## 背景事实

- 当前主测试项目规范已经切到 `E:\own_space\engines\cocos-test-projects`。
- `D:\ps_copy\p6\trunk\Project\GameClient\feature-c` 继续作为真实项目复杂场景验证线，用于覆盖业务项目、复杂依赖、复杂脚本、真实配置和大项目集成问题。
- `E:\own_space\cocos_work_lab_38x` 不再作为当前主测试项目，只保留为历史 reference / 旧 fixture。
- `docs/dev/runtime-preview/facts/source-meta-editor-baseline-20260611.md` 已记录 `cocos-test-projects` 的 3.8.6 分支、Editor baseline、CLI 配置适配和 `.anim.meta` parity 经验。
- 当前 `vitests/suites/runtime-preview/main-test-project-cli-integration.test.ts` 和 `vitests/suites/runtime-preview/cli-generated-output-integration.test.ts` 已切到 `cocos-test-projects` 语义，但 focused run 仍暴露 browser smoke 失败：`settings.js` 的 `launch.launchScene` 已是目标 scene，仍出现 `cc.TiledLayer` / `cc.TiledMap` class missing 与 `console.error(Event)`。

## 目标

1. 把历史小项目中有价值的 extension asset-db fixture 迁移到 `cocos-test-projects`。
2. 把 `feature-c` 中暴露过的 SDK / CommonJS bare specifier 问题复刻成 `cocos-test-projects` 的最小 fixture。
3. 从 `feature-c` 的历史诊断中筛选可复刻的集成风险，沉淀到主测试项目；不可复刻或不应缩小的部分继续留在 `feature-c` 真实项目线。
4. 让主线集成测试优先使用 `cocos-test-projects` 覆盖基础功能、资源类型、extension asset-db、script compile fallback、真实 CLI child process、browser smoke。

## 非目标

- 不把 `feature-c` 整个项目复制到 `cocos-test-projects`。
- 不把业务代码、业务资源或业务 package allow-list 引入 CLI production 逻辑。
- 不为了让测试通过而过滤真实 browser error、`pageerror`、同源 failed request 或 bad response。
- 不把 `@tbmp/mp-cloud-sdk` 做成特殊 allow-list 或 runtime API mock。
- 不恢复 `E:\own_space\cocos_work_lab_38x` 作为当前主测试项目。
- 不修改 source `.meta` parity 的范围；source `.meta` 仍按 `source-meta-editor-parity` 专项处理。

## 迁移候选清单

| 来源 | 候选 | 迁移方式 | 目标测试 | 备注 |
| --- | --- | --- | --- | --- |
| `cocos_work_lab_38x` | `ViewStateGroup` extension asset-db fixture | 复制最小 extension 到 `cocos-test-projects/extensions/ViewStateGroup`，保留 `contributions["asset-db"].mount.path` 和最小 asset 样本 | `editor-cli-output-consistency.test.ts`、`cli-generated-output-integration.test.ts`、后续 extension runtime trigger test | 当前测试仍依赖旧项目 package/output/frozen metadata 事实，迁移后旧项目只作为历史记录 |
| `feature-c` | `@tbmp/mp-cloud-sdk` CommonJS bare specifier 缺失 | 在 `cocos-test-projects` 新增最小 CommonJS 脚本 fixture，触发 `require("@tbmp/mp-cloud-sdk")`，不提供该 package | `preview-script-recovery.test.ts` 的 unit 之外，新增真实 CLI / programming output integration 断言 `resolution-detail-map.json` | 验证 packer-driver / QuickPack fallback，不引入 package allow-list |
| `feature-c` | 大项目 chunk fan-out / prerequisite imports 资源压力 | 在 `cocos-test-projects` 复刻小规模多 chunk fixture 或统计型 fixture | 后续 script runtime map / browser smoke diagnostic test | 不追求复刻 3000+ chunks；只沉淀可控的 depcache / prerequisite imports 行为 |
| `feature-c` | 2D physics 配置与 3D physics runtime 依赖不一致 | 只记录为真实项目线优先，不立即迁移 | `diagnose:feature-c` | 该问题依赖复杂业务脚本和 engine module 组合，最小复刻前需要先确认是否属于 CLI regression 还是项目配置风险 |
| `feature-c` | chunk load error / browser error logging | 抽象成 `cocos-test-projects` 的 browser error visibility fixture | `browser-runtime-smoke` 或单独 browser error reporting integration | 只验证错误可见性和分类，不伪造通过 |
| `cocos_work_lab_38x` | 旧小项目三复杂场景 smoke | 不迁移场景本身；改用 `cocos-test-projects` 代表场景 | `main-test-project-cli-integration.test.ts` | 当前主测试项目仍需先解决 TiledMap/Event browser smoke 失败 |

## 阶段计划

### 阶段 1：建立迁移基线

**目标：** 先把现有依赖关系和失败事实固定，避免迁移过程中混淆“旧 fixture 行为”和“主测试项目行为”。

**检查项：**

- `vitests/suites/runtime-preview/editor-cli-output-consistency.test.ts` 中 `records small-project extension asset-db output facts without treating them as runtime trigger` 当前依赖：
  - `extensions/ViewStateGroup/package.json`
  - `library/.view-state-group-data.json`
  - `library/.view-state-group-info1.0.0.json`
  - `library/cli-extensions/view-state-group/.view-state-group-data.json`
  - `library/cli-extensions/view-state-group/.view-state-group-info.json`
- `vitests/suites/runtime-preview/http-url-capture.probe.test.ts` 中 extension capture 当前只证明 representative HTTP-base capture 未触发 `view-state-group` URL。
- `vitests/scripts/runtime-preview-feature-c-diagnose.ts` 继续作为 `feature-c` strict acceptance 入口，不迁移为普通主线 test。
- `vitests/suites/runtime-preview/preview-script-recovery.test.ts` 当前只覆盖 unit-level CommonJS bare specifier fallback，不覆盖真实项目 programming output。

**验收：**

```powershell
rtk rg -n "cocos_work_lab_38x|ViewStateGroup|view-state-group|@tbmp/mp-cloud-sdk|feature-c" vitests docs/dev/runtime-preview
```

输出必须能区分：

- 当前主线 test 依赖。
- 历史 reference / archive。
- `feature-c` 真实项目线。
- 待迁移 fixture。

### 阶段 2：迁移 `ViewStateGroup` extension asset-db fixture

**目标：** 让 extension asset-db 的 package/input/output 测试基于 `cocos-test-projects`，不再读取 `cocos_work_lab_38x`。

**预期项目侧 fixture：**

```text
E:\own_space\engines\cocos-test-projects\extensions\ViewStateGroup\package.json
E:\own_space\engines\cocos-test-projects\extensions\ViewStateGroup\assets\...
```

`package.json` 必须保留最小事实：

```json
{
  "name": "view-state-group",
  "contributions": {
    "asset-db": {
      "mount": {
        "path": "./assets"
      }
    }
  }
}
```

**测试调整：**

- 修改 `vitests/suites/runtime-preview/editor-cli-output-consistency.test.ts`：
  - 测试名从 `small-project extension asset-db output facts` 改为 `main test-project extension asset-db output facts`。
  - 继续验证 package input、Editor baseline metadata、CLI extension output。
  - 若 `cocos-test-projects` 暂无 Editor baseline extension metadata，先生成 Editor baseline，再比较 CLI output。
- 修改 `docs/dev/runtime-preview/acceptance/matrix.md`：
  - `ViewStateGroup` 从历史 fixture 行迁到主测试项目 extension asset-db 行。
  - 历史 `cocos_work_lab_38x` 只留 archive / facts 引用。

**验收命令：**

```powershell
$env:COCOS_CLI_TEST_PROJECT_ROOT='E:\own_space\engines\cocos-test-projects'
$env:COCOS_CLI_TEST_ENGINE_ROOT='D:\workspace\engines\cocos\3.8.6'
npm --prefix vitests test -- suites/runtime-preview/editor-cli-output-consistency.test.ts
```

预期：

- 不再要求 `COCOS_CLI_TEST_PROJECT_ROOT=E:\own_space\cocos_work_lab_38x`。
- `view-state-group` output 来自 `cocos-test-projects\library\cli-extensions\view-state-group`。

### 阶段 3：复刻 `feature-c` SDK / CommonJS bare specifier fixture

**目标：** 用 `cocos-test-projects` 的最小 fixture 覆盖 `feature-c` 中 `@tbmp/mp-cloud-sdk` 触发的 CommonJS bare specifier fallback。

**预期项目侧 fixture：**

在 `cocos-test-projects` 增加一个最小脚本，例如：

```js
const sdk = require('@tbmp/mp-cloud-sdk');
module.exports = {
  sdk,
};
```

要求：

- 不安装 `@tbmp/mp-cloud-sdk`。
- 不添加 runtime preview allow-list。
- 不添加 CLI 参数级 `--script-stub`。
- 触发点必须是 CommonJS `require()`，不是 ESM `import`。

**测试调整：**

- 保留 `vitests/suites/runtime-preview/preview-script-recovery.test.ts` 作为 unit-level fallback contract。
- 新增或扩展真实 CLI programming output integration：
  - 启动 `preview --runtime`。
  - 等待 `asset-db:script-compile:done` 或 `asset-db:script-compile:report-only` 相关诊断。
  - 读取 `temp/cli/programming/packer-driver/targets/preview/resolution-detail-map.json`。
  - 断言存在 `@tbmp/mp-cloud-sdk` fallback 记录。
  - 断言没有 `runtime-preview-stubs`、没有 package allow-list 行为。

**验收命令：**

```powershell
$env:COCOS_CLI_TEST_PROJECT_ROOT='E:\own_space\engines\cocos-test-projects'
$env:COCOS_CLI_TEST_ENGINE_ROOT='D:\workspace\engines\cocos\3.8.6'
npm --prefix vitests test -- suites/runtime-preview/preview-script-recovery.test.ts suites/runtime-preview/cli-generated-output-integration.test.ts
```

预期：

- `preview-script-recovery.test.ts` 继续通过。
- 真实 CLI integration 能在 `cocos-test-projects` 中观察到 fallback 产物或诊断。

### 阶段 4：筛选 `feature-c` 可复刻集成风险

**目标：** 把 `feature-c` 里可控、独立、适合作为回归 fixture 的问题迁入 `cocos-test-projects`；保留不可缩小的问题在 `feature-c` 线。

**迁移判断标准：**

可迁移：

- 可以用少量资源 / 脚本复刻。
- 不依赖业务服务、业务账号、远程 API、真实业务目录结构。
- 能稳定触发 CLI / runtime preview 边界行为。
- 能在 `cocos-test-projects` 中用 Editor 3.8.6 正常 import。

暂不迁移：

- 依赖大规模业务脚本数量才能触发的 Chrome 资源压力。
- 依赖复杂业务脚本执行路径的 runtime exception。
- 依赖项目私有配置、私有资源或真实业务数据。
- 还没有明确归因的 source `.meta` 写回差异。

**候选处理：**

- chunk fan-out / `ERR_INSUFFICIENT_RESOURCES`：先做统计型诊断，不立即复制大规模 chunk。
- physics builtin asset mismatch：继续留在 `feature-c`，除非能证明是可独立复刻的 engine module/settings mismatch。
- browser error reporting：可以迁成小型 fixture，验证 `/preview-error` 和 evidence 分类，不让测试假通过。

### 阶段 5：清理测试和文档入口

**目标：** 迁移完成后，主线文档和测试不再把 `cocos_work_lab_38x` 当当前输入。

**清理项：**

- `vitests/suites/runtime-preview/editor-cli-output-consistency.test.ts`
- `vitests/suites/runtime-preview/http-url-capture.probe.test.ts`
- `docs/dev/runtime-preview/README.md`
- `docs/dev/runtime-preview/acceptance/matrix.md`
- `docs/dev/runtime-preview/issues.md`
- `docs/dev/runtime-preview/facts/architecture.md`

**保留项：**

- `docs/dev/runtime-preview/archive/**` 可保留历史命令和旧结论。
- `docs/dev/runtime-preview/acceptance/feedback-20260609.md` 可保留历史 evidence。
- `vitests/scripts/runtime-preview-feature-c-diagnose.ts` 保留为真实复杂项目 gate。

**验收命令：**

```powershell
rtk rg -n "cocos_work_lab_38x|small-project|小项目" vitests docs/dev/runtime-preview/README.md docs/dev/runtime-preview/acceptance/matrix.md docs/dev/runtime-preview/issues.md docs/dev/runtime-preview/facts
```

预期：

- 当前规范入口只把 `cocos_work_lab_38x` 标记为历史 reference / 旧 fixture。
- `vitests` 当前主线 test 不再依赖 `cocos_work_lab_38x`。

## 最终验收建议

迁移完成后，至少运行：

```powershell
$env:COCOS_CLI_TEST_PROJECT_ROOT='E:\own_space\engines\cocos-test-projects'
$env:COCOS_CLI_TEST_ENGINE_ROOT='D:\workspace\engines\cocos\3.8.6'
npm --prefix vitests test -- suites/runtime-preview/editor-cli-output-consistency.test.ts suites/runtime-preview/cli-generated-output-integration.test.ts suites/runtime-preview/main-test-project-cli-integration.test.ts suites/runtime-preview/preview-script-recovery.test.ts
```

`feature-c` 真实项目线单独运行：

```powershell
$env:COCOS_CLI_FEATURE_C_PROJECT_ROOT='D:\ps_copy\p6\trunk\Project\GameClient\feature-c'
$env:COCOS_CLI_TEST_ENGINE_ROOT='D:\workspace\engines\cocos\3.8.6'
npm --prefix vitests run diagnose:feature-c
```

通过标准：

- `cocos-test-projects` 覆盖可控最小 fixture。
- `feature-c` 继续验证真实复杂项目 strict acceptance。
- 不再用 `cocos_work_lab_38x` 作为当前主线输入。
- 文档能说明每个 fixture 的来源、目标和边界。

## 2026-06-12 执行记录

本轮只迁移可控 fixture、测试入口和文档记录，不修改 runtime preview 业务逻辑来让测试通过。

已执行：

- 在主测试项目 `E:\own_space\engines\cocos-test-projects` 新增最小 extension asset-db fixture：`extensions\ViewStateGroup`。
  - `package.json` 使用 `name = "view-state-group"`。
  - `contributions["asset-db"].mount.path = "./assets"`。
  - 保留代表性 UUID，用于验证 CLI `library\cli-extensions\view-state-group` output。
  - `cocos-test-projects` 原本 `.gitignore` 忽略整个 `extensions/`，本轮只放开 `extensions/ViewStateGroup/**`，不放开其它 extension 内容。
- 在主测试项目新增最小 CommonJS bare specifier fixture：`assets\cases\scripting\commonjs-bare-specifier\commonjs-bare-specifier.js`。
  - 脚本只包含 `require("@tbmp/mp-cloud-sdk")` 和 `module.exports`。
  - 不安装 `@tbmp/mp-cloud-sdk`。
  - 不引入 package allow-list、runtime stub 或 `--script-stub`。
- `editor-cli-output-consistency.test.ts` 的 extension output 测试改为读取主测试项目，不再依赖 `E:\own_space\cocos_work_lab_38x`。
- `cli-generated-output-integration.test.ts` 在 browser smoke 前新增真实 CLI programming output 断言：
  - `temp\cli\programming\packer-driver\targets\preview\resolution-detail-map.json` 存在。
  - 内容包含 `@tbmp/mp-cloud-sdk`。
  - 内容包含 `Failed to resolve CommonJS bare specifier`。
  - 内容不包含 `runtime-preview-stubs`。
- `http-url-capture.probe.test.ts` 只更新命名和测试描述，把 `small-project` 语义改为当前 project 语义，不改变行为。
- 更新 [README.md](../README.md)、[acceptance/matrix.md](../acceptance/matrix.md)、[issues.md](../issues.md)，区分主测试项目 fixture、`feature-c` 真实项目线和历史 reference。

已验证：

```powershell
$env:COCOS_CLI_TEST_PROJECT_ROOT='E:\own_space\engines\cocos-test-projects'
$env:COCOS_CLI_TEST_ENGINE_ROOT='D:\workspace\engines\cocos\3.8.6'
npm --prefix vitests test -- suites/runtime-preview/preview-script-recovery.test.ts
```

结果：通过，`14 tests`。

```powershell
$env:COCOS_CLI_TEST_PROJECT_ROOT='E:\own_space\engines\cocos-test-projects'
$env:COCOS_CLI_TEST_ENGINE_ROOT='D:\workspace\engines\cocos\3.8.6'
npm --prefix vitests test -- suites/runtime-preview/editor-cli-output-consistency.test.ts -t 'main test-project extension'
```

结果：通过，`1 passed`、`3 skipped`。该 focused run 只验证主测试项目 `ViewStateGroup` extension output，不需要 Editor frozen refs。

```powershell
$env:COCOS_CLI_TEST_PROJECT_ROOT='E:\own_space\engines\cocos-test-projects'
$env:COCOS_CLI_TEST_ENGINE_ROOT='D:\workspace\engines\cocos\3.8.6'
npm --prefix vitests test -- suites/runtime-preview/cli-generated-output-integration.test.ts
```

结果：失败，但失败点已经越过 SDK fallback output 断言。也就是说 `resolution-detail-map.json` 已包含 `@tbmp/mp-cloud-sdk` 的 CommonJS bare specifier fallback 记录，随后仍失败在既有 browser smoke：

```text
console errors: Event
Event
Event
Can not find class 'cc.TiledLayer'
Can not find class 'cc.TiledMap'
Sorry, the component of 'TiledMap' which with an index of 1 is corrupted! It has been removed.
Sorry, the component of 'baseLayer' which with an index of 1 is corrupted! It has been removed.
```

证据文件：

```text
E:\own_space\engines\cocos-test-projects\temp\runtime-preview-cli-generated-output-scene-d3fc11bc-05dc-4e60-bc4f-f682fa74e8b6.json
```

当前裁决：

- `ViewStateGroup` fixture 迁移到主测试项目已完成，CLI extension output focused test 已通过。
- `@tbmp/mp-cloud-sdk` 最小 fixture 已进入真实 CLI programming output，fallback 产物已观察到。
- 主测试项目 browser smoke 仍未通过，原因仍是 `cc.TiledLayer` / `cc.TiledMap` class missing 与 `console.error(Event)`，本轮不修改业务代码掩盖该失败。
- browser error reporting fixture、本计划阶段 4 的其它 `feature-c` 风险缩小复刻，本轮暂未执行。
