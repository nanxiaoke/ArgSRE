import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { runDailyReport } from "./daily-report.js";
import { millisecondsUntil } from "./daily-scheduler.js";
import { startMockServer } from "./mock-server.js";

const mock = await startMockServer();

try {
  const config = {
    name: "mock-daily-report",
    dataSource: {
      id: "mock-operations-source",
      name: "模拟运营数据源",
      profileName: "daily-report-demo",
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
    schedule: { time: "09:00" },
  };

  const result = await runDailyReport({ config });
  assert.equal(result.audit.status, "success");
  assert.equal(result.dataResult.audit.auth.state, "quick");
  assert.equal(result.reportPackage.report.serviceCount, 2);
  assert.equal(result.reportPackage.report.totalInstances, 18);
  assert.equal(result.reportPackage.report.totalAlarms, 2);
  assert.ok(result.reportPackage.chartSvg.includes("<svg"));

  const reports = mock.getImReports();
  assert.equal(reports.length, 1);
  assert.equal(reports[0].type, "daily_sre_report");
  assert.equal(reports[0].summary.totalAlarms, 2);
  assert.equal(reports[0].chart.mimeType, "image/svg+xml");

  const chart = await readFile(join(result.runPath, "chart.svg"), "utf8");
  assert.ok(chart.includes("DWS 生产集群"));

  const fingerprintConfig = structuredClone(config);
  fingerprintConfig.dataSource.profileName = "daily-report-fingerprint-demo";
  fingerprintConfig.dataSource.entryUrl = `${mock.baseUrl}/scenario?mode=fingerprint`;
  await assert.rejects(
    () => runDailyReport({ config: fingerprintConfig }),
    /FINGERPRINT_AUTH_REQUIRED/,
  );
  const reportsAfterFingerprint = mock.getImReports();
  assert.equal(reportsAfterFingerprint.length, 2);
  assert.equal(reportsAfterFingerprint[1].type, "authentication_required");

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
