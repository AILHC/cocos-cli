# Runtime Preview shared CLI records 关联问题审计

## 背景

`RP-ISSUE-023` 已确认：shared project library 默认化后，runtime preview scene resolver 仍只读取 `.assets-data.json`，没有读取当前 CLI assets records 使用的 `.cli-assets-data.json`，导致 `/scene-list` 为空、`/scene/<uuid>.json` 返回 `Scene asset JSON not found`。

本记录用于登记与该问题同类或可能关联的代码、测试和文档假设。当前只做审计，不进入修复。

## 事实来源

- `src/core/assets/asset-config.ts` 当前默认：`COCOS_CLI_SHARED_LIBRARY_OUTPUT !== '0'` 时，assets library 为 `library`，assets records 为 `library/.cli-assets-info.json`、`library/.cli-assets-data.json`、`library/.cli-assets-dependency.json` 和 `library/.cli-assets`。
- `src/core/launcher.ts` 当前 runtime preview 默认把 `projectLibraryRoot` 指向 `library`，与 shared output 默认策略一致。
- `src/runtime-preview/server/preview-scenes.ts` 当前 `loadAssetData(root)` 固定读取 `join(root, '.assets-data.json')`。

## 确定关联的问题

### 1. scene resolver 只读 `.assets-data.json`

位置：

```text
src/runtime-preview/server/preview-scenes.ts
```

影响入口：

```text
GET /scene-list
GET /scene/<uuid>.json
resolveRuntimePreviewStartScene()
```

影响：

- shared output 默认开启时，真实 scene records 位于 `library/.cli-assets-data.json`。
- resolver 查 `library/cli/.assets-data.json` 或 `library/.assets-data.json`，不会查 `library/.cli-assets-data.json`。
- 结果是场景列表为空、scene JSON 404、`current_scene` fallback 不能工作。

该项已由 `RP-ISSUE-023` 记录为直接用户可见问题。

## 可能掩盖问题的测试假设

### 2. `preview-app-route-contract.test.ts` 仍读取旧 `library/cli/.assets-data.json`

位置：

```text
vitests/suites/runtime-preview/preview-app-route-contract.test.ts
```

相关用例：

```text
prefers current CLI AssetDB scene output when production root is project library
```

当前用例从 `library/cli/.assets-data.json` 取 scene，再断言 `/scene-list` 和 `/scene/<uuid>.json`。这符合旧 isolated output 形态，但不覆盖当前默认 shared output 的 `library/.cli-assets-data.json`。

风险：

- 如果 fixture 中仍残留 `library/cli/.assets-data.json`，测试可能继续通过，无法暴露 production 默认 shared records 的 scene resolver 404。
- 如果 fixture 不再生成 `library/cli/.assets-data.json`，测试失败原因会表现为 fixture 缺旧产物，而不是明确指出 resolver 应支持 `.cli-assets-data.json`。

该项需要后续确认是否应新增 shared output fixture 测试，还是替换旧用例语义。

### 3. `editor-cli-output-consistency.test.ts` 中的 `.assets-data.json` 语义需要重新区分

位置：

```text
vitests/suites/runtime-preview/editor-cli-output-consistency.test.ts
```

该测试同时涉及 frozen Editor records、CLI output records 和 internal records。当前扫描显示它仍包含 `.assets-data.json`、`.assets-info.json`、`.assets-dependency.json` 等旧 record 名称。

初步判断：

- 用于 frozen Editor reference 的 `.assets-data.json` 是合理事实来源。
- 用于当前 production CLI shared output 的 records 如果仍按 `.assets-data.json` 判断，则可能与 `AssetConfig` 默认策略不一致。

该项目前只记录为候选，不直接判定为 BUG；需要按测试意图逐段核对。

### 4. `script-runtime-map.test.ts` 读取 frozen Editor `.assets-data.json`

位置：

```text
vitests/suites/runtime-preview/script-runtime-map.test.ts
```

该测试使用 `paths.editorLibraryRef/.assets-data.json` 作为 frozen reference，辅助验证 `dependScripts` 到 programming records 的链路。

当前判断：

- 这不是直接 BUG，因为它明确使用 `editorLibraryRef`。
- 如果后续要把同类逻辑扩展到 production shared output，需要补充 `.cli-assets-data.json` 覆盖，而不能复用该测试作为 production shared records 的证据。

## 文档和验收矩阵过期风险

### 5. runtime preview 架构文档仍有旧 `library/cli` 当前语义

位置示例：

