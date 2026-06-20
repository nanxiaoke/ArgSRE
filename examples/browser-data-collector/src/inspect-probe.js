import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function getArgument(name, fallback) {
  const prefix = `--${name}=`;
  const inline = process.argv.find((value) => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);

  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

async function latestSessionPath() {
  const probesPath = join(ROOT, "runtime", "probes");
  const entries = await readdir(probesPath, { withFileTypes: true });
  const latest = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .at(-1);
  if (!latest) throw new Error("No probe session found.");
  return join(probesPath, latest);
}

function describePaths(value, path = "$", output = [], depth = 0) {
  if (depth > 8) {
    output.push(`${path}: <max-depth>`);
    return output;
  }

  if (Array.isArray(value)) {
    output.push(`${path}: array(${value.length})`);
    if (value.length > 0) describePaths(value[0], `${path}[]`, output, depth + 1);
    return output;
  }
  if (value && typeof value === "object") {
    output.push(`${path}: object`);
    for (const [key, child] of Object.entries(value)) {
      describePaths(child, `${path}.${key}`, output, depth + 1);
    }
    return output;
  }

  const type = value === null ? "null" : typeof value;
  const preview =
    typeof value === "string" ? JSON.stringify(value.slice(0, 80)) : String(value);
  output.push(`${path}: ${type} = ${preview}`);
  return output;
}

const sessionPath = getArgument("session")
  ? resolve(getArgument("session"))
  : await latestSessionPath();
const candidateId = getArgument("candidate");
const summary = JSON.parse(
  await readFile(join(sessionPath, "summary.json"), "utf8"),
);

if (!candidateId) {
  console.log(`Session: ${sessionPath}`);
  console.log(`Actions: ${summary.actionCount}`);
  console.log("Candidates:");
  for (const candidate of summary.candidates) {
    console.log(
      `  ${candidate.id} score=${candidate.score} ${candidate.method} ${candidate.status} ${candidate.url}`,
    );
  }
  console.log(
    "\nInspect one candidate with: npm run inspect -- --candidate candidate-001",
  );
} else {
  const candidate = JSON.parse(
    await readFile(
      join(sessionPath, "candidates", `${candidateId}.json`),
      "utf8",
    ),
  );
  console.log(
    `${candidate.id}: ${candidate.request.method} ${candidate.request.url}`,
  );
  console.log(`Status: ${candidate.response.status}`);
  console.log(`Content-Type: ${candidate.response.contentType}`);
  console.log("\nResponse paths:");
  for (const line of describePaths(candidate.response.sample)) {
    console.log(`  ${line}`);
  }
}
