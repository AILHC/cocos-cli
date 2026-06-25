# cocos-cli tools 发布设计

## 背景

当前 `cocos-cli` 仓库是开发形态：root `package.json` 带有 `postinstall`，本机 `packages/engine` 可通过 junction 指向外部 engine source，`node_modules/cc` 和 `node_modules/@cocos/asset-db` 也可能是本地包 link。该形态不适合直接复制给团队使用。

目标是把 CLI 作为可版本管理的团队工具发布到 `<p6Root>/tools/cocos-cli`。发布目录纳入 `tools` 仓库 Git，但不提交 `node_modules`，不内置 engine source。团队成员首次使用只执行 `npm install`，不需要也不应该触发 CLI 开发期 `postinstall`。

## 目标

1. 发布目录可从 Git checkout 后通过 `npm install` 恢复运行依赖。
2. 发布包不包含 `packages/engine`，engine source 由项目配置或本机 Cocos Creator profile 提供。
3. 发布包根 `package.json` 不包含 root `postinstall`，避免团队首次安装触发 engine 编译、CLI build 或 tools 下载。
4. 发布包包含 `static/` 整体，尤其是 `static/tools/`，本轮不裁剪静态工具。
5. 使用文档为中文；路径用 `<p6Root>`、`<projectRoot>`、`<engineRoot>` 等占位符，不写入本机绝对路径。
6. 本轮验证 `--help` 和 `preview --runtime`。`build` 暂不纳入本轮测试。

## 非目标

1. 不提交 `node_modules`。
2. 不提交或打包 engine source。
3. 不把 `npm install` 改成 `npm install --ignore-scripts`；依赖包自身的 install scripts 允许正常执行。
4. 不为多 engine version 做完整兼容矩阵；当前 CLI supported engine versions 只有 `3.8.6`。
5. 不裁剪 `static/tools`，避免遗漏 importer、texture compression、native helper 或渠道工具。

## Engine Root 解析

新增或改造 `resolveLauncherEngineRoot()`，保留测试专用覆盖，同时移除 production 的 `<cliRoot>/packages/engine` fallback。

解析优先级：

1. 测试环境：当 `COCOS_CLI_TEST_ENGINE_ROOT` 与 `COCOS_CLI_TEST_PROJECT_ROOT` 同时匹配当前项目时，返回 test engine root，source 为 `test-env`。
2. 项目配置：读取 `<projectRoot>/package.json` 的 `cocos-cli.enginePath`。支持绝对路径和相对项目根目录的相对路径。该路径必须存在，否则报错。
3. 本机 Creator profile：读取用户目录下 `.CocosCreator/profiles/v2/packages/engine.json`。CLI supported engine versions 当前为 `["3.8.6"]`，对应 profile key 为 `386`。只接受 `engine[386].javascript.custom` 指向的自定义 engine source。该路径必须存在。
4. 无可用 engine 时直接报错，不启动。

错误信息需要说明实际失败原因，例如：

- 项目未配置 `cocos-cli.enginePath`。
- 本机 Creator engine profile 不存在或无法解析。
- 当前 CLI 只支持 `3.8.6`，但 profile 中没有对应自定义 engine。
- profile 中对应 engine 是内置引擎，不提供 source path。
- 解析出的 engine path 不存在。

runtime preview 的 active output 中应继续输出 `engineRoot` 与 `engineRootSource`。本机 Creator profile 来源建议新增 source 名称 `creator-profile`，用于区分 `project-config` 与测试覆盖。

## 发布目录结构

发布到 `<p6Root>/tools/cocos-cli`，提交以下内容：

- `dist/`
- `static/`
- `packages/cc-module/`
- `packages/asset-db/`
- runtime `package.json`
- 与 runtime `package.json` 匹配的 lockfile
- 使用文档，例如 `README.md`

不提交以下内容：

- `node_modules/`
- `packages/engine/`
- `.publish/`
- 源码测试临时输出
- 本机绝对路径记录

## Runtime package.json

发布包不能原样复制源码仓库 root `package.json`。发布阶段应生成 runtime manifest。

runtime manifest 要求：

1. 保留 `name`、`version`、`main`、`bin`、`dependencies`。
2. 删除 root `scripts.postinstall`。
3. 删除或最小化开发、测试、release、download、compiler 相关 scripts，避免误运行开发期流程。
4. 不保留 `devDependencies`。
5. 保留本地 runtime 包依赖：
   - `cc: file:./packages/cc-module`
   - `@cocos/asset-db: file:./packages/asset-db`
6. 保留运行 CLI 所需的普通 dependencies。

团队安装命令固定为：

```powershell
cd <p6Root>\tools\cocos-cli
npm install
node .\dist\cli.js --help
```

