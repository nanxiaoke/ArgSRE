import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG_PATH = join(ROOT, "config", "data-source.json");
const DEFAULT_EDGE_PATH =
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

function getArgument(name, fallback) {
  const prefix = `--${name}=`;
  const inline = process.argv.find((value) => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);

  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

function getPath(value, path) {
  return path.split(".").reduce((current, key) => current?.[key], value);
}

function getNested(value, path) {
  return path.reduce((current, key) => current?.[key], value);
}

function extractRecords(payload, extract) {
  const records = getNested(payload, extract.recordPath);
  if (!Array.isArray(records)) {
    throw new Error(
      `Configured record path did not resolve to an array: ${extract.recordPath.join(".")}`,
    );
  }

  return records.map((record) =>
    Object.fromEntries(
      Object.entries(extract.fields).map(([name, path]) => [
        name,
        getPath(record, path),
      ]),
    ),
  );
}

function createAudit(mode) {
  return {
    mode,
    startedAt: new Date().toISOString(),
    status: "running",
    authEvents: [],
    operations: [],
    requests: [],
  };
}

async function notifyFingerprint({ sourceName, url }) {
  const message = {
    channel: "mock-im",
    type: "fingerprint_required",
    sourceName,
    url,
    message: "数据源认证已长期超时，请在本机浏览器完成指纹认证。",
    createdAt: new Date().toISOString(),
  };
  console.log(`[IM MOCK] ${message.message}`);
  return message;
}

async function handleAuthentication(page, config, audit, options) {
  if (!page.url().includes(config.auth.pageUrlPattern)) return;

  const state = await page
    .locator(`[${config.auth.stateAttribute}]`)
    .getAttribute(config.auth.stateAttribute);

  audit.authEvents.push({
    state,
    url: page.url(),
    detectedAt: new Date().toISOString(),
  });

  if (state === "quick") {
    await Promise.all([
      page.waitForURL((url) => url.pathname.includes(config.targetUrlPattern)),
      page.locator(config.auth.quickButton).click(),
    ]);
    audit.authEvents.push({
      state: "quick_completed",
      completedAt: new Date().toISOString(),
    });
    return;
  }

  if (state === "fingerprint") {
    audit.imNotification = await notifyFingerprint({
      sourceName: config.name,
      url: page.url(),
    });

    if (options.simulateFingerprint) {
      await page.locator(config.auth.fingerprintButton).click();
    }

    await page.waitForURL(
      (url) => url.pathname.includes(config.targetUrlPattern),
      { timeout: config.auth.timeoutMs },
    );
    audit.authEvents.push({
      state: "fingerprint_completed",
      completedAt: new Date().toISOString(),
    });
    return;
  }

  throw new Error(`Unsupported authentication state: ${state}`);
}

async function executeFlow(page, config, audit) {
  let capturedPayload;

  for (const step of config.flow) {
    const startedAt = new Date().toISOString();

    if (step.type === "click") {
      await page.locator(step.selector).click();
    } else if (step.type === "select") {
      await page.locator(step.selector).selectOption(step.value);
    } else if (step.type === "clickAndWaitForResponse") {
      const [response] = await Promise.all([
        page.waitForResponse((candidate) =>
          candidate.url().includes(step.responseUrlPattern),
        ),
        page.locator(step.selector).click(),
      ]);

      capturedPayload = await response.json();
      audit.requests.push({
        method: response.request().method(),
        url: response.url(),
        requestBody: response.request().postDataJSON(),
        status: response.status(),
        capturedAt: new Date().toISOString(),
      });
    } else {
      throw new Error(`Unsupported flow step: ${step.type}`);
    }

    audit.operations.push({
      name: step.name,
      type: step.type,
      selector: step.selector,
      status: "success",
      startedAt,
      completedAt: new Date().toISOString(),
    });
  }

  if (!capturedPayload) {
    throw new Error("The configured flow did not capture a response payload.");
  }
  return capturedPayload;
}

export async function collectData({
  baseUrl,
  mode = "valid",
  simulateFingerprint = false,
  headless = true,
  edgePath = process.env.EDGE_PATH ?? DEFAULT_EDGE_PATH,
} = {}) {
  if (!baseUrl) throw new Error("baseUrl is required");

  const config = JSON.parse(await readFile(CONFIG_PATH, "utf8"));
  const runtimeRoot = join(ROOT, "runtime");
  const profilePath = join(runtimeRoot, "profiles");
  const resultPath = join(runtimeRoot, "results", `${mode}-latest.json`);
  await mkdir(profilePath, { recursive: true });
  await mkdir(dirname(resultPath), { recursive: true });

  const audit = createAudit(mode);
  const context = await chromium.launchPersistentContext(profilePath, {
    executablePath: edgePath,
    headless,
    viewport: { width: 1280, height: 900 },
  });

  try {
    const page = context.pages()[0] ?? (await context.newPage());
    const scenarioUrl = `${baseUrl}${config.entryPath}?mode=${mode}`;
    await page.goto(scenarioUrl, { waitUntil: "domcontentloaded" });
    await handleAuthentication(page, config, audit, {
      simulateFingerprint,
    });
    await page.waitForURL((url) =>
      url.pathname.includes(config.targetUrlPattern),
    );

    const payload = await executeFlow(page, config, audit);
    const records = extractRecords(payload, config.extract);

    audit.status = "success";
    audit.completedAt = new Date().toISOString();
    audit.result = {
      sourceId: config.id,
      primaryKey: config.extract.primaryKey,
      records,
    };
    await writeFile(resultPath, `${JSON.stringify(audit, null, 2)}\n`, "utf8");
    return { resultPath, audit };
  } catch (error) {
    audit.status = "failed";
    audit.completedAt = new Date().toISOString();
    audit.error = {
      name: error.name,
      message: error.message,
    };
    await writeFile(resultPath, `${JSON.stringify(audit, null, 2)}\n`, "utf8");
    throw error;
  } finally {
    await context.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const mode = getArgument("mode", "valid");
  const baseUrl = getArgument("base-url", "http://127.0.0.1:4310");
  const simulateFingerprint =
    getArgument("simulate-fingerprint", "false") === "true";
  const headless = getArgument("headless", "true") !== "false";

  const { resultPath, audit } = await collectData({
    baseUrl,
    mode,
    simulateFingerprint,
    headless,
  });
  console.log(`Collection completed: ${audit.result.records.length} records`);
  console.log(`Audit written to: ${resultPath}`);
}
