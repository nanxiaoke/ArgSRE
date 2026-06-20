# 浏览器自动认证与数据采集样例

该样例验证 ArgSRE 数据源模块的最小闭环：

1. 访问目标页面。
2. 识别已有认证、快速认证、指纹认证三种状态。
3. 快速认证自动点击。
4. 指纹认证通过模拟 IM 消息提醒人工处理。
5. 进入目标页面后执行子页面点击、下拉框选择和查询按钮点击。
6. 捕获关键请求及响应。
7. 按配置提取标准化字段。
8. 保存采集结果和审计轨迹。

## 目录

- `config/data-source.json`：操作条件、关键请求和解析规则。
- `src/mock-server.js`：模拟内部认证中心和运营页面。
- `src/collector.js`：Playwright 采集器。
- `src/probe.js`：真实页面探测器。
- `src/inspect-probe.js`：查看请求候选和响应字段路径。
- `src/core/data-source-runner.js`：独立数据源执行器。
- `src/core/report-builder.js`：独立业务报告与图表构建器。
- `src/adapters/message-sender.js`：独立消息通道适配器。
- `src/daily-report.js`：每日工作流编排。
- `src/daily-scheduler.js`：每日调度器。
- `src/run-demo.js`：三种认证场景的端到端验证。
- `runtime/`：运行时 profile、采集结果和审计文件。

## 安装

```bash
npm install
```

样例使用系统已安装的 Microsoft Edge，不需要下载 Playwright 浏览器。

## 环境自检

```bash
npm run doctor
```

所有检查均为 `PASS` 且 `failed=0` 后再继续测试。

如果 Edge 不在默认安装路径：

```powershell
$env:EDGE_PATH = "C:\实际路径\msedge.exe"
```

## 自动验证

```bash
npm test
```

该命令依次验证：

- 已有有效认证。
- 短期失效并自动快速认证。
- 长期失效并模拟人工指纹认证。

## 手工体验指纹认证

终端一：

```bash
npm run mock
```

终端二：

```bash
node src/collector.js --mode fingerprint --headless false
```

采集器会打开 Edge，并输出一条模拟 IM 提醒。点击页面中的“指纹认证”按钮后，任务会继续进入目标页面并完成数据采集。

## 真实页面探测

探测配置必须保存在 Git 忽略的 `runtime/` 目录，不要把内部 URL 写入仓库配置。

先创建本地配置：

```bash
mkdir -p runtime/local-config
cp config/probe-config.example.json runtime/local-config/probe.json
```

编辑 `runtime/local-config/probe.json`，至少填写真实 `entryUrl`。

启动探测：

```bash
npm run probe -- --config runtime/local-config/probe.json
```

工具会打开有头 Edge。随后：

1. 人工完成快速认证或指纹认证。
2. 进入目标子页面。
3. 设置下拉框、日期、筛选条件。
4. 点击查询或刷新。
5. 回到终端按 Enter 停止探测。

探测器会记录：

- 点击、选择和提交操作。
- XHR、Fetch 和 JSON 请求候选。
- 请求方法、脱敏 URL、请求体形状和响应状态。
- 脱敏后的 JSON 响应样例。

所有结果仅写入：

```text
runtime/probes/<session-id>/
```

该目录已被 Git 忽略。

### 查看候选请求

查看最近一次探测的候选列表：

```bash
npm run inspect
```

查看指定候选的响应字段路径：

```bash
npm run inspect -- --candidate candidate-001
```

如果候选过多，可以在本地配置中增加：

```json
{
  "capture": {
    "includeUrlPatterns": ["/api/"],
    "excludeUrlPatterns": ["analytics", "report"],
    "maxResponseBytes": 1048576
  }
}
```

不要将 `runtime/probes/` 中的完整文件反馈到外部。反馈时只提供候选数量、抽象请求路径、字段结构和错误分类。

详细测试步骤和预期结果见：

```text
docs/test-plans/browser-probe-v1.md
```

### 生成脱敏反馈草稿

```bash
npm run report
```

报告生成在：

```text
runtime/reports/internal-validation-feedback.md
```

反馈前仍需人工检查和补充测试状态。

## 每日自动报告 MVP

复制内网私有配置：

```bash
mkdir -p runtime/local-config
cp config/daily-report.example.json runtime/local-config/daily-report.json
```

配置分为：

- `dataSource`：认证、HTTP 请求、字段提取。
- `businessReport`：汇总和图表。
- `messageChannel`：IM 或其他消息通道。
- `schedule`：每日时间。

单次执行：

```bash
npm run daily:once -- --config runtime/local-config/daily-report.json
```

长期调度：

```bash
npm run daily:schedule -- \
  --config runtime/local-config/daily-report.json \
  --run-now true
```

设计说明：

```text
docs/daily-report-mvp-design.md
```

详细验收：

```text
docs/test-plans/daily-report-mvp-v1.md
```

## 采集结果

结果写入：

```text
runtime/results/<mode>-latest.json
```

文件包含：

- 认证事件。
- 页面操作步骤。
- 请求方法、URL、请求体和响应状态。
- 提取后的标准化记录。
- 成功或失败状态。

## 接入真实内部页面时需要替换的内容

- `entryPath` 和目标 URL。
- 认证页 URL 与状态识别规则。
- 快速认证按钮和指纹认证页面特征。
- 页面操作步骤与选择器。
- 关键请求 URL 模式。
- 响应记录路径和字段映射。
- IM 通知实现。
