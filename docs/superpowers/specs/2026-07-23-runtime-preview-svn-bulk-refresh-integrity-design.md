# Runtime Preview SVN 批量刷新完整性门禁规格

日期：2026-07-23

关联问题：`RP-ISSUE-039`

Triage（分诊标签）：`ready-for-agent`

## 问题陈述

用户在长时间运行 runtime preview，并启用资源监听和页面重载刷新时，会执行 SVN 更新或合并。SVN 会在短时间内批量覆盖源文件及部分 `.meta`，但当前 runtime preview 把这些文件系统变化拆成多个相互独立的 dirty target（脏目标），逐个执行增量 AssetDB refresh（资源数据库刷新）。

当前 refresh 成功条件只覆盖各目标调用、脚本编译和 programming output（编程产物）检查，没有验证 AssetDB 在整轮批量更新后是否仍满足 Bundle/settings 所需的 UUID 查询不变量。因此，即使所有目标都报告成功，settings 构建仍可能取得无法解析的 UUID，并在 `Query Asset Bundle` 阶段因读取空 AssetInfo 的 `loadUrl` 而失败。

用户需要 runtime preview 正确处理 SVN 这类批量更新。系统不能把局部刷新调用成功误报为整体刷新成功，也不能把 AssetDB 不一致推迟到 settings 构建或浏览器加载阶段。

## 解决方案

在 dirty-set 增量刷新完成、脚本编译和 programming output 检查通过之后，settings cache invalidation（settings 缓存失效）之前，增加 AssetDB 完整性门禁。

完整性门禁验证当前 AssetDB 中参与 runtime preview Bundle/settings 生成的资源 UUID 均可通过正式查询入口解析。验证通过后，refresh 才能进入成功态并使 settings 缓存失效。

如果增量刷新后的首次验证失败，系统执行一次限定于项目 `db://assets` 的根刷新，然后重新等待脚本稳定、检查 programming output 并再次执行完整性验证。

如果根刷新后的第二次验证仍失败，本轮 refresh 必须返回结构化失败结果，保留最后一个可用 settings，不自动 reload，并输出失效 UUID、资源 URL、父资源和 Bundle 上下文。系统不得静默跳过资源，也不得继续生成部分 Bundle 配置。

Bundle/settings 生成层增加最终不变量断言。该断言只负责提供完整诊断，不负责恢复、跳过或重新刷新。

## 用户故事

1. 作为使用 runtime preview 的开发者，我希望 SVN 更新完成后页面可以正常重载，以便继续预览最新资源。
2. 作为使用 runtime preview 的开发者，我希望 SVN 合并涉及大量源文件和 `.meta` 时，系统能够把它识别为一次需要整体一致性的刷新过程。
3. 作为使用 runtime preview 的开发者，我希望单个文件的小修改仍使用快速增量刷新，以免每次编辑都触发昂贵的全库扫描。
4. 作为使用 runtime preview 的开发者，我希望只有实际检测到 AssetDB 不一致时才执行根刷新，以兼顾正确性和性能。
5. 作为使用 runtime preview 的开发者，我希望增量刷新后的 AssetDB 不一致不会继续进入 settings 构建。
6. 作为使用 runtime preview 的开发者，我希望根刷新能够自动修复可恢复的不一致，而不是要求手工重启 CLI。
7. 作为使用 runtime preview 的开发者，我希望不可恢复的不一致不会破坏最后一个可用 preview 页面。
8. 作为使用 runtime preview 的开发者，我希望刷新失败时页面不自动 reload，以免进入空白页或重复失败循环。
9. 作为使用 runtime preview 的开发者，我希望错误信息包含具体 UUID、资源 URL、父资源和 Bundle，以便定位相关 `.meta` 或 importer（导入器）。
10. 作为使用 runtime preview 的开发者，我希望系统明确区分“目标刷新调用成功”和“AssetDB 整体一致”。
11. 作为使用 runtime preview 的开发者，我希望刷新结果能说明是否执行过 integrity fallback（完整性回退）和根刷新。
12. 作为使用 runtime preview 的开发者，我希望根刷新仍只作用于项目 `assets` 数据库，不意外刷新 internal（内置）或 extension（扩展）数据库。
13. 作为使用 runtime preview 的开发者，我希望一次 refresh 最多自动执行一次根刷新，避免恢复逻辑形成无限循环。
14. 作为使用 runtime preview 的开发者，我希望刷新失败不会静默丢弃 Bundle 资源，以免错误推迟到运行时资源 404。
15. 作为维护 CLI 的开发者，我希望通过一个高层 refresh seam（刷新测试入口）验证增量刷新、完整性检查、根刷新和最终结果，而不是依赖多个内部实现测试。
16. 作为维护 CLI 的开发者，我希望完整性检查返回结构化诊断，以便日志、HTTP response（HTTP 响应）和浏览器提示复用同一事实。
17. 作为维护 CLI 的开发者，我希望正常增量刷新路径的额外成本可测量，并避免完整性检查退化为每次完整重建。
18. 作为维护 CLI 的开发者，我希望真实项目验收能区分短链路测试、临时 fixture（测试夹具）和 P6 SVN 批量更新现场。

## 实现决策

