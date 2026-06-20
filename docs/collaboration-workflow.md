# ArgSRE 外部开发与内网验证协同工作流

## 1. 目标

ArgSRE 采用以下协同方式：

1. 在当前开发环境编写和验证通用代码。
2. 将可外发代码、模拟数据和文档推送到远程私有代码仓库。
3. 在工作内网单向拉取指定版本。
4. 在内网接入真实环境并执行验证。
5. 只反馈脱敏后的测试结论、错误分类、极小数据结构和必要脚本片段。
6. 外部开发环境根据反馈继续迭代。

远程仓库是代码交付通道，不是内网运行数据的回传通道。

## 2. 仓库内容边界

### 允许提交

- 通用平台代码。
- 模拟服务和合成测试数据。
- 不包含内部信息的配置模板。
- 数据结构定义。
- 测试脚本。
- 部署说明。
- 脱敏后的错误码和极小样例。

### 禁止提交

- 浏览器 profile。
- Cookie、token、storage state。
- 内部 URL、域名、IP、账号。
- 真实请求头和认证信息。
- 内部代码和配置。
- 真实响应数据。
- 生产日志、监控数据、拓扑和截图。
- 内网生成的运行结果。
- 包含内部标识的测试报告。

仓库根目录 `.gitignore` 已默认忽略常见凭据、浏览器 profile、运行结果和本地环境文件，但提交前仍必须人工检查。

## 3. 分支和版本策略

建议保持简单：

- `main`：内网可拉取和验证的稳定版本。
- `feature/<name>`：开发中的功能分支。
- `fix/<name>`：针对内网反馈的修复分支。

每次准备让内网验证时：

1. 完成本地测试。
2. 合并到 `main`。
3. 推送远程。
4. 记录 commit SHA。
5. 可选创建验证标签，例如 `verify-20260620-01`。

内网必须按 commit SHA 或标签拉取，避免“我验证的是哪个版本”不明确。

## 4. 外部开发流程

```bash
git switch -c feature/browser-collector

# 开发并验证
cd examples/browser-data-collector
npm ci
npm test

# 回到仓库根目录检查提交内容
git status
git diff --check
git diff

git add .
git commit -m "feat: add browser authentication collector example"
git push -u origin feature/browser-collector
```

合并到 `main` 后：

```bash
git switch main
git pull --ff-only
git push origin main
git rev-parse HEAD
```

## 5. 内网同步流程

首次同步：

```bash
git clone <remote-repository-url>
cd ArgSRE
git switch main
```

后续同步指定版本：

```bash
git fetch origin
git switch main
git pull --ff-only
git rev-parse HEAD
```

如果需要严格验证指定提交：

```bash
git fetch origin
git switch --detach <commit-sha-or-tag>
git rev-parse HEAD
```

内网本地配置、认证信息、浏览器 profile 和测试结果必须保存在 Git 忽略目录或仓库之外。

## 6. 内网验证流程

以浏览器采集样例为例：

```bash
cd examples/browser-data-collector
npm ci
npm test
```

真实页面探测步骤见 `docs/internal-real-page-probe-guide.md`。

接入真实页面时，建议复制配置模板到 Git 忽略目录，例如：

```text
runtime/local-config/data-source.json
```

不要直接把内部 URL、选择器、请求结构或真实字段写入可推送的通用配置文件。

验证至少记录：

- commit SHA。
- 操作系统、Node、Edge 版本。
- 验证场景。
- 成功/失败。
- 失败阶段。
- 错误分类。
- 是否需要人工认证。
- 是否捕获目标请求。
- 是否解析出预期记录。

## 7. 脱敏反馈协议

反馈使用 `docs/templates/internal-validation-feedback.md` 模板。

允许反馈的内容：

- commit SHA。
- 测试项和结果。
- 通用错误分类。
- 脱敏错误消息。
- 页面状态类别。
- 请求方法和抽象路径，例如 `/api/<resource>/query`。
- 字段形状，例如 `data.items[].status`。
- 极小虚构样例。
- 不包含内部标识的选择器或脚本片段。

不能反馈：

- 完整内部 URL。
- Cookie、token、认证头。
- 真实业务数据。
- 完整 HAR。
- 浏览器 profile。
- 内部页面截图。
- 可还原内部系统的信息组合。

## 8. 反馈到修复闭环

1. 内网提交脱敏反馈。
2. 外部开发按 commit SHA 复现对应版本。
3. 使用模拟器构造同类失败。
4. 在 `fix/<name>` 分支修复。
5. 增加回归测试。
6. 推送新 commit SHA 或验证标签。
7. 内网重新拉取并验证。

每个问题至少经过一次“模拟环境回归 + 内网确认”后关闭。

## 9. 提交前安全检查

每次推送前执行：

```bash
git status --short
git diff --cached --name-only
git diff --cached
```

重点检查：

- 是否包含 `runtime/`。
- 是否包含浏览器 profile。
- 是否包含真实 URL/IP。
- 是否包含 Cookie/token。
- 是否包含内部数据或日志。
- 是否包含仅应留在内网的配置。
