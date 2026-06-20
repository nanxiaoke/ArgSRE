import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  catalogSummary,
  loadDataSourceCatalog,
  resolveDataSourceRefs,
  validateDataSourceCatalog,
} from "./core/data-source-catalog.js";
import { loadWorkflowConfig } from "./core/workflow-config-loader.js";
import { runCatalogCommand } from "./catalog.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const catalogPath = resolve(root, "config/data-source-catalog.example.json");
const workflowPath = resolve(root, "config/daily-report-catalog.example.json");

const loaded = await loadDataSourceCatalog(catalogPath);
assert.equal(loaded.catalog.dataSources.length, 2);
assert.deepEqual(validateDataSourceCatalog(loaded.catalog), []);

const summary = catalogSummary(loaded.catalog);
assert.deepEqual(Object.keys(summary[0]), [
  "id",
  "name",
  "type",
  "enabled",
  "owner",
  "tags",
]);
assert.equal(JSON.stringify(summary).includes("entryUrl"), false);
assert.equal(JSON.stringify(summary).includes("headers"), false);

const resolvedWorkflow = await loadWorkflowConfig(workflowPath);
assert.equal(resolvedWorkflow.dataSources.length, 1);
assert.equal(resolvedWorkflow.dataSources[0].id, "manual-operations-source");
assert.equal(resolvedWorkflow.dataSourceCatalog, undefined);
assert.equal(resolvedWorkflow.dataSourceRefs, undefined);

const filtered = await runCatalogCommand({
  action: "list",
  path: catalogPath,
  tag: "browser",
  status: "disabled",
});
assert.equal(filtered.sources.length, 1);
assert.equal(filtered.sources[0].id, "browser-operations-source");

assert.throws(
  () => resolveDataSourceRefs(loaded.catalog, ["missing-source"]),
  (error) => error.code === "CAT-REF-001",
);
assert.throws(
  () => resolveDataSourceRefs(loaded.catalog, ["browser-operations-source"]),
  (error) => error.code === "CAT-REF-002",
);

const duplicateCatalog = structuredClone(loaded.catalog);
duplicateCatalog.dataSources[1].id = duplicateCatalog.dataSources[0].id;
assert.ok(
  validateDataSourceCatalog(duplicateCatalog).some(
    (error) => error.code === "CAT-SOURCE-002",
  ),
);

const mixedWorkflow = {
  ...resolvedWorkflow,
  dataSourceCatalog: catalogPath,
  dataSourceRefs: ["manual-operations-source"],
};
await assert.rejects(
  () =>
    import("./core/workflow-config-loader.js").then(({ resolveWorkflowConfig }) =>
      resolveWorkflowConfig(mixedWorkflow),
    ),
  /cannot be combined/,
);

console.log("Data source catalog demo passed");
