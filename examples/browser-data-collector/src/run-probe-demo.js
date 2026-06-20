import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { probePage } from "./probe.js";
import { startMockServer } from "./mock-server.js";

const mock = await startMockServer();

try {
  const result = await probePage({
    name: "mock-probe",
    entryUrl: `${mock.baseUrl}/scenario?mode=valid`,
    profileName: "probe-demo",
    durationSeconds: 1,
    headless: true,
    capture: {
      includeUrlPatterns: ["/api/ops/"],
      maxResponseBytes: 1048576,
    },
    onPageReady: async (page) => {
      await page.waitForURL((url) => url.pathname === "/app");
      await page.locator("[data-testid='nav-operations']").click();
      await page
        .locator("[data-testid='region-select']")
        .selectOption("cn-north-4");
      await Promise.all([
        page.waitForResponse((response) =>
          response.url().includes("/api/ops/query"),
        ),
        page.locator("[data-testid='query-button']").click(),
      ]);
    },
  });

  assert.equal(result.summary.candidateCount, 1);
  assert.ok(result.summary.actionCount >= 3);
  assert.equal(result.candidates[0].response.sampleType, "json");
  assert.equal(
    result.candidates[0].response.sample.debug.sessionToken,
    "<redacted>",
  );

  const summary = JSON.parse(await readFile(result.summaryPath, "utf8"));
  assert.equal(summary.candidates[0].method, "POST");
  assert.ok(summary.candidates[0].url.includes("/api/ops/query"));
  console.log(`Probe demo passed -> ${join(result.sessionPath, "summary.json")}`);
} finally {
  await mock.close();
}
