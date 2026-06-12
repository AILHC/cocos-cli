# Runtime Preview 文档入口

本文档目录是 runtime preview 的当前入口。新增 runtime preview 文档应优先放入本目录下的模块目录，不再继续平铺到 `docs/dev/runtime-preview-*.md`。

## 当前结论

- 当前目标是让 production `preview --runtime` 的核心预览流程跑通。
- `D:\ps_copy\p6\trunk\Project\GameClient\feature-c` 已重新纳入核心流程专项验证。
- 2026-06-11 最新 `diagnose:feature-c` 证据显示 core route / script / scene-ready 主链路已通过 strict acceptance：`readyTimedOut=false`、`pageErrors=0`、`failedRequests=0`、`badResponses=0`、`console.error=0`。
- `settings.engine.builtinAssets` 必须包含 internal physics default material `ba21476f-2866-4f81-9c4d-6e359316e448`；该资源不能只挂到 `main` / `start-scene` launch bundle。
- production `preview --runtime` 的 `engineRoot` 解析和启动日志重复问题已按当前计划修复：项目配置 `cocos-cli.enginePath` 可作为 `project-config` 来源，`server:listening` 只输出一次。修复记录见 [plans/engine-root-and-startup-log-fix-20260611.md](plans/engine-root-and-startup-log-fix-20260611.md)。
- 2026-06-11 `internal` AssetDB / runtime preview 应优先使用项目级 `library`；engine-level `editor/library` 中部分 internal Texture2D 为 `content:null`，会触发 `Texture2D._deserialize` 读取 `content.base` 报错。见 [facts/project-internal-library-20260611.md](facts/project-internal-library-20260611.md)。
- 浏览器脚本加载顺序当前只记录事实，不执行并发化修改；HTTP file response 已迁移到 Express `sendFile()` validator 路径，body response 不新增 Express `ETag` / conditional `304`。见 [facts/browser-loading-and-cache-20260611.md](facts/browser-loading-and-cache-20260611.md)。
- `assets/**/*.meta` 默认不应被 runtime preview 改写仍是后续专项；本轮核心流程整理不回滚、不归因现有 feature-c `.meta` 修改。

## 必读顺序

1. [issues.md](issues.md)：当前反馈问题、状态、事实入口、计划入口和验收入口。
2. [acceptance/matrix.md](acceptance/matrix.md)：当前验收矩阵。
3. [facts/architecture.md](facts/architecture.md)：当前事实、已否定假设和 2026-06-11 裁决。
4. [design/core-flow.md](design/core-flow.md)：核心流程目标、边界、route 规则、script loading 和 strict acceptance。注意：该文件当前存在编码损坏，读取时必须和 `issues.md`、`facts/`、`plans/` 中的最新裁决交叉确认。
5. [plans/core-flow-implementation-20260610.md](plans/core-flow-implementation-20260610.md)：本轮执行计划和执行记录。
6. [plans/engine-root-and-startup-log-fix-20260611.md](plans/engine-root-and-startup-log-fix-20260611.md)：production engine root 解析退化和启动日志重复的修复计划。
7. [facts/project-internal-library-20260611.md](facts/project-internal-library-20260611.md)：项目级 internal library 事实、缓存干扰和最小修复边界。
8. [acceptance/feedback-20260609.md](acceptance/feedback-20260609.md)：历史反馈闭环长文；新问题状态以 [issues.md](issues.md) 为索引。

## 模块说明

| 目录 | 用途 |
| --- | --- |
| `facts/` | 事实、源码约束、真实产物观察、当前裁决。 |
| `design/` | 当前或曾经批准的设计文档。 |
| `plans/` | 可执行计划、执行记录和阶段性 implementation notes。 |
| `acceptance/` | 验收矩阵、验收反馈和 evidence 摘要。 |
| `handoff/` | 交接记录和新会话启动信息。 |
| `archive/` | 历史审查、旧边界、旧执行计划和专项记录；不代表当前裁决，除非当前事实文档显式引用。 |

## 记录规范

- 反馈问题、待修事项和后续专项必须先进入 [issues.md](issues.md)，并分配 `RP-ISSUE-xxx`。
- `facts/` 只记录源码、真实产物、日志、可重复验证结果和由这些事实推出的裁决。
- `plans/` 只记录执行方案、执行记录、验证命令和阶段性 implementation notes；计划完成后必须回填 [issues.md](issues.md)。
- `acceptance/matrix.md` 只记录验收项、通过条件、证据和状态；不要把长篇问题历史写进 matrix。
- `acceptance/feedback-20260609.md` 保留历史反馈闭环细节；新增反馈不再直接追加到该文件，除非需要扩展原有验收证据。
- `archive/` 是历史参考，不作为当前实现依据；只有被 [issues.md](issues.md) 或 `facts/` 显式引用时才参与当前判断。

## 当前核心规则

- Library resolver 只消费 `RuntimePreviewContext` 显式传入的 roots：`projectLibraryRoot`、`extensionLibraryRoots[]`、`internalLibraryRoot`。
- `/assets/<namespace>/(import|native)/<tail>` 中的 `<namespace>` 是 HTTP namespace，不是 physical library directory。
- `preview-app` 在 `cc.game.init()` 后只导入 Cocos packer-driver 生成的 `cce:/internal/x/prerequisite-imports`，不按 scene 计算脚本依赖，不直接枚举加载所有 scope chunks。
- platform-only CommonJS bare specifier 缺失由 packer-driver / QuickPack resolver 层 fallback 处理：只对 `moduleType === 'commonjs'` 且 `isBareSpecifier(specifier) === true` 的 resolver 失败生成 `data:` meta module，并写入 `resolution-detail-map.json`；不维护 runtime preview package allow-list，不提供 `--script-stub`。
- runtime preview 默认遵循 CLI / PackerDriver / QuickPack 原有缓存与失效策略，不因开发机旧路径、旧 `engineRoot`、旧 `projectRoot` 或旧 resolver record 残留而默认清理编译缓存。此类缓存污染属于开发/迁移特殊情况，只能通过显式参数或人工诊断处理。
- 测试不得把 fixture 污染、历史缓存污染或本机路径迁移包装成 production 默认语义；需要清理缓存的测试必须显式 opt-in，并断言该 opt-in 行为。
- `diagnose:feature-c` 是 fail gate：`readyTimedOut`、`pageErrors`、`unhandledRejections`、同源 `failedRequests`、同源 `badResponses`、`console.error` 任一非空都必须失败。

## 路径迁移

历史 `docs/dev/runtime-preview-*.md` 已按模块迁移到本目录。若旧文档或脚本仍引用旧路径，应改为本目录下的新路径。
