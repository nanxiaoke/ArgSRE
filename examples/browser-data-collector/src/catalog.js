import { fileURLToPath } from "node:url";
import {
  catalogSummary,
  loadDataSourceCatalog,
} from "./core/data-source-catalog.js";

function getArgument(name, fallback) {
  const prefix = `--${name}=`;
  const inline = process.argv.find((value) => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

export async function runCatalogCommand({
  action,
  path,
  tag,
  status = "all",
}) {
  if (!path) throw new Error("--catalog is required");
  const loaded = await loadDataSourceCatalog(path);
  if (action === "validate") {
    return { action, path: loaded.path, count: loaded.catalog.dataSources.length };
  }
  if (action === "list") {
    let sources = catalogSummary(loaded.catalog);
    if (tag) sources = sources.filter((source) => source.tags.includes(tag));
    if (status === "enabled") {
      sources = sources.filter((source) => source.enabled);
    } else if (status === "disabled") {
      sources = sources.filter((source) => !source.enabled);
    } else if (status !== "all") {
      throw new Error("--status must be all, enabled, or disabled");
    }
    return { action, path: loaded.path, sources };
  }
  throw new Error(`Unsupported catalog action: ${action}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const action = getArgument("action", "list");
  const format = getArgument("format", "table");
  const result = await runCatalogCommand({
    action,
    path: getArgument("catalog"),
    tag: getArgument("tag"),
    status: getArgument("status", "all"),
  });
  if (action === "validate") {
    console.log(`PASS: ${result.path} (${result.count} data sources)`);
  } else {
    if (format === "json") {
      console.log(JSON.stringify(result.sources, null, 2));
    } else if (format === "table") {
      console.table(result.sources);
    } else {
      throw new Error("--format must be table or json");
    }
  }
}
