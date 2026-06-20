const HTTP_METHODS = new Set([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
]);

function add(errors, code, path, message) {
  errors.push({ code, path, message });
}

function requireString(errors, value, path) {
  if (typeof value !== "string" || value.trim() === "") {
    add(errors, "CFG-REQUIRED-001", path, "must be a non-empty string");
  }
}

function requireObject(errors, value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    add(errors, "CFG-REQUIRED-002", path, "must be an object");
    return false;
  }
  return true;
}

function requireUrl(errors, value, path) {
  requireString(errors, value, path);
  if (typeof value !== "string" || value.trim() === "") return;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) {
      add(errors, "CFG-URL-001", path, "must use http or https");
    }
  } catch {
    add(errors, "CFG-URL-001", path, "must be an absolute URL");
  }
}

function validateRetry(errors, value, path) {
  if (value === undefined) return;
  if (!requireObject(errors, value, path)) return;

  for (const [key, min] of [
    ["maxAttempts", 1],
    ["baseDelayMs", 0],
    ["maxDelayMs", 0],
    ["timeoutMs", 1],
  ]) {
    if (
      value[key] !== undefined &&
      (!Number.isFinite(value[key]) || value[key] < min)
    ) {
      add(
        errors,
        "CFG-RETRY-001",
        `${path}.${key}`,
        `must be a number >= ${min}`,
      );
    }
  }
}

function validateDataSource(errors, source, path) {
  if (!requireObject(errors, source, path)) return;
  for (const key of ["id", "name", "profileName", "targetUrlPattern"]) {
    requireString(errors, source[key], `${path}.${key}`);
  }
  requireUrl(errors, source.entryUrl, `${path}.entryUrl`);

  if (requireObject(errors, source.auth, `${path}.auth`)) {
    for (const key of [
      "pageUrlPattern",
      "stateAttribute",
      "quickButton",
      "fingerprintButton",
    ]) {
      requireString(errors, source.auth[key], `${path}.auth.${key}`);
    }
    if (!Number.isFinite(source.auth.timeoutMs) || source.auth.timeoutMs <= 0) {
      add(
        errors,
        "CFG-AUTH-001",
        `${path}.auth.timeoutMs`,
        "must be a positive number",
      );
    }
  }

  if (requireObject(errors, source.request, `${path}.request`)) {
    const method = source.request.method?.toUpperCase();
    if (!HTTP_METHODS.has(method)) {
      add(
        errors,
        "CFG-HTTP-001",
        `${path}.request.method`,
        `must be one of ${[...HTTP_METHODS].join(", ")}`,
      );
    }
    requireUrl(errors, source.request.url, `${path}.request.url`);
  }

  if (requireObject(errors, source.extract, `${path}.extract`)) {
    if (
      !Array.isArray(source.extract.recordPath) ||
      source.extract.recordPath.length === 0 ||
      source.extract.recordPath.some(
        (part) => typeof part !== "string" || part === "",
      )
    ) {
      add(
        errors,
        "CFG-EXTRACT-001",
        `${path}.extract.recordPath`,
        "must be a non-empty string array",
      );
    }
    if (requireObject(errors, source.extract.fields, `${path}.extract.fields`)) {
      if (Object.keys(source.extract.fields).length === 0) {
        add(
          errors,
          "CFG-EXTRACT-002",
          `${path}.extract.fields`,
          "must contain at least one field",
        );
      }
      for (const [field, fieldPath] of Object.entries(source.extract.fields)) {
        requireString(
          errors,
          fieldPath,
          `${path}.extract.fields.${field}`,
        );
      }
    }
    requireString(
      errors,
      source.extract.primaryKey,
      `${path}.extract.primaryKey`,
    );
    if (
      typeof source.extract.primaryKey === "string" &&
      source.extract.fields &&
      !(source.extract.primaryKey in source.extract.fields)
    ) {
      add(
        errors,
        "CFG-EXTRACT-003",
        `${path}.extract.primaryKey`,
        "must reference a configured output field",
      );
    }
  }
}