```text
docs/dev/runtime-preview/facts/architecture.md
docs/dev/runtime-preview/acceptance/matrix.md
docs/dev/runtime-preview/design/core-flow.md
```

扫描到多处仍描述“当前 CLI project library root 是 `library/cli`”或“CLI output 使用 `library/cli/.assets-data.json`”。这些说法在 `00279bcd fix(build): default to shared asset library` 后不再代表 production 默认路径。

影响：

- 后续排查可能继续沿用旧 isolated output 语义。
- runtime preview 相关验收可能把旧 fixture 通过误读成当前 production 默认通过。

该项是文档事实更新问题，是否和代码修复一起处理需要确认。

## 当前排除项

### `resolve-library-request.ts`

`src/runtime-preview/library/resolve-library-request.ts` 不读取 AssetDB record 文件名，只根据 `RuntimePreviewContext` 显式 roots 和请求 URL tail 查找实际文件。它可能受 `projectLibraryRoot` 影响，但不属于 `.assets-data.json` / `.cli-assets-data.json` record 文件名错位问题。

### `runtime-preview-routes.ts` 的 import/native 资源 route

资源 route 主要依赖 `settings` 的 bundle config 和 `resolveLibraryRequest()`，没有直接读取 `.assets-data.json`。当前没有证据表明它存在同类 record 文件名硬编码问题。

### internal records

`.internal-data.json` / `.internal-info1.0.0.json` 属于 internal DB parity 领域，已有 build 侧问题记录。它和 shared CLI assets sidecar records 属于相邻主题，但不是本次 scene-list / scene-json 404 的直接原因。

## 待确认修复边界

在修复前需要先确认：

1. runtime preview scene resolver 是否应读取 `AssetConfig` 的 records 配置，而不是继续从 physical root 推导 record 文件名。
2. 兼容顺序应如何定义：`library/.cli-assets-data.json`、`library/cli/.assets-data.json`、`library/.assets-data.json` 三者优先级是否应与 `projectLibraryRoot`、shared output 默认策略一致。
3. 是否同时更新旧测试和文档，避免后续继续用 `library/cli/.assets-data.json` 掩盖 production shared output 问题。
4. 是否把 `settings/v2/packages/scene.json` 当前场景读取纳入同一修复，还是拆成独立修复。

未确认前不应直接修改生产代码。

## 2026-06-26 候选修复后结论

已按确认范围实现 `scene resolver` 候选修复、回归测试、默认场景读取和当前文档事实更新；但 P7 真实项目 runtime preview 验收尚未执行，因此本审计不能标为完全闭环：

1. `src/runtime-preview/server/preview-scenes.ts` 不再只读 `.assets-data.json`；当 production `projectLibraryRoot` 是 `<project>/library` 时，record 优先级为 `library/.cli-assets-data.json`、`library/cli/.assets-data.json`、`library/.assets-data.json`。
2. 该顺序同时避免 stale `library/cli/.assets-data.json` 遮蔽 shared sidecar records，也避免 shared sidecar 缺失时 frozen / Editor `library/.assets-data.json` 遮蔽 legacy CLI output。
3. `settings/v2/packages/scene.json` 的 `current-scene` 已纳入默认 scene 解析；`profiles/v2/packages/preview.json` 的有效 `general.start_scene` 仍优先于 Editor current scene。
4. `resolve-library-request.ts` 和普通 import/native resource route 的排除结论不变：它们不直接读取 `.assets-data.json` / `.cli-assets-data.json`，不属于同类硬编码问题。
5. `editor-cli-output-consistency.test.ts` 中 frozen Editor `.assets-data.json` 和 production shared output records 的语义区分仍需在 output consistency 专项中继续核对；本次只消除 runtime preview scene route 的直接回归和旧 route contract 测试掩盖。

新增回归测试位于：

```text
vitests/suites/runtime-preview/preview-app-route-contract.test.ts
```

测试明确构造两类 fixture：

- 同时存在 shared `library/.cli-assets-data.json` 和 stale `library/cli/.assets-data.json` 时，断言 `/scene-list` 与 `/scene/<uuid>.json` 使用 shared sidecar records。
- shared sidecar records 不存在，但同时存在 legacy `library/cli/.assets-data.json` 和 editor/frozen `library/.assets-data.json` 时，断言优先使用 legacy CLI records。

待补验收：

- 构建当前 CLI `dist`。
- 用 P7 `Client-fight-roguelike-migration` 真实项目启动 `preview --runtime`。
- 验证 `/scene-list`、`/scene/<uuid>.json` 和不传 `--scene` 的 `/settings.js`。
