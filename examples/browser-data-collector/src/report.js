import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = resolve(ROOT, "..", "..");

async function command(command, args, options = {}) {
  try {
    const { stdout } = await execFileAsync(command, args, options);
    return stdout.trim();
  } catch {
    return "<unavailable>";
  }
}

async function latestProbeSummary() {
  const probesPath = join(ROOT, "runtime", "probes");
  try {
    const entries = await readdir(probesPath, { withFileTypes: true });
    const latest = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
      .at(-1);
    if (!latest) return undefined;
    return JSON.parse(
      await readFile(join(probesPath, latest, "summary.json"), "utf8"),
    );
  } catch {
    return undefined;
  }
}

async function latestDailyAudit() {
  const reportsPath = join(ROOT, "runtime", "daily-reports");
  try {
    const entries = await readdir(reportsPath, { withFileTypes: true });
    const latest = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
      .at(-1);
    if (!latest) return undefined;
    return JSON.parse(
      await readFile(
        join(reportsPath, latest, "workflow-audit.json"),
        "utf8",
      ),
    );
  } catch {
    return undefined;
  }
}

const commit = await command(
  "git",
  ["rev-parse", "HEAD"],
  { cwd: REPO_ROOT },
);
const edgePath =
  process.env.EDGE_PATH ??
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const escapedEdgePath = edgePath.replaceAll("'", "''");
const edgeVersion = await command(
  "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
  [
    "-NoProfile",
    "-Command",
    `(Get-Item -LiteralPath '${escapedEdgePath}').VersionInfo.ProductVersion`,
  ],
);
const npmVersion = await command(
  "C:\\Windows\\System32\\cmd.exe",
  ["/d", "/s", "/c", "npm --version"],
);
const summary = await latestProbeSummary();
const dailyAudit = await latestDailyAudit();

const candidates =
  summary?.candidates
    ?.map(
      (candidate) =>
        `- ${candidate.id}: method=${candidate.method}, status=${candidate.status}, type=${candidate.sampleType}, score=${candidate.score}`,
    )
    .join("\n") ?? "- 无探测结果";

const content = `# 内网验证反馈

> 该文件由工具生成，仅包含统计和抽象信息。反馈前仍需人工检查。

## 版本

- Commit SHA：${commit}
- 验证日期：${new Date().toISOString()}

## 环境

- 操作系统：${process.platform} ${process.arch}
- Node 版本：${process.versions.node}
- npm 版本：${npmVersion}
- 浏览器版本：${edgeVersion}

## 模拟回归

- npm test：请填写 PASS / FAIL

## 真实页面探测

- 总体结果：请填写 PASS / PARTIAL / FAIL / BLOCKED
- 认证状态：请填写 有效 / 快速认证 / 指纹认证 / 其他
- 是否进入目标页面：请填写
- 是否完成前置操作：请填写
- 动作数量：${summary?.actionCount ?? 0}
- 候选数量：${summary?.candidateCount ?? 0}

## 候选摘要

${candidates}

## 目标响应结构

- 目标候选编号：请填写
- 抽象请求路径：请填写，不要填写真实 URL
- 记录数组节点：请填写，例如 $.data.items[]
- 主键字段：请填写字段名，不填写真实值
- 计划提取字段：请填写字段名和类型

## 每日报告 MVP

- 最近任务状态：${dailyAudit?.status ?? "无运行记录"}
- Dry-run：${dailyAudit?.dryRun ?? "未知"}
- 标准记录数量：${dailyAudit?.recordCount ?? 0}
- 消息幂等跳过：${dailyAudit?.messageResult?.skipped ?? false}
- 连续失败次数：${dailyAudit?.workflowState?.consecutiveFailures ?? 0}
- 错误分类：${dailyAudit?.workflowState?.lastBlockedReason ?? dailyAudit?.workflowState?.lastErrorCode ?? dailyAudit?.error?.name ?? "无"}

## 失败信息

- 失败用例编号：请填写
- 错误分类：请填写
- 脱敏错误摘要：请填写
- 是否可稳定复现：请填写

## 安全确认

- [ ] 未附带 runtime 文件
- [ ] 未填写真实内部 URL
- [ ] 未附带 Cookie、Token、请求头或真实数据
- [ ] 已人工确认反馈内容不可还原内部系统信息
`;

const reportPath = join(
  ROOT,
  "runtime",
  "reports",
  "internal-validation-feedback.md",
);
await mkdir(dirname(reportPath), { recursive: true });
await writeFile(reportPath, content, "utf8");
console.log(`Feedback report written to: ${reportPath}`);
