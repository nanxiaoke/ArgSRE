# 每日自动采集与报告 MVP 内网验收手册

## 1. 验收范围

本轮验证：

- 浏览器认证。
- 快速认证自动恢复。
- 认证会话共享给纯 HTTP 请求。
- JSON 响应字段提取。
- 数据汇总。
- SVG 图表生成。
- 消息接口调用。
- 指纹超时提醒。
- 每日调度计算。

## 2. 安全边界

- 数据请求必须是只读查询。
- 私有配置必须放在 `runtime/local-config/`。
- 消息接口必须是内部接口。
- 报告内容需要符合内部信息发送范围。
- 不将任何 runtime 文件推送到 Git。
- 指纹认证不自动绕过。

## 3. 用例总览

| 编号 | 名称 | 必须通过 |
| --- | --- | --- |
| D00 | 环境和版本确认 | 是 |
| D01 | 模拟端到端回归 | 是 |
| D02 | 创建并校验内网私有配置 | 是 |
| D03 | Dry-run 安全试跑 | 是 |
| D04 | 单次真实发送 | 是 |
| D05 | 数据源结果检查 | 是 |
| D06 | 报告与图表检查 | 是 |
| D07 | 消息、重试和幂等检查 | 是 |
| D08 | 指纹与失败通知检查 | 是 |
| D09 | 每日调度检查 | 是 |
| D10 | Git 和安全检查 | 是 |
| D11 | 历史趋势和多数据源 | 是 |

## 4. D00 环境和版本确认

```bash
git pull --ff-only
git rev-parse HEAD
cd examples/browser-data-collector
npm ci
npm run doctor
```

预期：

- `npm run doctor` 全部 PASS。
- Summary 中 `failed=0`。

失败分类：

- 复用 `ENV-*`、`SYNC-*`、`DEP-*`。

## 5. D01 模拟端到端回归

```bash
npm test
```

预期最后出现：

```text
Daily report demo passed
```

该测试会验证：

- 快速认证。
- 共享会话 HTTP 请求。
- 两条标准记录。
- 业务汇总。
- SVG 图表。
- 模拟 IM 收到报告。
- 指纹超时发送认证提醒。
- 调度时间计算。

失败分类：

- `DAILY-SIM-001`：认证失败。
- `DAILY-SIM-002`：HTTP 请求未共享认证。
- `DAILY-SIM-003`：数据提取失败。
- `DAILY-SIM-004`：报告组装失败。
- `DAILY-SIM-005`：图表生成失败。
- `DAILY-SIM-006`：消息发送失败。

失败时不要继续真实接入。

## 6. D02 创建并校验内网私有配置

Git Bash：

```bash
mkdir -p runtime/local-config
cp config/daily-report.example.json runtime/local-config/daily-report.json
```

PowerShell：

```powershell
New-Item -ItemType Directory -Force runtime\local-config | Out-Null
Copy-Item config\daily-report.example.json runtime\local-config\daily-report.json
```

需要填写：

### dataSource

- `id`
- `name`
- `entryUrl`
- `targetUrlPattern`
- `auth`
- `request.url`
- `request.method`
- `request.headers`
- `request.body`
- `extract.recordPath`
- `extract.fields`

### businessReport

- `title`
- `chart.categoryField`
- `chart.valueField`
- `chart.title`

### messageChannel

- `type`
- `endpoint`
- `headers`

### schedule

- `time`

检查：

```bash
npm run daily:validate -- --config runtime/local-config/daily-report.json
git check-ignore -v runtime/local-config/daily-report.json
```

预期：

- 配置检查输出 `PASS`。
- Git ignore 规则匹配 runtime。

失败分类：

- `DAILY-CFG-001`：JSON 无效。
- `DAILY-CFG-002`：数据源配置缺失。
- `DAILY-CFG-003`：消息通道配置缺失。
- `DAILY-CFG-004`：私有配置未被忽略。

配置错误会在打开浏览器之前返回 `CFG-*` 错误码。

## 7. D03 Dry-run 安全试跑

首次运行必须使用 Dry-run：

```bash
npm run daily:once -- \
  --config runtime/local-config/daily-report.json \
  --dry-run true
```

预期：

- 完成认证和纯 HTTP 请求。
- 生成标准记录、报告和图表。
- 不调用真实 IM。
- 生成 `message-preview.json`。

