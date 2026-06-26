import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startMockServer } from "./mock-server.js";
import { startUiServer } from "./ui-server.js";

const server = await startUiServer({ host: "127.0.0.1", port: 0 });
const mock = await startMockServer();
const { port } = server.address();
const base = `http://127.0.0.1:${port}`;

async function getJson(path) {
  const response = await fetch(`${base}${path}`);
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  return response.json();
}

async function postJson(path, body) {
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}: ${result.error?.message}`);
  }
  return result;
}

async function createProbeFixture() {
  const sessionId = "ui-smoke-probe";
  const sessionPath = join("runtime", "probes", sessionId);
  await mkdir(join(sessionPath, "candidates"), { recursive: true });
  const candidate = {
    id: "candidate-001",
    capturedAt: new Date().toISOString(),
    request: {
      method: "POST",
      url: `${mock.baseUrl}/api/ops/query`,
      resourceType: "fetch",
      headers: { "content-type": "application/json" },
      body: { region: "cn-north-4" },
    },
    response: {
      status: 200,
      contentType: "application/json",
      sampleType: "json",
      sample: {
        data: {
          records: [
            {
              service: { id: "dws-001", name: "DWS" },
              runtime: { alarmCount: 1 },
            },
          ],
        },
      },
    },
    score: 12,
  };
  const summary = {
    sessionId,
    actionCount: 1,
    candidateCount: 1,
    candidates: [
      {
        id: candidate.id,
        score: candidate.score,
        method: candidate.request.method,
        url: candidate.request.url,
        resourceType: candidate.request.resourceType,
        status: candidate.response.status,
        contentType: candidate.response.contentType,
        sampleType: candidate.response.sampleType,
      },
    ],
  };
  await writeFile(
    join(sessionPath, "summary.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    join(sessionPath, "candidates", "candidate-001.json"),
    `${JSON.stringify(candidate, null, 2)}\n`,
    "utf8",
  );
  return sessionId;
}

function replayConfig() {
  return {
    name: "ui-replay-smoke",
    dataSource: {
      id: "ui-replay-source",
      name: "UI replay source",
      profileName: "ui-replay-smoke",
      entryUrl: `${mock.baseUrl}/scenario?mode=valid`,
      targetUrlPattern: "/app",
      headless: true,
      auth: {
        pageUrlPattern: "/auth",
        stateAttribute: "data-auth-state",
        quickButton: "[data-testid='quick-auth']",
        fingerprintButton: "[data-testid='fingerprint-auth']",
        timeoutMs: 60000,
      },
      request: {
        method: "POST",
        url: `${mock.baseUrl}/api/ops/query`,
        headers: { "Content-Type": "application/json" },
        body: { region: "cn-north-4" },
      },
      extract: {
        recordPath: ["data", "records"],
        fields: {
          serviceId: "service.id",
          serviceName: "service.name",
          alarmCount: "runtime.alarmCount",
        },
        primaryKey: "serviceId",
      },
    },
    businessReport: {
      title: "UI replay smoke",
      chart: {
        categoryField: "serviceName",
        valueField: "alarmCount",
        title: "Alarms",
      },
    },
    messageChannel: { type: "local-file" },
    schedule: { time: "09:00" },
  };
}

try {
  const health = await getJson("/api/health");
  if (health.ok !== true) throw new Error("health body is not ok");

  const page = await fetch(`${base}/`);
  if (!page.ok) throw new Error(`index returned ${page.status}`);
  const html = await page.text();
  if (!html.includes("ArgSRE 数据采集控制台")) {
    throw new Error("index page did not contain expected title");
  }

  const sessionId = await createProbeFixture();
  const candidate = await getJson(`/api/probe/${sessionId}/candidates/candidate-001`);
  if (candidate.request.method !== "POST") {
    throw new Error("candidate request was not returned");
  }
  if (!candidate.suggestedRecordPaths.some((item) => item.recordPath.join(".") === "data.records")) {
    throw new Error("candidate record path was not suggested");
  }

  const replay = await postJson("/api/replay-source", {
    content: replayConfig(),
    headless: true,
  });
  if (replay.recordCount !== 2) {
    throw new Error(`expected 2 replay records, got ${replay.recordCount}`);
  }

  console.log("UI smoke demo passed");
} finally {
  await mock.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}
