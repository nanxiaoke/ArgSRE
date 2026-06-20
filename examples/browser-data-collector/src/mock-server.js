import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

const DEFAULT_PORT = 4310;

function parseCookies(header = "") {
  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        return index === -1
          ? [part, ""]
          : [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      }),
  );
}

function html(title, body) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>
    :root { color-scheme: light; font-family: Inter, "Microsoft YaHei", sans-serif; }
    body { margin: 0; color: #172033; background: #eef2f6; }
    header { padding: 16px 24px; color: white; background: #172033; }
    main { max-width: 960px; margin: 32px auto; padding: 0 24px; }
    section { padding: 24px; background: white; border: 1px solid #d9e0e8; border-radius: 6px; }
    button, select { min-height: 38px; padding: 0 12px; font: inherit; }
    button { cursor: pointer; color: white; border: 0; border-radius: 4px; background: #176b58; }
    button.secondary { color: #172033; background: #dce5ed; }
    .toolbar { display: flex; gap: 12px; align-items: center; margin-bottom: 20px; }
    .muted { color: #667085; }
    .hidden { display: none; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 10px; text-align: left; border-bottom: 1px solid #e5e9ef; }
    code { padding: 2px 5px; border-radius: 3px; background: #eef2f6; }
  </style>
</head>
<body>${body}</body>
</html>`;
}

function redirect(res, location, cookies = []) {
  res.writeHead(302, {
    Location: location,
    "Set-Cookie": cookies,
  });
  res.end();
}

function json(res, status, value, cookies = []) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Set-Cookie": cookies,
  });
  res.end(JSON.stringify(value));
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function authPage(state, target) {
  const isQuick = state === "quick";
  const title = isQuick ? "快速认证" : "指纹认证";
  const description = isQuick
    ? "当前会话短期失效，点击按钮即可恢复认证。"
    : "当前会话长期超时，请在本机完成指纹认证。";
  const testId = isQuick ? "quick-auth" : "fingerprint-auth";
  const endpoint = isQuick ? "/api/auth/quick" : "/api/auth/fingerprint";

  return html(
    title,
    `<header><strong>ArgSRE 模拟统一认证中心</strong></header>
<main>
  <section data-auth-state="${state}">
    <h1>${title}</h1>
    <p class="muted">${description}</p>
    <button data-testid="${testId}">${title}</button>
    <p id="status" class="muted"></p>
  </section>
</main>
<script>
  document.querySelector("button").addEventListener("click", async () => {
    document.querySelector("#status").textContent = "认证处理中...";
    const response = await fetch("${endpoint}", { method: "POST" });
    if (!response.ok) {
      document.querySelector("#status").textContent = "认证失败";
      return;
    }
    location.href = ${JSON.stringify(target)};
  });
</script>`,
  );
}

function appPage() {
  return html(
    "运营数据平台",
    `<header><strong>模拟内部运营平台</strong></header>
<main>
  <section>
    <h1>云服务运营工作台</h1>
    <p class="muted">需要进入子页面并设置查询条件后，页面才会发送数据请求。</p>
    <div class="toolbar">
      <button data-testid="nav-operations" class="secondary">运营数据</button>
    </div>
    <div data-testid="operations-panel" class="hidden">
      <div class="toolbar">
        <label for="region">区域</label>
        <select id="region" data-testid="region-select">
          <option value="cn-east-3">华东-上海一</option>
          <option value="cn-north-4">华北-北京四</option>
          <option value="cn-south-1">华南-广州</option>
        </select>
        <button data-testid="query-button">查询</button>
      </div>
      <p id="query-status" class="muted">尚未查询</p>
      <table>
        <thead>
          <tr><th>服务</th><th>区域</th><th>状态</th><th>实例数</th><th>告警数</th></tr>
        </thead>
        <tbody data-testid="result-body"></tbody>
      </table>
    </div>
  </section>
</main>
<script>
  const panel = document.querySelector("[data-testid='operations-panel']");
  document.querySelector("[data-testid='nav-operations']").addEventListener("click", () => {
    panel.classList.remove("hidden");
  });

  document.querySelector("[data-testid='query-button']").addEventListener("click", async () => {
    const region = document.querySelector("[data-testid='region-select']").value;
    document.querySelector("#query-status").textContent = "查询中...";
    const response = await fetch("/api/ops/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ region, timeRange: "last_30_minutes" })
    });
    const payload = await response.json();
    const body = document.querySelector("[data-testid='result-body']");
    body.innerHTML = payload.data.records.map((record) => \`
      <tr>
        <td>\${record.service.name}</td>
        <td>\${record.deployment.region}</td>
        <td>\${record.runtime.status}</td>
        <td>\${record.runtime.instanceCount}</td>
        <td>\${record.runtime.alarmCount}</td>
      </tr>
    \`).join("");
    document.querySelector("#query-status").textContent = "查询完成";
  });
</script>`,
  );
}

export function startMockServer({ port = DEFAULT_PORT } = {}) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const cookies = parseCookies(req.headers.cookie);

    if (req.method === "GET" && url.pathname === "/scenario") {
      const mode = url.searchParams.get("mode") ?? "valid";
      const state = mode === "valid" ? "valid" : mode;
      redirect(res, "/app", [
        `mock_auth=${state}; Path=/; HttpOnly; SameSite=Lax`,
      ]);
      return;
    }

    if (req.method === "GET" && url.pathname === "/app") {
      if (cookies.mock_auth === "valid") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(appPage());
        return;
      }

      const state = cookies.mock_auth === "quick" ? "quick" : "fingerprint";
      redirect(res, `/auth?state=${state}&target=/app`);
      return;
    }

    if (req.method === "GET" && url.pathname === "/auth") {
      const state = url.searchParams.get("state") ?? "fingerprint";
      const target = url.searchParams.get("target") ?? "/app";
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(authPage(state, target));
      return;
    }

    if (
      req.method === "POST" &&
      ["/api/auth/quick", "/api/auth/fingerprint"].includes(url.pathname)
    ) {
      json(res, 200, { authenticated: true }, [
        "mock_auth=valid; Path=/; HttpOnly; SameSite=Lax",
      ]);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/ops/query") {
      if (cookies.mock_auth !== "valid") {
        json(res, 401, { error: "authentication_required" });
        return;
      }

      const body = await readJson(req);
      const now = new Date().toISOString();
      json(res, 200, {
        code: 0,
        message: "success",
        request: {
          region: body.region,
          timeRange: body.timeRange,
        },
        data: {
          total: 2,
          records: [
            {
              service: { id: "dws-prod-01", name: "DWS 生产集群" },
              deployment: { region: body.region, availabilityZones: 3 },
              runtime: {
                status: "healthy",
                instanceCount: 12,
                alarmCount: 0,
                updatedAt: now,
              },
            },
            {
              service: { id: "dms-kafka-01", name: "DMS Kafka 生产实例" },
              deployment: { region: body.region, availabilityZones: 3 },
              runtime: {
                status: "warning",
                instanceCount: 6,
                alarmCount: 2,
                updatedAt: now,
              },
            },
          ],
        },
      });
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not Found");
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise((closeResolve, closeReject) => {
            server.close((error) =>
              error ? closeReject(error) : closeResolve(),
            );
          }),
      });
    });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const running = await startMockServer();
  console.log(`Mock server listening at ${running.baseUrl}`);
}
