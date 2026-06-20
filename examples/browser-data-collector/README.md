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
- `src/run-demo.js`：三种认证场景的端到端验证。
- `runtime/`：运行时 profile、采集结果和审计文件。

## 安装

```bash
npm install
```

样例使用系统已安装的 Microsoft Edge，不需要下载 Playwright 浏览器。

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
