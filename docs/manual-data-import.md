# 人工数据导入

当自动认证或网页采集暂时不可用时，可以使用 `manual-file` 数据源导入 JSON 或 CSV 文件。人工导入只替换数据获取环节，字段提取、历史快照、趋势、报告和消息发送仍使用同一套工作流。

## 快速验证

在 `examples/browser-data-collector` 下执行：

```bash
npm run daily:validate -- --config config/daily-report-manual.example.json
npm run daily:once -- --config config/daily-report-manual.example.json --dry-run true
```

预期结果：

- 配置校验输出 `PASS`。
- 日报完成并导入 2 条记录。
- 运行目录生成 `records.json`、`data-source-audits.json`、报告和图表。
- `message-preview.json` 写入本地，不调用真实 IM。

## 数据源配置

```json
{
  "type": "manual-file",
  "id": "manual-operations-source",
  "name": "Manual operations import",
  "file": {
    "path": "runtime/imports/services.csv",
    "format": "csv",
    "encoding": "utf8",
    "maxAgeHours": 24
  },
  "extract": {
    "recordPath": ["records"],
    "fields": {
      "serviceId": "serviceId",
      "serviceName": "serviceName",
      "alarmCount": "alarmCount"
    },
    "primaryKey": "serviceId"
  }
}
```

约束：

- `format` 支持 `json` 和 `csv`。
- 当前编码仅支持 `utf8`。
- 相对路径以执行命令时的当前目录为基准。
- 建议真实导入文件放在 `runtime/imports/`，该目录不会进入 Git。
- `maxAgeHours` 可选。超过时限的文件会以 `ManualFileStaleError` 拒绝导入。

## CSV 规则

- 第一行为唯一且非空的列名。
- 支持双引号字段、逗号和双引号转义。
- 每行列数必须与表头一致。
- CSV 会先转换为 `{ "records": [...] }`，因此 `recordPath` 固定使用 `["records"]`。
- CSV 值默认为字符串。报告计算数值时会进行数字转换，后续平台化时应增加显式字段类型。

模板见：

```text
examples/browser-data-collector/config/manual-data.example.csv
```

## JSON 规则

JSON 可以保留嵌套结构，由 `recordPath` 定位记录数组，再由 `extract.fields` 使用点路径提取字段。

```json
{
  "records": [
    {
      "service": {
        "id": "service-001",
        "name": "DWS"
      },
      "metrics": {
        "alarmCount": 1
      }
    }
  ]
}
```

对应字段映射：

```json
{
  "recordPath": ["records"],
  "fields": {
    "serviceId": "service.id",
    "serviceName": "service.name",
    "alarmCount": "metrics.alarmCount"
  },
  "primaryKey": "serviceId"
}
```

## 自动采集降级

可以在 `dataSources` 中同时配置浏览器数据源和人工数据源。二者独立执行：

- 自动采集成功、人工文件不存在：生成 `partial_success` 报告。
- 自动采集失败、人工文件有效：使用人工数据生成 `partial_success` 报告。
- 两者都成功：合并记录，并通过 `_sourceId` 区分来源。
- 全部失败：不发送空业务报告，只记录失败审计并按阈值通知。

若人工文件是自动采集的替代数据，而不是补充数据，不应长期同时启用二者，以免重复统计。当前 MVP 不自动按主键跨数据源去重。

## 审计与安全

人工导入审计记录：

- 文件名，不记录完整路径。
- 格式、文件大小、修改时间和文件年龄。
- SHA-256 摘要。
- 导入记录数和执行状态。

审计不会复制原始文件内容。真实导入文件、标准记录和报告都必须保留在内网 `runtime/` 下，不应提交或反馈到外网。

## 独立测试

```bash
npm run test:manual
```

该测试覆盖：

- 嵌套 JSON 字段提取。
- 带逗号和引号的 CSV。
- CSV 列数错误。
- 过期文件拒绝。
