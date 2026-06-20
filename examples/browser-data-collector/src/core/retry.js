export async function withRetry(action, options = {}) {
  const {
    maxAttempts = 1,
    baseDelayMs = 250,
    maxDelayMs = 5000,
    shouldRetry = () => true,
    onAttempt,
  } = options;

  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      onAttempt?.({ attempt, maxAttempts });
      return await action({ attempt, maxAttempts });
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts || !shouldRetry(error)) throw error;
      const delay = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
      await new Promise((resolveWait) => setTimeout(resolveWait, delay));
    }
  }
  throw lastError;
}
