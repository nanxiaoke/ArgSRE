import { runDataSource } from "./data-source-runner.js";
import { runManualFileSource } from "./manual-file-runner.js";

export async function runConfiguredDataSource(options = {}) {
  const type = options.config?.type ?? "browser-http";
  let result;
  if (type === "browser-http") result = await runDataSource(options);
  else if (type === "manual-file") result = await runManualFileSource(options);
  else throw new Error(`Unsupported data source type: ${type}`);

  result.audit.sourceType = type;
  result.audit.owner = options.config.owner ?? "";
  result.audit.tags = options.config.tags ?? [];
  return result;
}
