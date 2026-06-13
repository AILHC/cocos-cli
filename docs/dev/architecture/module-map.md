# Module Map

| Source Path | Module Doc | Responsibility |
| --- | --- | --- |
| `src/cli.ts` | `../modules/commands.md` | CLI process entry |
| `src/index.ts` | `../modules/api.md` | Package/API entry |
| `src/global.ts` | `../modules/core-base.md` | Global runtime bootstrap/shared state |
| `src/api/` | `../modules/api.md` | Public API surface |
| `src/commands/` | `../modules/commands.md` | CLI commands and command handlers |
| `src/display/` | `../modules/display.md` | Terminal output and display helpers |
| `src/i18n/` | `../modules/i18n.md` | Localization and typed i18n resources |
| `src/lib/` | `../modules/lib.md` | Shared library helpers outside core subsystem folders |
| `src/mcp/` | `../modules/mcp.md` | MCP integration |
| `src/runtime-preview/` | `../modules/runtime-preview.md` | Runtime preview app and preview-specific orchestration |
| `src/server/` | `../modules/server.md` | HTTP server and middleware |
| `src/tests/` | `../modules/tests.md` | Source-level test helpers and fixtures |
| `src/core/launcher.ts` | `../modules/launcher.md` | CLI lifecycle and command orchestration |
| `src/core/assets/` | `../modules/asset-db.md` | AssetDB integration and resource metadata |
| `src/core/base/` | `../modules/core-base.md` | Core shared base types and services |
| `src/core/builder/` | `../modules/builder.md` | Builder worker and build output |
| `src/core/configuration/` | `../modules/configuration.md` | CLI and project configuration |
| `src/core/engine/` | `../modules/engine.md` | Engine root and engine capability handling |
| `src/core/filesystem/` | `../modules/filesystem.md` | Filesystem helpers and path utilities |
| `src/core/project/` | `../modules/project.md` | Project model and project-level state |
| `src/core/scene/` | `../modules/scene.md` | Scene query and scene serialization integration |
| `src/core/scripting/` | `../modules/scripting.md` | Script compilation, packer-driver records/import-map/chunks |
| `src/core/test/` | `../modules/tests.md` | Core test utilities |
| `src/core/launcher-engine-root.ts` | `../modules/engine.md` | Launcher-facing engine root resolution |
| `src/core/project-manager.ts` | `../modules/project.md` | Project manager entry |
| `static/` | `../modules/static-assets.md` | Static templates, preview assets, scripting support files |
| `packages/` | `../modules/packages.md` | Workspace packages |
| `workflow/` | `../modules/workflow.md` | Repository workflow scripts |
| `tests/` | `../modules/tests.md` | Repository-level tests |
| `vitests/` | `../modules/vitests.md` | Vitest suites, fixtures, shared test utilities |
| `e2e/` | `../modules/e2e.md` | End-to-end tests and coverage scripts |

## Existing Topic Documents

现有 `docs/dev/build/`、`docs/dev/core/`、`docs/dev/runtime-preview/` 和顶层专题文档保留原位置。新增或修订稳定结论时，应把长期结论回填到本表对应的 `modules/` 文档，再从专题文档链接回来。
