# 浏览器真实页面探测 V1 内网验收手册

## 1. 验证版本

验证时必须记录实际 SHA：

```bash
git rev-parse HEAD
```

## 2. 本轮目标

本轮只验证：

- 外部模拟测试可在内网运行。
- Edge 可以被 Playwright 启动。
- 人工可以完成真实认证。
- 工具可以记录基本页面操作。
- 工具可以捕获请求候选。
- 工具可以展示目标响应的字段路径。
- 探测结果只保存在 Git 忽略目录。

本轮不验证：

- 自动生成最终采集配置。
- 自动回放真实请求。
- 自动执行定时任务。
- 自动选择业务字段。
- 自动发送真实 IM。

## 3. 安全约束

- 仅操作只读查询页面。
- 不点击删除、修改、扩容、重启、提交配置等按钮。
- 不使用高频刷新。
- 不反馈 `runtime/` 文件。
- 不反馈完整 URL、截图、Cookie、Token、请求或响应。
- 发现敏感字段未遮蔽时立即停止。

## 4. 测试前准备

- Windows 工作机。
- Git 可用。
- Node.js 18 或更高版本。
- Microsoft Edge 已安装。
- 如果 Edge 不在默认路径，已设置环境变量 `EDGE_PATH`。
- 可以访问 npm 依赖源，或已准备离线依赖。
- 具备目标内部页面的只读访问权限。
- 指纹认证场景下，本机指纹设备可用。

## 5. 测试用例总览

| 编号 | 名称 | 必须通过 |
| --- | --- | --- |
| T00 | 版本和工作区确认 | 是 |
| T01 | 环境自检 | 是 |
| T02 | 依赖安装 | 是 |
| T03 | 完整模拟回归 | 是 |
| T04 | 创建私有探测配置 | 是 |
| T05 | 真实认证与页面操作 | 是 |
| T06 | 候选请求检查 | 是 |
| T07 | 响应字段路径检查 | 是 |
| T08 | Git 与安全检查 | 是 |

## 6. T00 版本和工作区确认

### 目的

确认验证版本正确，内网本地修改不会被覆盖。

### 命令

```bash
git switch main
git pull --ff-only
git rev-parse HEAD
git status --short
```

### 预期结果

- `git rev-parse HEAD` 输出 40 位 SHA。
- 当前版本中存在本手册以及 `npm run doctor`、`npm run report` 命令。
- `git status --short` 无输出，或只存在明确的内网本地忽略文件。

### 失败分类

- `SYNC-001`：无法拉取远程。
- `SYNC-002`：分支或 SHA 不正确。
- `SYNC-003`：存在未知本地修改。

### 失败处理

不要删除未知本地修改。记录错误分类后先处理代码同步问题。

## 7. T01 环境自检

### 命令

```bash
cd examples/browser-data-collector
npm run doctor
```

### 预期结果

终端显示以下检查均为 `PASS`：

- Node.js 版本。
- npm 可用。
- Edge 路径存在。
- `runtime/` 可写。
- `runtime/` 被 Git 忽略。
- 当前 commit SHA 可识别。

### 通过条件

Summary 中 `failed=0`。

### 失败分类

- `ENV-001`：Node 版本过低。
- `ENV-002`：npm 不可用。
- `ENV-003`：Edge 未找到。
- `ENV-004`：运行目录不可写。
- `ENV-005`：运行目录未被 Git 忽略。

### 是否继续

任何失败都不要继续 T02。

## 8. T02 依赖安装

### 命令

```bash
npm ci
```

### 预期结果

- 命令退出码为 0。
- 安装 `playwright-core`。
- 不下载 Playwright 自带浏览器。
- 不修改业务代码。

### 补充检查

```bash
npm ls --depth=0
git status --short
```

### 通过条件

- `playwright-core` 无 missing/error。
- `git status --short` 不出现 `node_modules/`。

### 失败分类

- `DEP-001`：依赖源不可达。
- `DEP-002`：依赖完整性校验失败。
- `DEP-003`：Node/npm 版本不兼容。

## 9. T03 完整模拟回归

### 目的

先证明代码在内网机器本身可以工作，再接入真实页面。

### 命令

```bash
npm test
```

### 预期结果

依次出现：

```text
Running scenario: valid
Collected 2 records

Running scenario: quick
Collected 2 records

Running scenario: fingerprint
[IM MOCK]
Collected 2 records

Probe demo passed
```

### 通过条件

- 命令退出码为 0。
- 三种认证模拟均完成。
- 探测模拟捕获一个候选请求。

### 失败分类

- `SIM-001`：模拟服务器无法启动。
- `SIM-002`：Edge 无法启动。
- `SIM-003`：认证模拟失败。
- `SIM-004`：页面操作模拟失败。
- `SIM-005`：候选捕获失败。

### 是否继续

失败时不要接入真实页面。反馈首个错误分类和脱敏错误摘要。

## 10. T04 创建私有探测配置

### Git Bash 命令

```bash
mkdir -p runtime/local-config
cp config/probe-config.example.json runtime/local-config/probe.json
```

### PowerShell 命令

```powershell
New-Item -ItemType Directory -Force runtime\local-config | Out-Null
Copy-Item config\probe-config.example.json runtime\local-config\probe.json
```

### 编辑内容

至少修改：

- `name`：使用不包含内部系统名的本地代号。
- `entryUrl`：真实目标 URL。
- `profileName`：本地 profile 名。

### 检查 JSON