- refresh coordinator 是恢复策略的唯一所有者。Bundle、HTTP route（HTTP 路由）和 preview app 不各自实现重试或根刷新。
- 完整性门禁位于脚本编译与 programming output 检查通过之后、settings 和 import replacement cache（导入替换缓存）失效之前。
- 完整性检查使用 Builder 和 settings 实际依赖的 AssetDB 查询语义，不新增与生产查询行为不同的影子索引。
- 完整性检查返回结构化结果，至少包含是否有效、失效 UUID 数量、有限样本、资源 URL、父资源标识和数据库名称。
- 诊断样本必须有上限，完整计数必须保留，避免 SVN 大批量更新时输出无界日志。
- 首次完整性检查失败时，只允许自动执行一次项目 `db://assets` 根刷新。
- 根刷新后必须重新等待脚本编译稳定，并重新检查 programming output；不能只重跑完整性检查。
- 第二次完整性检查失败时，本轮 refresh 返回 `ok: false`，并使用独立失败分类表示 AssetDB integrity failure（AssetDB 完整性失败）。
- 完整性失败不得 invalidate settings，不得清除最后一个可用 import replacement cache，不得触发页面 reload。
- 成功响应增加是否执行 integrity fallback、首次失效数量、最终验证状态和根刷新耗时等可观察字段。
- Bundle/settings 层在资源 UUID 无法解析时抛出包含上下文的明确错误。该层不得静默跳过、自动移除资源或改用未经验证的旧对象。
- 不使用固定 target 数量阈值决定是否根刷新。阈值不能直接反映 AssetDB 是否一致，并会对不同规模项目产生不稳定行为。
- 不把 SVN 识别逻辑绑定到 SVN 命令或工作副本元数据。系统只根据 AssetDB 完整性处理批量文件变化，因此同样覆盖目录复制、补丁应用和其它批量同步行为。
- 保持现有 refresh 串行语义。同一轮完整性恢复必须属于原 refresh 的生命周期和日志记录。
- 问题进入项目 runtime preview 台账，状态为 `open`，并标记 `ready-for-agent`。实现和真实项目验收完成前不得标记 `fixed`。

## 测试决策

- 主要测试 seam（测试入口）使用 refresh coordinator 的公开 refresh 行为。测试只观察刷新调用、完整性结果、根刷新、缓存失效和最终响应，不断言内部函数调用顺序之外的实现细节。
- 增量刷新后完整性通过时，测试应证明不执行根刷新，settings 和 import replacement cache 正常失效。
- 增量刷新后首次完整性失败、根刷新后通过时，测试应证明只执行一次根刷新，重新等待脚本稳定，最终返回成功并失效缓存。
- 增量刷新和根刷新后均失败时，测试应证明返回结构化失败，不失效缓存，不清除最后可用结果。
- 根刷新自身失败时，测试应证明保留首次完整性诊断并返回失败，不继续重试。
- 完整性诊断包含大量失效 UUID 时，测试应证明总数准确且日志样本有上限。
- 同一 refresh 的并发调用继续复用既有 in-flight（进行中）语义，不能为每个调用分别执行根刷新。
- Bundle 最终断言使用窄单元测试，验证错误包含 Bundle、UUID 和 URL 上下文，并验证不会静默跳过。
- 集成测试使用包含主资源和子资源的临时 fixture，模拟 `.meta` 或子资源 UUID 变化后增量刷新留下不可解析 UUID；测试必须先证明当前实现可复现原始 settings 失败，再验证完整性回退后的行为。
- 真实项目验证使用问题指定的 P6 项目，明确记录是否构建 `dist`、是否设置测试环境变量、SVN 操作范围、refresh 日志、settings 结果和浏览器结果。
- 真实项目验证不能通过修改或伪造 P6 `.meta` 完成。应使用可恢复的 SVN 更新/合并场景，并在执行前取得用户确认。
- 现有 runtime refresh coordinator、runtime preview server、settings generation 和 Bundle settings 测试是优先复用的测试组织方式。

## 范围外

- 不修改 SVN 工作流，也不调用或包装 SVN 命令。
- 不尝试从 filesystem watcher 识别写文件的具体进程。
- 不为每种批量工具建立独立检测规则。
- 不修改 AssetDB pause（暂停）机制。
- 不重构 Builder 的全局缓存或并发模型。
- 不把所有 dirty-set refresh 默认改为根刷新。
- 不静默删除、跳过或修复项目 `.meta`。
- 不自动清理项目 `library`、`temp` 或 engine cache（引擎缓存）。
- 不改变 `--watch-assets` 和 `--refresh-on-reload` 的默认开关行为。
- 不在本规格中解决已删除脚本的 QuickPack stale records（陈旧记录）问题。

## 补充说明

- 当前真实现场证明了外部触发是 SVN 更新/合并及其批量文件写入，但现有日志没有失效 UUID，因此具体资源仍属于事实缺口。
- 本规格不要求先知道具体失效资源才能定义完整性门禁；门禁本身必须把该资源作为结构化诊断暴露出来。
- 重启 CLI 后成功只能证明完整初始化可以恢复可用状态，不能替代根刷新恢复路径的验证。
- 当前现场单轮 dirty-set 刷新 `148` 个目标耗时约 `87.7s`，总 refresh 耗时约 `118.2s`。实现时必须记录完整性检查和根刷新附加耗时，但正确性优先于继续生成不一致 settings。
