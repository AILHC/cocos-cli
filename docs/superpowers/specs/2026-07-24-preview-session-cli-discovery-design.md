# Preview Session CLI 自动发现与连接 — 正式 Spec

定稿时间:2026-07-24(经两路对抗式审查后第二波修订)。对应台账:`docs/dev/runtime-preview/issues.md` 的 `RP-ISSUE-040`。
本 spec 由 wayfinder 地图 `.scratch/preview-session-cli-discovery/map.md` 的 18 张 ticket 裁决定稿;本文件为定稿的归档副本,工作区原件(含 map、`issues/01`-`issues/18` 的 `## Answer`、对抗式审查报告 `review-20260724.md` / `review-20260724-kimi.md` / `review-impl-20260724.md`)位于 `.scratch/preview-session-cli-discovery/`。

## Problem Statement

统一 Runtime Preview editing session(RP-ISSUE-036)已让 Runtime Preview、Scene Editor 和 MCP 在一个 CLI 进程内共享 server、AssetDB、scripting、builder、attached RPC 和唯一 `sceneWorker`。但 session 仍只能通过启动日志中的 URL 被外部客户端发现,普通 CLI 命令不能在项目目录中自动连接正在运行的 Preview。

同一项目还可被多个独立 CLI 进程重复启动 Preview:HTTP server 端口被占用后自动递增,第二个进程表面上启动成功,但每个进程初始化自己的 AssetDB、scripting 和 scene worker,并发读写同一项目的 `library`、`temp/cli`、source asset、`.meta` 和 scene 文件。当前没有跨进程 project ownership,AssetDB 内部锁只在单进程内生效。

用户希望 Preview 成为项目唯一的 writable backend:CLI 在 Cocos 项目目录或任意子目录执行时,自动找到该项目已启动的 Preview 并执行操作;AI agent 需要稳定、可发现、结构化的命令接口,而不是解析启动日志或反复提供 URL。

## Solution

每个 Cocos 项目使用 CLI-owned `temp/cli` 下的 **lock dir + descriptor 分离结构**承担跨进程 ownership 与 session 描述:`mkdir` 原子创建的 owner 目录(目录名含 sessionId 与 pid)是不可变 claim;目录内的 descriptor 文件以 tmp+rename 原子发布 session 状态。

`cocos preview`(含 legacy `--build`)在 command 层参数验证后、构造 `Launcher` 之前 `mkdir` 获取 ownership——早于任何项目写入(server、AssetDB、scripting、builder、sceneWorker、日志)。获取失败者读 claim 内 descriptor 走验活:live-compatible 时按第二次 preview 行为处理;stale 时经死亡确认后回收接管。

统一 server 新增一个只读 identity endpoint(`GET /__cocos-cli/session`),用于验活与项目身份确认。CLI 的命令通道**不新增 command endpoint**:agent 入口命令(`cocos session` 命令组)作为标准 MCP client 直连统一 server 已有的 `/mcp` endpoint,与 MCP 走完全相同的执行路径;server 端零改动。

项目内 CLI 从 cwd 向上解析 project root,读取 descriptor,经 identity endpoint 验证(session ID + canonical project root + protocol version)后连接;`--project` 显式指定项目走同一发现流程,`--url` 显式指定 endpoint,二者互斥。CLI 找不到 live session 时报可执行错误,不隐式启动后台 Preview。

目标 session 形态:带 `--watch-assets` 启动的统一 editing session(用户约束,2026-07-24)。

## User Stories

