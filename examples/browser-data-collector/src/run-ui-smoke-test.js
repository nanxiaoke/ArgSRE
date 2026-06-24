import { startUiServer } from "./ui-server.js";

const server = await startUiServer({ host: "127.0.0.1", port: 0 });
const { port } = server.address();

try {
  const health = await fetch(`http://127.0.0.1:${port}/api/health`);
  if (!health.ok) throw new Error(`health returned ${health.status}`);
  const body = await health.json();
  if (body.ok !== true) throw new Error("health body is not ok");

  const page = await fetch(`http://127.0.0.1:${port}/`);
  if (!page.ok) throw new Error(`index returned ${page.status}`);
  const html = await page.text();
  if (!html.includes("ArgSRE 数据采集控制台")) {
    throw new Error("index page did not contain expected title");
  }
  console.log("UI smoke demo passed");
} finally {
  await new Promise((resolveClose) => server.close(resolveClose));
}
