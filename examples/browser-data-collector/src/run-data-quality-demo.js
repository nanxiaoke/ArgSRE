import assert from "node:assert/strict";
import { evaluateDataQuality } from "./core/data-quality.js";

const now = new Date("2026-06-20T12:00:00.000Z");
const records = [
  {
    serviceId: "private-service-a",
    serviceName: "Service A",
    alarmCount: 1,
    updatedAt: "2026-06-20T11:30:00.000Z",
  },
  {
    serviceId: "private-service-a",
    serviceName: "",
    alarmCount: -1,
    updatedAt: "2026-06-19T10:00:00.000Z",
  },
];
const result = evaluateDataQuality(
  records,
  {
    mode: "warn",
    minRecords: 3,
    requiredFields: ["serviceId", "serviceName"],
    uniqueFields: ["serviceId"],
    freshness: {
      field: "updatedAt",
      maxAgeMinutes: 120,
    },
    numericRanges: {
      alarmCount: { min: 0, max: 100 },
    },
  },
  now,
);

assert.equal(result.status, "warn");
assert.equal(result.issueCount, 5);
assert.deepEqual(
  new Set(result.issues.map((item) => item.code)),
  new Set([
    "DQ-COUNT-001",
    "DQ-REQUIRED-001",
    "DQ-UNIQUE-001",
    "DQ-FRESHNESS-001",
    "DQ-NUMERIC-002",
  ]),
);
assert.equal(JSON.stringify(result).includes("private-service-a"), false);

const passing = evaluateDataQuality(
  records.slice(0, 1),
  {
    mode: "fail",
    minRecords: 1,
    requiredFields: ["serviceId"],
    uniqueFields: ["serviceId"],
    freshness: {
      field: "updatedAt",
      maxAgeMinutes: 120,
    },
    numericRanges: {
      alarmCount: { min: 0 },
    },
  },
  now,
);
assert.equal(passing.status, "pass");
assert.equal(passing.issueCount, 0);

console.log("Data quality demo passed");