通过后人工检查报告内容是否符合内部发送范围，再继续 D04。

失败分类：

- `DAILY-DRY-001`：仍调用了真实 IM。
- `DAILY-DRY-002`：未生成消息预览。
- 其他错误沿用后续数据、报告错误分类。

## 8. D04 单次真实发送

首次建议有头运行：

```json
{
  "dataSource": {
    "headless": false
  }
}
```

执行：

```bash
npm run daily:once -- --config runtime/local-config/daily-report.json
```

预期：

- Edge 打开并完成认证。
- 快速认证时自动点击。
- 不执行目标页面按钮操作。
- 认证完成后发送配置中的纯 HTTP 请求。
- 终端输出记录数量和产物目录。

失败分类：

- `DAILY-AUTH-001`：无法进入认证流程。
- `DAILY-AUTH-002`：快速认证失败。
- `DAILY-AUTH-003`：需要指纹认证。
- `DAILY-HTTP-001`：HTTP 返回未认证。
- `DAILY-HTTP-002`：请求参数不正确。
- `DAILY-HTTP-003`：返回非 JSON。

如果需要指纹：

- 应收到认证提醒。
- 本次任务状态为 `authentication_required`。
- 人工完成认证后重新运行。

## 9. D05 数据源结果检查

找到最新目录：

```powershell
$run = Get-ChildItem runtime\daily-reports -Directory |
  Sort-Object Name -Descending |
  Select-Object -First 1
Get-Content (Join-Path $run.FullName 'data-source-audit.json')
```

检查：

- `status` 为 `success`。
- `auth.state` 为 `valid` 或 `quick`。
- `request.status` 为 2xx。
- `recordCount` 大于 0。

检查 `records.json` 时只在内网查看：

- 字段名称符合配置。
- 数据类型符合预期。
- 没有把整份原始响应写入标准记录。

失败分类：

- `DAILY-DATA-001`：recordPath 错误。
- `DAILY-DATA-002`：字段路径错误。
- `DAILY-DATA-003`：记录数量异常。
- `DAILY-DATA-004`：标准记录包含不应保留的敏感字段。

## 10. D06 报告与图表检查

检查：

```text
report.json
report.md
chart.svg
```

通过条件：

- 汇总数量正确。
- Markdown 可读。
- 图表标题正确。
- 图表包含预期分类项。
- 0 值和非 0 值颜色可区分。
- 没有文字溢出到画布外。

可以使用 Edge 打开 `chart.svg` 进行人工检查。

失败分类：

- `DAILY-REPORT-001`：汇总错误。
- `DAILY-REPORT-002`：Markdown 内容不完整。
- `DAILY-CHART-001`：图表无法打开。
- `DAILY-CHART-002`：标签或数值显示异常。

## 11. D07 消息、重试和幂等检查

确认内部 IM 收到：

- 报告标题。
- 生成时间。
- 服务数、实例数、告警数。
- Markdown 摘要。
- 图表或图表附件。

注意：

通用 Webhook 当前发送的是 JSON，其中图表是 Base64 SVG。若内部 IM 不支持该格式，结果可能是：

- HTTP 发送成功但 IM 不展示图表。
- 接口直接拒绝字段。

此时反馈消息接口需要的抽象格式，不要反馈真实地址和凭据。后续新增专用适配器。

失败分类：

- `DAILY-MSG-001`：接口认证失败。
- `DAILY-MSG-002`：接口格式不兼容。
- `DAILY-MSG-003`：文字发送成功但图表失败。
- `DAILY-MSG-004`：重复发送。

### 重试验证

如果内部测试接口支持临时返回 503，可验证：

- 数据请求按配置次数重试。
- 消息请求按配置次数重试。
- `401/403` 不重复请求。

### 幂等验证

同一天连续执行两次：

```bash
npm run daily:once -- --config runtime/local-config/daily-report.json
npm run daily:once -- --config runtime/local-config/daily-report.json
```

预期：

- 第二次仍采集和生成本地报告。
- 第二次 `messageResult.skipped=true`。
- IM 只收到一份业务日报。

## 12. D08 指纹与失败通知检查

该用例只在方便时验证。

准备一个需要指纹认证的会话，执行单次任务。