export function validateWorkflowConfig(config) {
  const errors = [];
  if (!requireObject(errors, config, "$")) return errors;

  requireString(errors, config.name, "name");

  const hasSingleSource = config.dataSource !== undefined;
  const hasMultipleSources = config.dataSources !== undefined;
  if (hasSingleSource === hasMultipleSources) {
    add(
      errors,
      "CFG-SOURCE-001",
      "dataSource",
      "configure exactly one of dataSource or dataSources",
    );
  } else if (hasSingleSource) {
    validateDataSource(errors, config.dataSource, "dataSource");
  } else if (
    !Array.isArray(config.dataSources) ||
    config.dataSources.length === 0
  ) {
    add(
      errors,
      "CFG-SOURCE-002",
      "dataSources",
      "must be a non-empty array",
    );
  } else {
    const sourceIds = new Set();
    config.dataSources.forEach((source, index) => {
      validateDataSource(errors, source, `dataSources[${index}]`);
      if (typeof source?.id === "string") {
        if (sourceIds.has(source.id)) {
          add(
            errors,
            "CFG-SOURCE-003",
            `dataSources[${index}].id`,
            "must be unique",
          );
        }
        sourceIds.add(source.id);
      }
    });
  }

  if (requireObject(errors, config.businessReport, "businessReport")) {
    requireString(errors, config.businessReport.title, "businessReport.title");
    if (
      requireObject(errors, config.businessReport.chart, "businessReport.chart")
    ) {
      for (const key of ["categoryField", "valueField", "title"]) {
        requireString(
          errors,
          config.businessReport.chart[key],
          `businessReport.chart.${key}`,
        );
      }
    }
  }

  if (requireObject(errors, config.messageChannel, "messageChannel")) {
    const type = config.messageChannel.type;
    if (!["webhook-json", "local-file"].includes(type)) {
      add(
        errors,
        "CFG-MESSAGE-001",
        "messageChannel.type",
        "must be webhook-json or local-file",
      );
    }
    if (type === "webhook-json") {
      requireUrl(errors, config.messageChannel.endpoint, "messageChannel.endpoint");
    }
  }

  if (requireObject(errors, config.schedule, "schedule")) {
    if (
      typeof config.schedule.time !== "string" ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(config.schedule.time)
    ) {
      add(
        errors,
        "CFG-SCHEDULE-001",
        "schedule.time",
        "must use HH:mm in local time",
      );
    }
  }

  if (config.reliability !== undefined) {
    if (requireObject(errors, config.reliability, "reliability")) {
      validateRetry(
        errors,
        config.reliability.dataRequest,
        "reliability.dataRequest",
      );
      validateRetry(
        errors,
        config.reliability.messageSend,
        "reliability.messageSend",
      );
      if (
        config.reliability.idempotencyHours !== undefined &&
        (!Number.isFinite(config.reliability.idempotencyHours) ||
          config.reliability.idempotencyHours <= 0)
      ) {
        add(
          errors,
          "CFG-IDEMPOTENCY-001",
          "reliability.idempotencyHours",
          "must be a positive number",
        );
      }
      if (
        config.reliability.failureNotificationThreshold !== undefined &&
        (!Number.isInteger(
          config.reliability.failureNotificationThreshold,
        ) ||
          config.reliability.failureNotificationThreshold < 1)
      ) {
        add(
          errors,
          "CFG-FAILURE-001",
          "reliability.failureNotificationThreshold",
          "must be an integer >= 1",
        );
      }
    }
  }

  if (config.history !== undefined) {
    if (requireObject(errors, config.history, "history")) {
      for (const [key, min] of [
        ["trendDays", 1],
        ["retentionDays", 1],
      ]) {
        if (
          config.history[key] !== undefined &&
          (!Number.isInteger(config.history[key]) ||
            config.history[key] < min)
        ) {
          add(
            errors,
            "CFG-HISTORY-001",
            `history.${key}`,
            `must be an integer >= ${min}`,
          );
        }
      }
      if (
        Number.isInteger(config.history.trendDays) &&
        Number.isInteger(config.history.retentionDays) &&
        config.history.retentionDays < config.history.trendDays
      ) {
        add(
          errors,
          "CFG-HISTORY-002",
          "history.retentionDays",
          "must be greater than or equal to trendDays",
        );
      }
      if (config.history.trendChart !== undefined) {
        if (
          requireObject(
            errors,
            config.history.trendChart,
            "history.trendChart",
          )
        ) {
          requireString(
            errors,
            config.history.trendChart.title,
            "history.trendChart.title",
          );
          if (
            !["serviceCount", "totalInstances", "totalAlarms"].includes(
              config.history.trendChart.valueField,
            )
          ) {
            add(
              errors,
              "CFG-HISTORY-003",
              "history.trendChart.valueField",
              "must be serviceCount, totalInstances, or totalAlarms",
            );
          }
        }
      }
    }
  }

  return errors;
}

export function assertValidWorkflowConfig(config) {
  const errors = validateWorkflowConfig(config);
  if (errors.length === 0) return config;

  const message = errors
    .map((error) => `${error.code} ${error.path}: ${error.message}`)
    .join("\n");
  const validationError = new Error(`Workflow config validation failed:\n${message}`);
  validationError.name = "ConfigValidationError";
  validationError.validationErrors = errors;
  throw validationError;
}