1. 作为 Cocos 项目开发者,我希望在项目目录执行 CLI scene/asset 命令时自动连接正在运行的 Preview,从而不需要复制 URL。
2. 作为 Cocos 项目开发者,我希望在项目任意子目录执行 CLI 命令时仍能解析到同一个 project root 和 Preview session。
3. 作为 Cocos 项目开发者,我希望同一项目只能有一个 writable Preview owner,从而避免多个 AssetDB 和 scene worker 并发写项目。
4. 作为 Cocos 项目开发者,我希望第二次执行 `cocos preview` 时看到已有 session 的明确 URL,而不是静默启动到另一个端口。
5. 作为 Cocos 项目开发者,我希望第二次执行 `cocos preview` 不产生第二个 scene process,从而避免独立 scene 内存状态互相覆盖。
6. 作为 Cocos 项目开发者,我希望不同项目仍可同时启动各自的 Preview,从而不引入全局单实例限制。
7. 作为 Cocos 项目开发者,我希望 Preview 崩溃后残留的 claim 能被识别和安全恢复,从而不需要手工删除 lock。
8. 作为 Cocos 项目开发者,我希望 PID 被操作系统复用时仍通过 session identity endpoint 识别 descriptor 是否真实有效。
9. 作为 Cocos 项目开发者,我希望 Preview 正常退出时在关闭流程一开始就释放 claim,从而后续可以立即重新启动。
10. 作为 Cocos 项目开发者,我希望旧 Preview 的迟到 cleanup 不会删除新 Preview 的 claim。
11. 作为 CLI 用户,我希望没有运行中 Preview 时收到含恢复路径的可执行错误提示,从而知道应先运行 `cocos preview`。
12. 作为 CLI 用户,我希望 CLI 找不到 session 时不要偷偷启动后台进程,从而保持进程 ownership 明确。
13. 作为 CLI 用户,我希望在项目外可以通过 `--project` 选择项目并自动发现其 Preview。
14. 作为 CLI 用户,我希望在项目外或诊断场景可以通过 `--url` 显式连接 endpoint。
15. 作为 CLI 用户,我希望显式 URL 仍经过协议版本与服务身份验证,从而避免连接到错误服务。
16. 作为 CLI 用户,我希望 session 命令的输出告诉我当前作用于哪个项目(canonical project identity)。
17. 作为 CLI 用户,我希望 scene open、query、update 和 save 最终进入 Preview owner 的唯一 attached RPC。
18. 作为 CLI 用户,我希望 CLI 保存 scene 后 Scene Editor、MCP 和 Runtime Preview 能读取同一结果。
19. 作为 CLI 用户,我希望命令失败(含业务 4xx)产生稳定的非零 exit code,而不是只打印日志后返回成功。
20. 作为 CLI 用户,我希望机器可读结果只写 stdout,诊断信息写 stderr,从而脚本可以可靠解析 JSON。
21. 作为 AI agent 用户,我希望 `cocos session list` 列出当前 session 支持的全部 command,从而无需把能力清单硬编码到 prompt。
22. 作为 AI agent 用户,我希望 `cocos session describe <name>` 查询单个 command 的输入输出 schema,从而在调用前构造合法参数。
23. 作为 AI agent 用户,我希望 `cocos session call` 一个通用入口覆盖 MCP 已公开的全部能力,从而不需要等待每个能力都有手写 CLI wrapper。
24. 作为 AI agent 用户,我希望 `cocos session info` 返回 session 身份与状态,从而确认连接的是目标项目的 live session。
25. 作为 MCP 用户,我希望新增 CLI 入口不改变现有 MCP tool 名称、schema 和行为。
26. 作为 Scene Editor 用户,我希望新增 CLI 入口不改变浏览器到主进程的现有内部 Web RPC。
27. 作为 Runtime Preview 用户,我希望 CLI 触发的 scene save 继续进入现有 AssetDB save 和 Runtime Preview refresh 协调链路。
28. 作为项目维护者,我希望 ownership claim 与可更新的 descriptor 是分离对象,从而锁的原子性不被状态更新破坏。
29. 作为项目维护者,我希望 claim 位于 CLI-owned runtime output,而不是项目根目录顶层,从而避免被误提交。
30. 作为项目维护者,我希望 `cocos session` discovery 有且只有一种 Cocos 项目识别逻辑,从而不产生第二种识别规则。
31. 作为项目维护者,我希望 CLI 入口与 MCP 复用同一条命令执行路径(直连 `/mcp`),从而避免两套参数校验和业务调用逻辑漂移。
32. 作为项目维护者,我希望 CLI 可调用的 command 集合就是已注册 tool 集合,从而不把内部任意 RPC 方法变成远程 API。
33. 作为项目维护者,我希望 session ownership 在任何项目写入(含日志)之前确定,从而第二个进程不会先写产物再发现冲突。
34. 作为项目维护者,我希望实现只处理本机 loopback session,从而不引入远程认证、分布式锁或网络文件系统语义。
35. 作为测试维护者,我希望通过真实 CLI child process(含真双进程并发)验证 discovery、command 和 lifecycle,从而不把纯 route contract 当作完整验收。
36. 作为测试维护者,我希望主测试项目验收使用隔离副本,从而不修改原项目的 source、`.meta`、`library` 或 `temp`。

