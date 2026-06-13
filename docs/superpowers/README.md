# Superpowers Specs And Plans

本目录保存按 Superpowers 工作流产生的正式 spec 和 implementation plan。

## Directory Roles

- `specs/`：设计规格文档，文件名使用 `YYYY-MM-DD-<topic>-design.md`。
- `plans/`：实施计划文档，文件名使用 `YYYY-MM-DD-<feature-name>.md`。

## Rules

- 新的 Superpowers spec 必须写入 `docs/superpowers/specs/`。
- 新的 Superpowers implementation plan 必须写入 `docs/superpowers/plans/`。
- `docs/dev/**/plans/` 只保留 legacy process record，不再作为新计划默认位置。
- `docs/dev/**/facts/`、`issues.md`、`acceptance/`、`handoff/` 继续保存专题事实、问题索引、验收和交接记录。
- 专项完成后，稳定结论仍必须回填到 `docs/dev/architecture/` 或 `docs/dev/modules/`。

## Related Dev Docs

- [Development documentation](../dev/README.md)
- [Documentation policy](../dev/architecture/documentation-policy.md)
