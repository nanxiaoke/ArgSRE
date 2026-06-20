import { collectData } from "./collector.js";
import { startMockServer } from "./mock-server.js";

const mock = await startMockServer();

try {
  const scenarios = [
    { mode: "valid" },
    { mode: "quick" },
    { mode: "fingerprint", simulateFingerprint: true },
  ];

  for (const scenario of scenarios) {
    console.log(`\nRunning scenario: ${scenario.mode}`);
    const { audit, resultPath } = await collectData({
      baseUrl: mock.baseUrl,
      mode: scenario.mode,
      simulateFingerprint: scenario.simulateFingerprint ?? false,
      headless: true,
    });
    console.log(
      `Collected ${audit.result.records.length} records -> ${resultPath}`,
    );
  }
} finally {
  await mock.close();
}
