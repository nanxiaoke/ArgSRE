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
console.log(`Config validation demo passed: ${errors.length} errors detected`);