预期：

- 消息通道收到“需要人工认证”提醒。
- 不发送业务日报。
- `workflow-audit.json` 状态为 `authentication_required`。
- `data-source-audit.json` 记录指纹认证状态。
- 工作流状态为 `blocked`，连续失败次数不增加。

失败分类：

- `DAILY-FP-001`：未发送认证提醒。
- `DAILY-FP-002`：认证未完成却继续请求数据。
- `DAILY-FP-003`：误发送空业务报告。

### 连续失败

当数据请求持续失败并达到阈值时：

- `runtime/state/` 中连续失败次数增加。
- IM 收到抽象失败通知。
- 通知中不包含真实 URL、请求体或响应体。
- 下一次成功后连续失败次数清零。

## 13. D09 每日调度检查

### 方式一：内置调度器

```bash
npm run daily:schedule -- \
  --config runtime/local-config/daily-report.json \
  --run-now true
```

预期：

- 启动时执行一次。
- 输出下一次计划时间。
- 进程保持运行。

停止：

```text
Ctrl+C
```

### 方式二：Windows 任务计划

先预览：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\manage-daily-task.ps1 `
  -Action Preview `
  -ConfigPath runtime\local-config\daily-report.json `
  -Time 09:00
```

安装：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\manage-daily-task.ps1 `
  -Action Install `
  -ConfigPath runtime\local-config\daily-report.json `
  -Time 09:00
```

验收时可临时设置为未来 2-5 分钟执行一次，确认完成后再改为正式时间。

完整说明见 `docs/windows-scheduled-task-guide.md`。

失败分类：

- `DAILY-SCHED-001`：时间计算错误。
- `DAILY-SCHED-002`：任务计划工作目录错误。
- `DAILY-SCHED-003`：计划任务无浏览器权限。
- `DAILY-SCHED-004`：机器锁屏或会话状态导致认证失败。

## 14. D10 Git 和安全检查

```bash
git status --short --ignored
git check-ignore -v runtime/local-config/daily-report.json
git check-ignore -v runtime/daily-reports
```

必须满足：

- 私有配置被忽略。
- 运行报告被忽略。
- 浏览器 profile 被忽略。
- 没有内部 URL 或消息凭据进入 Git。

## 15. D11 历史趋势和多数据源

### 历史趋势

连续执行或使用模拟测试后检查：

```text
runtime/history/
runtime/daily-reports/<run-id>/trend.json
runtime/daily-reports/<run-id>/trend-chart.svg
```

通过条件：

- `trend.json` 按日期升序。
- 同一天多次快照只保留当天最新聚合结果。
- 趋势指标与报告汇总一致。
- SVG 可以在 Edge 打开。
- 过期快照只在配置的保留期之外清理。

失败分类：

- `DAILY-HISTORY-001`：快照未保存。
- `DAILY-HISTORY-002`：趋势日期或数值错误。
- `DAILY-HISTORY-003`：趋势图无法显示。
- `DAILY-HISTORY-004`：保留策略误删有效快照。

### 多数据源

将单个 `dataSource` 改为：

```json
{
  "dataSources": [
    {
      "id": "source-a"
    },
    {
      "id": "source-b"
    }
  ]
}
```

每个元素需要包含完整数据源配置。

验证：

- 两个数据源都成功：状态 `success`。
- 一个成功、一个失败：状态 `partial_success`。
- 报告中出现抽象数据源告警。
- `data-source-audits.json` 分开记录成功和失败。
- 全部失败：不发送空业务报告。

失败分类：

- `DAILY-MULTI-001`：单个失败阻塞全部。
- `DAILY-MULTI-002`：不同数据源记录无法区分。
- `DAILY-MULTI-003`：部分失败未在报告中提示。
- `DAILY-MULTI-004`：全部失败仍发送空报告。

## 16. 脱敏反馈

反馈：

- Commit SHA。
- D00-D11 状态。
- 首个失败用例。
- 认证状态。
- HTTP 状态码。
- 标准记录数量。
- 报告汇总是否正确。
- 图表是否可打开。
- IM 文本和图表是否成功。
- 抽象错误分类。

不要反馈：

- 私有配置。
- 标准记录真实值。
- 报告正文。
- 图表文件。
- 消息接口地址和凭据。
