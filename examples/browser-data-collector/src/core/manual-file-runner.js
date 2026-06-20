import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { extractRecords } from "./data-source-runner.js";

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (character !== "\r") {
      field += character;
    }
  }

  if (quoted) throw new Error("CSV_UNCLOSED_QUOTE");
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  if (rows.length === 0) return [];

  const headers = rows[0].map((header) => header.trim());
  if (headers.some((header) => header === "")) {
    throw new Error("CSV_EMPTY_HEADER");
  }
  if (new Set(headers).size !== headers.length) {
    throw new Error("CSV_DUPLICATE_HEADER");
  }

  return rows
    .slice(1)
    .filter((values) => values.some((value) => value !== ""))
    .map((values, rowIndex) => {
      if (values.length !== headers.length) {
        throw new Error(`CSV_COLUMN_COUNT_MISMATCH_AT_ROW_${rowIndex + 2}`);
      }
      return Object.fromEntries(
        headers.map((header, index) => [header, values[index]]),
      );
    });
}

function parsePayload(text, format) {
  if (format === "json") return JSON.parse(text);
  if (format === "csv") return { records: parseCsv(text) };
  throw new Error(`UNSUPPORTED_MANUAL_FILE_FORMAT:${format}`);
}

function classifyError(error) {
  if (error.message === "MANUAL_FILE_STALE") {
    error.name = "ManualFileStaleError";
  } else if (
    error instanceof SyntaxError ||
    error.message.startsWith("CSV_")
  ) {
    error.name = "ManualFileParseError";
  }
  return error;
}

export async function runManualFileSource({ config } = {}) {
  if (!config) throw new Error("data source config is required");

  const path = resolve(config.file.path);
  const audit = {
    sourceId: config.id,
    sourceName: config.name,
    sourceType: "manual-file",
    startedAt: new Date().toISOString(),
    status: "running",
    file: {
      name: basename(path),
      format: config.file.format,
    },
  };

  try {
    const [content, metadata] = await Promise.all([
      readFile(path, config.file.encoding ?? "utf8"),
      stat(path),
    ]);
    const ageHours = (Date.now() - metadata.mtimeMs) / (60 * 60 * 1000);
    if (
      Number.isFinite(config.file.maxAgeHours) &&
      ageHours > config.file.maxAgeHours
    ) {
      const error = new Error("MANUAL_FILE_STALE");
      error.ageHours = ageHours;
      throw error;
    }

    const payload = parsePayload(content, config.file.format);
    const records = extractRecords(payload, config.extract);
    audit.status = "success";
    audit.recordCount = records.length;
    audit.file.sizeBytes = metadata.size;
    audit.file.modifiedAt = metadata.mtime.toISOString();
    audit.file.ageHours = Number(ageHours.toFixed(3));
    audit.file.sha256 = createHash("sha256").update(content).digest("hex");
    audit.completedAt = new Date().toISOString();
    return {
      sourceId: config.id,
      records,
      audit,
    };
  } catch (error) {
    classifyError(error);
    audit.status = "failed";
    audit.completedAt = new Date().toISOString();
    audit.error = { name: error.name, message: error.message };
    if (Number.isFinite(error.ageHours)) {
      audit.file.ageHours = Number(error.ageHours.toFixed(3));
    }
    error.dataSourceAudit = audit;
    throw error;
  }
}
