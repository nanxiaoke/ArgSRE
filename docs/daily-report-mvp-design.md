# 每日自动采集与报告 MVP 设计

## 1. MVP 目标

每天定时执行一次：

1. 打开目标页面建立合法认证会话。
2. 处理有效认证或快速认证。
3. 使用共享会话发送纯 HTTP 数据请求。
4. 将响应提取为标准记录。
5. 组装业务汇总数据。
6. 生成 Markdown 报告和 SVG 图表。
7. 通过独立消息通道适配器发送报告。

如果认证长期超时并需要人工指纹：

1. 数据源层产生 `fingerprint_required` 事件。
2. 工作流通过消息通道发送人工认证提醒。
3. 本次业务报告任务安全停止。
4. 人工完成认证后重新执行任务。

平台不绕过指纹认证。

## 2. 分层原则

### 2.1 数据源层

位置：

```text
src/core/data-source-dispatcher.js
src/core/data-source-runner.js
src/core/manual-file-runner.js
```

职责：

- 按数据源类型分派获取适配器。
- 打开浏览器并建立认证会话。
- 自动处理快速认证。
- 产生人工认证事件。
- 使用浏览器上下文的 HTTP 客户端发送请求。
- 从人工 JSON 或 CSV 文件导入记录。
- 校验人工文件新鲜度并记录文件摘要。
- 提取标准记录。
- 输出数据源审计。

数据源层不知道：

- 报告标题。
- 图表形式。
- IM 消息格式。
- 业务模块如何使用数据。

### 2.2 业务报告层

位置：

```text
src/core/report-builder.js
```

职责：

- 消费标准记录。
- 计算业务汇总。
- 生成 Markdown。
- 生成 SVG 图表。
- 生成通用报告消息对象。

业务报告层不知道：

- 数据来自哪个网页。
- 如何认证。
- 消息最终发到哪个 IM。

### 2.3 消息通道层

位置：

```text
src/adapters/message-sender.js
```

职责：

- 接收通用消息对象。
- 转换并发送到具体消息通道。
- 返回消息通道结果。

当前实现：

- JSON Webhook。

后续可以增加：

- 内部 IM 机器人。
- 文件上传加卡片消息。
- 邮件。
- 工单。
- 本地文件。

消息通道层不知道：

- 如何采集数据。
- 如何计算报表。

### 2.4 工作流层

位置：

```text
src/daily-report.js
```

职责：

- 编排数据源、业务报告和消息发送。
- 将认证事件转给消息通道。
- 保存本次运行产物和审计。

### 2.5 调度层

位置：

```text
src/daily-scheduler.js
```

职责：

- 根据本地时间每天触发一次工作流。

生产环境更推荐由操作系统任务计划每天调用一次 `daily-report.js`。这样即使 Node 进程退出或机器重启，也由系统调度器负责恢复。

### 2.6 配置校验层

位置：

```text
src/core/config-validator.js
```

职责：

- 在启动浏览器前检查必填字段。
- 检查绝对 URL、HTTP 方法、字段路径、主键和调度时间。
- 检查重试、幂等和失败通知参数。
- 输出稳定错误码和字段路径。

### 2.7 可靠性状态

位置：

```text
src/core/retry.js
src/core/idempotency.js
src/core/workflow-state.js
```

职责：

- 对网络错误、429 和 5xx 做有限重试。
- 防止同一日报重复发送。
- 记录连续失败次数。
- 达到阈值后发送失败通知。
- 指纹等待记录为 `blocked`，不计入连续技术失败。

### 2.8 历史与趋势层

位置：

```text
src/core/history-store.js
src/core/trend-builder.js
```

职责：

- 保存标准记录快照。
- 按天聚合服务数、实例数和告警数。
- 生成 7/30 天趋势数据。
- 生成 SVG 趋势图。
- 按保留周期逐文件清理过期快照。

历史层不保存浏览器会话或原始响应。

### 2.9 多数据源编排

工作流支持：

```json
{
  "dataSource": {}
}
```

或：

```json
{
  "dataSources": [
    {},
    {}
  ]
}
```

约束：

- 两种配置只能选择一种。
- 数据源 ID 必须唯一。
- 数据源顺序执行并独立审计。
- 单个失败不阻塞其他数据源。
- 至少一个成功时生成部分成功报告。
- 全部失败时工作流失败。
- 全部等待认证时工作流阻塞。

