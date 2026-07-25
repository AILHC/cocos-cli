# P6 SVN 批量刷新后 AssetDB 不一致事实记录

日期：2026-07-23

关联问题：`RP-ISSUE-039`

## 反馈现象

真实项目：

```text
D:\ps_copy\p6\trunk\Project\GameClient\Client-feature-b
```

运行命令启用了 `--watch-assets`（监听资源变更）和 `--refresh-on-reload`（页面重载前刷新）：

```powershell
node E:\own_space\engines\cocos-cli\dist\cli.js preview --runtime `
  --project D:\ps_copy\p6\trunk\Project\GameClient\Client-feature-b `
  --host 127.0.0.1 `
  --port 8530 `
  --watch-assets `
  --refresh-on-reload
```

运行中的 preview 在 SVN 更新/合并后执行 dirty-set refresh（脏集增量刷新），随后 settings 构建失败：

```text
ERROR  run build task Query Asset Bundle failed! (10%)
[runtime-preview] settings:build:error durationMs=1327 scene= Cannot read properties of null (reading 'loadUrl')
```

对应 runtime preview 日志：

```text
D:\ps_copy\p6\trunk\Project\GameClient\Client-feature-b\temp\preview-logs\runtime-preview-20260723-075521.log
```

## 已确认的外部操作

用户确认错误发生前执行了 SVN 更新/合并。

SVN 更新/合并对用户是一次操作，但会在文件系统层面依次写入大量源文件和 `.meta`。现场文件时间与 watcher（文件监视器）记录符合批量覆盖特征：

- `2026-07-23 16:15:33` 同一秒写入 `116` 个 refresh target（刷新目标）。
- `2026-07-23 16:37:31` 同一秒又写入 `12` 个 refresh target。
- 目标跨越 TypeScript、JSON、PNG、Prefab、Spine、TMX 等资源类型和多个不相关目录。
- `148` 个 refresh target 当前均存在，不是单纯的批量删除现场。
- 所有目标均存在对应 `.meta`；至少 `42` 个 `.meta` 在 `16:15` 被写入。
- 部分源文件与其 `.meta` 的写入时间只相差约 `2ms`，符合 SVN 或其它批量同步工具连续覆盖文件的行为。

## 已确认的 runtime refresh 事实

触发错误前的 `runtime-refresh-52`：

| 字段 | 值 |
| --- | ---: |
| `passes`（刷新轮次） | 1 |
| `targetCount`（目标数） | 148 |
| `dirtyEventCount`（脏事件数） | 223 |
| `changedAssetCount`（AssetDB 变更数） | 154 |
| `successfulTargets`（成功目标数） | 148 |
| `failedTargets`（失败目标数） | 0 |
| `settledTargets`（收敛目标数） | 0 |
| `parentFallbackTargets`（父目录回退数） | 0 |
| `rootFallback`（根刷新回退） | `false` |
| 总耗时 | `118233ms` |
| 单轮目标刷新耗时 | `87721ms` |

refresh coordinator（刷新协调器）把本轮结果判定为成功并 invalidate settings（使 settings 缓存失效）。紧随其后的 settings 构建在 `Query Asset Bundle` 阶段失败。

## 已确认的代码失败边界

Bundle settings 生成会遍历根资源 UUID，并查询对应 AssetInfo（资源信息）。失败现场中某次查询返回 `null`，随后代码直接读取 `asset.loadUrl`，产生当前 TypeError（类型错误）。

可以确认：

- Bundle 根资源列表中至少存在一个 UUID。
- 同一时刻 AssetDB 查询接口不能把该 UUID 解析为 AssetInfo。
- runtime refresh 的“所有目标调用成功”没有保证 AssetDB 的整体查询不变量成立。
- 当前错误日志没有输出失效 UUID、Bundle 名、父资源或 URL，因此不能从现有证据确定具体资源。

## 尚未确认的事实

现有日志不能区分以下底层状态：

- `.meta` 更新导致主 UUID 或 `subMetas`（子资源元数据）UUID 变化。
- 父资源对象仍引用旧子资源，但 UUID 索引已经移除该子资源。
- 单目标 refresh（刷新）全部返回后，仍存在延迟的 AssetDB 更新。
- settings 构建与其它资源操作发生时序交叠。

以上只能作为后续诊断候选，不得在获得失效 UUID 前写成已确认根因。

## 当前裁决

系统级根因是 runtime preview 把 SVN 批量更新/合并拆成普通的单目标增量刷新，并把“每个目标刷新调用成功”直接等同于“AssetDB 整体一致”。当前流程缺少增量刷新后的 AssetDB 完整性门禁。

正确的修复边界应位于 refresh 成功与 settings cache invalidation（settings 缓存失效）之间：

1. 完成 dirty-set 增量刷新和脚本编译。
2. 验证 Bundle/settings 所需的 AssetDB UUID 查询不变量。
3. 不变量失败时执行一次项目 `db://assets` 根刷新并重新验证。
4. 第二次验证仍失败时返回结构化 refresh 失败，不 invalidate settings，不触发 reload（页面重载）。
5. Bundle 层保留带 UUID、Bundle 名和 URL 的最终诊断，不静默跳过资源。

## 不能由当前证据证明

- 不能证明具体是哪一个资源或 `.meta` 导致不一致。
- 不能证明 AssetDB 根刷新一定可以恢复；需要回归测试和真实项目复现验证。
- 不能把重启后成功解释为缓存文件损坏；重启只能证明完整初始化重新建立了可用状态。
- 不能把 Bundle 判空或改读旧对象视为根因修复。
