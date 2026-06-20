# 数据质量门禁

数据请求返回成功不代表数据可直接用于运营判断。ArgSRE 在标准记录提取后、写入历史和生成报告前执行数据质量检查，使自动采集和人工导入使用同一套质量规则。

## 支持的规则

```json
{
  "quality": {
    "mode": "warn",
    "minRecords": 1,
    "requiredFields": [
      "serviceId",
      "serviceName",
      "updatedAt"
    ],
    "uniqueFields": [
      "serviceId"
    ],
    "freshness": {
      "field": "updatedAt",
      "maxAgeMinutes": 1440
    },
    "numericRanges": {
      "instanceCount": {
        "min": 0
      },
      "alarmCount": {
        "min": 0,
        "max": 100000
      }
    }
  }
}
```

规则含义：

- `minRecords`：记录数不能低于阈值。
- `requiredFields`：字段不能为 `null`、`undefined` 或空字符串。
- `uniqueFields`：字段的非空值不能重复。
- `freshness`：时间字段必须可解析，且不能早于最大允许时间。
- `numericRanges`：字段必须可以转换为有限数值，并符合最小值或最大值。

质量规则引用的是 `extract.fields` 输出字段，不是原始响应路径。配置引用未知字段时会在任务启动前失败。

## 处理模式

### warn

- 数据源仍视为可用。
- 数据进入历史、报告和消息。
- 工作流状态为 `success_with_warnings`。
- 问题进入日报的“数据源告警”部分。
- 审计状态为 `warning`。

适合第一阶段观察、非关键字段和仍可人工判断的数据。

### fail

- 当前数据源状态为 `quality_failed`。
- 该数据不进入历史和业务报告。
- 其他数据源继续执行。
- 至少一个其他数据源成功时，工作流状态为 `partial_success`。
- 全部数据源失败时，不发送空业务报告，走现有失败通知。

适合空数据、主键重复、关键字段缺失等会导致错误运营结论的问题。

## 质量错误码

| 错误码 | 含义 |
| --- | --- |
| `DQ-COUNT-001` | 记录数低于最低要求 |
| `DQ-REQUIRED-001` | 必填字段缺失 |
| `DQ-UNIQUE-001` | 唯一字段重复 |
| `DQ-FRESHNESS-001` | 数据超过允许时间 |
| `DQ-FRESHNESS-002` | 时间字段缺失或无法解析 |
| `DQ-NUMERIC-001` | 数值字段无法转换 |
| `DQ-NUMERIC-002` | 数值超出配置范围 |

## 审计产物

每次成功进入报告阶段的任务生成：

```text
runtime/daily-reports/<run-id>/data-quality-audit.json
```

审计内容包括：

- 数据源 ID。
- 质量状态和处理模式。
- 检查时间、记录数量和问题数量。
- 规则错误码、字段名和影响记录数量。
- 最多 5 个记录索引样例。

审计不保存触发问题的真实字段值。记录索引用于在内网对照 `records.json` 人工排查，不能单独反馈到外网时附带真实记录。

## 推荐初始策略

L1 阶段先使用简单且可行动的规则：

1. 关键数据源设置 `minRecords: 1`。
2. 主键同时加入 `requiredFields` 和 `uniqueFields`。
3. 报告分组字段加入 `requiredFields`。
4. 采集时间或业务更新时间设置 `freshness`。
5. 数量和告警字段设置非负范围。
6. 初次接入使用 `warn` 观察，确认规则稳定后改为 `fail`。

不要在第一阶段堆叠复杂统计异常检测。规则应该能明确说明问题是什么、影响多少记录、由谁处理。

## 验证命令

```bash
npm run test:quality
npm run daily:validate -- --config runtime/local-config/daily-report.json
npm run daily:once -- \
  --config runtime/local-config/daily-report.json \
  --dry-run true
```

检查 `data-quality-audit.json`、`workflow-audit.json` 和
`message-preview.json`，确认状态、告警数量和处理策略一致。
