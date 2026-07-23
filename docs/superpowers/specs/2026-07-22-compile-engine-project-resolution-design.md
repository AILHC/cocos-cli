# `compile-engine` 项目上下文解析设计

## Problem Statement

`compile-engine` 当前要求用户必须传入 `--engine <engineRoot>`。这迫使用户重复理解和输入项目已经声明的 engine source，且可能让重建目标与随后 `preview --runtime` 实际使用的 engine root 不一致。

用户期望在项目根目录直接执行 `cocos compile-engine`；CLI 应从当前工作目录识别项目，再复用现有项目 engine root 解析规则。只有不在目标项目目录执行时，用户才需要显式传入项目路径或 engine source 路径。

## Solution

`compile-engine` 支持三种互斥的目标输入：

1. 不传目标参数时，将当前工作目录作为项目根目录，并从该项目解析 engine source。
2. 传入 `--project <projectRoot>` 时，从指定项目解析 engine source。
3. 传入 `--engine <engineRoot>` 时，绕过项目解析，直接重建指定 engine source 的 `dev-cli` cache。

项目模式复用 `preview` 已使用的统一 engine root resolver，不建立第二套配置优先级。`--project` 与 `--engine` 同时出现时立即失败。

## User Stories

1. As a Cocos project developer, I want to run `cocos compile-engine` from the project root, so that I do not need to repeat the configured engine path.
2. As a Cocos project developer, I want the command to use the same engine resolver as runtime preview, so that rebuilt cache and preview cannot silently target different engine sources.
3. As a developer working outside the project directory, I want to pass `--project`, so that the CLI can still derive the correct engine source from that project.
4. As an engine developer, I want to pass `--engine`, so that I can rebuild a known engine source without creating or locating a project context.
5. As a developer using a relative `cocos-cli.enginePath`, I want it resolved relative to the project root, so that existing project configuration keeps working.
6. As a developer without project-level engine configuration, I want project mode to retain the existing Creator custom-engine fallback, so that the command matches preview behavior.
7. As a developer, I want an invalid current working directory to fail clearly, so that the CLI does not accidentally rebuild an unrelated Creator profile engine.
8. As a developer, I want `--project` and `--engine` to be mutually exclusive, so that there is one unambiguous rebuild target.
9. As a developer, I want an invalid engine source to fail before compilation, so that arbitrary directories are not treated as Cocos engine roots.
10. As a preview user, I want engine cache rebuilding to remain explicit, so that starting or restarting preview does not unexpectedly perform an expensive compile.
11. As a preview user, I want the command to avoid stopping or restarting preview automatically, so that process lifecycle remains under user control.
12. As a release-package user, I want the packaged CLI to include the compiled engine compiler, so that all three command forms work outside the source repository.

## Implementation Decisions

- `compile-engine` 的默认项目根目录为 `process.cwd()`。
- `--project` 显式覆盖默认项目根目录；`--engine` 显式绕过项目解析。
- `--project` 与 `--engine` 互斥，不定义隐式优先级。
- 项目模式首先确认目标目录包含项目 `package.json`，再调用现有统一 engine root resolver。
- 项目模式完整保留现有 resolver 的 project config、CLI initialized root 和 Creator profile custom engine 语义。
- 显式 engine 模式要求目标目录包含 engine `cc.config.json`。
- 命令输出最终 engine root 及其来源，便于确认实际重建目标。
- 重建范围仍为目标 engine source 下的 `bin/.cache/dev-cli/editor` 和 `bin/.cache/dev-cli/web`。
- 不增加自动源码变更检测、cache variant、preview 自动停止或 preview 自动重启。

## Testing Decisions

- 最高测试 seam 是“CLI 输入上下文解析为唯一 engine target”，而不是分别测试内部路径拼接。
- 覆盖当前工作目录项目、显式项目、显式 engine、参数冲突和无效当前目录。
- 项目测试使用临时目录与真实 `package.json`，验证相对 `cocos-cli.enginePath` 语义。
- cache rebuild 测试继续验证同一 engine root 依次生成 editor 和 web 两个 target。
- release workflow 测试继续验证发布包包含 engine compiler 产物，并验证生成的使用说明覆盖默认项目模式。
- 不在自动测试中重建真实共享 engine cache；真实 P7 验收必须先取得用户确认并停止相关 preview。

## Out of Scope

- 自动判断 engine source 是否发生变化。
- `preview` 启动时自动重编译 engine cache。
- 根据 Spine 或其它多版本模块拆分 cache variant。
- 自动停止、重启或接管正在运行的 preview。
- 改变现有项目 engine root resolver 的优先级。

## Further Notes

- 对应问题：`RP-ISSUE-038`。
- Triage：`ready-for-agent`；本轮在登记后直接进入实现。
- 当前 `9528` preview 在实现和自动测试阶段保持运行，不执行真实 engine cache rebuild。
