import { access, mkdir, writeFile, unlink } from "node:fs/promises";
import { constants } from "node:fs";
import { execFile } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = resolve(ROOT, "..", "..");
const EDGE_PATH =
  process.env.EDGE_PATH ??
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

const checks = [];

async function check(name, action, failureCode) {
  try {
    const detail = await action();
    checks.push({ name, status: "PASS", detail });
  } catch (error) {
    checks.push({
      name,
      status: "FAIL",
      code: failureCode,
      detail: error.message,
    });
  }
}

await check(
  "Node.js version >= 18",
  async () => {
    const major = Number(process.versions.node.split(".")[0]);
    if (major < 18) throw new Error(`found ${process.versions.node}`);
    return process.versions.node;
  },
  "ENV-001",
);

await check(
  "npm available",
  async () => {
    const { stdout } = await execFileAsync(
      "C:\\Windows\\System32\\cmd.exe",
      ["/d", "/s", "/c", "npm --version"],
    );
    return stdout.trim();
  },
  "ENV-002",
);

await check(
  "Microsoft Edge available",
  async () => {
    await access(EDGE_PATH, constants.X_OK);
    return EDGE_PATH;
  },
  "ENV-003",
);

await check(
  "runtime directory writable",
  async () => {
    const runtimePath = join(ROOT, "runtime");
    const markerPath = join(runtimePath, ".doctor-write-test");
    await mkdir(runtimePath, { recursive: true });
    await writeFile(markerPath, "ok", "utf8");
    await unlink(markerPath);
    return runtimePath;
  },
  "ENV-004",
);

await check(
  "runtime directory ignored by Git",
  async () => {
    const { stdout } = await execFileAsync(
      "git",
      ["check-ignore", "-v", "examples/browser-data-collector/runtime"],
      { cwd: REPO_ROOT },
    );
    if (!stdout.includes("runtime")) throw new Error("no ignore rule matched");
    return stdout.trim();
  },
  "ENV-005",
);

await check(
  "Git commit identifiable",
  async () => {
    const { stdout } = await execFileAsync(
      "git",
      ["rev-parse", "HEAD"],
      { cwd: REPO_ROOT },
    );
    return stdout.trim();
  },
  "SYNC-002",
);

for (const item of checks) {
  const suffix = item.code ? ` ${item.code}` : "";
  console.log(`[${item.status}]${suffix} ${item.name}: ${item.detail}`);
}

const failed = checks.filter((item) => item.status === "FAIL").length;
console.log(`\nSummary: total=${checks.length} failed=${failed}`);
process.exitCode = failed === 0 ? 0 : 1;
