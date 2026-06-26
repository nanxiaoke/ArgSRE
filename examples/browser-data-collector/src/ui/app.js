const $ = (selector) => document.querySelector(selector);
const state = {
  latestRunId: undefined,
  currentProbeSessionId: undefined,
  selectedCandidate: undefined,
  selectedCandidateMeta: undefined,
  config: defaultWorkflow(),
  pollTimer: undefined,
};

function defaultWorkflow() {
  return {
    name: "daily-sre-operations-report",
    dataSource: {
      id: "internal-operations-source",
      name: "内部运营数据源",
      profileName: "daily-report",
      entryUrl: "https://replace-with-internal-target.example/",
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
        url: "https://replace-with-internal-target.example/api/query",
        headers: { "Content-Type": "application/json" },
        body: { region: "example-region", timeRange: "last_24_hours" },
      },
      extract: {
        recordPath: ["data", "records"],
        fields: {
          serviceId: "service.id",
          serviceName: "service.name",
          region: "deployment.region",
          status: "runtime.status",
          instanceCount: "runtime.instanceCount",
          alarmCount: "runtime.alarmCount",
          updatedAt: "runtime.updatedAt",
        },
        primaryKey: "serviceId",
      },
      quality: {
        mode: "warn",
        minRecords: 1,
        requiredFields: ["serviceId", "serviceName", "status", "updatedAt"],
        uniqueFields: ["serviceId"],
        freshness: { field: "updatedAt", maxAgeMinutes: 1440 },
        numericRanges: {
          instanceCount: { min: 0 },
          alarmCount: { min: 0 },
        },
      },
    },
    businessReport: {
      title: "SRE 每日运营报告",
      chart: {
        categoryField: "serviceName",
        valueField: "alarmCount",
        title: "各服务告警数量",
      },
    },
    messageChannel: { type: "local-file" },
    reliability: {
      dataRequest: {
        maxAttempts: 3,
        baseDelayMs: 500,
        maxDelayMs: 3000,
        timeoutMs: 30000,
      },
      messageSend: {
        maxAttempts: 3,
        baseDelayMs: 500,
        maxDelayMs: 3000,
        timeoutMs: 30000,
      },
      idempotencyHours: 36,
      failureNotificationThreshold: 1,
    },
    history: {
      trendDays: 7,
      retentionDays: 90,
      trendChart: { title: "近 7 天告警趋势", valueField: "totalAlarms" },
    },
    schedule: { time: "09:00" },
  };
}

function log(message, detail) {
  const line = `[${new Date().toLocaleTimeString()}] ${message}`;
  $("#log").textContent =
    `${line}${detail ? `\n${JSON.stringify(detail, null, 2)}` : ""}\n\n${$("#log").textContent}`;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers ?? {}),
    },
  });
  const contentType = response.headers.get("content-type") ?? "";
  const body = contentType.includes("json")
    ? await response.json()
    : await response.text();
  if (!response.ok) {
    throw new Error(typeof body === "string" ? body : body.error?.message);
  }
  return body;
}

function source() {
  state.config.dataSource ??= structuredClone(defaultWorkflow().dataSource);
  return state.config.dataSource;
}

function parseJsonField(selector, label) {
  try {
    return JSON.parse($(selector).value || "{}");
  } catch (error) {
    throw new Error(`${label} 不是合法 JSON: ${error.message}`);
  }
}

function fillForm(config) {
  state.config = structuredClone(config);
  const dataSource = source();
  $("#workflowName").value = state.config.name ?? "";
  $("#scheduleTime").value = state.config.schedule?.time ?? "";
  $("#sourceId").value = dataSource.id ?? "";
  $("#sourceName").value = dataSource.name ?? "";
  $("#entryUrl").value = dataSource.entryUrl ?? "";
  $("#targetUrlPattern").value = dataSource.targetUrlPattern ?? "";
  $("#profileName").value = dataSource.profileName ?? "";
  $("#quickButton").value = dataSource.auth?.quickButton ?? "";
  $("#fingerprintButton").value = dataSource.auth?.fingerprintButton ?? "";
  $("#requestUrl").value = dataSource.request?.url ?? "";
  $("#requestMethod").value = dataSource.request?.method ?? "GET";
  $("#recordPath").value = (dataSource.extract?.recordPath ?? []).join(".");
  $("#fieldsText").value = JSON.stringify(dataSource.extract?.fields ?? {}, null, 2);
  $("#bodyText").value = JSON.stringify(dataSource.request?.body ?? {}, null, 2);
  $("#qualityText").value = JSON.stringify(dataSource.quality ?? {}, null, 2);
  $("#primaryKeyField").value = dataSource.extract?.primaryKey ?? "";
  $("#probeUrl").value = dataSource.entryUrl ?? "";
  $("#probeProfile").value = dataSource.profileName ?? "probe";
  renderJson();
}

