# adapter-to-386 对齐 origin/main 台账

## 目标

把 `origin/main` 中对 adapter 有价值的官方更新逐项合入 `adapter-to-386`，而不是简单“全部保持 adapter”或“一次性 rebase 后看测试”。本台账用于后续逐项决策、实现和验证。

复杂分析报告只作为证据库：`docs/dev/build/reports/adapter-to-386-rebase-origin-main-deep-analysis-20260622.md`。

## 决策原则

- 默认优先吸收官方改进。
- 只有当官方改动破坏 adapter-to-386 的明确目标时，才保留 adapter 行为或做 adapter-specific merge。
- 保留 adapter 行为必须写明被保护的目标和验证方式。
- 每项对齐必须能单独验证；没有验证不能标记为 `done`。

adapter-to-386 的受保护目标：

- Cocos Creator / engine `3.8.6` parity。
- Editor baseline parity，尤其 AssetDB internal record、source meta、library 输出。
- project extension builder hooks 与受限 `Editor` facade。
- `wechatgame` support。
- runtime-preview fixture 与诊断能力。
- configuration owner model：Editor-owned config 与 CLI-owned overlay 分离。

## 状态定义

- `todo`：尚未处理。
- `analyzing`：正在补证据或设计合并方式。
- `ready`：决策明确，可以实施。
- `done`：已处理并通过对应验证。
- `blocked`：缺少 fixture、外部事实或实现路径。
- `accepted-risk`：风险已记录，当前不处理。

## 对齐项

| ID | 主题 | 官方变化 | adapter 变化 | 当前决策 | 状态 |
| --- | --- | --- | --- | --- | --- |
| A01 | npm root metadata 与 build script | root version 到 `0.0.1-alpha.30`，`pink >=0.0.1.24`，`build` 追加 `generate:dts` | adapter 仍是 alpha.28，build 不跑 DTS | adopt official | ready |
| A02 | `@cocos/asset-db` 来源 | 官方继续 registry `3.0.0-alpha.10` | adapter 改为 local `file:./packages/asset-db` 并打 internal record patch | keep adapter，补维护流程 | ready |
| A03 | `@cocos/asset-db` 官方包同步机制 | 官方 npm tarball 是 baseline | adapter local package 无落地 re-vendor 脚本 | merge：保留 local patch，但补 re-vendor/upgrade 流程 | todo |
| A04 | `cc` / `packages/cc-module` runtime mode | 官方 `cc` 仍 local package，`BASE..origin/main` 无 diff | adapter 修改 `preload.ts`，控制 `EngineRuntimeMode` / `CC_EDITOR` | analyzing | todo |
| A05 | `packages/cocos-cli-types` / DTS | 官方更新 DTS 生成、CI 检查和 snapshot | adapter 未改 DTS 生成机制 | adopt official；只按官方流程重新生成并验证 | ready |
| A06 | builder schema/check API | 官方新增 schema output、`BuildCheckResult.valid/fixedValue`、required options | adapter 有 project extension options、`wechatgame` schema | merge，以官方 API shape 为准 | ready |
| A07 | builder create template API | 官方新增 `createBuildTemplate` public API | adapter 有 project extension builder/template 相关行为 | adopt official + 保留 extension template 行为 | ready |
| A08 | build stage progress/log sink/logDest | 官方新增 progress callback、log sink restore、`logDest` propagation | adapter 有 isolated build runtime 与 error hook | merge | ready |
| A09 | project extension builder hooks | 官方无等价 project extension discovery | adapter 注册 project extension hooks、fatal diagnostics | keep adapter on top of official APIs | ready |
| A10 | `wechatgame` platform | 官方无 adapter 等价 | adapter 新增 platform schema/options/templates | keep adapter，接入官方 builder API | ready |
| A11 | script static compile check | 官方在 script build 内新增 hard static compile check | adapter 移除该 check，避免 `.tsx` / broad include 误杀 | analyzing，不能直接丢官方；评估 narrow/report-only | todo |
| A12 | asset path helpers | 官方新增 `pathToDbUrlIfAssetDBPath`、`dirnameForDbUrlOrPath` | adapter 有 extension asset-db mount 和 source meta parity | adopt official helpers，验证 adapter mount 不回退 | todo |
| A13 | `asset-config.ts` temp/library path | 官方对齐 `temp/asset-db`、project `library` | adapter 曾使用 CLI-specific extension output 和 internal parity | merge，采用官方 project/internal path，保留 extension isolation | analyzing |
| A14 | AssetDB internal record parity | 官方 registry package 写法不等同 Editor baseline | adapter local package 对齐 `.internal-*` records | keep adapter | ready |
| A15 | glTF normalized skin weights | 官方修 importer 解码 | adapter 有 3D source meta parity | adopt official | todo |
| A16 | configuration schema path | 官方 schema path 到 `temp/cocos.config.schema.json` | adapter owner model 分离 Editor-owned / CLI-owned | merge，采用官方 path，保留 owner model | ready |
| A17 | configuration metadata / scene tick | 官方新增 metadata、scene tick | adapter 有 owner-map hardening | adopt official metadata，审 owner map | todo |
| A18 | scene public API rename | 官方 `queryChildren/queryComponent` 改为 `includeChildren/includeComponents` | adapter 可能有旧调用或 facade | adopt official，必要时兼容旧入口 | todo |
| A19 | runtime-preview package | 官方无直接 runtime-preview/Vitest diff | adapter 保留 `vitests` 与 preview app build | keep adapter until suite proves obsolete | todo |
| A20 | repo engine tag | 官方 `repo.json` 到 `4.0.0-alpha.22` | adapter 目标是 3.8.6 engine | keep adapter target，明确 external engine source | analyzing |

## 每项模板

后续逐项处理时，在本节追加详细记录：

```md
### Axx: 主题

- 状态：
- 决策：
- 官方证据：
- adapter 证据：
- 处理动作：
- 验证命令：
- 验证结果：
- 剩余风险：
```

## 优先级

第一批应先处理会影响 rebase 合并正确性的项：

1. A02 / A03：`@cocos/asset-db` local package 与 re-vendor 流程。
2. A06 / A07 / A08 / A09 / A10：builder API、extension hooks、`wechatgame`。
3. A11：static compile check。
4. A13 / A14：AssetDB path 与 internal record parity。
5. A16 / A17：configuration path 与 owner model。
6. A05：DTS / `packages/cocos-cli-types`，直接采用官方生成流程。

第二批处理间接或需要额外 fixture 的项：

1. A04：`cc-module` runtime mode。
2. A12 / A15：asset path helpers 与 glTF importer。
3. A18：scene public API rename。
4. A19：runtime-preview。
5. A20：engine tag / external engine source。

## 当前下一步

从 A02/A03 开始：确认 local `@cocos/asset-db` 保留的最小 patch 集，并补可执行 re-vendor/upgrade 流程。完成后再进入 builder API 对齐项。

`@cocos/asset-db` 官方版本升级 / re-vendor 的交接文档见：

- `docs/dev/build/handoff/asset-db-official-upgrade-handoff-20260622.md`

AssetDB `library` / `temp` path 对齐（A13 / A16）的交接文档见：

- `docs/dev/build/handoff/asset-library-path-alignment-handoff-20260622.md`
