import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { runDailyReport } from "./daily-report.js";
import { millisecondsUntil } from "./daily-scheduler.js";
import { startMockServer } from "./mock-server.js";

const mock = await startMockServer({ dataFailures: 1, imFailures: 1 });

try {
  const workflowName = `mock-daily-report-${Date.now()}`;
  const config = {
    name: workflowName,
    dataSource: {
      id: "mock-operations-source",
      name: "模拟运营数据源",
      profileName: `${workflowName}-profile`,
      entryUrl: `${mock.baseUrl}/scenario?mode=quick`,
      targetUrlPattern: "/app",
      headless: true,
      auth: {
        pageUrlPattern: "/auth",
        stateAttribute: "data-auth-state",
        quickButton: "[data-testid='quick-auth']",
        fingerprintButton: "[data-testid='fingerprint-auth']",
        timeoutMs: 60000,
      },
      request: {
        method: "POST",
        url: `${mock.baseUrl}/api/ops/query`,
        headers: { "Content-Type": "application/json" },
        body: {
          region: "cn-north-4",
          timeRange: "last_24_hours",
        },
      },
      extract: {
        recordPath: ["data", "records"],
        fields: {
          serviceId: "service.id",
          serviceName: "service.name",
          region: "deployment.region",
          status: "runtime.status",
          instanceCount: "runtime.instanceCount",
          alarmCount: "runtime.alarmCount",
          updatedAt: "runtime.updatedAt",
        },
        primaryKey: "serviceId",
      },
    },
    businessReport: {
      title: "SRE 每日运营报告",
      chart: {
        categoryField: "serviceName",
        valueField: "alarmCount",
        title: "各服务告警数量",
      },
    },
    messageChannel: {
      type: "webhook-json",
      endpoint: `${mock.baseUrl}/api/im/reports`,
      headers: { "Content-Type": "application/json" },
    },
    reliability: {
      dataRequest: {
        maxAttempts: 3,
        baseDelayMs: 10,
        maxDelayMs: 20,
        timeoutMs: 5000,
      },
      messageSend: {
        maxAttempts: 3,
        baseDelayMs: 10,
        maxDelayMs: 20,
        timeoutMs: 5000,
      },
      idempotencyHours: 36,
    },
    schedule: { time: "09:00" },
  };

  const result = await runDailyReport({ config });
  assert.equal(result.audit.status, "success");
  assert.equal(result.dataResult.audit.auth.state, "quick");
  assert.equal(result.dataResult.audit.request.attempts, 2);
  assert.equal(result.reportPackage.report.serviceCount, 2);
  assert.equal(result.reportPackage.report.totalInstances, 18);
  assert.equal(result.reportPackage.report.totalAlarms, 2);
  assert.ok(result.reportPackage.chartSvg.includes("<svg"));

  const reports = mock.getImReports();
  assert.equal(reports.length, 1);
  assert.equal(reports[0].type, "daily_sre_report");
  assert.equal(reports[0].summary.totalAlarms, 2);
  assert.equal(reports[0].chart.mimeType, "image/svg+xml");
  assert.equal(result.messageResult.attempts, 2);

  const chart = await readFile(join(result.runPath, "chart.svg"), "utf8");
  assert.ok(chart.includes("DWS 生产集群"));

  const duplicateResult = await runDailyReport({ config });
  assert.equal(duplicateResult.messageResult.skipped, true);
  assert.equal(mock.getImReports().length, 1);

  const dryRunConfig = structuredClone(config);
  dryRunConfig.name = `${workflowName}-dry-run`;
  dryRunConfig.dataSource.profileName = `${workflowName}-dry-run-profile`;
  const dryRunResult = await runDailyReport({
    config: dryRunConfig,
    dryRun: true,
  });
  assert.equal(dryRunResult.audit.dryRun, true);
  assert.equal(mock.getImReports().length, 1);
  const preview = JSON.parse(
    await readFile(join(dryRunResult.runPath, "message-preview.json"), "utf8"),
  );
  assert.equal(preview.type, "daily_sre_report");

  const partialConfig = structuredClone(config);
  partialConfig.name = `${workflowName}-partial`;
  const goodSource = structuredClone(partialConfig.dataSource);
  goodSource.id = "good-source";
  goodSource.profileName = `${workflowName}-partial-good-profile`;
  const failedSource = structuredClone(partialConfig.dataSource);
  failedSource.id = "failed-source";
  failedSource.name = "失败模拟数据源";
  failedSource.profileName = `${workflowName}-partial-failed-profile`;
  failedSource.request.url = `${mock.baseUrl}/api/ops/fail`;
  delete partialConfig.dataSource;
  partialConfig.dataSources = [goodSource, failedSource];
  const partialResult = await runDailyReport({
    config: partialConfig,
    dryRun: true,
  });
  assert.equal(partialResult.audit.status, "partial_success");
  assert.equal(partialResult.dataResults.length, 1);
  assert.equal(partialResult.audit.sourceFailures.length, 1);
  assert.equal(partialResult.reportPackage.message.summary.warningCount, 1);

  const failureConfig = structuredClone(config);
  failureConfig.name = `${workflowName}-failure`;
  failureConfig.dataSource.profileName = `${workflowName}-failure-profile`;
  failureConfig.dataSource.request.url = `${mock.baseUrl}/api/ops/fail`;
  failureConfig.reliability.dataRequest.maxAttempts = 2;
  failureConfig.reliability.failureNotificationThreshold = 1;
  await assert.rejects(
    () => runDailyReport({ config: failureConfig }),
    /ALL_DATA_SOURCES_FAILED/,
  );
  const reportsAfterFailure = mock.getImReports();
  assert.equal(reportsAfterFailure.length, 2);
  assert.equal(reportsAfterFailure[1].type, "workflow_failure");
  assert.equal(
    reportsAfterFailure[1].summary.consecutiveFailures,
    1,
  );

  const fingerprintConfig = structuredClone(config);
  fingerprintConfig.name = `${workflowName}-fingerprint`;
  fingerprintConfig.dataSource.profileName = `${workflowName}-fingerprint-profile`;
  fingerprintConfig.dataSource.entryUrl = `${mock.baseUrl}/scenario?mode=fingerprint`;
  let fingerprintError;
  try {
    await runDailyReport({ config: fingerprintConfig });
  } catch (error) {
    fingerprintError = error;
  }
  assert.match(
    fingerprintError.message,
    /ALL_DATA_SOURCES_AUTH_REQUIRED/,
  );
  assert.equal(
    fingerprintError.workflowAudit.workflowState.lastStatus,
    "blocked",
  );
  const reportsAfterFingerprint = mock.getImReports();
  assert.equal(reportsAfterFingerprint.length, 3);
  assert.equal(reportsAfterFingerprint[2].type, "authentication_required");

  const now = new Date("2026-06-20T08:30:00");
  assert.equal(millisecondsUntil("09:00", now), 30 * 60 * 1000);
  assert.equal(
    millisecondsUntil("08:00", now),
    23.5 * 60 * 60 * 1000,
  );

  console.log(`Daily report demo passed -> ${result.runPath}`);
} finally {
  await mock.close();
}