## Implementation Decisions

### Ownership claim 与 descriptor(05、13、15、17、18)

- 一个 canonical project root 对应一个 writable Preview owner;不同项目各自拥有 session,不引入全局单实例。
- **claim = `temp/cli/` 下 `mkdir` 原子创建的 owner 目录**(如 `preview-session-<sessionId>-<pid>/`):`mkdir` 成功即 ownership 成立,目录名自带 sessionId+pid,不存在「半个 claim」;acquire 前确保 `temp/cli` 存在(`mkdir -p`)。claim 是 `mkdir` 的唯一仲裁点,也是多进程 race 的唯一仲裁点。
- **descriptor = claim 目录内文件**,字段:`sessionId`、`projectRoot`(canonical,realpath 归一)、`pid`、`state`(`starting`|`ready`|`draining`)、`protocolVersion`(整数常量)、`serverUrl`、`startedAt`(纯诊断);`mcpUrl` 不单独存储,由 `serverUrl` + 固定 `/mcp` 路径推导。descriptor 不含秘密,默认文件权限。
- 初始发布:`starting` 态,`serverUrl` 缺席;全部能力 ready 后经 tmp+rename 原子更新补 `serverUrl` 并切 `ready`;close 开始原子切 `draining`(若 descriptor 仍存在)并立即释放 claim。tmp 文件崩溃残留由下次 acquire 清理。
- **acquire 的代码接缝**:command 层参数验证/canonicalization 之后、`new Launcher` 之前(Launcher 构造函数会写 `<project>/temp/logs`,ownership 必须早于任何项目写入);acquire 后立即安装覆盖 `starting` 窗口的 signal/finally 保护。
- 运行中 `temp` 被外部删除视为显式破坏行为,接受为已知边界(不周期校验、不重建、不打 warn——无可行触发点,仅作事实陈述)。

### 验活与 stale 回收(16)

- **liveness 分级**:`live-compatible`(endpoint 可达且 sessionId + canonical projectRoot + protocolVersion 三重一致)/ `live-incompatible`(descriptor 或 identity 的 protocolVersion 与本地不符,验活先比 descriptor 版本)/ `starting`(PID 活且 state=starting,不设超时)/ `unreachable-owner-alive`(PID 活、ready、endpoint 不可达)/ `confirmed-dead`(PID 死)/ `invalid`(PID 死的损坏/垃圾 claim,或 identity 证明非本 session)/ `invalid-owner-alive`(descriptor 损坏或身份不匹配但 PID 活)。
- **回收路径**:`confirmed-dead` 与 `invalid` → 直接回收 claim(`invalid` 不 SIGTERM——对端已证明不是本 session);`invalid-owner-alive` → **永不回收、不 SIGTERM、不接管**,报「claim 损坏且 PID x 仍存活,请人工处理」fail closed(20);`unreachable-owner-alive` → SIGTERM(Windows 优先终止进程树)后**轮询 `process.kill(pid, 0)` 确认死亡**,确认后才删 claim 并 exclusive retry `mkdir`(仅一次);超时 → fail closed,报错请用户人工处理,不接管。
- **平台语义写明**:Windows 上 SIGTERM 是硬杀(不触发 handler),回收时优先终止整个进程树(scene 子进程不成孤儿,实现期验证);POSIX 走优雅关闭,死亡确认等待相应更长。
- **`live-incompatible` 永不进回收**:一律报「版本不匹配,请重启 Preview」,不 SIGTERM、不删 claim。CLI 升级后对存量旧 Preview 硬失败是预期场景。
- 回收重读 descriptor 时重新执行完整 liveness probe;窗口内恢复健康的 owner 不被误杀。