### 2.10 人工导入数据源

`manual-file` 与默认的 `browser-http` 使用相同标准记录输出：

- 支持 UTF-8 JSON 和 CSV。
- JSON 使用通用 `recordPath` 和字段点路径。
- CSV 先转换为统一记录数组，再使用相同字段映射。
- 可配置 `maxAgeHours`，避免误用过期文件。
- 审计记录文件名、大小、修改时间、年龄和 SHA-256，不复制原始内容。
- 可以与浏览器数据源共同参与 `dataSources` 编排。

详细配置和验收见 `docs/manual-data-import.md`。

### 2.11 数据源目录

位置：

```text
src/core/data-source-catalog.js
src/core/workflow-config-loader.js
src/catalog.js
```

职责：

- 校验平台级数据源目录。
- 根据稳定 ID 将目录条目解析到工作流。
- 阻止不存在或已禁用的数据源执行。
- 为人工管理和后续运营平台输出非敏感元数据。
- 保持现有内联数据源配置兼容。

工作流可以使用 `dataSourceCatalog + dataSourceRefs`，但不能与
`dataSource/dataSources` 混用。解析后仍转换为普通 `dataSources`，
下游模块不依赖目录实现。

详细说明见 `docs/data-source-catalog.md`。

### 2.12 数据质量门禁

位置：

```text
src/core/data-quality.js
```

质量检查位于标准记录提取之后、历史快照和报告之前。浏览器采集与人工导入共用相同规则：

- 最少记录数。
- 必填字段。
- 唯一字段。
- 数据新鲜度。
- 数值范围。

`warn` 模式保留数据并将问题写入报告；`fail` 模式拒绝当前数据源，但不阻塞其他数据源。质量审计不保存触发问题的真实值，只记录规则、字段、影响数量和记录索引。

详细说明见 `docs/data-quality-gates.md`。

## 3. 配置分区

配置文件分为独立部分：

```json
{
  "name": "workflow-name",
  "dataSource": {},
  "businessReport": {},
  "messageChannel": {},
  "schedule": {}
}
```

### dataSource

定义认证、HTTP 请求和字段提取。

### businessReport

定义报告标题和图表字段。

### messageChannel

定义消息适配器类型、地址和必要请求头。

### schedule

定义每日触发时间。

### reliability

定义：

- 数据请求重试次数和超时。
- 消息发送重试次数和超时。
- 幂等有效时间。
- 连续失败通知阈值。

### history

定义：

- 趋势统计天数。
- 历史保留天数。
- 趋势图指标和标题。

## 4. 运行产物

每次运行写入：

```text
runtime/daily-reports/<run-id>/
```

成功任务：

- `data-source-audit.json`
- `records.json`
- `report.json`
- `report.md`
- `chart.svg`
- `trend.json`
- `trend-chart.svg`
- `data-quality-audit.json`
- `workflow-audit.json`

认证阻塞或失败任务：

- `data-source-audit.json`
- `workflow-audit.json`

其他状态：

```text
runtime/idempotency/
runtime/state/
runtime/history/
```

Dry-run 会额外生成：

```text
message-preview.json
```

所有产物只保存在内网本地，不进入 Git。

## 5. 当前限制

- HTTP 请求目前支持 GET/POST 等通用方法和 JSON body。
- 图表目前为单指标水平柱状图。
- 消息适配器目前是通用 JSON Webhook。
- 不同内部 IM 可能需要先上传图片，再发送卡片，需要新增专用适配器。
- 调度器使用运行机器的本地时区。
- 需要指纹认证时无法无人值守完成。
- 暂未实现多实例分布式锁和跨机器幂等。
- 暂未实现历史趋势数据库。
- 历史 MVP 使用文件快照，后续可以迁移到 SQLite 或平台数据库。

## 6. 后续演进

1. 根据真实数据源完善请求参数和分页。
2. 将业务报告配置化为多个指标和图表。
3. 实现内部 IM 专用适配器。
4. 增加报告发送幂等键。
5. 增加失败重试和连续失败告警。
6. 增加历史数据存储与趋势图。
7. 将数据源注册到平台级数据源目录，供其他业务模块复用。
