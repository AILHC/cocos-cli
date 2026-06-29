# Cocos CLI tools helper scripts 设计

## 背景

`cocos-cli` 已通过 `release:tools` 发布到 `<p6Root>/tools/cocos-cli`，发布包不包含 `node_modules`，团队成员首次使用需要在发布目录执行 `npm install`。当前 runtime preview 的常用启动命令较长，且新增 `--watch-assets`、`--refresh-on-reload` 后，手工输入容易漏参数。

本设计新增两个随 tools 发布的 Windows 双击友好脚本：

1. CLI 安装脚本：放在 `tools/cocos-cli` 根目录，用于安装依赖并 link 全局命令。
2. 项目预览启动脚本模板：放在 `tools/cocos-cli` 发布包中，复制到 Cocos 项目根目录后可直接启动 runtime preview。

## 目标

- 团队成员可以双击安装脚本完成 `npm install` 和 `npm link`。
- 全局命令沿用现有 `package.json` 的 `bin`：`cocos`，不新增 `cc-cli`。
- 用户把预览脚本复制到项目根目录后，可以双击启动：
  - `cocos preview --runtime`
  - 自动传入当前项目路径。
  - 默认开启 `--watch-assets` 和 `--refresh-on-reload`。
- 脚本不写死开发机路径，也不写死 `<p6Root>/tools/cocos-cli` 路径。
- `release:tools` 发布时携带并校验这两个脚本。

## 非目标

- 不实现跨平台 shell 脚本；本轮面向 Windows 双击使用。
- 不新增全局命令名；不修改 `bin` 为 `cc-cli`。
- 不实现复杂项目探测，不扫描 `assets/`、`settings/`、`library/`。
- 不在预览脚本里自动查找或安装 `tools/cocos-cli`。
- 不改变 runtime preview 当前 reload 生效策略；脚本只是默认打开已有能力。

## 脚本格式

入口脚本使用 `.cmd`。

原因：

- Windows 双击 `.cmd` 比 `.ps1` 更稳定，不受 PowerShell execution policy 和默认打开方式影响。
- 需要的逻辑很少，`.cmd` 足够表达。
- 需要读取 `package.json` 时，可从 `.cmd` 调用 `node -e`，避免手写脆弱的字符串匹配。

## CLI 安装脚本

建议文件名：`install-cocos-cli.cmd`。

放置位置：

- 源仓库：`workflow/tools-runtime-scripts/install-cocos-cli.cmd`。
- 发布结果：`<p6Root>/tools/cocos-cli/install-cocos-cli.cmd`。

行为：

1. `cd /d "%~dp0"`，确保当前目录切到脚本所在的 `tools/cocos-cli`。
2. 检查 `node` 和 `npm` 可用；不可用时提示并暂停。
3. 执行 `npm install`。
4. `npm install` 成功后执行 `npm link`。
5. `npm link` 成功后提示可使用 `cocos --help` 验证。
6. 任一步失败时输出明确错误，暂停窗口，并以非零退出码结束。

说明：

- `cd /d "%~dp0"` 不是写死路径；它只是消除双击时工作目录不稳定的问题。
- 安装脚本不提交 `node_modules`；`node_modules/` 仍由发布包 `.gitignore` 忽略。

## 项目预览启动脚本

建议文件名：`preview-runtime.cmd`。

放置位置：

- 源仓库：`workflow/tools-runtime-scripts/preview-runtime.cmd`。
- 发布包中提供模板：`<p6Root>/tools/cocos-cli/preview-runtime.cmd`。
- 使用方式：用户复制到 Cocos 项目根目录后双击。

行为：

1. `cd /d "%~dp0"`，把当前目录切到脚本所在项目目录。
2. 用 Node 读取当前目录的 `package.json`。
3. 判断这是 Cocos 项目：
   - `package.json` 必须是合法 JSON。
   - `package.json.creator.version` 必须存在且为字符串。
4. 检查全局 `cocos` 命令可用；不可用时提示先运行 `install-cocos-cli.cmd`。
5. 执行：

```cmd
cocos preview --runtime --project "%CD%" --watch-assets --refresh-on-reload
```

6. CLI 退出后保留窗口，方便用户看到端口、错误或退出原因。

项目判断选择：

- 只读 `package.json`，不额外检查 `assets/`、`settings/`。
- 使用 `creator.version` 作为最小项目标识，匹配当前 feature-c 和主测试项目事实。

## Release 集成

`release:tools` 需要更新：

- 将 `workflow/tools-runtime-scripts/install-cocos-cli.cmd` 复制到发布目录根部。
- 将 `workflow/tools-runtime-scripts/preview-runtime.cmd` 复制到发布目录根部。
- `assertReleaseDirectory()` 校验：
  - `install-cocos-cli.cmd` 存在。
  - `preview-runtime.cmd` 存在。
- `README.md` 增加使用说明：
  - 双击 `install-cocos-cli.cmd` 完成安装。
  - 将 `preview-runtime.cmd` 复制到项目根目录。
  - 双击 `preview-runtime.cmd` 启动 runtime preview。
  - 默认启用 `--watch-assets` 和 `--refresh-on-reload`。

发布包仍然保持：

- 不包含 `node_modules/`。
- 不包含 `packages/engine/`。
- 不包含本机绝对路径。

## 错误处理

安装脚本：

- Node.js 不存在：提示安装 Node.js。
- npm 不存在：提示检查 Node.js/npm 安装。
- `npm install` 失败：提示依赖安装失败，并保留 npm 输出。
- `npm link` 失败：提示全局 link 失败，并保留 npm 输出。

预览脚本：

- `package.json` 不存在：提示脚本必须放在 Cocos 项目根目录。
- `package.json` 非合法 JSON：提示文件解析失败。
- 缺少 `creator.version`：提示当前目录不像 Cocos 项目。
- `cocos` 命令不存在：提示先运行 `tools/cocos-cli` 下的安装脚本。
- preview 启动失败：保留 CLI 输出和退出码。

## 验证

实现完成后至少验证：

1. `npm run build` 通过。
2. `release:tools -- --target <target>` 后发布目录包含两个脚本。
3. 发布目录执行安装脚本：
   - `npm install` 成功。
   - `npm link` 成功。
   - `cocos --help` 可运行。
4. 将 `preview-runtime.cmd` 复制到真实 Cocos 项目根目录，启动命令包含：
   - `preview --runtime`
   - `--project <项目根目录>`
   - `--watch-assets`
   - `--refresh-on-reload`
5. 将 `preview-runtime.cmd` 放到非 Cocos 目录时，脚本拒绝启动并提示原因。

真实项目验证应清理无关 `COCOS_CLI_TEST_*` 环境变量，不能把测试 env 当作 production 前提。

## 风险

- 用户机器没有 Node.js 或 npm：安装脚本只能提示，不能自动安装。
- 全局已有旧 `cocos` link：`npm link` 会覆盖或更新到当前发布目录，README 需要说明以当前目录为准。
- 双击窗口关闭过快：脚本应在成功和失败路径都 pause，方便读取输出。
- 项目识别过简：只读 `package.json.creator.version`，可能拒绝非标准项目；这是本轮有意选择，避免目录扫描和误判复杂化。
