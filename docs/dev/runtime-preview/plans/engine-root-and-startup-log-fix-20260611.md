# Runtime Preview engineRoot 解析和启动日志修复计划

## 背景

2026-06-11 手动运行 `preview --runtime` 时，`feature-c` 启动日志显示：

```text
[runtime-preview] engineRoot=E:\own_space\engines\cocos-cli\packages\engine
```

这不是 `D:\ps_copy\p6\trunk\Project\GameClient\feature-c` 实际应使用的 engine source。已确认该项目 `package.json` 中存在：

```json
{
  "cocos-cli": {
    "enginePath": "D:\\workspace\\engines\\cocos\\3.8.6"
  }
}
```

同一轮日志还出现两类重复：

```text
[runtime-preview] server:listening=http://127.0.0.1:19530
...
[runtime-preview] active-output:
...
[runtime-preview] server:listening http://127.0.0.1:19530
```

问题目标是修通 runtime preview 核心启动链路：生产预览必须解析项目配置中的 engine root，测试 env override 只能在明确匹配测试 project root 时生效，启动日志必须能看出 engine root 来源且不重复输出关键 listening 行。

## 源码事实

修复前 `src/core/launcher.ts` 的 `Launcher.getEngineRoot()` 逻辑是：

```ts
private getEngineRoot() {
    const testEngineRoot = process.env.COCOS_CLI_TEST_ENGINE_ROOT;
    const testProjectRoot = process.env.COCOS_CLI_TEST_PROJECT_ROOT;
    if (testEngineRoot && testProjectRoot && resolve(this.projectPath) === resolve(testProjectRoot)) {
        return testEngineRoot;
    }
    return GlobalPaths.enginePath;
}
```

`src/global.ts` 中 `GlobalPaths.enginePath` 的默认值是：

```ts
enginePath: join(__dirname, '..', 'packages', 'engine')
```

因此修复前 production path 是明确的二元事实：

- 如果 `COCOS_CLI_TEST_ENGINE_ROOT` 和 `COCOS_CLI_TEST_PROJECT_ROOT` 同时存在，且 `projectRoot` 匹配，使用 test env engine root。
- 否则使用 CLI 仓库内置 `packages/engine`。

这条 production path 没有读取项目 `package.json["cocos-cli"].enginePath`，也没有在日志中标记 engine root 来源。

启动日志重复的源码事实：

- `src/runtime-preview/server/runtime-preview-server.ts` 生成 `startupLogLines`，包含 `projectRoot`、`engineRoot`、`projectLibraryRoot` 等。
- `src/core/launcher.ts` 再把 `server.startupLogLines` 输出到 console。
- `src/core/launcher.ts` 随后调用 `emitRuntimePreviewSummary()` 输出 `active-output`，内容与 `startupLogLines` 高度重复。
- `server:listening` 同时存在 `server:listening=<url>` 和 `server:listening <url>` 两种 console 可见格式。
- `NewConsole.record()` 会包装 `console.log()`；runtime-preview 事件如果继续走 wrapped console，会在 stdout 中产生重复可见行。

## 线程和提交审计事实

本问题不能表述为“恢复某个已被确认的实现”。线程和 git 审计结果如下：

- `getEngineRoot()` 首次引入于 commit `c1ae2f7 test(runtime-preview): diagnose real cli settings blockers`。
- 该提交把 `initEngine()`、`scripting.initialize()`、`startupScene()`、`startRuntimePreview()` 的 engine root 调用收敛到 `getEngineRoot()`。
- 该提交可确认的意图是：只有 test project root 匹配时才允许 `COCOS_CLI_TEST_ENGINE_ROOT` 覆盖，降低 env 泄漏影响普通 production 命令的风险。
- 没有找到线程或设计文档要求 production path 固定 fallback 到 `GlobalPaths.enginePath` / CLI 内置 `packages/engine`。
- AGENTS 和当前事实约束已明确：正常运行时，engine source 应从项目配置和 CLI 初始化链路解析；测试或专项验证可用 `COCOS_CLI_TEST_ENGINE_ROOT` 覆盖。

准确表述是：

> 当前 `Launcher.getEngineRoot()` 的 production 分支缺少项目配置 / CLI 初始化链路解析，只留下 `GlobalPaths.enginePath` fallback。这个缺口被显式 engine root 的测试和诊断命令覆盖了。

直接原因：

- focused tests、small project 验证、`diagnose:feature-c` 都显式传入或设置了 engine root，绕过了 production no-env path。
- 没有 regression test 强制验证“无 test env 时必须从项目配置解析 engine root”。
- 之前回答中使用了“恢复”这类缺少证据的措辞，把“补齐 production resolver 缺口”错误表达为“已有实现被恢复/未恢复”。

## 修复规则

