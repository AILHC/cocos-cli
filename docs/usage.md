# Cocos CLI agent 使用注意事项

本文档给 agent 使用发布版 `cocos-cli` 时参考。命令、参数和基础示例优先看 CLI 自带 help：

```powershell
node .\dist\cli.js --help
node .\dist\cli.js <command> --help
```

不要把本文档当作完整命令手册；这里只记录 `--help` 不会说明、但 agent 容易误判或遗漏的约束。

## 发布包边界

- 发布产物为当前仓库 `publish/cocos-cli-v<version>.zip` 中的单个 ZIP，解压根目录为 `cocos-cli/`。
- 发布包根 `package.json` 不应包含 root `postinstall`，首次 `npm install` 不应触发源码仓库的 engine 编译、CLI build 或 tools 下载。
- 发布包不提交 `node_modules/`，该目录由使用者本机 `npm install` 生成。
- 发布包不包含 `packages/engine`，也不允许运行时回退到 `<cliRoot>/packages/engine`。
- 发布包包含完整 `static/`，包括 `static/tools/`。

## Tools helper scripts

- 发布目录包含 `install-cocos-cli.cmd`。
- Windows 用户可双击该脚本；脚本会在发布目录执行 `npm install`，成功后执行 `npm link`，把全局 `cocos` 命令指向当前发布目录。
- 发布目录还包含 `preview-runtime.cmd`。将它复制到 Cocos 项目根目录后双击，可执行：

```powershell
cocos preview --runtime --project <projectRoot> --watch-assets --refresh-on-reload
```

- `preview-runtime.cmd` 只通过当前目录的 `package.json.creator.version` 判断是否为 Cocos 项目；不要把它放在子目录或非项目目录运行。
- 如果提示找不到 `cocos` 命令，先回到 `<cliRoot>` 运行 `install-cocos-cli.cmd`。

## Engine 解析

production 运行时 engine source 只允许来自明确配置或 Creator profile，优先级为：

1. 项目 `package.json` 中的 `cocos-cli.enginePath`。
2. CLI 初始化链路传入的 `cliInitializedEngineRoot`。
3. 本机 Creator profile 中支持版本的 custom engine。

当前支持的 Creator 版本映射只有 `3.8.6`，对应 Creator profile key 为 `386`。这不是长期固定策略，只是当前 CLI 支持范围。

`cocos-cli.enginePath` 可以写绝对路径，也可以写相对路径；相对路径按 `<projectRoot>` 解析。路径不存在时应报错，不应继续回退到其它来源。

Creator profile 只接受 custom engine，不接受 builtin engine。没有 project `cocos-cli.enginePath` 且没有可用 custom engine 时，CLI 应报错并停止。

合并或修改 engine source 后，使用 `cocos compile-engine --engine <engineRoot>` 显式重建 `<engineRoot>/bin/.cache/dev-cli`。该 cache 由同一 engine root 下的 preview 共享；不要在 preview 仍运行时重建，应先取得用户确认并停止相关 preview，重建完成后再重新启动。

## 容易误判的路径

报错中可能出现 Creator profile 配置文件路径，例如：

```text
<profileRoot>/.CocosCreator/profiles/v2/packages/engine.json
```

这个路径里的 `packages/engine.json` 是 Creator profile 配置文件，不是发布包内置 engine。判断是否错误回退时，应检查是否访问了：

```text
<cliRoot>/packages/engine
```

不要用宽泛的 `packages/engine` 字符串直接判定失败。

## Agent smoke 建议

发布包生成后，agent 可做这些低成本检查：

```powershell
npm install
node .\dist\cli.js --help
node .\dist\cli.js preview --help
```

如果要验证 runtime preview engine 解析，至少覆盖三类场景：

- 项目配置 `cocos-cli.enginePath`：输出应能证明 `engineRootSource` 为 `project-config`。
- 无项目配置但本机 Creator custom engine 可用：输出应能证明 `engineRootSource` 为 `creator-profile`。
- 无项目配置且空 Creator profile：应失败，错误应指向 Creator profile 缺失或无可用 engine，且不应访问 `<cliRoot>/packages/engine`。

测试用 `COCOS_CLI_TEST_ENGINE_ROOT` 只允许用于 unit/integration 专项验证，不能当作 production 默认策略的证据。

## Build 验收边界

`build` 命令的参数说明以 `node .\dist\cli.js build --help` 为准。发布包 smoke 不等同于真实项目 build 验收。

真实项目 build 涉及 project extensions、engine source、Cocos npm 包、静态工具、缓存和业务构建配置。agent 只有在明确收到 build 验收要求时，才应执行真实 build，并先读取 `docs/dev/testing-spec.md` 及对应专题文档。

## 发布规范入口

发布设计和执行计划已记录在：

- `docs/superpowers/specs/2026-06-25-cocos-cli-tools-release-design.md`
- `docs/superpowers/plans/2026-06-25-cocos-cli-tools-release.md`

这些文档是发布行为的事实来源之一；如果实现与规范不一致，先记录差异，再按当前源码和可重复验证结果判断。
