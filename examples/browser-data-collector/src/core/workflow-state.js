import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

function fileName(workflowName) {
  return `${createHash("sha256").update(workflowName).digest("hex")}.json`;
}

export async function createWorkflowStateStore(runtimeRoot) {
  const directory = join(runtimeRoot, "state");
  await mkdir(directory, { recursive: true });

  async function read(workflowName) {
    const path = join(directory, fileName(workflowName));
    try {
      return JSON.parse(await readFile(path, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") {
        return {
          workflow: workflowName,
          consecutiveFailures: 0,
        };
      }
      throw error;
    }
  }

  async function save(workflowName, state) {
    const path = join(directory, fileName(workflowName));
    await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    return state;
  }

  return {
    read,
    async markSuccess(workflowName, runId) {
      const current = await read(workflowName);
      return save(workflowName, {
        ...current,
        workflow: workflowName,
        consecutiveFailures: 0,
        lastStatus: "success",
        lastRunId: runId,
        lastSuccessAt: new Date().toISOString(),
      });
    },
    async markFailure(workflowName, runId, errorCode) {
      const current = await read(workflowName);
      return save(workflowName, {
        ...current,
        workflow: workflowName,
        consecutiveFailures: (current.consecutiveFailures ?? 0) + 1,
        lastStatus: "failed",
        lastRunId: runId,
        lastErrorCode: errorCode,
        lastFailureAt: new Date().toISOString(),
      });
    },
    async markBlocked(workflowName, runId, reason) {
      const current = await read(workflowName);
      return save(workflowName, {
        ...current,
        workflow: workflowName,
        lastStatus: "blocked",
        lastRunId: runId,
        lastBlockedReason: reason,
        lastBlockedAt: new Date().toISOString(),
      });
    },
  };
}
