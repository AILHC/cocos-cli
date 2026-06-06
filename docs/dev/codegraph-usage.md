# CodeGraph 使用说明

## 使用定位

CodeGraph 是结构化代码索引工具，适合建立 symbol（符号）、文件、调用关系和影响面锚点。它不能替代源码阅读、测试、TypeScript 编译或运行时验证。

在 `runtime-preview` 迁移任务中，CodeGraph 的主要用途是辅助确认：

- `cocos-cli` 中 preview、builder、settings、server middleware 的入口和调用关系。
- `@cocos/asset-db`、`@cocos/ccbuild`、`@cocos/lib-programming` 等 package 的 importer、builder 和配置生成入口。
- Cocos engine 3.8.6 中 `assetManager`、`Bundle`、`downloader`、`parser`、`deserialize`、`editor-path-replace`、`url-transformer` 的真实加载链路。

如果 CodeGraph 返回项目未初始化，先确认索引范围，再执行：

```powershell
rtk powershell -NoProfile -Command "codegraph init 'E:\own_space\engines\cocos-cli'"
```

Cocos engine 目录较大，索引前必须确认目标路径和当前分支状态，不要在未确认时直接初始化或强制重建。

## 推荐项目边界

本任务至少涉及两个独立 CodeGraph 项目：

| 项目 | `projectPath` | 用途 |
| --- | --- | --- |
| `cocos-cli` | `E:\own_space\engines\cocos-cli` | 查询 CLI、runtime-preview、builder、server、tests、`node_modules/@cocos/**` |
| Cocos engine 3.8.6 | `D:\workspace\engines\cocos\3.8.6` | 查询 engine runtime、internal assets、PAL、adapter、asset loading |

两个索引不会自动合并。跨项目结论需要分别查询后人工组合，不要把 `cocos-cli` 的调用图结果当成 engine runtime 调用链证明。

`library`、`temp`、cache、build output 和 `.codegraph/` 本身不应作为主索引事实来源。它们可以作为产物对照，但不能替代源码链路。

## 优先工具

| 目标 | 优先使用 |
| --- | --- |
| 找 symbol 定义 | `codegraph_search` |
| 读取函数/类源码 | `codegraph_node`，需要源码时设置 `includeCode=true` |
| 找调用方 | `codegraph_callers` |
| 找被调用方 | `codegraph_callees` |
| 看影响面 | `codegraph_impact` |
| 看目录或测试文件候选 | `codegraph_files` |
| 验证精确静态调用路径 | `codegraph_trace` |
| 批量查看相关源码 | `codegraph_explore` |
| 检查索引状态 | `codegraph_status` |

跨项目或非当前工作区查询时，必须显式传 `projectPath`。

## 推荐流程

### 已知 symbol

1. 用 `codegraph_search` 找目标 symbol。
2. 用 `codegraph_node(includeCode=true)` 确认完整 `qualifiedName`、文件和源码。
3. 用 `codegraph_callers` / `codegraph_callees` 扩展直接关系。
4. 需要影响面时用 `codegraph_impact`，但只把结果当候选集合。
5. 需要静态路径时，用已确认的完整 from/to symbol 调 `codegraph_trace`。

### runtime-preview 事实链

先拆成若干锚点：CLI command、launcher、server、middleware、settings generator、asset-db import、bundle config、engine downloader/parser。分别用 `search/node/files` 找入口，再组合 `callers/callees/impact/trace`。最后必须读取源码和产物路径确认语义。

### asset-db 和 node_modules

`node_modules/@cocos/**` 是本任务的有效源码范围，但不能把整个 `node_modules` 作为无边界上下文阅读。优先查询已知 package：

- `E:\own_space\engines\cocos-cli\node_modules\@cocos\asset-db`
- `E:\own_space\engines\cocos-cli\node_modules\@cocos\ccbuild`
- `E:\own_space\engines\cocos-cli\node_modules\@cocos\lib-programming`
- 必要时补充 `@cocos/quick-compiler`

如果 CodeGraph 对 `node_modules/@cocos/**` 的覆盖不足，使用 `rg` 精确定位后再决定是否单独建受控索引。

### 测试候选

测试侧 import/call 不一定进入 `callers` 或 `impact` 图关系。查测试时配合 `codegraph_files`、`codegraph_search` 和直接读取测试文件。

## 降级规则

- 默认不要使用 `codegraph_context` 构建答案上下文。它只有自然语言 `task` 参数，entry point selection（入口点选择）可能跑偏。
- `codegraph_context` 只能作为低信任候选线索；不能把它的结果直接当完整上下文。
- `codegraph_trace` 只用于验证已确认完整 symbol 之间的静态 `calls` 路径。动态分发、事件桥接、运行时调度、同名方法和弱限定名都可能导致 no path 或误判。
- `codegraph_callers` / `codegraph_impact` 对测试侧 import/call 不稳定。查测试影响时同时用 `codegraph_files`、`codegraph_search` 和直接读取测试文件。
- `codegraph_impact` 可辅助看影响面，但大系统类、入口类或生命周期方法会产生过宽结果。按模块边界、调用方向、文件路径和测试覆盖面筛选。
- 对 import alias（导入别名）、barrel/re-export（聚合导出）和 typed property access（类型属性访问）问题，CodeGraph 可能只能给出文本或近似 symbol 线索。定位候选后读取导出文件、`tsconfig` path alias（路径别名）配置和实际 import 链确认。

## 和其他工具的分工

| 工具 | 优先场景 |
| --- | --- |
| `rg` | 文本、日志、配置、产物路径、URL、uuid、文件名精确查询 |
| CodeGraph | symbol、调用方、被调用方、影响面、静态调用路径、源码批量锚点 |
| Semble | chunk-level retrieval（片段级召回）、文档/配置/相似实现候选；不能当作调用链证明 |
| 源码阅读 | 最终语义确认 |
| 测试/运行 | 最终行为确认 |

## 验证命令

只读检查：

```powershell
rtk powershell -NoProfile -Command "codegraph --version"
rtk powershell -NoProfile -Command "codegraph status 'E:\own_space\engines\cocos-cli' --json"
rtk powershell -NoProfile -Command "codegraph status 'D:\workspace\engines\cocos\3.8.6' --json"
```

如果需要初始化当前项目：

```powershell
rtk powershell -NoProfile -Command "codegraph init 'E:\own_space\engines\cocos-cli'"
```

如果需要初始化 engine 项目，先确认 Creator/preview 进程已停止、engine 分支和工作区状态符合当前 handoff 文档，再执行：

```powershell
rtk powershell -NoProfile -Command "codegraph init 'D:\workspace\engines\cocos\3.8.6'"
```

不要在未确认索引范围时删除 `.codegraph/` 或执行强制重建。