function readForm() {
  const config = structuredClone(state.config);
  const dataSource = config.dataSource ?? structuredClone(defaultWorkflow().dataSource);
  config.name = $("#workflowName").value.trim();
  config.schedule = { ...(config.schedule ?? {}), time: $("#scheduleTime").value.trim() };
  dataSource.id = $("#sourceId").value.trim();
  dataSource.name = $("#sourceName").value.trim();
  dataSource.entryUrl = $("#entryUrl").value.trim();
  dataSource.targetUrlPattern = $("#targetUrlPattern").value.trim();
  dataSource.profileName = $("#profileName").value.trim();
  dataSource.auth = {
    ...(dataSource.auth ?? {}),
    pageUrlPattern: dataSource.auth?.pageUrlPattern ?? "/auth",
    stateAttribute: dataSource.auth?.stateAttribute ?? "data-auth-state",
    quickButton: $("#quickButton").value.trim(),
    fingerprintButton: $("#fingerprintButton").value.trim(),
    timeoutMs: dataSource.auth?.timeoutMs ?? 60000,
  };
  dataSource.request = {
    ...(dataSource.request ?? {}),
    method: $("#requestMethod").value,
    url: $("#requestUrl").value.trim(),
    headers: dataSource.request?.headers ?? { "Content-Type": "application/json" },
    body: parseJsonField("#bodyText", "请求体 JSON"),
  };
  dataSource.extract = {
    ...(dataSource.extract ?? {}),
    recordPath: $("#recordPath")
      .value.split(".")
      .map((part) => part.trim())
      .filter(Boolean),
    fields: parseJsonField("#fieldsText", "字段映射"),
    primaryKey: $("#primaryKeyField").value.trim(),
  };
  if (!dataSource.extract.primaryKey) {
    dataSource.extract.primaryKey = Object.keys(dataSource.extract.fields)[0] ?? "";
  }
  dataSource.quality = parseJsonField("#qualityText", "质量规则 JSON");
  config.dataSource = dataSource;
  state.config = config;
  renderJson();
  return config;
}

function renderJson() {
  $("#jsonEditor").value = JSON.stringify(state.config, null, 2);
}

function responsePathToFieldPath(path) {
  const recordPath = $("#recordPath").value.trim();
  let value = path.replace(/^\$\./, "").replace(/^\$/, "").replaceAll("[]", "");
  if (recordPath && value.startsWith(`${recordPath}.`)) {
    value = value.slice(recordPath.length + 1);
  }
  return value;
}

function setProbeStatus(text, running = false) {
  $("#probeStatus").textContent = text;
  $("#stopProbeBtn").disabled = !running;
  $("#probeBtn").disabled = running;
}

function renderCandidates(summary) {
  const list = $("#candidateList");
  list.innerHTML = "";
  const candidates = summary?.candidates ?? [];
  if (candidates.length === 0) {
    list.textContent = "暂无候选请求";
    return;
  }
  for (const candidate of candidates) {
    const button = document.createElement("button");
    button.className = "candidate-item";
    button.dataset.candidateId = candidate.id;
    button.innerHTML = `<strong>${candidate.id} score=${candidate.score} ${candidate.method} ${candidate.status}</strong><span>${candidate.url}</span>`;
    button.addEventListener("click", () => selectCandidate(summary.sessionId, candidate.id, button));
    list.appendChild(button);
  }
}

function renderCandidateDetail(result) {
  state.selectedCandidate = result.candidate;
  state.selectedCandidateMeta = result;
  $("#candidateDetail").textContent = JSON.stringify(result.candidate, null, 2);
  $("#responsePaths").textContent = result.responsePaths
    .map((item) => `${item.path}: ${item.type}${item.length !== undefined ? `(${item.length})` : ""}`)
    .join("\n");

  const recordSelect = $("#recordPathSelect");
  recordSelect.innerHTML = "";
  for (const item of result.suggestedRecordPaths) {
    const option = document.createElement("option");
    option.value = item.recordPath.join(".");
    option.textContent = `${item.path} (${item.length})`;
    recordSelect.appendChild(option);
  }

  const fieldSelect = $("#fieldPathSelect");
  fieldSelect.innerHTML = "";
  for (const item of result.responsePaths.filter((path) => !["array", "object"].includes(path.type))) {
    const option = document.createElement("option");
    option.value = item.path;
    option.textContent = `${item.path}: ${item.type}`;
    fieldSelect.appendChild(option);
  }

  $("#applyCandidateBtn").disabled = false;
  $("#useRecordPathBtn").disabled = recordSelect.options.length === 0;
  $("#addFieldBtn").disabled = fieldSelect.options.length === 0;
}

