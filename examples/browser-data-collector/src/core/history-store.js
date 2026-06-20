import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

function sourceDirectoryName(sourceId) {
  return createHash("sha256").update(sourceId).digest("hex");
}

function timestampFileName(timestamp) {
  return `${timestamp.replace(/[:.]/g, "-")}.json`;
}

function assertInside(parent, child) {
  const resolvedParent = resolve(parent);
  const resolvedChild = resolve(child);
  if (
    resolvedChild !== resolvedParent &&
    !resolvedChild.startsWith(`${resolvedParent}${sep}`)
  ) {
    throw new Error(`History path escaped runtime directory: ${resolvedChild}`);
  }
}

export async function createHistoryStore(runtimeRoot) {
  const root = join(runtimeRoot, "history");
  await mkdir(root, { recursive: true });

  function sourcePath(sourceId) {
    const path = join(root, sourceDirectoryName(sourceId));
    assertInside(root, path);
    return path;
  }

  return {
    async append({ sourceId, records, timestamp = new Date().toISOString() }) {
      const directory = sourcePath(sourceId);
      await mkdir(directory, { recursive: true });
      const path = join(directory, timestampFileName(timestamp));
      assertInside(directory, path);
      const snapshot = {
        sourceId,
        timestamp,
        recordCount: records.length,
        records,
      };
      await writeFile(path, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
      return { path, snapshot };
    },

    async list({ sourceId, days = 30, now = new Date() }) {
      const directory = sourcePath(sourceId);
      let entries;
      try {
        entries = await readdir(directory, { withFileTypes: true });
      } catch (error) {
        if (error.code === "ENOENT") return [];
        throw error;
      }
      const cutoff = now.getTime() - days * 24 * 60 * 60 * 1000;
      const snapshots = [];
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
        const path = join(directory, entry.name);
        assertInside(directory, path);
        const snapshot = JSON.parse(await readFile(path, "utf8"));
        if (new Date(snapshot.timestamp).getTime() >= cutoff) {
          snapshots.push(snapshot);
        }
      }
      return snapshots.sort((left, right) =>
        left.timestamp.localeCompare(right.timestamp),
      );
    },

    async prune({ sourceId, retentionDays = 90, now = new Date() }) {
      const directory = sourcePath(sourceId);
      let entries;
      try {
        entries = await readdir(directory, { withFileTypes: true });
      } catch (error) {
        if (error.code === "ENOENT") return 0;
        throw error;
      }
      const cutoff = now.getTime() - retentionDays * 24 * 60 * 60 * 1000;
      let removed = 0;
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
        const path = join(directory, entry.name);
        assertInside(directory, path);
        const snapshot = JSON.parse(await readFile(path, "utf8"));
        if (new Date(snapshot.timestamp).getTime() < cutoff) {
          await unlink(path);
          removed += 1;
        }
      }
      return removed;
    },
  };
}
