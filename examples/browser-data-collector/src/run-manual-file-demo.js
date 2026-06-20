import assert from "node:assert/strict";
import { mkdir, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runManualFileSource } from "./core/manual-file-runner.js";

const directory = join(
  fileURLToPath(new URL("../runtime/imports", import.meta.url)),
  `manual-file-demo-${Date.now()}`,
);
await mkdir(directory, { recursive: true });

const extract = {
  recordPath: ["records"],
  fields: {
    serviceId: "service.id",
    serviceName: "service.name",
    alarmCount: "metrics.alarmCount",
  },
  primaryKey: "serviceId",
};

const jsonPath = join(directory, "services.json");
await writeFile(
  jsonPath,
  JSON.stringify({
    records: [
      {
        service: { id: "json-001", name: "JSON service" },
        metrics: { alarmCount: 2 },
      },
    ],
  }),
  "utf8",
);
const jsonResult = await runManualFileSource({
  config: {
    type: "manual-file",
    id: "json-source",
    name: "JSON source",
    file: { path: jsonPath, format: "json" },
    extract,
  },
});
assert.deepEqual(jsonResult.records, [
  {
    serviceId: "json-001",
    serviceName: "JSON service",
    alarmCount: 2,
  },
]);

const csvPath = join(directory, "services.csv");
await writeFile(
  csvPath,
  [
    "serviceId,serviceName,alarmCount",
    'csv-001,"Service, quoted",3',
  ].join("\n"),
  "utf8",
);
const csvResult = await runManualFileSource({
  config: {
    type: "manual-file",
    id: "csv-source",
    name: "CSV source",
    file: { path: csvPath, format: "csv" },
    extract: {
      recordPath: ["records"],
      fields: {
        serviceId: "serviceId",
        serviceName: "serviceName",
        alarmCount: "alarmCount",
      },
      primaryKey: "serviceId",
    },
  },
});
assert.equal(csvResult.records[0].serviceName, "Service, quoted");

const invalidCsvPath = join(directory, "invalid.csv");
await writeFile(invalidCsvPath, "a,b\n1", "utf8");
await assert.rejects(
  () =>
    runManualFileSource({
      config: {
        type: "manual-file",
        id: "invalid-source",
        name: "Invalid source",
        file: { path: invalidCsvPath, format: "csv" },
        extract: {
          recordPath: ["records"],
          fields: { a: "a" },
          primaryKey: "a",
        },
      },
    }),
  (error) =>
    error.name === "ManualFileParseError" &&
    error.message === "CSV_COLUMN_COUNT_MISMATCH_AT_ROW_2",
);

const staleTime = new Date(Date.now() - 48 * 60 * 60 * 1000);
await utimes(jsonPath, staleTime, staleTime);
await assert.rejects(
  () =>
    runManualFileSource({
      config: {
        type: "manual-file",
        id: "stale-source",
        name: "Stale source",
        file: { path: jsonPath, format: "json", maxAgeHours: 1 },
        extract,
      },
    }),
  (error) => error.name === "ManualFileStaleError",
);

console.log("Manual JSON/CSV import demo passed");