依赖包自身的 `install` / `postinstall` 不禁止，由 npm 正常执行。禁止的是发布包 root manifest 触发当前 CLI 开发期 `postinstall`。

## Static Tools 策略

本轮随包提交 `static/` 整体，包括 `static/tools/`。不做工具裁剪。

已知代码会直接或间接使用以下工具目录：

- `static/tools/creator-3.8.6/PVRTexTool_win32/`
- `static/tools/PVRTexTool_win32/`
- `static/tools/libwebp_win32/`
- `static/tools/mali_win32/`
- `static/tools/astc-encoder/`
- `static/tools/cmft/`
- `static/tools/LightFX/`
- `static/tools/cmake/`
- `static/tools/keystore/`

下载清单中还包含 `openSSLWin64`、`Python27-win32`、`xiaomi-pack-tools`、`quickgame-toolkit`、`huawei-rpk-tools`、`unzip.exe` 等平台或渠道工具。本轮保留整套 `static/tools`，用包体换稳定性。

## 使用文档

发布目录应包含中文 README，至少覆盖：

1. 环境要求：Node.js 版本、Windows PowerShell。
2. 首次安装：`npm install`。
3. 基本调用：`node .\dist\cli.js --help`、`preview --runtime`。
4. engine 配置优先级：项目 `cocos-cli.enginePath` 优先，本机 Creator profile 兜底。
5. 当前支持 engine version：`3.8.6`。
6. 常见错误：未配置自定义 engine、profile 缺失、engine path 不存在、未安装依赖、端口占用。
7. 不包含 engine、不包含 `node_modules`、包含 `static/tools`。

文档不得写入当前开发机绝对路径。示例使用 `<p6Root>`、`<projectRoot>`、`<engineRoot>`。

## 测试计划

源码仓库测试：

1. focused unit tests 覆盖 `resolveLauncherEngineRoot()`：
   - `cocos-cli.enginePath` 优先。
   - 相对 `enginePath` 按 project root 解析。
   - project config path 不存在时报错。
   - 无 project config 时读取 Creator profile custom engine。
   - Creator profile 缺失时报错。
   - Creator profile 中 supported version 是内置引擎时报错。
   - Creator profile custom path 不存在时报错。
   - `COCOS_CLI_TEST_ENGINE_ROOT` 仍只在 test project 匹配时生效。
2. runtime package manifest 生成逻辑测试：
   - 不包含 `scripts.postinstall`。
   - 不包含 `devDependencies`。
   - 保留 `bin`、`main`、runtime dependencies、本地 package dependencies。

发布目录测试：

1. 静态校验：
   - `node_modules/` 不存在。
   - `packages/engine/` 不存在。
   - `static/tools/` 存在。
   - 关键工具目录存在。
   - root `package.json` 不包含 `postinstall`。
2. 安装校验：
   - 在 `<p6Root>/tools/cocos-cli` 执行 `npm install`。
3. 运行校验：
   - `node .\dist\cli.js --help`
   - `node .\dist\cli.js preview --runtime --project <projectRoot> --host 127.0.0.1 --port <port>`

本轮不执行 `build` 验证；后续应在明确平台和外部工具链后单独补充。

## 风险与缓解

1. runtime lockfile 与 runtime manifest 不匹配。
   - 发布脚本生成 manifest 后，应在发布目录实际执行 `npm install` 验证。
2. root `postinstall` 遗留导致团队安装触发开发期流程。
   - 发布目录静态校验必须检查 `scripts.postinstall` 不存在。
3. 删除 `packages/engine` 后仍有代码隐式访问 `<cliRoot>/packages/engine`。
   - engine resolver 测试和发布目录 preview smoke 能暴露主要入口问题。
4. `static/tools` 包体较大。
   - 本轮明确不裁剪；后续可基于真实平台和 importer 使用情况做专门裁剪计划。
5. Creator profile fallback 当前只支持 `3.8.6`。
   - supported engine versions 显式集中定义，后续扩展版本时同时补测试。

## 验收标准

1. `tools/cocos-cli` 可纳入 Git，且不包含 `node_modules`、`packages/engine`、本机绝对路径文档。
2. 团队在发布目录执行 `npm install` 不触发 CLI root `postinstall`。
3. `node .\dist\cli.js --help` 在发布目录通过。
4. 未配置项目 `cocos-cli.enginePath` 时，CLI 能从本机 Creator profile 解析 supported version 的 custom engine。
5. 没有项目配置且没有可用 custom engine 时，CLI 以清晰错误退出，不再 fallback 到 `<cliRoot>/packages/engine`。
6. `preview --runtime` 能从发布目录针对目标项目启动到预期阶段。
