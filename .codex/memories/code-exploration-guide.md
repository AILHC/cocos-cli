# CodeGraph 使用指南

CodeGraph 用于代码结构探索、symbol 定位、调用关系、影响面分析和相关测试候选定位。

## 使用场景

- 查 symbol 定义：`codegraph_search`
- 查调用方：`codegraph_callers`
- 查被调用方：`codegraph_callees`
- 查调用路径：`codegraph_trace`
- 查变更影响面：`codegraph_impact`
- 查单个 symbol 源码和签名：`codegraph_node`
- 获取任务相关上下文：`codegraph_context`
- 批量查看相关 symbol 源码：`codegraph_explore`
- 查看文件结构：`codegraph_files`
- 查看索引状态：`codegraph_status`

## 使用规则

- 结构性问题优先使用 CodeGraph；文本、日志、配置字面量查询仍优先使用 `rg`。
- “X 怎么工作”“架构是什么”这类问题，优先从 `codegraph_context` 开始。
- “X 如何到达 Y”这类 flow 问题，优先使用 `codegraph_trace`。
- 已经拿到多个相关 symbol 时，用 `codegraph_explore` 批量读取，不要循环读取多个文件。
- 修改文件后索引可能有短暂延迟；不要在同一瞬间反复查询刚改过的 symbol。
- 如果项目没有 `.codegraph/`，先确认是否需要初始化索引，再运行 `codegraph init -i`。
