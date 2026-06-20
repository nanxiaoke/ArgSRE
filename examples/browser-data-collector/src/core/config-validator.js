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

function validateQuality(errors, quality, source, path) {
  if (quality === undefined) return;
  if (!requireObject(errors, quality, path)) return;
  if (!["warn", "fail"].includes(quality.mode ?? "warn")) {
    add(errors, "CFG-QUALITY-001", `${path}.mode`, "must be warn or fail");
  }
  if (
    quality.minRecords !== undefined &&
    (!Number.isInteger(quality.minRecords) || quality.minRecords < 0)
  ) {
    add(
      errors,
      "CFG-QUALITY-002",
      `${path}.minRecords`,
      "must be an integer >= 0",
    );
  }

  const outputFields = new Set(Object.keys(source.extract?.fields ?? {}));
  for (const key of ["requiredFields", "uniqueFields"]) {
    if (quality[key] === undefined) continue;
    if (
      !Array.isArray(quality[key]) ||
      quality[key].length === 0 ||
      quality[key].some(
        (field) => typeof field !== "string" || field.trim() === "",
      )
    ) {
      add(
        errors,
        "CFG-QUALITY-003",
        `${path}.${key}`,
        "must be a non-empty string array",
      );
      continue;
    }
    for (const field of quality[key]) {
      if (!outputFields.has(field)) {
        add(
          errors,
          "CFG-QUALITY-004",
          `${path}.${key}`,
          `references unknown output field: ${field}`,
        );
      }
    }
  }

  if (quality.freshness !== undefined) {
    if (requireObject(errors, quality.freshness, `${path}.freshness`)) {
      requireString(
        errors,
        quality.freshness.field,
        `${path}.freshness.field`,
      );
      if (
        typeof quality.freshness.field === "string" &&
        !outputFields.has(quality.freshness.field)
      ) {
        add(
          errors,
          "CFG-QUALITY-004",
          `${path}.freshness.field`,
          `references unknown output field: ${quality.freshness.field}`,
        );
      }
      if (
        !Number.isFinite(quality.freshness.maxAgeMinutes) ||
        quality.freshness.maxAgeMinutes <= 0
      ) {
        add(
          errors,
          "CFG-QUALITY-005",
          `${path}.freshness.maxAgeMinutes`,
          "must be a positive number",
        );
      }
    }
  }

  if (quality.numericRanges !== undefined) {
    if (
      requireObject(errors, quality.numericRanges, `${path}.numericRanges`)
    ) {
      for (const [field, range] of Object.entries(quality.numericRanges)) {
        if (!outputFields.has(field)) {
          add(
            errors,
            "CFG-QUALITY-004",
            `${path}.numericRanges.${field}`,
            `references unknown output field: ${field}`,
          );
        }
        if (
          requireObject(
            errors,
            range,
            `${path}.numericRanges.${field}`,
          )
        ) {
          if (
            range.min === undefined &&
            range.max === undefined
          ) {
            add(
              errors,
              "CFG-QUALITY-006",
              `${path}.numericRanges.${field}`,
              "must configure min or max",
            );
          }
          for (const boundary of ["min", "max"]) {
            if (
              range[boundary] !== undefined &&
              !Number.isFinite(range[boundary])
            ) {
              add(
                errors,
                "CFG-QUALITY-006",
                `${path}.numericRanges.${field}.${boundary}`,
                "must be a finite number",
              );
            }
          }
          if (
            Number.isFinite(range.min) &&
            Number.isFinite(range.max) &&
            range.min > range.max
          ) {
            add(
              errors,
              "CFG-QUALITY-007",
              `${path}.numericRanges.${field}`,
              "min must be less than or equal to max",
            );
          }
        }
      }
    }
  }
}

function validateDataSource(errors, source, path) {
  if (!requireObject(errors, source, path)) return;
  for (const key of ["id", "name"]) {
    requireString(errors, source[key], `${path}.${key}`);
  }
  const type = source.type ?? "browser-http";
  if (!["browser-http", "manual-file"].includes(type)) {
    add(
      errors,
      "CFG-SOURCE-004",
      `${path}.type`,
      "must be browser-http or manual-file",
    );
    return;
  }

  if (type === "browser-http") {
    for (const key of ["profileName", "targetUrlPattern"]) {
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
  } else if (requireObject(errors, source.file, `${path}.file`)) {
    requireString(errors, source.file.path, `${path}.file.path`);
    if (!["json", "csv"].includes(source.file.format)) {
      add(
        errors,
        "CFG-FILE-001",
        `${path}.file.format`,
        "must be json or csv",
      );
    }
    if (
      source.file.encoding !== undefined &&
      source.file.encoding !== "utf8"
    ) {
      add(
        errors,
        "CFG-FILE-002",
        `${path}.file.encoding`,
        "currently only utf8 is supported",
      );
    }
    if (
      source.file.maxAgeHours !== undefined &&
      (!Number.isFinite(source.file.maxAgeHours) ||
        source.file.maxAgeHours <= 0)
    ) {
      add(
        errors,
        "CFG-FILE-003",
        `${path}.file.maxAgeHours`,
        "must be a positive number",
      );
    }
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
  validateQuality(errors, source.quality, source, `${path}.quality`);
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