1. `COCOS_CLI_TEST_ENGINE_ROOT` 仅在 `COCOS_CLI_TEST_PROJECT_ROOT` 同时存在且与当前 `projectRoot` 匹配时生效。
2. production 优先读取项目 `package.json["cocos-cli"].enginePath`。
3. 项目配置缺失时，可使用 CLI 初始化链路已提供的 engine root。
4. `GlobalPaths.enginePath` 只能作为最后 fallback，并输出 warning。
5. 日志必须输出 `engineRootSource`，取值限定为 `test-env`、`project-config`、`cli-initialized`、`global-fallback`。
6. console 可见的 `server:listening` 只保留一条，统一使用 `server:listening <url>`。
7. server 内部 `startupLogLines` 继续用于 file log 和结构化返回；Launcher 可把同一组 `startupLogLines` 输出到 console 一次，但不能通过 runtime preview event 再写入 file log。

## 执行记录

已实施：

- 新增 `src/core/launcher-engine-root.ts`，提供 `resolveLauncherEngineRoot(projectPath, options)`。
- `Launcher` 缓存单次 engine root 解析结果，并把同一结果传给 `initEngine()`、`scripting.initialize()`、`startupScene()`、`startRuntimePreviewServer()` 和 `resolveRuntimePreviewInternalLibraryRoot()`。
- `resolveLauncherEngineRoot()` 支持 `cliInitializedEngineRoot` 参数；当前源码搜索没有发现 Launcher 可直接取得的上游 initialized engine root 字段，因此本次 `feature-c` 修复实际依赖项目 `package.json["cocos-cli"].enginePath`。无项目配置的生产初始化链路仍只能进入 `global-fallback`。
- `startRuntimePreviewServer()` 接收并记录 `engineRootSource`，`/__runtime-preview/health` 返回同一字段。
- Launcher 恢复对 `server.startupLogLines` 的兼容性 console 输出，但只输出一次，且不通过 runtime preview event 写入 file log。
- `server:listening` 统一为空格格式 `server:listening <url>`；server file log 写一次，Launcher console 输出同一条，不再额外发第二条 listening event。
- runtime-preview event 输出改为优先使用 `console.__rawConsole`，避免 `NewConsole.record()` 造成用户可见重复行；event file log 仍通过 runtime preview logger 写入。
- 新增 `vitests/suites/runtime-preview/launcher-engine-root.test.ts` 覆盖：
  - production no-env 使用 `package.json["cocos-cli"].enginePath`。
  - test env 仅在 test project root 匹配时生效。
  - 项目 package config 缺失时使用 `cliInitializedEngineRoot`。
- 更新 `vitests/suites/runtime-preview/cli-startup.test.ts`，断言 startup log、health JSON 和 file log 都包含 `engineRootSource`，并断言 file log 中 `server:listening` 只出现一次。
- 更新 `vitests/suites/runtime-preview/launcher-runtime-preview.test.ts`，断言 `server:listening` 只出现一次，断言 `engineRootSource: test-env`，并新增子进程回归测试覆盖 Launcher 无 test env 时从项目 `package.json["cocos-cli"].enginePath` 解析 `project-config`。

已验证：

```bat
npm --prefix vitests test -- suites/runtime-preview/launcher-engine-root.test.ts suites/runtime-preview/cli-startup.test.ts suites/runtime-preview/launcher-runtime-preview.test.ts
```

结果：3 个 test files 通过，10 个 tests 通过。

review 后重新验证：

```bat
npm --prefix vitests test -- suites/runtime-preview/launcher-engine-root.test.ts suites/runtime-preview/cli-startup.test.ts suites/runtime-preview/launcher-runtime-preview.test.ts
```

结果：3 个 test files 通过，11 个 tests 通过。

```bat
npm run build
```

结果：通过。构建输出包含既有 circular dependency warning，未阻塞构建。

```bat
npm --prefix vitests test -- suites/runtime-preview/cli-generated-output-integration.test.ts
npm --prefix vitests test -- suites/runtime-preview/small-project-cli-integration.test.ts
```

结果：两个 CLI 集成测试单独运行均通过。不要并行运行这两个测试；它们会同时操作同一个 project 的 programming/packer lock，可能产生与本修复无关的 lock contention。

## 剩余验收

仍需要用户在 `feature-c` 上手动运行真实命令验收：

- 日志中的 `engineRoot` 应为 `D:\workspace\engines\cocos\3.8.6`，除非项目配置被改成其他值。
- 日志中的 `engineRootSource` 应为 `project-config`。
- console 可见的 `server:listening` 只应出现一次。
- 不应再出现 `engineRoot=E:\own_space\engines\cocos-cli\packages\engine`，除非进入 `global-fallback` 且伴随 warning。

剩余风险：

- `cli-initialized` 目前是 resolver API 支持项，不是 Launcher 已接线事实。后续如果确认 CLI 初始化链路中存在独立 engine root 来源，应把该来源显式传入 `resolveLauncherEngineRoot()`，并增加对应集成测试。
