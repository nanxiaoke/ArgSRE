import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { createMessageSender } from "./adapters/message-sender.js";
import { runConfiguredDataSource } from "./core/data-source-dispatcher.js";
import {
  createIdempotencyStore,
  localDateKey,
} from "./core/idempotency.js";
import { createHistoryStore } from "./core/history-store.js";
import { buildReportPackage } from "./core/report-builder.js";
import {
  buildDailyTrend,
  renderTrendChart,
} from "./core/trend-builder.js";
import { createWorkflowStateStore } from "./core/workflow-state.js";
import {
  loadWorkflowConfig,
  resolveWorkflowConfig,
} from "./core/workflow-config-loader.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function getArgument(name, fallback) {
  const prefix = `--${name}=`;
  const inline = process.argv.find((value) => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

export async function runDailyReport({
  config: inputConfig,
  simulateFingerprint = false,
  messageSender,
  dryRun = false,
} = {}) {
  if (!inputConfig) throw new Error("workflow config is required");
  const config = await resolveWorkflowConfig(inputConfig);

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
  const historyStore = await createHistoryStore(runtimeRoot);
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
    const sourceConfigs = config.dataSources ?? [config.dataSource];
    const dataResults = [];
    const sourceFailures = [];
    const authNotifications = [];

    for (const sourceConfig of sourceConfigs) {
      try {
        const dataResult = await runConfiguredDataSource({
          config: sourceConfig,
          runtimeRoot,
          simulateFingerprint,
          onAuthRequired: async (event) => {
            const notificationResult = await sender.send(
              {
                type: "authentication_required",
                title: `${event.sourceName} 需要人工认证`,
                generatedAt: event.detectedAt,
                summary: { sourceId: event.sourceId },
                markdown:
                  "定时采集检测到认证长期超时，请在运行采集任务的机器上完成指纹认证后重新执行。",
              },
              { fileName: `authentication-required-${event.sourceId}` },
            );
            authNotifications.push({ event, notificationResult });
          },
          retryConfig: config.reliability?.dataRequest,
        });
        dataResults.push(dataResult);
        await historyStore.append({
          sourceId: dataResult.sourceId,
          records: dataResult.records,
        });
        await historyStore.prune({
          sourceId: dataResult.sourceId,
          retentionDays: config.history?.retentionDays ?? 90,
        });
      } catch (error) {
        sourceFailures.push({
          sourceId: sourceConfig.id,
          sourceName: sourceConfig.name,
          status:
            error.message === "FINGERPRINT_AUTH_REQUIRED"
              ? "authentication_required"
              : error.name === "DataQualityError"
                ? "quality_failed"
                : "failed",
          errorCode:
            error.message === "FINGERPRINT_AUTH_REQUIRED"
              ? "FINGERPRINT_AUTH_REQUIRED"
              : error.name,
          quality: error.quality,
          qualityWarnings: error.qualityWarnings ?? [],
          audit: error.dataSourceAudit,
        });
      }
    }

    audit.authNotifications = authNotifications;
    audit.sourceFailures = sourceFailures.map(
      ({ sourceId, sourceName, status, errorCode }) => ({
        sourceId,
        sourceName,
        status,
        errorCode,
      }),
    );

    if (dataResults.length === 0) {
      const allAuthRequired = sourceFailures.every(
        (failure) => failure.status === "authentication_required",
      );
      const allFailedError = new Error(
        allAuthRequired
          ? "ALL_DATA_SOURCES_AUTH_REQUIRED"
          : "ALL_DATA_SOURCES_FAILED",
      );
      allFailedError.name = allAuthRequired
        ? "AllDataSourcesAuthRequiredError"
        : "AllDataSourcesFailedError";
      allFailedError.sourceFailures = sourceFailures;
      throw allFailedError;
    }

    const combinedRecords = dataResults.flatMap((result) =>
      result.records.map((record) => ({
        ...record,
        _sourceId: result.sourceId,
      })),
    );
    const qualityWarnings = dataResults.flatMap(
      (result) => result.qualityWarnings ?? [],
    );
    const failedQualityWarnings = sourceFailures.flatMap(
      (failure) => failure.qualityWarnings ?? [],
    );
    const reportWarnings = [
      ...sourceFailures.map(
        (failure) =>
          `${failure.sourceName}: ${failure.status} (${failure.errorCode})`,
      ),
      ...qualityWarnings,
      ...failedQualityWarnings,
    ];
    const combinedSourceId = `workflow:${config.name}`;
    const historyResult = await historyStore.append({
      sourceId: combinedSourceId,
      records: combinedRecords,
    });
    const trendDays = config.history?.trendDays ?? 7;
    const snapshots = await historyStore.list({
      sourceId: combinedSourceId,
      days: trendDays,
    });
    const trendSeries = buildDailyTrend(snapshots);
    const trendConfig = config.history?.trendChart ?? {
      title: `${trendDays} 天告警趋势`,
      valueField: "totalAlarms",
    };
    const trendChartSvg = renderTrendChart(trendSeries, trendConfig);
    const removedHistoryFiles = await historyStore.prune({
      sourceId: combinedSourceId,
      retentionDays: config.history?.retentionDays ?? 90,
    });
    const reportPackage = buildReportPackage(
      combinedRecords,
      config.businessReport,
      {
        trend: {
          title: trendConfig.title,
          valueField: trendConfig.valueField,
          series: trendSeries,
          chartSvg: trendChartSvg,
        },
        warnings: reportWarnings,
      },
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
        join(runPath, "data-source-audits.json"),
        `${JSON.stringify(
          {
            successes: dataResults.map((result) => result.audit),
            failures: sourceFailures,
          },
          null,
          2,
        )}\n`,
        "utf8",
      ),
      writeFile(
        join(runPath, "records.json"),
        `${JSON.stringify(combinedRecords, null, 2)}\n`,
        "utf8",
      ),
      writeFile(
        join(runPath, "report.json"),
        `${JSON.stringify(reportPackage.report, null, 2)}\n`,
        "utf8",
      ),
      writeFile(join(runPath, "report.md"), reportPackage.markdown, "utf8"),
      writeFile(join(runPath, "chart.svg"), reportPackage.chartSvg, "utf8"),
      writeFile(join(runPath, "trend-chart.svg"), trendChartSvg, "utf8"),
      writeFile(
        join(runPath, "trend.json"),
        `${JSON.stringify(trendSeries, null, 2)}\n`,
        "utf8",
      ),
      writeFile(
        join(runPath, "data-quality-audit.json"),
        `${JSON.stringify(
          {
            status:
              sourceFailures.some((failure) => failure.quality)
                ? "partial_failure"
                : qualityWarnings.length > 0
                  ? "warning"
                  : "pass",
            sources: [
              ...dataResults
                .filter((result) => result.quality)
                .map((result) => ({
                  sourceId: result.sourceId,
                  ...result.quality,
                })),
              ...sourceFailures
                .filter((failure) => failure.quality)
                .map((failure) => ({
                  sourceId: failure.sourceId,
                  ...failure.quality,
                })),
            ],
          },
          null,
          2,
        )}\n`,
        "utf8",
      ),
    ]);

    audit.status = "success";
    if (qualityWarnings.length > 0) audit.status = "success_with_warnings";
    if (sourceFailures.length > 0) audit.status = "partial_success";
    audit.completedAt = new Date().toISOString();
    audit.sourceIds = dataResults.map((result) => result.sourceId);
    audit.recordCount = combinedRecords.length;
    audit.quality = {
      warningCount: qualityWarnings.length + failedQualityWarnings.length,
      failedSourceCount: sourceFailures.filter((failure) => failure.quality)
        .length,
    };
    audit.history = {
      snapshotPath: historyResult.path,
      trendDays,
      trendPointCount: trendSeries.length,
      removedFiles: removedHistoryFiles,
    };
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
      dataResult: dataResults[0],
      dataResults,
      reportPackage,
      messageResult,
    };
  } catch (error) {
    const authenticationBlocked = [
      "FINGERPRINT_AUTH_REQUIRED",
      "ALL_DATA_SOURCES_AUTH_REQUIRED",
    ].includes(error.message);
    audit.status =
      authenticationBlocked
        ? "authentication_required"
        : "failed";
    audit.completedAt = new Date().toISOString();
    audit.error = { name: error.name, message: error.message };
    const errorCode =
      authenticationBlocked
        ? error.message
        : error.name;
    audit.workflowState =
      authenticationBlocked
        ? await workflowStateStore.markBlocked(config.name, runId, errorCode)
        : await workflowStateStore.markFailure(
            config.name,
            runId,
            errorCode,
          );
    const threshold =
      config.reliability?.failureNotificationThreshold ?? 1;
    if (
      !authenticationBlocked &&
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
    if (error.sourceFailures) {
      await writeFile(
        join(runPath, "data-source-audits.json"),
        `${JSON.stringify(
          {
            successes: [],
            failures: error.sourceFailures,
          },
          null,
          2,
        )}\n`,
        "utf8",
      );
      const qualityFailures = error.sourceFailures.filter(
        (failure) => failure.quality,
      );
      if (qualityFailures.length > 0) {
        await writeFile(
          join(runPath, "data-quality-audit.json"),
          `${JSON.stringify(
            {
              status: "failed",
              sources: qualityFailures.map((failure) => ({
                sourceId: failure.sourceId,
                ...failure.quality,
              })),
            },
            null,
            2,
          )}\n`,
          "utf8",
        );
      }
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
  const config = await loadWorkflowConfig(configPath);
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
