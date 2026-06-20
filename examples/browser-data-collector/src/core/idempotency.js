import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";

function safeKey(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export async function createIdempotencyStore(runtimeRoot) {
  const directory = join(runtimeRoot, "idempotency");
  await mkdir(directory, { recursive: true });

  return {
    async get(key, maxAgeHours) {
      const path = join(directory, `${safeKey(key)}.json`);
      try {
        const value = JSON.parse(await readFile(path, "utf8"));
        if (Number.isFinite(maxAgeHours) && value.sentAt) {
          const ageMs = Date.now() - new Date(value.sentAt).getTime();
          if (ageMs > maxAgeHours * 60 * 60 * 1000) return undefined;
        }
        return value;
      } catch (error) {
        if (error.code === "ENOENT") return undefined;
        throw error;
      }
    },
    async mark(key, value) {
      const path = join(directory, `${safeKey(key)}.json`);
      await writeFile(
        path,
        `${JSON.stringify({ key, ...value }, null, 2)}\n`,
        "utf8",
      );
      return path;
    },
  };
}
