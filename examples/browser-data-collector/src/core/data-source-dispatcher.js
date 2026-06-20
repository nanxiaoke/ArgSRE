import { runDataSource } from "./data-source-runner.js";
import { runManualFileSource } from "./manual-file-runner.js";
import {
  evaluateDataQuality,
  qualityIssueSummary,
} from "./data-quality.js";

export async function runConfiguredDataSource(options = {}) {
  const type = options.config?.type ?? "browser-http";
  let result;
  if (type === "browser-http") result = await runDataSource(options);
  else if (type === "manual-file") result = await runManualFileSource(options);
  else throw new Error(`Unsupported data source type: ${type}`);

  result.audit.sourceType = type;
  result.audit.owner = options.config.owner ?? "";
  result.audit.tags = options.config.tags ?? [];
  if (options.config.quality) {
    result.quality = evaluateDataQuality(
      result.records,
      options.config.quality,
    );
    result.audit.quality = result.quality;
    if (result.quality.status === "fail") {
      const error = new Error("DATA_QUALITY_FAILED");
      error.name = "DataQualityError";
      error.quality = result.quality;
      error.qualityWarnings = qualityIssueSummary(
        options.config.name,
        result.quality,
      );
      result.audit.status = "quality_failed";
      result.audit.error = {
        name: error.name,
        message: error.message,
      };
      error.dataSourceAudit = result.audit;
      throw error;
    }
    result.qualityWarnings = qualityIssueSummary(
      options.config.name,
      result.quality,
    );
  }
  return result;
}
