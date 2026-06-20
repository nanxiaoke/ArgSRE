import assert from "node:assert/strict";
import { join } from "node:path";
import { createHistoryStore } from "./core/history-store.js";
import {
  buildDailyTrend,
  renderTrendChart,
} from "./core/trend-builder.js";

const runtimeRoot = join(
  process.cwd(),
  "runtime",
  "test-history",
  String(Date.now()),
);
const store = await createHistoryStore(runtimeRoot);
const sourceId = `history-demo-${Date.now()}`;
const snapshots = [
  {
    timestamp: "2026-06-18T09:00:00.000Z",
    alarms: [0, 1],
  },
  {
    timestamp: "2026-06-19T09:00:00.000Z",
    alarms: [1, 2],
  },
  {
    timestamp: "2026-06-20T09:00:00.000Z",
    alarms: [0, 2],
  },
];

for (const snapshot of snapshots) {
  await store.append({
    sourceId,
    timestamp: snapshot.timestamp,
    records: snapshot.alarms.map((alarmCount, index) => ({
      serviceId: `service-${index}`,
      serviceName: `service-${index}`,
      instanceCount: index + 1,
      alarmCount,
      status: alarmCount > 0 ? "warning" : "healthy",
    })),
  });
}

const stored = await store.list({
  sourceId,
  days: 7,
  now: new Date("2026-06-20T12:00:00.000Z"),
});
const trend = buildDailyTrend(stored);
assert.equal(trend.length, 3);
assert.deepEqual(
  trend.map((point) => point.totalAlarms),
  [1, 3, 2],
);
const svg = renderTrendChart(trend, {
  title: "告警趋势",
  valueField: "totalAlarms",
});
assert.ok(svg.includes("<polyline"));
assert.ok(svg.includes("06-20"));
console.log("History and trend demo passed");
