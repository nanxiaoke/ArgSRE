# 数据源目录与复用编排

数据源目录把认证、请求、人工导入和字段提取配置从具体业务工作流中抽离。多个日报或后续业务模块可以按稳定 ID 引用同一个数据源，避免重复维护。

## 核心边界

- 目录负责定义如何获得标准记录。
- 工作流负责选择数据源、生成报告和发送消息。
- 工作流只保存数据源 ID，不复制认证或请求配置。
- 目录是内网私有配置，真实 URL、请求头和文件路径不得提交到外网。
- 管理命令只输出非敏感元数据。

## 目录格式

```json
{
  "version": 1,
  "dataSources": [
    {
      "id": "operations-source",
      "name": "Operations source",
      "type": "browser-http",
      "enabled": true,
      "owner": "sre-operations",
      "tags": ["operations", "daily-report"]
    }
  ]
}
```

每个条目还需要包含对应类型的完整执行配置：

- `browser-http`：浏览器认证、HTTP 请求和字段提取。
- `manual-file`：JSON/CSV 文件和字段提取。

元数据：

- `enabled`：可选，默认为 `true`。设为 `false` 后不可被工作流引用。
- `owner`：可选，记录维护团队或责任人。
- `tags`：可选，用于模块、场景和能力分类。

数据源 ID 在目录中必须唯一。ID 应保持稳定，名称、责任人和实现方式可以演进。

## 工作流引用

内联数据源：

```json
{
  "dataSource": {}
}
```

目录引用：

```json
{
  "dataSourceCatalog": "data-sources.json",
  "dataSourceRefs": [
    "operations-source",
    "capacity-source"
  ]
}
```

约束：

- 内联配置和目录引用不能混用。
- `dataSourceRefs` 必须非空且不能重复。
- 不存在的引用返回 `CAT-REF-001`。
- 被禁用的引用返回 `CAT-REF-002`。
- 目录路径相对工作流配置文件所在目录解析。
- 数据源内部的文件路径和现有配置一致，相对任务工作目录解析。

目录解析发生在工作流配置校验之前。解析完成后会转换成普通 `dataSources`，采集、历史、报告和消息模块不需要感知目录。

## 内网初始化

在 `examples/browser-data-collector` 下：

```bash
mkdir -p runtime/local-config
cp config/data-source-catalog.example.json runtime/local-config/data-sources.json
cp config/daily-report-catalog.example.json runtime/local-config/daily-report.json
```

编辑工作流中的目录路径：

```json
{
  "dataSourceCatalog": "data-sources.json"
}
```

真实数据源目录保存在 `runtime/local-config/`，已被 Git 忽略。

## 管理命令

校验目录：

```bash
npm run catalog:validate -- \
  --catalog runtime/local-config/data-sources.json
```

列出全部非敏感元数据：

```bash
npm run catalog:list -- \
  --catalog runtime/local-config/data-sources.json
```

按标签和状态筛选：

```bash
npm run catalog:list -- \
  --catalog runtime/local-config/data-sources.json \
  --tag operations \
  --status enabled
```

输出机器可读 JSON：

```bash
npm run catalog:list -- \
  --catalog runtime/local-config/data-sources.json \
  --format json
```

`--status` 支持 `all`、`enabled`、`disabled`。列表输出只包含：

- ID 和名称。
- 类型和启用状态。
- 责任人和标签。

不会输出 URL、请求头、请求体、认证选择器或导入文件路径。

## 工作流验证

```bash
npm run daily:validate -- \
  --config runtime/local-config/daily-report.json

npm run daily:once -- \
  --config runtime/local-config/daily-report.json \
  --dry-run true
```

通过条件：

- 目录和工作流配置均通过校验。
- 引用的数据源数量与预期一致。
- `data-source-audits.json` 中出现对应 ID。
- 审计包含 `sourceType`、`owner` 和 `tags`。
- 禁用未引用的数据源不会执行。
- Dry-run 不调用真实 IM。

## 变更流程

1. 在内网修改目录副本。
2. 执行 `catalog:validate`。
3. 执行 `catalog:list`，检查启用状态和标签。
4. 对受影响工作流执行 `daily:validate`。
5. 使用 Dry-run 验证记录和报告。
6. 再恢复正式调度。

禁用数据源优先使用 `"enabled": false`，不要立即删除。确认没有工作流引用并完成观察期后再清理条目。

当前目录采用 JSON 配置即代码方式，不提供运行时在线修改，避免在隔离环境中引入额外状态和权限面。后续运营平台可以在此契约上增加只读目录页面、审批发布和版本记录。
