import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { validateWorkflowConfig } from "./config-validator.js";

function add(errors, code, path, message) {
  errors.push({ code, path, message });
}

export function validateDataSourceCatalog(catalog) {
  const errors = [];
  if (!catalog || typeof catalog !== "object" || Array.isArray(catalog)) {
    add(errors, "CAT-REQUIRED-001", "$", "must be an object");
    return errors;
  }
  if (catalog.version !== 1) {
    add(errors, "CAT-VERSION-001", "version", "must be 1");
  }
  if (!Array.isArray(catalog.dataSources) || catalog.dataSources.length === 0) {
    add(
      errors,
      "CAT-SOURCE-001",
      "dataSources",
      "must be a non-empty array",
    );
    return errors;
  }

  const ids = new Set();
  catalog.dataSources.forEach((source, index) => {
    const path = `dataSources[${index}]`;
    const validationErrors = validateWorkflowConfig({
      name: "catalog-validation",
      dataSource: source,
      businessReport: {
        title: "catalog-validation",
        chart: {
          categoryField: "category",
          valueField: "value",
          title: "catalog-validation",
        },
      },
      messageChannel: { type: "local-file" },
      schedule: { time: "00:00" },
    });
    for (const error of validationErrors) {
      if (error.path.startsWith("dataSource")) {
        add(
          errors,
          error.code.replace(/^CFG-/, "CAT-"),
          error.path.replace("dataSource", path),
          error.message,
        );
      }
    }

    if (typeof source?.id === "string") {
      if (ids.has(source.id)) {
        add(errors, "CAT-SOURCE-002", `${path}.id`, "must be unique");
      }
      ids.add(source.id);
    }
    if (
      source?.enabled !== undefined &&
      typeof source.enabled !== "boolean"
    ) {
      add(errors, "CAT-META-001", `${path}.enabled`, "must be a boolean");
    }
    if (
      source?.tags !== undefined &&
      (!Array.isArray(source.tags) ||
        source.tags.some((tag) => typeof tag !== "string" || tag.trim() === ""))
    ) {
      add(
        errors,
        "CAT-META-002",
        `${path}.tags`,
        "must be an array of non-empty strings",
      );
    }
    if (
      source?.owner !== undefined &&
      (typeof source.owner !== "string" || source.owner.trim() === "")
    ) {
      add(errors, "CAT-META-003", `${path}.owner`, "must be a non-empty string");
    }
  });
  return errors;
}

export function assertValidDataSourceCatalog(catalog) {
  const errors = validateDataSourceCatalog(catalog);
  if (errors.length === 0) return catalog;

  const message = errors
    .map((error) => `${error.code} ${error.path}: ${error.message}`)
    .join("\n");
  const validationError = new Error(
    `Data source catalog validation failed:\n${message}`,
  );
  validationError.name = "DataSourceCatalogValidationError";
  validationError.validationErrors = errors;
  throw validationError;
}

export async function loadDataSourceCatalog(path, baseDirectory = process.cwd()) {
  const catalogPath = resolve(baseDirectory, path);
  const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
  assertValidDataSourceCatalog(catalog);
  return {
    path: catalogPath,
    directory: dirname(catalogPath),
    catalog,
  };
}

export function resolveDataSourceRefs(catalog, refs) {
  const byId = new Map(catalog.dataSources.map((source) => [source.id, source]));
  return refs.map((id, index) => {
    const source = byId.get(id);
    if (!source) {
      const error = new Error(`Unknown data source reference: ${id}`);
      error.name = "DataSourceReferenceError";
      error.code = "CAT-REF-001";
      error.path = `dataSourceRefs[${index}]`;
      throw error;
    }
    if (source.enabled === false) {
      const error = new Error(`Data source is disabled: ${id}`);
      error.name = "DataSourceReferenceError";
      error.code = "CAT-REF-002";
      error.path = `dataSourceRefs[${index}]`;
      throw error;
    }
    return structuredClone(source);
  });
}

export function catalogSummary(catalog) {
  return catalog.dataSources.map((source) => ({
    id: source.id,
    name: source.name,
    type: source.type ?? "browser-http",
    enabled: source.enabled !== false,
    owner: source.owner ?? "",
    tags: source.tags ?? [],
  }));
}
