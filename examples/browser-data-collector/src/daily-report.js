import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { createMessageSender } from "./adapters/message-sender.js";
import { runDataSource } from "./core/data-source-runner.js";
import { buildReportPackage } from "./core/report-builder.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function getArgument(name, fallback) {
  const prefix = `--${name}=`;
  const inline = process.argv.find((value) => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

export async function runDailyReport({
  config,
  simulateFingerprint = false,
  messageSender,
} = {}) {
  if (!config) throw new Error("workflow config is required");

  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const runtimeRoot = join(ROOT, "runtime");
  const runPath = join(runtimeRoot, "daily-reports", runId);
  await mkdir(runPath, { recursive: true });

  const sender =
    messageSender ?? createMessageSender(config.messageChannel);
  const audit = {
    runId,
    workflow: config.name,
    startedAt: new Date().toISOString(),
    status: "running",
  };

  try {
    const dataResult = await runDataSource({
      config: config.dataSource,
      runtimeRoot,
      simulateFingerprint,
      onAuthRequired: async (event) => {
        audit.authRequiredEvent = event;
        audit.authNotificationResult = await sender.send({
          type: "authentication_required",
          title: `${event.sourceName} 需要人工认证`,
          generatedAt: event.detectedAt,
          markdown:
            "定时采集检测到认证长期超时，请在运行采集任务的机器上完成指纹认证后重新执行。",
        });
      },
    });
    const reportPackage = buildReportPackage(
      dataResult.records,
      config.businessReport,
    );
    const messageResult = await sender.send(reportPackage.message);

    await Promise.all([
      writeFile(
        join(runPath, "data-source-audit.json"),
        `${JSON.stringify(dataResult.audit, null, 2)}\n`,
        "utf8",
      ),
      writeFile(
        join(runPath, "records.json"),
        `${JSON.stringify(dataResult.records, null, 2)}\n`,
        "utf8",
      ),
      writeFile(
        join(runPath, "report.json"),
        `${JSON.stringify(reportPackage.report, null, 2)}\n`,
        "utf8",
      ),
      writeFile(join(runPath, "report.md"), reportPackage.markdown, "utf8"),
      writeFile(join(runPath, "chart.svg"), reportPackage.chartSvg, "utf8"),
    ]);

    audit.status = "success";
    audit.completedAt = new Date().toISOString();
    audit.sourceId = dataResult.sourceId;
    audit.recordCount = dataResult.records.length;
    audit.messageResult = messageResult;
    await writeFile(
      join(runPath, "workflow-audit.json"),
      `${JSON.stringify(audit, null, 2)}\n`,
      "utf8",
    );
    return {
      runPath,
      audit,
      dataResult,
      reportPackage,
      messageResult,
    };
  } catch (error) {
    audit.status =
      error.message === "FINGERPRINT_AUTH_REQUIRED"
        ? "authentication_required"
        : "failed";
    audit.completedAt = new Date().toISOString();
    audit.error = { name: error.name, message: error.message };
    if (error.dataSourceAudit) {
      await writeFile(
        join(runPath, "data-source-audit.json"),
        `${JSON.stringify(error.dataSourceAudit, null, 2)}\n`,
        "utf8",
      );
    }
    await writeFile(
      join(runPath, "workflow-audit.json"),
      `${JSON.stringify(audit, null, 2)}\n`,
      "utf8",
    );
    throw error;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const configPath = getArgument("config");
  if (!configPath) throw new Error("--config is required");
  const config = JSON.parse(await readFile(resolve(configPath), "utf8"));
  const simulateFingerprint =
    getArgument("simulate-fingerprint", "false") === "true";
  const result = await runDailyReport({ config, simulateFingerprint });
  console.log(`Daily report completed: ${result.audit.recordCount} records`);
  console.log(`Artifacts: ${result.runPath}`);
}
