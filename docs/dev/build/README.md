# Build Documentation

本文是 normal build 专题文档入口。这里保留 build 相关的问题台账、事实记录和实施计划；稳定结论应回填到 `../modules/` 下的正式模块文档。

## Reading Path

1. 当前问题索引：[issues.md](issues.md)
2. 当前关键事实：[facts/meta-library-editor-parity-20260613.md](facts/meta-library-editor-parity-20260613.md)
3. 产物体积 Editor parity 事实：[facts/build-output-size-editor-parity-20260615.md](facts/build-output-size-editor-parity-20260615.md)
4. 微信小游戏平台事实来源清单：[facts/wechatgame-source-inventory-20260615.md](facts/wechatgame-source-inventory-20260615.md)
5. `wechatgame` 平台重写实施计划：[../../superpowers/plans/2026-06-15-wechatgame-platform-implementation.md](../../superpowers/plans/2026-06-15-wechatgame-platform-implementation.md)
6. `cocos.config.json` Editor-owned 配置运行时合并规格：[../../superpowers/specs/2026-06-13-cocos-config-editor-owned-runtime-merge-design.md](../../superpowers/specs/2026-06-13-cocos-config-editor-owned-runtime-merge-design.md)
7. `cocos.config.json` Editor-owned 配置运行时合并实施计划：[../../superpowers/plans/2026-06-13-cocos-config-editor-owned-runtime-merge.md](../../superpowers/plans/2026-06-13-cocos-config-editor-owned-runtime-merge.md)
8. 项目状态写入一致性阶段计划：[../../superpowers/plans/2026-06-13-meta-library-editor-parity.md](../../superpowers/plans/2026-06-13-meta-library-editor-parity.md)
9. `@cocos/asset-db` 定制源码接管计划：[../../superpowers/plans/2026-06-13-asset-db-custom-source.md](../../superpowers/plans/2026-06-13-asset-db-custom-source.md)
10. 项目 build extension hook Editor parity 计划：[../../superpowers/plans/2026-06-15-build-extension-hook-editor-parity.md](../../superpowers/plans/2026-06-15-build-extension-hook-editor-parity.md)

## Related Stable Modules

- Builder build flow：[../modules/builder.md](../modules/builder.md)
- AssetDB metadata / library records：[../modules/asset-db.md](../modules/asset-db.md)
- Project configuration and Creator profile migration：[../modules/configuration.md](../modules/configuration.md)
- Script compilation and resolver behavior：[../modules/scripting.md](../modules/scripting.md)
- Workspace packages and local package ownership：[../modules/packages.md](../modules/packages.md)

## Document Roles

- `issues.md`：只记录 build 专题问题状态、当前结论、事实入口和处理方向。
- `facts/`：记录可重复事实、命令、baseline、diff 和由事实推出的判断。
- `../../superpowers/specs/`：记录 Superpowers spec。
- `../../superpowers/plans/`：记录 Superpowers implementation plan。

## Maintenance Rule

验证和排查时可以先写入本目录的 `issues` 或 `facts`。需要正式 spec 或 implementation plan 时，写入 `docs/superpowers/specs/` 或 `docs/superpowers/plans/`。专项完成后，长期结论必须同步回填到相关 `modules/` 文档；过程记录保留在本目录作为证据。
