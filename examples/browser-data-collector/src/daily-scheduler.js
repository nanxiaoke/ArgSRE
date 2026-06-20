import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runDailyReport } from "./daily-report.js";

function getArgument(name, fallback) {
  const prefix = `--${name}=`;
  const inline = process.argv.find((value) => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

export function millisecondsUntil(time, now = new Date()) {
  const [hour, minute] = time.split(":").map(Number);
  if (
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    throw new Error(`Invalid schedule time: ${time}`);
  }

  const next = new Date(now);
  next.setHours(hour, minute, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

export async function startDailyScheduler({ config, runOnStart = false }) {
  let stopped = false;
  let timer;

  async function execute() {
    try {
      const result = await runDailyReport({ config });
      console.log(
        `[scheduler] report sent: ${result.audit.recordCount} records`,
      );
    } catch (error) {
      console.error(`[scheduler] run failed: ${error.message}`);
    }
  }

  function scheduleNext() {
    if (stopped) return;
    const delay = millisecondsUntil(config.schedule.time);
    const next = new Date(Date.now() + delay);
    console.log(`[scheduler] next run: ${next.toISOString()}`);
    timer = setTimeout(async () => {
      await execute();
      scheduleNext();
    }, delay);
  }

  if (runOnStart) await execute();
  scheduleNext();

  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const configPath = getArgument("config");
  if (!configPath) throw new Error("--config is required");
  const config = JSON.parse(await readFile(resolve(configPath), "utf8"));
  const runOnStart = getArgument("run-now", "false") === "true";
  await startDailyScheduler({ config, runOnStart });
}
