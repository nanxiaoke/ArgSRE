import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  loadDataSourceCatalog,
  resolveDataSourceRefs,
} from "./data-source-catalog.js";
import { assertValidWorkflowConfig } from "./config-validator.js";

export async function resolveWorkflowConfig(config, { baseDirectory } = {}) {
  const resolved = structuredClone(config);
  const usesCatalog =
    resolved.dataSourceCatalog !== undefined ||
    resolved.dataSourceRefs !== undefined;
  if (!usesCatalog) {
    assertValidWorkflowConfig(resolved);
    return resolved;
  }

  if (
    resolved.dataSource !== undefined ||
    resolved.dataSources !== undefined
  ) {
    throw new Error(
      "catalog references cannot be combined with dataSource or dataSources",
    );
  }
  if (
    typeof resolved.dataSourceCatalog !== "string" ||
    resolved.dataSourceCatalog.trim() === ""
  ) {
    throw new Error("dataSourceCatalog must be a non-empty string");
  }
  if (
    !Array.isArray(resolved.dataSourceRefs) ||
    resolved.dataSourceRefs.length === 0 ||
    resolved.dataSourceRefs.some(
      (id) => typeof id !== "string" || id.trim() === "",
    )
  ) {
    throw new Error("dataSourceRefs must be a non-empty string array");
  }
  if (new Set(resolved.dataSourceRefs).size !== resolved.dataSourceRefs.length) {
    throw new Error("dataSourceRefs must be unique");
  }

  const loaded = await loadDataSourceCatalog(
    resolved.dataSourceCatalog,
    baseDirectory,
  );
  resolved.dataSources = resolveDataSourceRefs(
    loaded.catalog,
    resolved.dataSourceRefs,
  );
  delete resolved.dataSource;
  delete resolved.dataSourceCatalog;
  delete resolved.dataSourceRefs;
  assertValidWorkflowConfig(resolved);
  return resolved;
}

export async function loadWorkflowConfig(path) {
  const configPath = resolve(path);
  const config = JSON.parse(await readFile(configPath, "utf8"));
  return resolveWorkflowConfig(config, {
    baseDirectory: dirname(configPath),
  });
}