### 第二次 cocos preview(06、17)

- 发现 `live-compatible` 且 `ready`:stdout 打印已有 session URL 与项目信息,按当前 preview 默认 open 行为打开页面,exit 0;`starting`:报「session 正在启动(PID x)」,非零退出,不开页。
- 参数与运行中 session 不同时,忽略差异,stderr warn 列出未生效参数,仍按上述分支处理。
- live loser 在 command 层处理完即 return,不进入 `stdin.resume()` 保活路径。
- legacy `--build` 是 **blocking-only owner**(19):与 runtime 共享同一 ownership 获取与发现流程,发现 live session 时同样不起第二套 backend;它不是 editing session(无 sceneWorker/MCP),不承担被 `cocos session` 驱动的义务,但为验活闭环同样挂 identity endpoint 并在 server ready 后 publishReady;`cocos session` 对其报「该 session 不是 editing session」。

### CLI 自动发现(07、18)

- 自动发现只服务新增的 `cocos session` 命令组(及未来 alias);`build`/`make`/`run`/`upload`/`compile-engine`/`preview` 语义不变。向上解析模块是 `cocos session` discovery 的唯一 project resolver(不宣称全 CLI 已统一)。
- project root 解析:从 cwd 逐级向上取最近的、同时含 `package.json` + `assets/` + `settings/` 的目录;跳过 `node_modules`;上界为文件系统根;找不到报明确错误并提示 `--project`/`--url`;结果经 realpath 归一为 canonical project root。已知边界:嵌套于 `node_modules` 的项目不可达;`assets/` 下恰好三标志齐全的子目录可能截胡。
- `--project` 与 `--url` 互斥,同时给出立即报错;只给 `--project` 走同一自动发现;只给 `--url` 直连该 endpoint,验证强度为 protocolVersion + 对端确为 cocos-cli(无 descriptor 可比对)。
- 异常路径:session `starting` → 报「session 正在启动(PID x),稍后重试」非零退出;identity/协议版本失败 → 明确错误非零退出;错误文案带 PID 与恢复路径;CLI 不内置等待,重试策略交给调用方。

### Command 通道与 identity endpoint(08、14)

- command 通道 = CLI 作为标准 MCP client 直连 `/mcp`(initialize 握手 + `tools/list` + `tools/call`);server 端零改动,不新建 command endpoint,不抽取 executor;allowlist 天然 = `toolRegistry` 当前生效集合(68 个 tool),不开放任意 module/method 反射。
- 新只读 identity endpoint `GET /__cocos-cli/session`,返回 `{sessionId, projectRoot, state, protocolVersion, serverUrl, mcpUrl, startedAt}`;不动现有 `/__runtime-preview/health` 的 readiness 语义;能力发现走 `tools/list`,不放 capabilities。
- 协议版本:descriptor 与 identity endpoint 带整数 `protocolVersion` 常量,CLI 与 server 同包发布;不匹配 → 明确错误提示重启 Preview,不协商;`/mcp` 通道协议版本由 MCP SDK initialize 握手处理。
- 写命令与 watcher 去重:CLI 经 `/mcp` 与 MCP 完全同路径,scene save 走 `RuntimeAssetSaveCoordinator` 既有去重,不新增机制;主进程 asset 写入若产生多余 dirty refresh 按缺陷处理。
- **安全边界(知情接受,经审查更正)**:server 现状对全部响应返回 `Access-Control-Allow-Origin: *` 且 preflight 204(`src/server/utils/cors.ts`,全局挂载),socket.io 同为通配——**Preview 运行期间,用户访问的任意网页均可跨域调用本机 session 全部 tool(含写操作)并读回响应**。本 effort 知情接受该现状:不加 token、不加 Origin/Host 校验;绑 `127.0.0.1` 仅限制非本机来源。加固候选记入 Out of Scope。

### Agent 入口(10、18)

