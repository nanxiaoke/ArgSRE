import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_EDGE_PATH =
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const SENSITIVE_KEY_PATTERN =
  /authorization|cookie|token|secret|password|passwd|session|credential|api[-_]?key/i;
const SAFE_REQUEST_HEADERS = new Set([
  "accept",
  "content-type",
  "x-requested-with",
]);

function getArgument(name, fallback) {
  const prefix = `--${name}=`;
  const inline = process.argv.find((value) => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);

  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

function toBoolean(value, fallback = false) {
  if (value === undefined) return fallback;
  return value === true || value === "true";
}

function sanitizeValue(value, key = "") {
  if (SENSITIVE_KEY_PATTERN.test(key)) return "<redacted>";
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, childValue]) => [
        childKey,
        sanitizeValue(childValue, childKey),
      ]),
    );
  }
  return value;
}

function sanitizeUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    for (const key of url.searchParams.keys()) {
      url.searchParams.set(key, "<redacted>");
    }
    return url.toString();
  } catch {
    return rawUrl;
  }
}

function sanitizeHeaders(headers) {
  return Object.fromEntries(
    Object.entries(headers)
      .filter(([name]) => SAFE_REQUEST_HEADERS.has(name.toLowerCase()))
      .map(([name, value]) => [name, value]),
  );
}

function parseAndSanitizeBody(text, contentType = "") {
  if (!text) return undefined;
  if (contentType.includes("json")) {
    try {
      return sanitizeValue(JSON.parse(text));
    } catch {
      return "<invalid-json>";
    }
  }
  if (contentType.includes("application/x-www-form-urlencoded")) {
    const params = new URLSearchParams(text);
    return Object.fromEntries(
      [...params.entries()].map(([key, value]) => [
        key,
        SENSITIVE_KEY_PATTERN.test(key) ? "<redacted>" : value,
      ]),
    );
  }
  return `<${text.length} characters omitted>`;
}

function matchesPatterns(url, patterns) {
  return patterns.some((pattern) => url.includes(pattern));
}

function shouldCapture(response, capture) {
  const request = response.request();
  const url = response.url();
  const resourceType = request.resourceType();
  const contentType = response.headers()["content-type"] ?? "";

  if (
    capture.excludeUrlPatterns?.length &&
    matchesPatterns(url, capture.excludeUrlPatterns)
  ) {
    return false;
  }
  if (
    capture.includeUrlPatterns?.length &&
    !matchesPatterns(url, capture.includeUrlPatterns)
  ) {
    return false;
  }

  return (
    resourceType === "xhr" ||
    resourceType === "fetch" ||
    contentType.includes("json")
  );
}

function candidateScore(candidate) {
  let score = 0;
  if (candidate.response.contentType.includes("json")) score += 4;
  if (candidate.request.resourceType === "xhr") score += 3;
  if (candidate.request.resourceType === "fetch") score += 3;
  if (candidate.response.sampleType === "json") score += 3;
  if (candidate.request.method !== "GET") score += 1;
  if (candidate.response.status >= 200 && candidate.response.status < 300) {
    score += 1;
  }
  return score;
}

