import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { createMessageSender } from "./adapters/message-sender.js";
import { assertValidWorkflowConfig } from "./core/config-validator.js";
import { runDataSource } from "./core/data-source-runner.js";
import {
  createIdempotencyStore,
  localDateKey,
} from "./core/idempotency.js";
import { buildReportPackage } from "./core/report-builder.js";
import { createWorkflowStateStore } from "./core/workflow-state.js";

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
  dryRun = false,
} = {}) {
  if (!config) throw new Error("workflow config is required");
  assertValidWorkflowConfig(config);

  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const runtimeRoot = join(ROOT, "runtime");
  const runPath = join(runtimeRoot, "daily-reports", runId);
  await mkdir(runPath, { recursive: true });

  const sender =
    messageSender ??
    createMessageSender(
      dryRun ? { type: "local-file" } : config.messageChannel,
      {
        retry: config.reliability?.messageSend,
        outputDirectory: runPath,
      },
    );
  const idempotencyStore = await createIdempotencyStore(runtimeRoot);
  const workflowStateStore = await createWorkflowStateStore(runtimeRoot);
  const idempotencyKey = `${config.name}:${localDateKey()}:daily-report`;
  const audit = {
    runId,
    workflow: config.name,
    startedAt: new Date().toISOString(),
    status: "running",
    dryRun,
    idempotencyKey,
  };

  try {
    const dataResult = await runDataSource({
      config: config.dataSource,
      runtimeRoot,
      simulateFingerprint,
      onAuthRequired: async (event) => {
        audit.authRequiredEvent = event;
        audit.authNotificationResult = await sender.send(
          {
            type: "authentication_required",
            title: `${event.sourceName} 需要人工认证`,
            generatedAt: event.detectedAt,
            markdown:
              "定时采集检测到认证长期超时，请在运行采集任务的机器上完成指纹认证后重新执行。",
          },
          { fileName: "authentication-required" },
        );
      },
      retryConfig: config.reliability?.dataRequest,
    });
    const reportPackage = buildReportPackage(
      dataResult.records,
      config.businessReport,
    );
    const priorSend = dryRun
      ? undefined
      : await idempotencyStore.get(
          idempotencyKey,
          config.reliability?.idempotencyHours ?? 36,
        );
    let messageResult;
    if (priorSend) {
      messageResult = {
        skipped: true,
        reason: "idempotency",
        priorSend,
      };
    } else {
      messageResult = await sender.send(reportPackage.message, {
        idempotencyKey,
        fileName: "message-preview",
      });
      if (!dryRun) {
        await idempotencyStore.mark(idempotencyKey, {
          sentAt: new Date().toISOString(),
          workflow: config.name,
          messageResult,
        });
      }
    }

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
    audit.workflowState = await workflowStateStore.markSuccess(
      config.name,
      runId,
    );
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
    const errorCode =
      error.message === "FINGERPRINT_AUTH_REQUIRED"
        ? "FINGERPRINT_AUTH_REQUIRED"
        : error.name;
    audit.workflowState =
      error.message === "FINGERPRINT_AUTH_REQUIRED"
        ? await workflowStateStore.markBlocked(config.name, runId, errorCode)
        : await workflowStateStore.markFailure(
            config.name,
            runId,
            errorCode,
          );
    const threshold =
      config.reliability?.failureNotificationThreshold ?? 1;
    if (
      error.message !== "FINGERPRINT_AUTH_REQUIRED" &&
      audit.workflowState.consecutiveFailures >= threshold
    ) {
      try {
        audit.failureNotificationResult = await sender.send(
          {
            type: "workflow_failure",
            title: `${config.name} 执行失败`,
            generatedAt: new Date().toISOString(),
            summary: {
              consecutiveFailures:
                audit.workflowState.consecutiveFailures,
              errorCode,
            },
            markdown:
              `工作流连续失败 ${audit.workflowState.consecutiveFailures} 次。` +
              `错误分类：${errorCode}。请在运行机器上查看本地审计文件。`,
          },
          { fileName: "workflow-failure" },
        );
      } catch (notificationError) {
        audit.failureNotificationError = {
          name: notificationError.name,
          message: notificationError.message,
        };
      }
    }
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
    error.workflowAudit = audit;
    throw error;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const configPath = getArgument("config");
  if (!configPath) throw new Error("--config is required");
  const config = JSON.parse(await readFile(resolve(configPath), "utf8"));
  const simulateFingerprint =
    getArgument("simulate-fingerprint", "false") === "true";
  const dryRun = getArgument("dry-run", "false") === "true";
  const result = await runDailyReport({
    config,
    simulateFingerprint,
    dryRun,
  });
  console.log(`Daily report completed: ${result.audit.recordCount} records`);
  console.log(`Artifacts: ${result.runPath}`);
}
