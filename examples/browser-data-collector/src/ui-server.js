import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import {
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import { fileURLToPath } from "node:url";
import { probePage } from "./probe.js";
import { runDailyReport } from "./daily-report.js";
import { runConfiguredDataSource } from "./core/data-source-dispatcher.js";
import { resolveWorkflowConfig } from "./core/workflow-config-loader.js";
import { validateWorkflowConfig } from "./core/config-validator.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const UI_ROOT = join(ROOT, "src", "ui");
const LOCAL_CONFIG_ROOT = join(ROOT, "runtime", "local-config");
const RUNTIME_ROOT = join(ROOT, "runtime");
const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};
const probeSessions = new Map();

function isInside(parent, child) {
  const diff = relative(resolve(parent), resolve(child));
  return diff === "" || (!diff.startsWith("..") && !isAbsolute(diff));
}

function safeConfigName(name) {
  if (typeof name !== "string" || !/^[a-zA-Z0-9._-]+\.json$/.test(name)) {
    throw Object.assign(new Error("Config name must end with .json and use safe characters."), {
      statusCode: 400,
    });
  }
  return name;
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("Request body must be valid JSON."), {
      statusCode: 400,
    });
  }
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(`${JSON.stringify(body, null, 2)}\n`);
}

function toErrorBody(error) {
  return {
    ok: false,
    error: {
      name: error.name,
      message: error.message,
      validationErrors: error.validationErrors,
      workflowAudit: error.workflowAudit,
    },
  };
}