async function installActionRecorder(context, actions) {
  await context.exposeBinding("__argsreRecordAction", (_source, action) => {
    actions.push({
      ...sanitizeValue(action),
      url: sanitizeUrl(action.url ?? ""),
      recordedAt: new Date().toISOString(),
    });
  });

  await context.addInitScript(() => {
    function selectorFor(element) {
      if (!(element instanceof Element)) return "";
      const testId = element.getAttribute("data-testid");
      if (testId) return `[data-testid="${testId}"]`;
      if (element.id) return `#${CSS.escape(element.id)}`;
      if (element.getAttribute("name")) {
        return `${element.tagName.toLowerCase()}[name="${CSS.escape(element.getAttribute("name"))}"]`;
      }

      const parts = [];
      let current = element;
      while (current && current.nodeType === Node.ELEMENT_NODE && parts.length < 4) {
        let part = current.tagName.toLowerCase();
        const siblings = current.parentElement
          ? [...current.parentElement.children].filter(
              (item) => item.tagName === current.tagName,
            )
          : [];
        if (siblings.length > 1) {
          part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
        }
        parts.unshift(part);
        current = current.parentElement;
      }
      return parts.join(" > ");
    }

    function describe(element) {
      return {
        selector: selectorFor(element),
        tag: element?.tagName?.toLowerCase() ?? "",
        text: (element?.innerText ?? element?.textContent ?? "")
          .trim()
          .replace(/\s+/g, " ")
          .slice(0, 120),
      };
    }

    document.addEventListener(
      "click",
      (event) => {
        window.__argsreRecordAction({
          type: "click",
          url: location.href,
          target: describe(event.target),
        });
      },
      true,
    );

    document.addEventListener(
      "change",
      (event) => {
        const element = event.target;
        const sensitive =
          element instanceof HTMLInputElement &&
          ["password", "file"].includes(element.type);
        window.__argsreRecordAction({
          type: "change",
          url: location.href,
          target: describe(element),
          value: sensitive ? "<redacted>" : element?.value,
        });
      },
      true,
    );

    document.addEventListener(
      "submit",
      (event) => {
        window.__argsreRecordAction({
          type: "submit",
          url: location.href,
          target: describe(event.target),
        });
      },
      true,
    );
  });
}

async function captureCandidate(response, config, sequence) {
  const request = response.request();
  const responseHeaders = response.headers();
  const contentType = responseHeaders["content-type"] ?? "";
  const maxBytes = config.capture.maxResponseBytes ?? 1048576;
  let sample;
  let sampleType = "none";
  let sampleError;

  try {
    const body = await response.body();
    if (body.length > maxBytes) {
      sampleType = "too-large";
      sample = {
        byteLength: body.length,
        maxResponseBytes: maxBytes,
      };
    } else if (contentType.includes("json")) {
      sampleType = "json";
      sample = sanitizeValue(JSON.parse(body.toString("utf8")));
    } else if (contentType.startsWith("text/")) {
      sampleType = "text";
      sample = body.toString("utf8").slice(0, 4000);
    }
  } catch (error) {
    sampleError = error.message;
  }

  const requestBody = parseAndSanitizeBody(
    request.postData(),
    request.headers()["content-type"] ?? "",
  );
  const id = `candidate-${String(sequence).padStart(3, "0")}`;
  const candidate = {
    id,
    capturedAt: new Date().toISOString(),
    pageUrl: sanitizeUrl(request.frame()?.url() ?? ""),
    request: {
      method: request.method(),
      url: sanitizeUrl(request.url()),
      resourceType: request.resourceType(),
      headers: sanitizeHeaders(request.headers()),
      body: requestBody,
    },
    response: {
      status: response.status(),
      contentType,
      headers: sanitizeHeaders(responseHeaders),
      sampleType,
      sample,
      sampleError,
    },
  };
  candidate.score = candidateScore(candidate);
  return candidate;
}

async function loadProbeConfig(configPath) {
  if (!configPath) return {};
  return JSON.parse(await readFile(resolve(configPath), "utf8"));
}

async function waitForOperator(durationSeconds) {
  if (durationSeconds > 0) {
    await new Promise((resolveWait) =>
      setTimeout(resolveWait, durationSeconds * 1000),
    );
    return;
  }

  if (!input.isTTY) {
    throw new Error(
      "Interactive probe requires a terminal. Set durationSeconds or pass --duration.",
    );
  }
  const readline = createInterface({ input, output });
  await readline.question(
    "\n请在浏览器中完成认证和页面操作。完成后回到终端按 Enter 停止探测。\n",
  );
  readline.close();
}