- 新命令组 `cocos session`:`info`(identity)、`list`、`describe <name>`、`call <name> --input <json>`(`--input` 支持 `@file` 或 stdin);均配 `--project`/`--url`。
- stdout 只输出单个 JSON 对象:成功 `{ok:true, session:{sessionId, projectRoot, serverUrl}, result|commands|command}`;失败 `{ok:false, session?, error:{code, reason, data?}}`;每个响应带 session 摘要;诊断/进度写 stderr。
- **错误归一化表**:CLI 解包 `structuredContent.result`,`CommonResult.code >= 400` → `{ok:false}` + 非零 exit(MCP `isError` 仅 5xx 置位,不能单独依赖);identity HTTP 错误、initialize 失败、unknown tool、Zod 参数错误、tool 4xx/5xx、transport 500/非 JSON 响应各有明确的 envelope/exit code 映射,全部写入命令 help。
- **成本写明**:`describe` = initialize + 全量 `tools/list` + client 过滤(MCP 无单 tool describe);每次 CLI invocation 独立握手;接受该成本,timeout/close 行为由实现定义并写入 help。
- scene alias(如 `cocos scene open`)首轮不做(见 Out of Scope)。

### 生命周期(11、17、18)

- 状态机三态:`starting` / `ready` / `draining`。
- **releaseOwnership 在 close 开始即执行**:先删除 descriptor 并 `rmdir` claim(验活立即落空),再走相位化 close;关闭窗口内新 `cocos preview` 发现无 claim 直接启动新 session(旧端口未放则自动递增),`cocos session` 报「无运行中 session」。旧 owner 迟到 cleanup 因 sessionId 不匹配不动后继 claim(`rmdir` 只删空目录提供第二重保护)。
- 启动失败回滚同一规则:catch 路径先释放 claim,再清理已初始化资源。

## Testing Decisions

三层映射(好测试 = 只测外部行为;事实基座见 `issues/04-research-testing-seams.md`),经第二波补强:

- **Jest 单元**(分支覆盖):ownership 状态机(liveness 各级、死亡确认、invalid、回收竞争)、cwd 向上解析与 canonicalization、claim/descriptor 读写与原子发布、错误归一化映射。临时目录 + fake fs/process table,不启动真实进程;关键 interleaving 用可注入 barrier 做确定性并发。
- **Vitest 真实 CLI child process 集成**(接线验证):`cocos session` list/describe/call/info 的 JSON 契约与 exit code(含错误 matrix);**真双进程并发启动竞争 claim**(第二进程不产生第二个 scene PID);stale recovery 端到端(**SIGTERM 而非 SIGKILL**,含死亡确认);**draining 窗口验活**(close 中启动新 preview);lifecycle 后 claim/端口/scene 进程释放;不同项目并行;CORS 通配现状的契约测试(守护安全现状的知情接受)。seam 复用 `vitests/shared/runtime-preview-cli-process.ts`;先例 `unified-session-cli-integration.test.ts`。
- **主测试项目隔离副本跨表面验收**(抽样):一个代表性 scene(选择标准:含常用节点类型、能驱动四个表面;具体 scene 实现期定),CLI `session call` 修改并保存 → MCP query → Scene Editor 读取 → Runtime Preview readback 同一结果;覆盖 `RP-ISSUE-040` 台账验收项。
- **隔离副本**:集成层用小 fixture `mkdtemp` 副本(排除 `library`/`temp`、改写 `cocos-cli.enginePath`,多项目并行造两份);跨表面验收用主测试项目仓库外隔离副本(沿用 `resetProject()` 做法),源项目零写入。
- **MCP 兼容**:server 端零改动,现有 MCP 测试保持绿;另加 CLI client contract matrix(上述集成层)。
- **273 scene sweep 不重跑**:scene loader、runtime route、资源解析不在改动面;server 端唯一新增是只读 identity endpoint。
- 环境变量边界、构建要求(先 `npm run compile` 再跑 dist CLI)遵循 `docs/dev/testing-spec.md` 与 `docs/dev/runtime-preview/testing-spec.md`;Windows 平台语义(信号、进程树)需在 Windows 真实验证。

## Out of Scope

