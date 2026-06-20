import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { assertValidWorkflowConfig } from "./core/config-validator.js";

function getArgument(name, fallback) {
  const prefix = `--${name}=`;
  const inline = process.argv.find((value) => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

const configPath = getArgument("config");
if (!configPath) throw new Error("--config is required");
const config = JSON.parse(await readFile(resolve(configPath), "utf8"));
assertValidWorkflowConfig(config);
console.log(`PASS: ${resolve(configPath)}`);