export async function probePage({
  entryUrl,
  name = "data-source-probe",
  profileName = "probe",
  durationSeconds = 0,
  headless = false,
  edgePath = process.env.EDGE_PATH ?? DEFAULT_EDGE_PATH,
  capture = {},
  onPageReady,
} = {}) {
  if (!entryUrl) throw new Error("entryUrl is required");

  const runtimeRoot = join(ROOT, "runtime");
  const profilePath = join(runtimeRoot, "profiles", profileName);
  const sessionId = new Date().toISOString().replace(/[:.]/g, "-");
  const startedAt = new Date().toISOString();
  const sessionPath = join(runtimeRoot, "probes", sessionId);
  const candidatesPath = join(sessionPath, "candidates");
  await mkdir(profilePath, { recursive: true });
  await mkdir(candidatesPath, { recursive: true });

  const config = {
    name,
    entryUrl,
    profileName,
    durationSeconds,
    capture: {
      includeUrlPatterns: capture.includeUrlPatterns ?? [],
      excludeUrlPatterns: capture.excludeUrlPatterns ?? [],
      maxResponseBytes: capture.maxResponseBytes ?? 1048576,
    },
  };
  const actions = [];
  const candidates = [];
  const pendingCaptures = new Set();
  const context = await chromium.launchPersistentContext(profilePath, {
    executablePath: edgePath,
    headless,
    viewport: { width: 1365, height: 900 },
  });

  try {
    await installActionRecorder(context, actions);
    const page = context.pages()[0] ?? (await context.newPage());

    context.on("response", (response) => {
      if (!shouldCapture(response, config.capture)) return;
      const task = captureCandidate(
        response,
        config,
        candidates.length + pendingCaptures.size + 1,
      )
        .then(async (candidate) => {
          candidates.push(candidate);
          await writeFile(
            join(candidatesPath, `${candidate.id}.json`),
            `${JSON.stringify(candidate, null, 2)}\n`,
            "utf8",
          );
          console.log(
            `[candidate] ${candidate.id} ${candidate.request.method} ${candidate.request.url}`,
          );
        })
        .catch((error) => {
          console.warn(`[candidate] capture failed: ${error.message}`);
        })
        .finally(() => pendingCaptures.delete(task));
      pendingCaptures.add(task);
    });

    await page.goto(entryUrl, { waitUntil: "domcontentloaded" });
    console.log(`Probe opened: ${page.url()}`);
    console.log(`Local output: ${sessionPath}`);

    if (onPageReady) await onPageReady(page);
    await waitForOperator(durationSeconds);
    await Promise.all([...pendingCaptures]);

    candidates.sort((left, right) => right.score - left.score);
    const summary = {
      name,
      entryUrl: sanitizeUrl(entryUrl),
      sessionId,
      startedAt,
      completedAt: new Date().toISOString(),
      actionCount: actions.length,
      candidateCount: candidates.length,
      actions,
      candidates: candidates.map((candidate) => ({
        id: candidate.id,
        score: candidate.score,
        method: candidate.request.method,
        url: candidate.request.url,
        resourceType: candidate.request.resourceType,
        status: candidate.response.status,
        contentType: candidate.response.contentType,
        sampleType: candidate.response.sampleType,
      })),
    };

    const summaryPath = join(sessionPath, "summary.json");
    await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
    return { sessionPath, summaryPath, summary, candidates };
  } finally {
    await context.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const configPath = getArgument("config");
  const fileConfig = await loadProbeConfig(configPath);
  const entryUrl = getArgument("url", fileConfig.entryUrl);
  const durationSeconds = Number(
    getArgument("duration", fileConfig.durationSeconds ?? 0),
  );
  const headless = toBoolean(getArgument("headless"), false);

  const result = await probePage({
    ...fileConfig,
    entryUrl,
    durationSeconds,
    headless,
  });
  console.log(`\nProbe completed: ${result.summary.candidateCount} candidates`);
  console.log(`Summary written to: ${result.summaryPath}`);
}
