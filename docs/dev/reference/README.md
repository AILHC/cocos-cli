# 开发参考材料

本目录保存需要长期保留、但不属于当前 production source 的参考材料。参考材料只能用于事实核对、迁移对照和历史行为理解；不能直接作为当前 CLI 默认策略、route mapping 或生成产物的权威来源。

## 当前条目

| 路径 | 来源 | 用途 | 边界 |
| --- | --- | --- | --- |
| `old_editor_preview_server/` | 从 `E:\own_space\tmp-repos\runtime-preview-reference\cocos-cli-backup-runtime-preview-bad-20260606\docs\dev\reference\old_editor_preview_server` 迁入 | 长期保存旧 Editor preview server 参考源码，用于核对 root page、`preview-app` route、Express `sendFile()`、cache header、project `preview-template` fallback 等历史行为 | 仅为 historical reference；不能照搬为当前 CLI route、resolver、settings 或 browser entry 设计 |

## 外部仓库边界

- `E:\own_space\engines\cocos4` 是本机已拉取的 cocos4 参考仓库；需要对照新版本 engine 行为时优先使用该路径。
- `E:\own_space\engines\cocos-cli\.codex-tmp\cocos4-alpha22` 是临时 checkout，不应继续作为事实来源、计划输入或文档引用目标。后续文档不得新增对该目录的依赖；已有排查如需引用 cocos4，应改用本机正式仓库。
- `.codex-tmp` 下的冻结产物或临时仓库只允许作为一次性诊断输入；需要长期保留的参考源码应迁入 `docs/dev/reference/` 并记录来源、用途和边界。
