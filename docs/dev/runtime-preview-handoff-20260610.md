# runtime preview 交接记录 2026-06-10

## 当前状态

- 当前仓库：`E:\own_space\engines\cocos-cli`
- 最新提交：`5823691 runtime-preview: add feature-c diagnostics checkpoint`
- 提交后工作区状态：仅 `AGENTS.md` 未跟踪。
- 已创建但被 `.gitignore` 忽略：`.codex/memories/code-exploration-guide.md`。

## 已完成

- 已提交 runtime preview 诊断检查点：
  - Playwright console/page/request 监听能力。
  - `feature-c` exact URL 诊断脚本。
  - runtime preview 启动/active output 日志增强。
  - `preview` target prerequisite imports 临时切到 dynamic import 策略。
  - 相关 Vitest 覆盖。
  - 验收反馈与 meta 副作用文档更新。
- 已新增 `AGENTS.md` 草案，作为仓库级地图。
- 已从 `E:\own_space\ai-workflow-lab\tool-adoptions\codegraph` 注入 CodeGraph 使用说明到 `.codex/memories/code-exploration-guide.md`。

## 重要文档

- `docs/dev/runtime-preview-acceptance-feedback-20260609.md`
  - 记录人工验收反馈、`feature-c` exact scene 问题、资源 URL / bundle 归属问题、native URL 白名单问题、meta 写入风险。
- `docs/dev/runtime-preview-cli-output-and-meta-side-effects-20260609.md`
  - 记录 CLI output 与 `.meta` 副作用边界。
- `docs/dev/runtime-preview-architecture-facts-20260606.md`
  - runtime preview 架构事实和 library / metadata / engine loading 相关事实。
- `docs/dev/runtime-preview-verification-traceability-plan-20260607.md`
  - 验证和可追溯计划。
- `docs/dev/runtime-preview-preview-app-route-inventory-20260608.md`
  - preview-app route inventory。

## 当前关键问题

### 1. Asset URL / bundle 归属不一致

复现 URL：

```text
http://localhost:19530/?scene=4c721bfe-0b6e-46c2-97f0-644adfdcba31
```

已确认事实：

- 当前服务的 `cce:/internal/x/prerequisite-imports` 已是 `System.register([], ...)` dynamic import，不是旧的 3242 静态依赖问题。
- 该 scene ready 后仍大量报错。
- 典型资源 `207a3957-d7e1-4fdb-8903-c63948195ada@f9941` 属于 `product/config.json`，`/assets/product/import/...` 可 200。
- 浏览器实际请求 `/assets/resources/import/...`，`resources/config.json` 不包含该 UUID，因此 404。

下一步：

- 基于 engine runtime / assetManager / bundle config 生成和解析逻辑，查为什么依赖落到 `resources`。
- 不要在 route 层硬编码 URL fallback；server 应根据 engine 请求与真实 library 产物建立最短映射。

### 2. Native URL 识别逻辑阻碍真实文件返回

已确认事实：