- 同一项目同时运行多个 writable Preview backend;隔离 `library`/`temp` 支持多 writer。
- 用户级或系统级 session registry;常驻 daemon、后台自动启动 Preview、跨机器 session discovery。
- 分布式锁、网络文件系统 lock、多主协调。
- 远程网络鉴权、TLS、权限角色、多用户协作;**本机安全加固**(Origin/Host allowlist、收紧 CORS、descriptor token + 0600)——经审查确认现状暴露(任意网页可驱动本机 session)后用户知情接受,如未来需要加固另起 effort。
- 共享浏览器 VM 或把浏览器对象暴露给 CLI;内部任意 RPC module/method 直接开放为 public HTTP API;重写 Scene Process IPC。
- 给人用的 scene alias(如 `cocos scene open/save`)——等 `cocos session` 真实使用反馈后另起 effort 设计。
- `mcp-server` 与运行中 Preview 并存的双写问题——本轮不动,如要处理另起 effort。
- 首轮手写全部 public command 的独立 CLI wrapper;改变已有 MCP tool 名称和输入输出 schema。
- 改变 `build`/`make`/`run`/`upload`/`compile-engine` 在没有 Preview session 时的现有语义;找不到 Preview 时自动启动后台 session。
- 因本需求重新执行完整 273 scene sweep。

## Further Notes

- 对应问题:`RP-ISSUE-040`;Triage:`ready-for-agent`。
- 本 spec 扩展 `RP-ISSUE-036` 已完成的单进程统一 session;不修改其「Runtime Preview、Scene Editor 和 MCP 共享 backend,但不共享浏览器 VM」的边界。
- 决策过程与事实依据:wayfinder 地图 `.scratch/preview-session-cli-discovery/map.md` 及 `issues/01`-`issues/18`(4 张 research 盘点 + 14 张 grilling 裁决,含 5 张审查驱动的第二波重裁)。
- 对抗式审查(2026-07-24):codex(`review-20260724.md`,13 条)与内部(`review-20260724-kimi.md`,21 条)两路独立审查,发现已全部 triage——接受并落实为 `issues/14`-`issues/18`;无驳回项,token 方案经评估后明确不采用(理由见 14)。
- 首轮实现 = 项目内 lock dir + descriptor、一个只读 identity endpoint、`cocos session` 命令组(MCP client),不引入 registry service、daemon、通用 service container 或新的 RPC protocol。
- 目标 session 形态为带 `--watch-assets` 的统一 editing session;设计与验收以该形态为准。
- 实现完成后,稳定结论按仓库文档政策回填 `docs/dev/modules/` 或 `docs/dev/architecture/`,台账 `RP-ISSUE-040` 状态同步更新。

## 验收结果(2026-07-24)

主测试项目隔离副本跨表面验收 **22/22 通过**(`vitests/scripts/preview-session-cli-acceptance.ts`;evidence:`E:\own_space\tmp\preview-session-cli-acceptance-20260724-r2\evidence\preview-session-cli-acceptance.json`,副本保留于同级 `project/`)。覆盖台账全部验收项:

- 项目子目录 CLI 自动发现(cwd 为 `assets/cases`,未传 `--project`/`--url`,经向上解析 + descriptor + identity endpoint);
- CLI `session call` scene mutation(重命名 + position)+ save → MCP query、Scene Editor、Runtime Preview、磁盘 scene 产物四面一致;
- 同项目第二次启动 exit 0、报告已有 session URL、不产生第二个 scene PID;全链路(CLI/MCP/双 browser 表面)单 scene PID;
- 不同项目并行、stale lock 恢复:见 `preview-session-ownership-cli-integration.test.ts`、`preview-session-multi-project-reclaim-cli-integration.test.ts`(R3,6 套件 28/28);
- 真实项目形态 stale recovery 复核:Windows SIGTERM 硬杀后 claim 按设计残留为 stale(平台语义,不触发 close handler),下次 preview 回收并接管(新 sessionId、单 claim、单 scene 进程)。

已知非阻断项:fresh import 下 Scene Editor/Runtime 页面 default_skybox TextureCube 反序列化 TypeError(engine 反序列化 + 已知 default_skybox 缺失,RP-ISSUE-036 台账已记录),与本改动面无关。
