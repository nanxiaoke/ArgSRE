import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";

const DEFAULT_EDGE_PATH =
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

function getNested(value, path) {
  return path.reduce((current, key) => current?.[key], value);
}

function getPath(value, path) {
  return path.split(".").reduce((current, key) => current?.[key], value);
}

export function extractRecords(payload, extract) {
  const source = getNested(payload, extract.recordPath);
  if (!Array.isArray(source)) {
    throw new Error(
      `recordPath is not an array: ${extract.recordPath.join(".")}`,
    );
  }

  return source.map((record) =>
    Object.fromEntries(
      Object.entries(extract.fields).map(([field, path]) => [
        field,
        getPath(record, path),
      ]),
    ),
  );
}

async function establishSession(page, config, audit, options) {
  await page.goto(config.entryUrl, { waitUntil: "domcontentloaded" });
  audit.auth.entryUrlPath = new URL(page.url()).pathname;

  if (!page.url().includes(config.auth.pageUrlPattern)) {
    audit.auth.state = "valid";
    return;
  }

  const state = await page
    .locator(`[${config.auth.stateAttribute}]`)
    .getAttribute(config.auth.stateAttribute);
  audit.auth.state = state;

  if (state === "quick") {
    await Promise.all([
      page.waitForURL((url) => url.pathname.includes(config.targetUrlPattern)),
      page.locator(config.auth.quickButton).click(),
    ]);
    audit.auth.completedAt = new Date().toISOString();
    return;
  }

  if (state === "fingerprint") {
    await options.onAuthRequired?.({
      type: "fingerprint_required",
      sourceId: config.id,
      sourceName: config.name,
      detectedAt: new Date().toISOString(),
    });

    if (options.simulateFingerprint) {
      await page.locator(config.auth.fingerprintButton).click();
      await page.waitForURL((url) =>
        url.pathname.includes(config.targetUrlPattern),
      );
      audit.auth.completedAt = new Date().toISOString();
      return;
    }
    throw new Error("FINGERPRINT_AUTH_REQUIRED");
  }

  throw new Error(`Unsupported authentication state: ${state}`);
}

async function fetchPayload(context, requestConfig) {
  const method = requestConfig.method?.toUpperCase() ?? "GET";
  const options = {
    headers: requestConfig.headers,
    failOnStatusCode: false,
    method,
  };
  if (requestConfig.body !== undefined) options.data = requestConfig.body;

  const response = await context.request.fetch(requestConfig.url, options);
  const text = await response.text();
  if (!response.ok()) {
    throw new Error(`Data request failed: ${response.status()} ${text}`);
  }
  return {
    status: response.status(),
    payload: JSON.parse(text),
  };
}

export async function runDataSource({
  config,
  runtimeRoot,
  simulateFingerprint = false,
  onAuthRequired,
  edgePath = process.env.EDGE_PATH ?? DEFAULT_EDGE_PATH,
} = {}) {
  if (!config) throw new Error("data source config is required");
  if (!runtimeRoot) throw new Error("runtimeRoot is required");

  const profilePath = join(runtimeRoot, "profiles", config.profileName);
  await mkdir(profilePath, { recursive: true });
  const audit = {
    sourceId: config.id,
    sourceName: config.name,
    startedAt: new Date().toISOString(),
    status: "running",
    auth: {},
    request: {
      method: config.request.method,
      urlPath: new URL(config.request.url).pathname,
    },
  };
  const context = await chromium.launchPersistentContext(profilePath, {
    executablePath: edgePath,
    headless: config.headless ?? true,
    viewport: { width: 1280, height: 900 },
  });

  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await establishSession(page, config, audit, {
      simulateFingerprint,
      onAuthRequired,
    });
    const response = await fetchPayload(context, config.request);
    const records = extractRecords(response.payload, config.extract);
    audit.status = "success";
    audit.request.status = response.status;
    audit.recordCount = records.length;
    audit.completedAt = new Date().toISOString();
    return {
      sourceId: config.id,
      records,
      audit,
    };
  } catch (error) {
    audit.status =
      error.message === "FINGERPRINT_AUTH_REQUIRED"
        ? "authentication_required"
        : "failed";
    audit.completedAt = new Date().toISOString();
    audit.error = { name: error.name, message: error.message };
    error.dataSourceAudit = audit;
    throw error;
  } finally {
    await context.close();
  }
}
