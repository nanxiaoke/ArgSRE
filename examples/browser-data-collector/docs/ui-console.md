# ArgSRE 数据采集控制台

这个控制台把前期命令行验证流程 UI 化，用于内网常态化录入认证入口、页面探测、请求配置、数据解析、质量规则和试跑结果查看。

## 一键启动

```bash
cd examples/browser-data-collector
npm run ui
```

默认地址是 `http://127.0.0.1:8787`。如果端口被占用，可以指定：

```bash
ARGSRE_UI_PORT=8788 npm run ui
```

## 架构边界

- `src/core`：采集、解析、质量规则、历史、报告等核心能力。
- `src/ui-server.js`：本机 HTTP API，只编排已有核心能力，不保存敏感数据到代码目录。
- `src/ui`：静态前端页面，负责配置编辑、触发执行、查看本机结果。
- `runtime/local-config`：本机私有配置，受 `.gitignore` 保护。
- `runtime/daily-reports` 和 `runtime/probes`：本机运行产物，受 `.gitignore` 保护。

## 当前 UI 能力

- 数据源配置：编辑入口 URL、认证按钮、请求 URL、请求体、字段映射、质量规则。
- 配置管理：保存和读取 `runtime/local-config/*.json`。
- 配置校验：调用与 CLI 相同的配置校验逻辑。
- 页面探测：打开真实 Edge 浏览器，记录操作和候选 XHR/fetch 请求。
- 本机试跑：默认 dry-run，消息发送落本地文件。
- 结果查看：查看最近执行审计、最近探测摘要和最新 Markdown 报告。

## 内网测试建议

1. 先启动 UI，保存一个 `daily-report.local.json`。
2. 在“页面探测”里输入内部入口 URL，设置 60 到 180 秒探测窗口。
3. 浏览器弹出后完成认证、点击子页面、选择下拉框、触发目标请求。
4. 回到 UI 读取最近探测，根据候选请求完善请求 URL、请求体、字段映射和 `recordPath`。
5. 点击“校验”，通过后点击“本机试跑”。
6. 在“执行结果”查看 `workflow-audit` 和 `report.md`。

不要把 `runtime` 目录中的配置、截图、请求、响应、报告原文发到外网；反馈时只发送脱敏后的状态、错误码、候选数量、记录数量和失败分类。
