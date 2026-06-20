import assert from "node:assert/strict";
import {
  assertValidWorkflowConfig,
  validateWorkflowConfig,
} from "./core/config-validator.js";

const invalid = {
  name: "",
  dataSource: {
    id: "source",
    name: "source",
    profileName: "profile",
    entryUrl: "not-a-url",
    targetUrlPattern: "/app",
    auth: {
      pageUrlPattern: "/auth",
      stateAttribute: "data-auth-state",
      quickButton: "#quick",
      fingerprintButton: "#fingerprint",
      timeoutMs: 0,
    },
    request: {
      method: "INVALID",
      url: "/relative",
    },
    extract: {
      recordPath: [],
      fields: {},
      primaryKey: "id",
    },
  },
  businessReport: {
    title: "",
    chart: {
      categoryField: "",
      valueField: "",
      title: "",
    },
  },
  messageChannel: {
    type: "unknown",
  },
  schedule: {
    time: "25:61",
  },
};

const errors = validateWorkflowConfig(invalid);
assert.ok(errors.length >= 10);
assert.ok(errors.some((error) => error.code === "CFG-URL-001"));
assert.ok(errors.some((error) => error.code === "CFG-SCHEDULE-001"));
assert.throws(
  () => assertValidWorkflowConfig(invalid),
  /Workflow config validation failed/,
);

const validManual = {
  name: "manual-workflow",
  dataSource: {
    type: "manual-file",
    id: "manual-source",
    name: "Manual source",
    file: {
      path: "runtime/imports/services.csv",
      format: "csv",
      encoding: "utf8",
      maxAgeHours: 24,
    },
    extract: {
      recordPath: ["records"],
      fields: { serviceId: "serviceId" },
      primaryKey: "serviceId",
    },
  },
  businessReport: {
    title: "Manual report",
    chart: {
      categoryField: "serviceId",
      valueField: "serviceId",
      title: "Manual chart",
    },
  },
  messageChannel: { type: "local-file" },
  schedule: { time: "09:00" },
};
assert.deepEqual(validateWorkflowConfig(validManual), []);

const invalidManual = structuredClone(validManual);
invalidManual.dataSource.file.format = "xlsx";
invalidManual.dataSource.file.maxAgeHours = 0;
const manualErrors = validateWorkflowConfig(invalidManual);
assert.ok(manualErrors.some((error) => error.code === "CFG-FILE-001"));
assert.ok(manualErrors.some((error) => error.code === "CFG-FILE-003"));

const invalidQuality = structuredClone(validManual);
invalidQuality.dataSource.quality = {
  mode: "stop",
  minRecords: -1,
  requiredFields: ["missingField"],
  freshness: {
    field: "unknownTimestamp",
    maxAgeMinutes: 0,
  },
  numericRanges: {
    serviceId: { min: 10, max: 1 },
  },
};
const qualityErrors = validateWorkflowConfig(invalidQuality);
for (const code of [
  "CFG-QUALITY-001",
  "CFG-QUALITY-002",
  "CFG-QUALITY-004",
  "CFG-QUALITY-005",
  "CFG-QUALITY-007",
]) {
  assert.ok(qualityErrors.some((error) => error.code === code));
}

console.log(`Config validation demo passed: ${errors.length} errors detected`);
