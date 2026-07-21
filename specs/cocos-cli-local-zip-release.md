# Cocos CLI 本地 ZIP 发布规范

**状态：** `implemented`

## 目标

在当前 Cocos CLI 仓库中生成一个不参与版本管理的完整运行时 ZIP，替代向外部业务 `tools` 仓库复制 CLI 的旧发布方式。

## 发布契约

- 执行 `npm run release:tools` 时先完成 CLI build，再生成发布物。
- 发布目录固定为仓库根目录的 `publish/`，并由 Git 忽略。
- 文件名固定为 `cocos-cli-v<version>.zip`；`version` 来自根 `package.json`。
- ZIP 的解压根目录固定为 `cocos-cli/`。
- 发布包包含完整 `static/`，包括 `static/tools/`，不再拆分独立 tools ZIP。
- 发布包包含编译后的 runtime、必要的 runtime packages、使用文档、`install-cocos-cli.cmd` 和 `preview-runtime.cmd`。
- 发布包排除 `node_modules`、`packages/engine`、开发源码、测试和缓存。
- 同版本 ZIP 已存在时发布失败，不静默覆盖；只有提升 CLI version 后才能生成新版本。
- 发布过程不执行 Git、SBG、SVN 或外部仓库操作。

## 验收

- 自动测试验证单 ZIP 的名称、根目录、`static/tools`、runtime metadata 和排除项。
- 自动测试验证同版本冲突，以及失败时不残留 partial ZIP。
- 真实发布后解压 ZIP，确认 `static/tools` 存在，执行 `npm install` 和 `node dist/cli.js --help`。