async function listDirectories(path) {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
      .reverse();
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function listConfigs() {
  await mkdir(LOCAL_CONFIG_ROOT, { recursive: true });
  const entries = await readdir(LOCAL_CONFIG_ROOT, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
    .sort();
}

async function latestJson(path, fileName) {
  const dirs = await listDirectories(path);
  for (const dir of dirs) {
    const filePath = join(path, dir, fileName);
    try {
      const content = JSON.parse(await readFile(filePath, "utf8"));
      return { id: dir, content };
    } catch {
      // Keep scanning for the newest complete artifact.
    }
  }
  return undefined;
}

function createStopController() {
  let stop;
  const signal = new Promise((resolveStop) => {
    stop = resolveStop;
  });
  return { signal, stop };
}

function summarizeProbeSession(session) {
  return {
    sessionId: session.sessionId,
    status: session.status,
    startedAt: session.startedAt,
    completedAt: session.completedAt,
    sessionPath: session.sessionPath,
    error: session.error,
    summary: session.summary,
  };
}

function describeJsonPaths(value, path = "$", output = [], depth = 0) {
  if (depth > 8) {
    output.push({ path, type: "max-depth" });
    return output;
  }
  if (Array.isArray(value)) {
    output.push({ path, type: "array", length: value.length });
    if (value.length > 0) describeJsonPaths(value[0], `${path}[]`, output, depth + 1);
    return output;
  }
  if (value && typeof value === "object") {
    output.push({ path, type: "object" });
    for (const [key, child] of Object.entries(value)) {
      describeJsonPaths(child, `${path}.${key}`, output, depth + 1);
    }
    return output;
  }
  output.push({
    path,
    type: value === null ? "null" : typeof value,
    preview: typeof value === "string" ? value.slice(0, 80) : value,
  });
  return output;
}

function pathToExtractPath(path) {
  return path
    .replace(/^\$\./, "")
    .replace(/^\$/, "")
    .replaceAll("[]", "")
    .split(".")
    .filter(Boolean);
}

function candidateToRequest(candidate) {
  return {
    method: candidate.request.method,
    url: candidate.request.url,
    headers: candidate.request.headers,
    body: candidate.request.body,
  };
}

async function readProbeCandidate(sessionId, candidateId) {
  const candidatePath = resolve(
    RUNTIME_ROOT,
    "probes",
    sessionId,
    "candidates",
    `${candidateId}.json`,
  );
  const probeRoot = join(RUNTIME_ROOT, "probes");
  if (!isInside(probeRoot, candidatePath)) {
    throw Object.assign(new Error("Candidate path is outside runtime root."), {
      statusCode: 400,
    });
  }
  return JSON.parse(await readFile(candidatePath, "utf8"));
}

async function readRuntimeArtifact(kind, id, file) {
  const roots = {
    reports: join(RUNTIME_ROOT, "daily-reports"),
    probes: join(RUNTIME_ROOT, "probes"),
  };
  const root = roots[kind];
  if (!root) {
    throw Object.assign(new Error("Unknown artifact kind."), { statusCode: 404 });
  }
  const filePath = resolve(root, id, file);
  if (!isInside(root, filePath)) {
    throw Object.assign(new Error("Artifact path is outside runtime root."), {
      statusCode: 400,
    });
  }
  return {
    filePath,
    content: await readFile(filePath, "utf8"),
    contentType: MIME_TYPES[extname(filePath)] ?? "text/plain; charset=utf-8",
  };
}

async function handleApi(request, response, url) {
  if (request.method === "GET" && url.pathname === "/api/health") {
    sendJson(response, 200, {
      ok: true,
      root: ROOT,
      localConfigRoot: LOCAL_CONFIG_ROOT,
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/configs") {
    sendJson(response, 200, { ok: true, configs: await listConfigs() });
    return;
  }

  if (request.method === "GET" && url.pathname.startsWith("/api/configs/")) {
    const name = safeConfigName(decodeURIComponent(basename(url.pathname)));
    const filePath = join(LOCAL_CONFIG_ROOT, name);
    sendJson(response, 200, {
      ok: true,
      name,
      content: await readFile(filePath, "utf8"),
    });
    return;
  }

  if (request.method === "PUT" && url.pathname.startsWith("/api/configs/")) {
    const name = safeConfigName(decodeURIComponent(basename(url.pathname)));
    const body = await readJsonBody(request);
    const content =
      typeof body.content === "string"
        ? body.content
        : `${JSON.stringify(body.content, null, 2)}\n`;
    JSON.parse(content);
    await mkdir(LOCAL_CONFIG_ROOT, { recursive: true });
    const filePath = join(LOCAL_CONFIG_ROOT, name);
    await writeFile(filePath, content.endsWith("\n") ? content : `${content}\n`, "utf8");
    sendJson(response, 200, { ok: true, name, filePath });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/validate") {
    const body = await readJsonBody(request);
    const content =
      typeof body.content === "string"
        ? JSON.parse(body.content)
        : body.content;
    const staticErrors = validateWorkflowConfig(content);
    if (staticErrors.length > 0) {
      sendJson(response, 200, { ok: false, validationErrors: staticErrors });
      return;
    }
    await resolveWorkflowConfig(content, { baseDirectory: LOCAL_CONFIG_ROOT });
    sendJson(response, 200, { ok: true, validationErrors: [] });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/run") {
    const body = await readJsonBody(request);
    const config =
      typeof body.content === "string"
        ? JSON.parse(body.content)
        : body.content;
    const result = await runDailyReport({
      config,
      dryRun: body.dryRun !== false,
      simulateFingerprint: body.simulateFingerprint === true,
    });
    sendJson(response, 200, {
      ok: true,
      runPath: result.runPath,
      audit: result.audit,
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/probe") {
    const body = await readJsonBody(request);
    const probeConfig = body.config ?? {};
    const result = await probePage({
      ...probeConfig,
      headless: probeConfig.headless === true,
      durationSeconds: Number(probeConfig.durationSeconds ?? 90),
    });
    sendJson(response, 200, {
      ok: true,
      sessionPath: result.sessionPath,
      summary: result.summary,
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/probe/start") {
    const body = await readJsonBody(request);
    const probeConfig = body.config ?? {};
    const sessionId = new Date().toISOString().replace(/[:.]/g, "-");
    const stopController = createStopController();
    const session = {
      sessionId,
      status: "starting",
      startedAt: new Date().toISOString(),
      stop: stopController.stop,
    };
    probeSessions.set(sessionId, session);
    probePage({
      ...probeConfig,
      sessionId,
      headless: probeConfig.headless === true,
      durationSeconds: Number(probeConfig.durationSeconds ?? 3600),
      stopSignal: stopController.signal,
      onSessionStarted(event) {
        session.status = "running";
        session.sessionPath = event.sessionPath;
        session.pageUrl = event.pageUrl;
      },
    })
      .then((result) => {
        session.status = "completed";
        session.completedAt = new Date().toISOString();
        session.sessionPath = result.sessionPath;
        session.summary = result.summary;
      })
      .catch((error) => {
        session.status = "failed";
        session.completedAt = new Date().toISOString();
        session.error = { name: error.name, message: error.message };
      });
    sendJson(response, 202, { ok: true, session: summarizeProbeSession(session) });
    return;
  }

  const stopProbeMatch = url.pathname.match(/^\/api\/probe\/([^/]+)\/stop$/);
  if (request.method === "POST" && stopProbeMatch) {
    const session = probeSessions.get(decodeURIComponent(stopProbeMatch[1]));
    if (!session) {
      sendJson(response, 404, { ok: false, error: { message: "Probe session not found." } });
      return;
    }
    if (["starting", "running"].includes(session.status)) {
      session.status = "stopping";
      session.stop();
    }
    sendJson(response, 200, { ok: true, session: summarizeProbeSession(session) });
    return;
  }

  const getProbeMatch = url.pathname.match(/^\/api\/probe\/([^/]+)$/);
  if (request.method === "GET" && getProbeMatch) {
    const sessionId = decodeURIComponent(getProbeMatch[1]);
    const session = probeSessions.get(sessionId);
    if (session) {
      sendJson(response, 200, { ok: true, session: summarizeProbeSession(session) });
      return;
    }
    const summary = JSON.parse(
      await readFile(join(RUNTIME_ROOT, "probes", sessionId, "summary.json"), "utf8"),
    );
    sendJson(response, 200, {
      ok: true,
      session: { sessionId, status: "completed", summary },
    });
    return;
  }

  const candidateMatch = url.pathname.match(/^\/api\/probe\/([^/]+)\/candidates\/([^/]+)$/);
  if (request.method === "GET" && candidateMatch) {
    const candidate = await readProbeCandidate(
      decodeURIComponent(candidateMatch[1]),
      decodeURIComponent(candidateMatch[2]),
    );
    sendJson(response, 200, {
      ok: true,
      candidate,
      request: candidateToRequest(candidate),
      responsePaths: describeJsonPaths(candidate.response.sample),
      suggestedRecordPaths: describeJsonPaths(candidate.response.sample)
        .filter((item) => item.type === "array")
        .map((item) => ({
          path: item.path,
          recordPath: pathToExtractPath(item.path),
          length: item.length,
        })),
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/replay-source") {
    const body = await readJsonBody(request);
    const config =
      typeof body.content === "string"
        ? JSON.parse(body.content)
        : body.content;
    const resolved = await resolveWorkflowConfig(config, {
      baseDirectory: LOCAL_CONFIG_ROOT,
    });
    const sourceConfig = resolved.dataSource ?? resolved.dataSources?.[0];
    const result = await runConfiguredDataSource({
      config: {
        ...sourceConfig,
        headless: body.headless === true ? true : false,
      },
      runtimeRoot: RUNTIME_ROOT,
      simulateFingerprint: body.simulateFingerprint === true,
      retryConfig: resolved.reliability?.dataRequest,
    });
    sendJson(response, 200, {
      ok: true,
      sourceId: result.sourceId,
      audit: result.audit,
      quality: result.quality,
      recordCount: result.records.length,
      sampleRecords: result.records.slice(0, 5),
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/runs") {
    sendJson(response, 200, {
      ok: true,
      runs: await listDirectories(join(RUNTIME_ROOT, "daily-reports")),
      latest: await latestJson(join(RUNTIME_ROOT, "daily-reports"), "workflow-audit.json"),
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/probes") {
    sendJson(response, 200, {
      ok: true,
      probes: await listDirectories(join(RUNTIME_ROOT, "probes")),
      latest: await latestJson(join(RUNTIME_ROOT, "probes"), "summary.json"),
    });
    return;
  }

  const artifactMatch = url.pathname.match(/^\/api\/artifacts\/(reports|probes)\/([^/]+)\/(.+)$/);
  if (request.method === "GET" && artifactMatch) {
    const [, kind, id, rawFile] = artifactMatch;
    const artifact = await readRuntimeArtifact(
      kind,
      decodeURIComponent(id),
      decodeURIComponent(rawFile),
    );
    response.writeHead(200, {
      "content-type": artifact.contentType,
      "cache-control": "no-store",
    });
    response.end(artifact.content);
    return;
  }

  sendJson(response, 404, { ok: false, error: { message: "API route not found." } });
}

async function serveStatic(response, pathname) {
  const requestPath = pathname === "/" ? "/index.html" : pathname;
  const filePath = resolve(UI_ROOT, `.${decodeURIComponent(requestPath)}`);
  if (!isInside(UI_ROOT, filePath)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }
  try {
    const info = await stat(filePath);
    if (!info.isFile()) throw Object.assign(new Error("Not found"), { code: "ENOENT" });
    response.writeHead(200, {
      "content-type": MIME_TYPES[extname(filePath)] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    createReadStream(filePath).pipe(response);
  } catch (error) {
    if (error.code === "ENOENT") {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }
    throw error;
  }
}

export function createUiServer() {
  return createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    try {
      if (url.pathname.startsWith("/api/")) {
        await handleApi(request, response, url);
      } else {
        await serveStatic(response, url.pathname);
      }
    } catch (error) {
      sendJson(response, error.statusCode ?? 500, toErrorBody(error));
    }
  });
}

export async function startUiServer({ host = "127.0.0.1", port = 8787 } = {}) {
  const server = createUiServer();
  await new Promise((resolveListen) => server.listen(port, host, resolveListen));
  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.ARGSRE_UI_PORT ?? 8787);
  const host = process.env.ARGSRE_UI_HOST ?? "127.0.0.1";
  await startUiServer({ host, port });
  console.log(`ArgSRE collector UI: http://${host}:${port}`);
  console.log(`Local configs: ${LOCAL_CONFIG_ROOT}`);
}
