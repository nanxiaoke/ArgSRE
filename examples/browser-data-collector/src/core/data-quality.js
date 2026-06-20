function isMissing(value) {
  return value === undefined || value === null || value === "";
}

function issue(code, rule, details = {}) {
  return { code, rule, ...details };
}

function sampleIndexes(indexes, limit = 5) {
  return indexes.slice(0, limit);
}

export function evaluateDataQuality(
  records,
  quality = {},
  now = new Date(),
) {
  const issues = [];

  if (
    Number.isInteger(quality.minRecords) &&
    records.length < quality.minRecords
  ) {
    issues.push(
      issue("DQ-COUNT-001", "minRecords", {
        expectedMinimum: quality.minRecords,
        actualCount: records.length,
      }),
    );
  }

  for (const field of quality.requiredFields ?? []) {
    const indexes = [];
    records.forEach((record, index) => {
      if (isMissing(record[field])) indexes.push(index);
    });
    if (indexes.length > 0) {
      issues.push(
        issue("DQ-REQUIRED-001", "requiredFields", {
          field,
          affectedCount: indexes.length,
          sampleRecordIndexes: sampleIndexes(indexes),
        }),
      );
    }
  }

  for (const field of quality.uniqueFields ?? []) {
    const firstIndex = new Map();
    const duplicateIndexes = [];
    records.forEach((record, index) => {
      const value = record[field];
      if (isMissing(value)) return;
      const key = `${typeof value}:${String(value)}`;
      if (firstIndex.has(key)) duplicateIndexes.push(index);
      else firstIndex.set(key, index);
    });
    if (duplicateIndexes.length > 0) {
      issues.push(
        issue("DQ-UNIQUE-001", "uniqueFields", {
          field,
          affectedCount: duplicateIndexes.length,
          sampleRecordIndexes: sampleIndexes(duplicateIndexes),
        }),
      );
    }
  }

  if (quality.freshness) {
    const indexes = [];
    const invalidIndexes = [];
    const cutoff =
      now.getTime() - quality.freshness.maxAgeMinutes * 60 * 1000;
    records.forEach((record, index) => {
      const value = record[quality.freshness.field];
      if (isMissing(value)) {
        invalidIndexes.push(index);
        return;
      }
      const timestamp = new Date(value).getTime();
      if (!Number.isFinite(timestamp)) invalidIndexes.push(index);
      else if (timestamp < cutoff) indexes.push(index);
    });
    if (indexes.length > 0) {
      issues.push(
        issue("DQ-FRESHNESS-001", "freshness", {
          field: quality.freshness.field,
          maxAgeMinutes: quality.freshness.maxAgeMinutes,
          affectedCount: indexes.length,
          sampleRecordIndexes: sampleIndexes(indexes),
        }),
      );
    }
    if (invalidIndexes.length > 0) {
      issues.push(
        issue("DQ-FRESHNESS-002", "freshness", {
          field: quality.freshness.field,
          affectedCount: invalidIndexes.length,
          sampleRecordIndexes: sampleIndexes(invalidIndexes),
        }),
      );
    }
  }

  for (const [field, range] of Object.entries(quality.numericRanges ?? {})) {
    const invalidIndexes = [];
    const outOfRangeIndexes = [];
    records.forEach((record, index) => {
      const value = Number(record[field]);
      if (!Number.isFinite(value)) {
        invalidIndexes.push(index);
        return;
      }
      if (
        (range.min !== undefined && value < range.min) ||
        (range.max !== undefined && value > range.max)
      ) {
        outOfRangeIndexes.push(index);
      }
    });
    if (invalidIndexes.length > 0) {
      issues.push(
        issue("DQ-NUMERIC-001", "numericRanges", {
          field,
          affectedCount: invalidIndexes.length,
          sampleRecordIndexes: sampleIndexes(invalidIndexes),
        }),
      );
    }
    if (outOfRangeIndexes.length > 0) {
      issues.push(
        issue("DQ-NUMERIC-002", "numericRanges", {
          field,
          min: range.min,
          max: range.max,
          affectedCount: outOfRangeIndexes.length,
          sampleRecordIndexes: sampleIndexes(outOfRangeIndexes),
        }),
      );
    }
  }

  const mode = quality.mode ?? "warn";
  return {
    status: issues.length === 0 ? "pass" : mode,
    mode,
    checkedAt: now.toISOString(),
    recordCount: records.length,
    issueCount: issues.length,
    issues,
  };
}

export function qualityIssueSummary(sourceName, result) {
  return result.issues.map(
    (item) =>
      `${sourceName}: ${item.code} ${item.field ?? item.rule}` +
      ` affected=${item.affectedCount ?? 1}`,
  );
}
