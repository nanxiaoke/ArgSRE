# 内网真实页面探测指南

## 1. 目标

使用有头 Edge 访问一个真实内部页面，由人工完成认证和页面操作，工具负责记录：

- 页面点击、选择和提交操作。
- XHR、Fetch 和 JSON 请求候选。
- 请求方法、脱敏 URL、请求体形状和响应状态。
- 脱敏后的响应 JSON 样例和字段路径。

探测结果只保存在内网本地 `runtime/`，不会进入 Git。

## 2. 拉取版本

```bash
git switch main
git pull --ff-only
git rev-parse HEAD
```

## 3. 安装依赖

```bash
cd examples/browser-data-collector
npm ci
```

## 4. 创建内网私有配置

```bash
mkdir -p runtime/local-config
cp config/probe-config.example.json runtime/local-config/probe.json
```

编辑 `runtime/local-config/probe.json`：

```json
{
  "name": "first-internal-probe",
  "entryUrl": "https://内部目标地址/",
  "profileName": "first-internal-probe",
  "durationSeconds": 0,
  "capture": {
    "includeUrlPatterns": [],
    "excludeUrlPatterns": [
      "analytics",
      "report"
    ],
    "maxResponseBytes": 1048576
  }
}
```

该文件包含内部 URL，禁止提交。

## 5. 启动探测

```bash
npm run probe -- --config runtime/local-config/probe.json
```

Edge 打开后：

1. 等待自动认证跳转。
2. 如果出现快速认证，人工点击。
3. 如果出现指纹认证，人工完成指纹认证。
4. 进入目标子页面。
5. 设置下拉框、日期和查询条件。
6. 点击查询或刷新，确保目标数据展示出来。
7. 回到终端按 Enter。

## 6. 查看结果

候选列表：

```bash
npm run inspect
```

检查候选响应结构：

```bash
npm run inspect -- --candidate candidate-001
```

如果候选过多，在私有配置中填写 `includeUrlPatterns`，例如：

```json
{
  "capture": {
    "includeUrlPatterns": [
      "/api/",
      "/query"
    ]
  }
}
```

再次运行探测。

## 7. 本地结果位置

```text
runtime/probes/<session-id>/summary.json
runtime/probes/<session-id>/candidates/candidate-001.json
```

`summary.json` 包含操作和候选摘要。候选文件包含脱敏后的请求与响应样例。

已自动处理：

- 不保存 Authorization 和 Cookie 请求头。
- URL 查询参数值替换为 `<redacted>`。
- token、secret、password、session、credential 等字段替换为 `<redacted>`。
- 超过配置上限的响应不保存正文。

仍需人工检查：响应中的业务字段可能属于内部敏感信息，因此整个 `runtime/` 目录都不能外发。

## 8. 脱敏反馈内容

请反馈：

- Commit SHA。
- 是否成功打开目标页面。
- 认证类型：自动、快速认证、指纹认证。
- 是否记录到页面操作。
- 候选请求数量。
- 目标候选编号。
- 抽象请求路径，例如 `/api/<resource>/query`。
- 请求方法。
- 响应记录节点，例如 `$.data.items[]`。
- 需要提取的字段名称和类型，不填写真实值。
- 失败阶段和脱敏错误摘要。

不要反馈：

- 真实内部 URL。
- `runtime/` 文件。
- 页面截图。
- Cookie、token 或完整请求头。
- 真实响应数据。
- 完整 HAR。

## 9. 本轮验收目标

第一个真实页面只需要验证：

- 人工认证后能继续操作。
- 工具能记录三到五个关键页面操作。
- 工具能找到目标请求候选。
- 工具能展示响应 JSON 路径。
- 能确认记录数组节点和计划提取字段。

暂时不要求生成最终自动采集配置。
