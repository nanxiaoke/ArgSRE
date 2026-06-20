export function createMessageSender(config) {
  if (!config?.type || config.type === "webhook-json") {
    return {
      async send(message) {
        const response = await fetch(config.endpoint, {
          method: "POST",
          headers: config.headers,
          body: JSON.stringify(message),
        });
        const responseText = await response.text();
        if (!response.ok) {
          throw new Error(
            `Message send failed: ${response.status} ${responseText}`,
          );
        }
        try {
          return JSON.parse(responseText);
        } catch {
          return { text: responseText };
        }
      },
    };
  }

  throw new Error(`Unsupported message channel type: ${config.type}`);
}
