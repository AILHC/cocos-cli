# Runtime Preview CLI / Engine 改动溯源 Ledger

记录时间：2026-06-08

## 状态定义

| 状态 | 含义 |
| --- | --- |
| `active` | CLI commit/file、CLI test、CLI behavior 已闭环；若涉及 engine patch，也必须有明确 engine commit/file 对应关系。 |
| `candidate` | 方向可能正确，但还缺少测试、行为闭环或事实归因。 |
| `obsolete` | 已被当前计划废弃，不能作为继续实现依据。 |
| `needs-review` | 有事实线索或已存在改动，但 CLI / engine / test / behavior 对应关系尚未足够精确。 |

## Ledger

| ID | 需求/问题 | CLI commit/file | Engine commit/file | 事实来源 | 验证命令 | 当前状态 |
| --- | --- | --- | --- | --- | --- | --- |
| RP-CLI-001 | `preview --runtime` 需要独立 Launcher/server path，不启动 scene RPC/MCP/editor scene service | `ecc53f8 feat(runtime-preview): serve real launcher settings lazily`；`src/core/launcher.ts`；`src/runtime-preview/server/runtime-preview-server.ts`；`vitests/suites/runtime-preview/launcher-runtime-preview.test.ts` | `not applicable: CLI-only behavior` | 当前 CLI source + runtime-preview tests + intent/status 文档 | `rtk cmd /c "set COCOS_CLI_TEST_PROJECT_ROOT=E:/own_space/cocos_work_lab_38x&& set COCOS_CLI_TEST_ENGINE_ROOT=D:/workspace/engines/cocos/3.8.6&& set COCOS_CLI_TEST_EDITOR_LIBRARY_REF=E:/own_space/engines/cocos-cli/.codex-tmp/reference-library/cocos_work_lab_38x-editor-library-20260606&& set COCOS_CLI_TEST_EDITOR_PROGRAMMING_REF=E:/own_space/engines/cocos-cli/.codex-tmp/reference-temp/cocos_work_lab_38x-editor-programming-20260606&& npm --prefix vitests test -- suites/runtime-preview/launcher-runtime-preview.test.ts"` | `active` |
| RP-CLI-002 | `/settings.js` 需要 lazy 使用 CLI `getPreviewSettings()` 或等价封装，不能手写 settings / bundle config | `ecc53f8 feat(runtime-preview): serve real launcher settings lazily`；`src/runtime-preview/settings/preview-settings-provider.ts`；`src/runtime-preview/server/runtime-preview-routes.ts`；`vitests/suites/runtime-preview/settings-generation.test.ts`；`vitests/suites/runtime-preview/launcher-runtime-preview.test.ts` | `not applicable: current evidence is CLI path; engine behavior still consumed through current 3.8.6 source` | 当前 CLI source + `getPreviewSettings()` path + settings tests | `rtk cmd /c "set COCOS_CLI_TEST_PROJECT_ROOT=E:/own_space/cocos_work_lab_38x&& set COCOS_CLI_TEST_ENGINE_ROOT=D:/workspace/engines/cocos/3.8.6&& set COCOS_CLI_TEST_EDITOR_LIBRARY_REF=E:/own_space/engines/cocos-cli/.codex-tmp/reference-library/cocos_work_lab_38x-editor-library-20260606&& set COCOS_CLI_TEST_EDITOR_PROGRAMMING_REF=E:/own_space/engines/cocos-cli/.codex-tmp/reference-temp/cocos_work_lab_38x-editor-programming-20260606&& npm --prefix vitests test -- suites/runtime-preview/settings-generation.test.ts"` | `candidate` |
| RP-ENGINE-001 | runtime preview Vitest 和 CLI runtime path 需要 Node.js PAL / host boundary | `needs-review: map exact CLI commits/files/tests before active` | `ec7f8d2161 feat(runtime-preview): add nodejs pal adapter`；`cc.config.json`；`pal/audio/nodejs/player.ts`；`pal/env/nodejs/env.ts`；`pal/input/nodejs/**`；`pal/pacer/pacer-nodejs.ts`；`pal/screen-adapter/nodejs/screen-adapter.ts`；`pal/system-info/nodejs/system-info.ts`；`pal/wasm/wasm-nodejs.ts` | engine backup + current 3.8.6 source + engine-source probe | `rtk cmd /c "set COCOS_CLI_TEST_ENGINE_ROOT=D:/workspace/engines/cocos/3.8.6&& npm --prefix vitests test -- suites/runtime-preview/engine-source-runtime.probe.test.ts"` | `needs-review` |
| RP-TEST-001 | 真实 engine source 引入测试需要保持 `PREVIEW=true`、`TEST=false`，不能照搬 P6 business test 语义 | `aafba9d test(runtime-preview): expand filesystem parser probes`；`vitests/shared/cocos-internal-constants.ts`；`vitests/shared/engine-source.ts`；`vitests/shared/cocos-cc-source-entry.ts`；`vitests/suites/runtime-preview/engine-source-runtime.probe.test.ts`；`vitests/suites/runtime-preview/editor-library-resources-load.probe.test.ts` | `not applicable: test harness consumes current engine source but does not require a dedicated engine patch` | P6 test reference + current Vitest harness + current engine source | `rtk cmd /c "set COCOS_CLI_TEST_PROJECT_ROOT=E:/own_space/cocos_work_lab_38x&& set COCOS_CLI_TEST_ENGINE_ROOT=D:/workspace/engines/cocos/3.8.6&& set COCOS_CLI_TEST_EDITOR_LIBRARY_REF=E:/own_space/engines/cocos-cli/.codex-tmp/reference-library/cocos_work_lab_38x-editor-library-20260606&& set COCOS_CLI_TEST_EDITOR_PROGRAMMING_REF=E:/own_space/engines/cocos-cli/.codex-tmp/reference-temp/cocos_work_lab_38x-editor-programming-20260606&& npm --prefix vitests test -- suites/runtime-preview/engine-source-runtime.probe.test.ts suites/runtime-preview/editor-library-resources-load.probe.test.ts"` | `active` |

## 规则

1. `active` 不能只表示“方向正确”。必须同时有 CLI commit/file、CLI test、CLI behavior 三者闭环；涉及 engine patch 时，还必须有 engine commit/file 和 CLI 行为闭环。
2. engine patch 不能只写“适配 runtime preview”。必须说明它对应哪个 CLI 行为、CLI 测试和验收证据。
3. 没有 CLI commit、CLI test、CLI behavior 三者闭环时，状态不能写 `active`。
4. 如果 engine patch 影响非 runtime preview 语义，状态先写 `needs-review`，直到证明影响边界。
5. CLI-only 行为可以写 `active`，但 `Engine commit/file` 必须明确写 `not applicable`，不能虚构 engine 对应关系。
6. 后续每个 engine patch 都必须先补本 ledger，再进入最终验收。

## 当前结论

当前已有 CLI-only runtime preview path 和 engine-source test harness 的 active 证据。`ec7f8d2161` Node.js PAL engine patch 仍为 `needs-review`：它是当前事实链的重要输入，但还没有精确到某个 CLI commit / CLI behavior / CLI test 的完整闭环，不能提前标为 active。