```bash
node -e "JSON.parse(require('fs').readFileSync('runtime/local-config/probe.json','utf8')); console.log('PASS')"
```

### 预期结果

输出：

```text
PASS
```

### Git 安全检查

```bash
git status --short --ignored runtime
```

### 预期结果

`runtime/` 前缀为 `!!`，表示已忽略。

### 失败分类

- `CFG-001`：配置不是合法 JSON。
- `CFG-002`：缺少 entryUrl。
- `CFG-003`：runtime 未被忽略。

## 11. T05 真实认证与页面操作

### 前置条件

- 目标页面仅执行只读查询。
- 已确定要操作的子页面和查询条件。
- 已确定停止测试的高风险按钮。

### 命令

```bash
npm run probe -- --config runtime/local-config/probe.json
```

### 预期终端输出

```text
Probe opened: <URL>
Local output: <runtime/probes/...>
```

操作期间可能出现：

```text
[candidate] candidate-001 ...
```

### 人工步骤

1. 等待页面跳转到认证页或目标页。
2. 如果已有认证，确认自动进入目标页。
3. 如果是快速认证，人工点击快速认证。
4. 如果是指纹认证，人工完成本机指纹认证。
5. 进入目标子页面。
6. 设置一个区域、日期或筛选条件。
7. 点击一次查询。
8. 确认页面显示目标数据。
9. 等待 3-5 秒。
10. 回到终端按 Enter。

### 预期结果

- Edge 未异常关闭。
- 完成认证后可进入目标页面。
- 终端至少出现一个候选请求，或停止后候选数量大于 0。
- 生成 `runtime/probes/<session-id>/summary.json`。

### 失败分类

- `REAL-001`：Edge 无法打开。
- `AUTH-001`：认证页面无法识别或无法继续。
- `AUTH-002`：指纹认证后未跳回目标页。
- `PAGE-001`：无法进入目标子页面。
- `PAGE-002`：页面操作未被记录。
- `CAP-001`：没有捕获候选请求。
- `CAP-002`：候选捕获导致页面异常。

### 是否继续

- 认证失败：停止。
- 页面查询成功但无候选：可以继续 T06 确认。
- 出现写操作风险：立即停止。

## 12. T06 候选请求检查

### 命令

```bash
npm run inspect
```

### 预期结果

输出：

- Session 路径。
- Actions 数量。
- Candidates 列表。
- 每个候选的评分、方法、状态和脱敏 URL。

### 选择目标候选

优先选择：

- 状态为 2xx。
- 方法为 POST/GET。
- Content-Type 为 JSON。
- URL 抽象含义接近查询、列表、详情。
- 操作查询后立即出现。

### 候选过多

修改私有配置：

```json
{
  "capture": {
    "includeUrlPatterns": ["/api/", "/query"],
    "excludeUrlPatterns": ["analytics", "report"]
  }
}
```

重新执行 T05。

### 通过条件

能够确定一个或少量可能的目标候选。

### 失败分类

- `CAP-003`：候选过多无法判断。
- `CAP-004`：目标请求不是 XHR/Fetch/JSON。
- `CAP-005`：候选 URL 或请求信息脱敏不完整。

## 13. T07 响应字段路径检查

### 命令

```bash
npm run inspect -- --candidate candidate-001
```

### 预期结果

输出字段树，例如：

```text
$.data.items: array(...)
$.data.items[].id: string
$.data.items[].status: string
```

### 需要人工确认

- 记录数组节点。
- 主键字段。
- 状态字段。
- 时间字段。
- 后续需要展示或分析的字段。
- 是否需要分页。
- 是否需要多个请求组装。

### 通过条件

至少能确认：

- 一个记录数组节点。
- 一个主键候选。
- 两个以上计划提取字段。

### 失败分类

- `PARSE-001`：响应不是 JSON。
- `PARSE-002`：响应超过大小限制。
- `PARSE-003`：JSON 中没有目标记录。
- `PARSE-004`：敏感业务字段不适合保存样例。
- `PARSE-005`：需要多个请求组装。

## 14. T08 Git 与安全检查

### 命令

```bash
git status --short --ignored
git check-ignore -v runtime/local-config/probe.json
git check-ignore -v runtime/probes
```

### 预期结果

- `runtime/` 显示为 ignored。
- 私有配置和探测结果不会进入待提交列表。
- 工作区没有意外修改。

### 敏感信息检查

打开候选文件只在内网人工检查：

- Authorization/Cookie 不应出现。
- URL 查询参数值应为 `<redacted>`。
- token/password/session 等字段应为 `<redacted>`。

### 失败分类

- `SEC-001`：runtime 未被忽略。
- `SEC-002`：认证头或 Cookie 被保存。
- `SEC-003`：敏感字段未遮蔽。
- `SEC-004`：真实内部配置进入 Git 状态。

任何 `SEC-*` 均为阻塞问题，不要反馈原始文件。

## 15. 生成脱敏反馈摘要

```bash
npm run report
```

生成：

```text
runtime/reports/internal-validation-feedback.md
```

该报告仅汇总版本、环境、动作数量、候选数量和抽象结果。提交反馈前仍需人工检查。

## 16. 本轮通过标准

全部满足才算 PASS：

- T00-T04 全部通过。
- 人工认证成功。
- 目标页面查询成功。
- 至少记录一个页面操作。
- 至少捕获一个候选请求。
- 能查看目标响应字段路径。
- `runtime/` 保持 Git 忽略。
- 没有发现未遮蔽凭据。