async function selectCandidate(sessionId, candidateId, button) {
  document.querySelectorAll(".candidate-item").forEach((item) => item.classList.remove("active"));
  button?.classList.add("active");
  const result = await api(
    `/api/probe/${encodeURIComponent(sessionId)}/candidates/${encodeURIComponent(candidateId)}`,
  );
  renderCandidateDetail(result);
  log(`已选择候选请求 ${candidateId}`);
}

function applyCandidateToConfig() {
  if (!state.selectedCandidateMeta) return;
  const request = state.selectedCandidateMeta.request;
  $("#requestMethod").value = request.method;
  $("#requestUrl").value = request.url;
  $("#bodyText").value = JSON.stringify(request.body ?? {}, null, 2);
  if ($("#recordPathSelect").value) $("#recordPath").value = $("#recordPathSelect").value;
  readForm();
  log("候选请求已应用到数据源配置");
}

function useSelectedRecordPath() {
  if (!$("#recordPathSelect").value) return;
  $("#recordPath").value = $("#recordPathSelect").value;
  readForm();
  log(`已设置数据路径 ${$("#recordPath").value}`);
}

function addSelectedField() {
  const rawPath = $("#fieldPathSelect").value;
  if (!rawPath) return;
  const outputField = $("#outputFieldName").value.trim() || rawPath.split(".").at(-1);
  const fields = parseJsonField("#fieldsText", "字段映射");
  fields[outputField] = responsePathToFieldPath(rawPath);
  $("#fieldsText").value = JSON.stringify(fields, null, 2);
  if (!$("#primaryKeyField").value.trim()) $("#primaryKeyField").value = outputField;
  readForm();
  log(`已加入字段映射 ${outputField}`);
}

async function refreshConfigs() {
  const result = await api("/api/configs");
  const select = $("#configSelect");
  select.innerHTML = "";
  for (const name of result.configs) {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    select.appendChild(option);
  }
  if (result.configs.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "尚无本地配置";
    select.appendChild(option);
  }
}

async function loadConfig(name) {
  if (!name) return;
  const result = await api(`/api/configs/${encodeURIComponent(name)}`);
  $("#configName").value = result.name;
  fillForm(JSON.parse(result.content));
  log(`已加载配置 ${result.name}`);
}

async function saveConfig() {
  const config = readForm();
  const name = $("#configName").value.trim();
  const result = await api(`/api/configs/${encodeURIComponent(name)}`, {
    method: "PUT",
    body: JSON.stringify({ content: JSON.stringify(config, null, 2) }),
  });
  await refreshConfigs();
  log("配置已保存", result);
}

async function validateConfig() {
  const config = readForm();
  const result = await api("/api/validate", {
    method: "POST",
    body: JSON.stringify({ content: config }),
  });
  log(result.ok ? "配置校验通过" : "配置校验未通过", result.validationErrors);
}

async function replaySource() {
  const config = readForm();
  $("#replayResult").textContent = "重放验证中...";
  const result = await api("/api/replay-source", {
    method: "POST",
    body: JSON.stringify({ content: config, headless: false }),
  });
  $("#replayResult").textContent = JSON.stringify(result, null, 2);
  log(`重放验证完成，记录数 ${result.recordCount}`, result.audit);
}

async function runDryRun() {
  const config = readForm();
  log("开始生成本机报告");
  const result = await api("/api/run", {
    method: "POST",
    body: JSON.stringify({ content: config, dryRun: true }),
  });
  state.latestRunId = result.audit.runId;
  log("本机报告生成完成", result.audit);
  await loadRuns();
}

function csvList(value) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

async function startProbe() {
  const config = {
    name: "ui-data-source-probe",
    entryUrl: $("#probeUrl").value.trim(),
    profileName: $("#probeProfile").value.trim(),
    durationSeconds: Number($("#probeDuration").value || 3600),
    capture: {
      includeUrlPatterns: csvList($("#probeIncludes").value),
      excludeUrlPatterns: csvList($("#probeExcludes").value),
      maxResponseBytes: 1048576,
    },
  };
  log("开始页面探测，请在弹出的浏览器中完成认证、进入子页面并触发目标请求", config);
  const result = await api("/api/probe/start", {
    method: "POST",
    body: JSON.stringify({ config }),
  });
  state.currentProbeSessionId = result.session.sessionId;
  setProbeStatus("运行中", true);
  startProbePolling();
}

