# Runtime Preview Reference Temp Programming

记录时间：2026-06-06

## 来源

- Project temp: `E:\own_space\cocos_work_lab_38x\temp`
- Programming source: `E:\own_space\cocos_work_lab_38x\temp\programming`
- Reference copy: `E:\own_space\engines\cocos-cli\.codex-tmp\reference-temp\cocos_work_lab_38x-editor-programming-20260606`
- Reference index: `E:\own_space\engines\cocos-cli\.codex-tmp\reference-temp\cocos_work_lab_38x-editor-programming-20260606-index`

## 冻结结果

- File count: `936`
- Total bytes: `15544837`
- Preview target files: `466`
- Editor target files: `466`
- SystemJS files: `2`

## 已复制范围

本次只冻结编辑器代码编译结果相关子集：

- `temp\tsconfig.cocos.json`
- `temp\programming\custom-macro.js`
- `temp\programming\preview\systemjs\**`
- `temp\programming\packer-driver\targets\preview\**`
- `temp\programming\packer-driver\targets\editor\**`

其中 `targets/preview` 是 runtime preview 最关键的脚本编译参考；`targets/editor` 用作 Creator editor 编译语义对照；`.map` 文件保留用于从 chunk 反查源文件和 module 关系。

## 明确排除范围

以下内容未冻结：

- `temp\programming\packer-driver\logs\**`
- `temp\logs\**`
- `temp\node.localStorage\**`
- `temp\writablePath\**`
- `temp\asset-db\**`
- `temp\builder\**`
- `temp\declarations\**`
- `temp\profiles\**`
- `temp\scene\**`

排除原因：这些目录更接近运行状态、日志、缓存或非本轮“编辑器代码编译结果”核心参考。后续如发现某个目录对 preview facts 必不可少，应单独说明原因后再冻结，不应把整个 `temp` 一次性纳入参考。

## 已保存清单

Reference index 中已生成：

- `summary.json`
- `all-files.txt`
- `preview-target-files.txt`
- `editor-target-files.txt`
- `key-files.txt`
- `extension-counts.tsv`

## 关键文件

| 文件 | 用途 |
| --- | --- |
| `tsconfig.cocos.json` | Creator 生成的项目脚本 TypeScript 配置参考 |
| `programming/custom-macro.js` | Creator 生成的 custom macro 参考 |
| `programming/preview/systemjs/system.js` | preview SystemJS runtime 参考 |
| `programming/packer-driver/targets/preview/import-map.json` | preview module specifier 到 chunk 的映射 |
| `programming/packer-driver/targets/preview/main-record.json` | preview 编译主记录 |
| `programming/packer-driver/targets/preview/assembly-record.json` | preview assembly/module 记录 |
| `programming/packer-driver/targets/preview/chunks/**` | preview 编译后的 chunk 与 sourcemap |
| `programming/packer-driver/targets/editor/import-map.json` | editor module specifier 到 chunk 的映射 |
| `programming/packer-driver/targets/editor/main-record.json` | editor 编译主记录 |
| `programming/packer-driver/targets/editor/assembly-record.json` | editor assembly/module 记录 |
| `programming/packer-driver/targets/editor/chunks/**` | editor 编译后的 chunk 与 sourcemap |

## 使用边界

- Reference copy 只作为 Creator editor-generated script compilation result 对照。
- 不提交 reference copy。
- 不把日志、localStorage、writablePath 或 asset-db cache 当作源码事实。
- 后续事实文档应使用 `preview/import-map.json` 和 `preview/chunks/**` 解释 project script class registration、`dependScripts`、SystemJS module resolution 和 preview launch 行为。
