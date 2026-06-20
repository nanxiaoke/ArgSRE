# ArgSRE 本地开发工具约定

## 当前结论

当前 Codex 会话运行在 Windows 环境中，默认 shell 是 PowerShell 5.1。PowerShell 可用于基础 Windows 操作，但存在两个已观察到的问题：

- 终端活动代码页为 936，读取中文文件时容易出现显示乱码。
- `rg.exe` 指向 Codex 应用资源目录，执行时出现拒绝访问。

本机已安装 Git for Windows，可直接使用 Git Bash：

- Bash: `D:\Program Files\Git\bin\bash.exe`
- Git: `D:\Program Files\Git\cmd\git.exe`
- Git Bash 内置常用工具：`grep`、`sed`、`awk`、`find`、`xargs`、`perl`
- Git Bash 可访问本机 Python 与 Node

因此，后续仓库内文本读取、搜索、脚本执行和 Markdown 检查优先使用 Git Bash。PowerShell 主要用于 Windows 特定操作。

## 推荐调用方式

在 Codex 工具中保持 `workdir` 为仓库根目录，并通过 PowerShell 显式调用 Git Bash：

```powershell
& 'D:\Program Files\Git\bin\bash.exe' -lc 'pwd; find . -maxdepth 3 -type f'
```

读取中文 Markdown：

```powershell
& 'D:\Program Files\Git\bin\bash.exe' -lc 'sed -n "1,80p" docs/argsre-requirements.md'
```

搜索文本：

```powershell
& 'D:\Program Files\Git\bin\bash.exe' -lc 'grep -RIn "ArgSRE" docs'
```

## 暂不安装新工具的原因

当前 Git Bash 已经满足早期需求讨论、文档维护和轻量脚本验证。为了减少环境变量、权限、网络下载和安全审查带来的不确定性，暂不安装新的 Windows shell 工具。

如果后续代码规模扩大，需要更高效的搜索工具，再考虑安装独立版 `ripgrep`，或通过 Git Bash/包管理器引入更完整的 Unix 工具链。

## 后续可选方案

- 修复或安装独立版 `ripgrep`，用于大规模代码搜索。
- 安装 PowerShell 7，改善现代 shell 体验与 UTF-8 行为。
- 使用 MSYS2 或 Git Bash 作为主要类 Unix 工具链。
- 在项目内提供 `scripts/doctor`，自动检查本地工具链、编码、Python、Node 和 Git 状态。
