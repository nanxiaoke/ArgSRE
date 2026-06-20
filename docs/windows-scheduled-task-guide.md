# Windows 每日报告任务计划指南

## 1. 设计选择

浏览器认证可能依赖：

- 当前 Windows 用户会话。
- 企业浏览器策略。
- 本机证书。
- 指纹设备。

因此任务默认采用：

- 当前用户身份。
- `Interactive` 登录类型。
- 仅用户已登录时运行。
- 普通权限运行。
- 错过计划时间后尽快启动。

如果机器无人登录，任务可能无法完成浏览器认证。这是当前 MVP 的明确限制。

## 2. 预览任务

```powershell
cd examples\browser-data-collector

powershell -ExecutionPolicy Bypass -File scripts\manage-daily-task.ps1 `
  -Action Preview `
  -ConfigPath runtime\local-config\daily-report.json `
  -Time 09:00
```

预期：

- 显示任务名。
- 显示 Node 路径。
- 显示脚本和私有配置绝对路径。
- 显示当前 Windows 用户。
- 不创建或修改任务。

## 3. 安装任务

```powershell
powershell -ExecutionPolicy Bypass -File scripts\manage-daily-task.ps1 `
  -Action Install `
  -ConfigPath runtime\local-config\daily-report.json `
  -Time 09:00
```

安装前会自动运行配置校验。校验失败时不会创建任务。

## 4. 查看任务

```powershell
powershell -ExecutionPolicy Bypass -File scripts\manage-daily-task.ps1 `
  -Action Show
```

检查：

- `State`
- `LastRunTime`
- `LastTaskResult`
- `NextRunTime`

Windows 任务成功退出通常为：

```text
LastTaskResult = 0
```

## 5. 立即运行

```powershell
powershell -ExecutionPolicy Bypass -File scripts\manage-daily-task.ps1 `
  -Action Run
```

运行后检查：

```text
runtime\daily-reports\<run-id>\
```

## 6. 卸载任务

```powershell
powershell -ExecutionPolicy Bypass -File scripts\manage-daily-task.ps1 `
  -Action Uninstall
```

该操作只删除 Windows 任务，不删除配置、浏览器 profile 或历史报告。

## 7. 修改执行时间

重新执行 Install 并传入新时间：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\manage-daily-task.ps1 `
  -Action Install `
  -ConfigPath runtime\local-config\daily-report.json `
  -Time 08:30
```

同名任务会被更新。

## 8. 常见问题

### LastTaskResult 非 0

先手工执行：

```powershell
node src\daily-report.js --config runtime\local-config\daily-report.json
```

如果手工成功但计划任务失败，重点检查：

- 用户是否登录。
- Edge 是否能在计划任务中启动。
- 配置使用的是否为绝对路径。
- Node 路径是否变化。
- 任务运行账号是否具有 profile 和 runtime 写权限。

### 指纹认证

计划任务无法模拟指纹。检测到指纹认证后：

- 发送人工认证提醒。
- 本次任务停止。
- 人工认证后可以执行 `-Action Run` 重试。

### 锁屏

锁屏状态是否允许企业认证取决于内部环境。首次验证必须分别测试：

- 用户登录且桌面解锁。
- 用户登录但桌面锁屏。

## 9. 安全提示

- 任务参数只包含私有配置文件路径，不直接包含 Token。
- 私有配置和运行结果位于 Git 忽略目录。
- 不要把任务导出 XML 反馈到外部，因为 XML 中可能包含内部路径和用户名。
