import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { withRetry } from "../core/retry.js";

export function createMessageSender(config, options = {}) {
  if (!config?.type || config.type === "webhook-json") {
    return {
      async send(message, sendOptions = {}) {
        let attempts = 0;
        const result = await withRetry(
          async () => {
            const response = await fetch(config.endpoint, {
              method: "POST",
              headers: {
                ...config.headers,
                ...(sendOptions.idempotencyKey
                  ? { "Idempotency-Key": sendOptions.idempotencyKey }
                  : {}),
              },
              body: JSON.stringify(message),
              signal: AbortSignal.timeout(
                options.retry?.timeoutMs ?? 30000,
              ),
            });
            const responseText = await response.text();
            if (!response.ok) {
              const error = new Error(
                `Message send failed: ${response.status} ${responseText}`,
              );
              error.status = response.status;
              throw error;
            }
            try {
              return JSON.parse(responseText);
            } catch {
              return { text: responseText };
            }
          },
          {
            maxAttempts: options.retry?.maxAttempts ?? 1,
            baseDelayMs: options.retry?.baseDelayMs ?? 250,
            maxDelayMs: options.retry?.maxDelayMs ?? 5000,
            shouldRetry(error) {
              return !error.status || error.status === 429 || error.status >= 500;
            },
            onAttempt({ attempt }) {
              attempts = attempt;
            },
          },
        );
        return { result, attempts };
      },
    };
  }

  if (config.type === "local-file") {
    if (!options.outputDirectory) {
      throw new Error("local-file sender requires outputDirectory");
    }
    return {
      async send(message, sendOptions = {}) {
        await mkdir(options.outputDirectory, { recursive: true });
        const fileName = `${sendOptions.fileName ?? message.type ?? "message"}.json`;
        const path = join(options.outputDirectory, fileName);
        await writeFile(path, `${JSON.stringify(message, null, 2)}\n`, "utf8");
        return {
          result: { accepted: true, localFile: path },
          attempts: 1,
        };
      },
    };
  }

  throw new Error(`Unsupported message channel type: ${config.type}`);
}
