# Runtime Preview Reference Library

记录时间：2026-06-06

## 来源

- Project root: `E:\own_space\cocos_work_lab_38x`
- Editor-generated library: `E:\own_space\cocos_work_lab_38x\library`
- Reference copy: `E:\own_space\engines\cocos-cli\.codex-tmp\reference-library\cocos_work_lab_38x-editor-library-20260606`
- Reference index: `E:\own_space\engines\cocos-cli\.codex-tmp\reference-library\cocos_work_lab_38x-editor-library-20260606-index`

## 冻结结果

- File count: `1083`
- Total bytes: `86902048`
- Layout: uuid/hash bucket，例如 `08/0835f102-5471-47a3-9a76-01c07ac9cdb2/OpenSans-Regular.ttf`
- Metadata files: `8`
- Serialized JSON files: `839`
- Native-like files: `230`
- Non-JSON files: `236`

本次样本不是顶层 `import/`、`native/`、`internal/` 目录布局，而是 Creator editor `library` 的 uuid/hash 分桶布局。后续 runtime URL 映射不能继续假设存在 `library/import/**` 和 `library/native/**` 目录，必须基于 metadata 和 per-uuid file 事实确认。

## 已保存清单

Reference index 中已生成：

- `summary.json`
- `all-files.txt`
- `metadata-files.txt`
- `serialized-json-files.txt`
- `native-like-files.txt`
- `non-json-files.txt`
- `extension-counts.tsv`
- `.assets-data.json`
- `.assets-dependency.json`
- `.assets-info1.0.0.json`
- `.internal-data.json`
- `.internal-dependency.json`
- `.internal-info1.0.0.json`
- `.view-state-group-data.json`
- `.view-state-group-info1.0.0.json`

## 扩展名分布

| Count | Extension |
| ---: | --- |
| 847 | `.json` |
| 185 | `.png` |
| 13 | `.atlas` |
| 13 | `.bin` |
| 10 | `.jpg` |
| 6 | no extension |
| 4 | `.ttf` |
| 2 | `.plist` |
| 1 | `.zip` |
| 1 | `.cconb` |
| 1 | `.mp4` |

## 已确认样例

| 类型 | 样例 |
| --- | --- |
| Project metadata | `.assets-data.json` |
| Internal metadata | `.internal-data.json` |
| Serialized JSON | `00/00614c43-17eb-4463-be7a-c162c2b92d43.json` |
| Texture/Image native-like | `01/014b2d77-d625-4e91-9e51-081e353db503.png` |
| TTF native-like | `08/0835f102-5471-47a3-9a76-01c07ac9cdb2/OpenSans-Regular.ttf` |
| Spine/atlas native-like | `0d/0d687c8c-1928-4af0-8caa-195c7cd6ada3.atlas` |
| Binary native-like | `12/1263d74c-8167-4928-91a6-4e2672411f47@17020.bin` |

## 使用边界

- Reference copy 只作为 Creator editor-generated `library` 结构对照。
- 不提交完整 `library`。
- 不把 `temp` 或 engine cache 当作源码事实。
- 不把 native-like 扩展名直接等同于 runtime native URL；必须结合 metadata、bundle config 和 engine runtime downloader/parser 决策确认。
- 资源类型矩阵后续应从 `.assets-data.json`、`.assets-info1.0.0.json`、per-uuid `.json` 和真实 engine parser 行为共同生成。

## 后续必须补充的索引

下一步事实分析需要生成 `asset-type-matrix.json` 或等价文档，至少包含：

- `uuid`
- `db://` URL
- resource type
- serialized JSON path
- native-like dependency paths
- dependency uuid list
- bundle/resource path
- engine parser/downloader entry

该矩阵生成前，不应把 URL resolver 写死为某一种目录布局。