- `libraryRoot` 为 `F:\ps_copy\p6\trunk\Project\GameClient\feature-c\library\cli`。
- `8c1ebdc5-5bb8-48b2-a60f-e16fd6b0a624.manifest` 在 `library\cli\8c\` 下存在。
- 当前 `/assets/general/native/...manifest` 返回 404。
- 原因之一：`getUuidFromNativeTail()` 只识别 `.png` / `.jpg` / `.jpeg` 或路径中的独立 UUID segment。

下一步：

- 重新设计 `/assets/*/import/*`、`/assets/*/native/*` 的服务边界。
- 路径安全应通过 root containment 保证。
- UUID / metadata / bundle config 应主要用于诊断和溯源，不应阻断真实存在的 library 文件，除非 engine/source 事实明确要求。

### 3. `feature-c` source `.meta` 被改写风险

人工反馈：

```text
F:\ps_copy\p6\trunk\Project\GameClient\feature-c\assets\product\animation\a_bdmx_hit.anim.meta
files 中 .cconb 变成 .bin
```

当前已确认：

- 当前文件 `files` 为 `[ ".bin" ]`。
- 尚缺 before/after hash 或 diff，不能严谨断定某次 CLI runtime preview 运行造成。

下一步：

- 做受控 before/after 验证。
- 查 `animation-clip` importer / AssetDB import 流程中 `.cconb` / `.bin` 的决策来源。
- runtime preview 不应默认修改 `assets/**/*.meta`；`library/cli`、`temp/cli` 生成和 source `.meta` 写入必须分开统计。

### 4. Prerequisite imports 临时策略不是最终闭环

已提交变更：

- `src/core/scripting/packer-driver/target-policy.ts`
- `preview` target 现在使用 tentative prerequisite imports。

已知边界：

- 该修改能缓解大项目几千静态依赖导致的浏览器资源耗尽。
- 当前 tentative 语义会捕获单个 import 失败并继续，可能隐藏脚本加载失败。

下一步：

- 改为 strict bounded / sequential dynamic import：
  - 避免一次性暴露几千静态依赖。
  - 加载所有 prerequisite script。
  - 收集失败并在 preview ready 前抛出聚合错误。

## 常用命令

启动 feature-c runtime preview：

```bat
node E:\own_space\engines\cocos-cli\dist\cli.js preview --runtime --project F:\ps_copy\p6\trunk\Project\GameClient\feature-c --host 127.0.0.1 --port 19530
```

监听已有 preview URL：

```bat
set COCOS_CLI_LISTEN_PREVIEW_URL=http://localhost:19530/?scene=4c721bfe-0b6e-46c2-97f0-644adfdcba31
set COCOS_CLI_LISTEN_READY_TIMEOUT_MS=180000
set COCOS_CLI_LISTEN_STABLE_WINDOW_MS=60000
set COCOS_CLI_LISTEN_EVIDENCE=F:\ps_copy\p6\trunk\Project\GameClient\feature-c\temp\runtime-preview-exact-scene-4c721bfe-browser-evidence.json
npm --prefix E:\own_space\engines\cocos-cli\vitests run listen:preview-url
```

feature-c 诊断脚本：

```bat
set COCOS_CLI_FEATURE_C_ENGINE_ROOT=D:/workspace/engines/cocos/3.8.6
set COCOS_CLI_FEATURE_C_PROJECT_ROOT=F:/ps_copy/p6/trunk/Project/GameClient/feature-c
set COCOS_CLI_FEATURE_C_SCENE=4c721bfe-0b6e-46c2-97f0-644adfdcba31
set COCOS_CLI_FEATURE_C_STARTUP_TIMEOUT_MS=600000
set COCOS_CLI_FEATURE_C_READY_TIMEOUT_MS=300000
set COCOS_CLI_FEATURE_C_STABLE_WINDOW_MS=60000
npm --prefix E:\own_space\engines\cocos-cli\vitests run diagnose:feature-c
```

基础验证：

```bat
npm run build
set COCOS_CLI_TEST_PROJECT_ROOT=E:/own_space/cocos_work_lab_38x
set COCOS_CLI_TEST_ENGINE_ROOT=D:/workspace/engines/cocos/3.8.6
npm --prefix vitests test -- suites/runtime-preview/preview-prerequisite-imports-policy.test.ts
```

## 新会话起步建议

1. 先读 `AGENTS.md` 和本文件。
2. 再读 `runtime-preview-acceptance-feedback-20260609.md` 的 6.7、6.8。
3. 优先处理 asset URL / bundle 归属问题，不要先扩大 route fallback。
4. 修复前先确认 engine runtime 如何生成请求 URL，以及 CLI `bundleConfigs` / `.assets-data.json` / library flat layout 的对应关系。
5. 任何 source `.meta` 写入都必须有 before/after 证据。
