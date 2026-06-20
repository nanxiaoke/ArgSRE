import { runDataSource } from "./data-source-runner.js";
import { runManualFileSource } from "./manual-file-runner.js";

export function runConfiguredDataSource(options = {}) {
  const type = options.config?.type ?? "browser-http";
  if (type === "browser-http") return runDataSource(options);
  if (type === "manual-file") return runManualFileSource(options);
  throw new Error(`Unsupported data source type: ${type}`);
}