async function stopProbe() {
  if (!state.currentProbeSessionId) return;
  await api(`/api/probe/${encodeURIComponent(state.currentProbeSessionId)}/stop`, {
    method: "POST",
    body: "{}",
  });
  log("已请求结束探测");
  setProbeStatus("结束中", true);
}

function startProbePolling() {
  clearInterval(state.pollTimer);
  state.pollTimer = setInterval(() => {
    refreshCurrentProbe().catch((error) => log("探测状态刷新失败", { message: error.message }));
  }, 1500);
}

async function refreshCurrentProbe() {
  if (!state.currentProbeSessionId) return;
  const result = await api(`/api/probe/${encodeURIComponent(state.currentProbeSessionId)}`);
  const session = result.session;
  if (session.summary) renderCandidates(session.summary);
  if (["completed", "failed"].includes(session.status)) {
    clearInterval(state.pollTimer);
    setProbeStatus(session.status === "completed" ? "已完成" : "失败", false);
    log("探测已结束", session.summary ?? session.error);
  } else {
    setProbeStatus(session.status, true);
  }
}

async function loadProbes() {
  const result = await api("/api/probes");
  const latest = result.latest?.content;
  if (latest) {
    state.currentProbeSessionId = latest.sessionId;
    renderCandidates(latest);
    setProbeStatus("已读取最近", false);
  }
  log("已读取最近探测", result.latest ?? result);
}

async function loadRuns() {
  const result = await api("/api/runs");
  state.latestRunId = result.latest?.id ?? result.runs?.[0];
  $("#runSummary").textContent = JSON.stringify(result.latest ?? result, null, 2);
  log("已读取最近执行");
}

async function loadReport() {
  if (!state.latestRunId) await loadRuns();
  if (!state.latestRunId) {
    $("#reportPreview").textContent = "暂无执行结果";
    return;
  }
  const response = await fetch(
    `/api/artifacts/reports/${encodeURIComponent(state.latestRunId)}/report.md`,
  );
  $("#reportPreview").textContent = response.ok
    ? await response.text()
    : `读取失败: ${response.status}`;
}

function bindEvents() {
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".nav-item").forEach((item) => item.classList.remove("active"));
      document.querySelectorAll(".view").forEach((view) => view.classList.remove("active"));
      button.classList.add("active");
      $(`#${button.dataset.view}`).classList.add("active");
    });
  });
  $("#refreshBtn").addEventListener("click", refreshAll);
  $("#saveBtn").addEventListener("click", () => saveConfig().catch((error) => log(error.message)));
  $("#validateBtn").addEventListener("click", () => validateConfig().catch((error) => log(error.message)));
  $("#replayBtn").addEventListener("click", () => replaySource().catch((error) => {
    $("#replayResult").textContent = error.message;
    log("重放验证失败", { message: error.message });
  }));
  $("#dryRunBtn").addEventListener("click", () => runDryRun().catch((error) => log("报告生成失败", { message: error.message })));
  $("#applyJsonBtn").addEventListener("click", () => {
    try {
      fillForm(JSON.parse($("#jsonEditor").value));
      log("已从 JSON 回填表单");
    } catch (error) {
      log(error.message);
    }
  });
  $("#configSelect").addEventListener("change", (event) => loadConfig(event.target.value).catch((error) => log(error.message)));
  $("#probeBtn").addEventListener("click", () => startProbe().catch((error) => log("页面探测失败", { message: error.message })));
  $("#stopProbeBtn").addEventListener("click", () => stopProbe().catch((error) => log("结束探测失败", { message: error.message })));
  $("#loadProbesBtn").addEventListener("click", () => loadProbes().catch((error) => log(error.message)));
  $("#applyCandidateBtn").addEventListener("click", applyCandidateToConfig);
  $("#useRecordPathBtn").addEventListener("click", useSelectedRecordPath);
  $("#addFieldBtn").addEventListener("click", addSelectedField);
  $("#clearFieldsBtn").addEventListener("click", () => {
    $("#fieldsText").value = "{}";
    readForm();
    log("字段映射已清空");
  });
  $("#loadRunsBtn").addEventListener("click", () => loadRuns().catch((error) => log(error.message)));
  $("#loadReportBtn").addEventListener("click", () => loadReport().catch((error) => log(error.message)));
  $("#clearLogBtn").addEventListener("click", () => {
    $("#log").textContent = "";
  });
}

async function refreshAll() {
  const health = await api("/api/health");
  $("#healthText").innerHTML = `<span class="status-ok">已连接</span> ${health.localConfigRoot}`;
  await refreshConfigs();
}

bindEvents();
fillForm(state.config);
refreshAll().catch((error) => {
  $("#healthText").innerHTML = `<span class="status-bad">连接失败</span> ${error.message}`;
  log(error.message);
});
