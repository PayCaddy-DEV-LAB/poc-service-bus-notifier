import { ServiceBusClient } from "@azure/service-bus";
import { v4 as uuid } from "uuid";
import { SERVICEBUS_CONNECTION_STRING, SERVICEBUS_TOPIC, CLIENT_REGISTRY } from "./config.js";

function parseArgs(): { clientId: string; eventType: string; count: number } {
  const args = process.argv.slice(2);
  const get = (flag: string, fallback: string) => {
    const i = args.indexOf(flag);
    return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
  };
  const clientId = get("--clientId", "acme");
  const eventType = get("--eventType", "payment.completed");
  const count = parseInt(get("--count", "1"), 10);
  return { clientId, eventType, count };
}

async function main() {
  const { clientId, eventType, count } = parseArgs();

  if (!CLIENT_REGISTRY[clientId]) {
    console.error(`Unknown clientId: "${clientId}". Known clients: ${Object.keys(CLIENT_REGISTRY).join(", ")}`);
    process.exit(1);
  }

  const client = new ServiceBusClient(SERVICEBUS_CONNECTION_STRING);
  const sender = client.createSender(SERVICEBUS_TOPIC);

  try {
    for (let i = 0; i < count; i++) {
      const messageId = uuid();
      const body = {
        eventType,
        data: { amount: 100 + i, currency: "USD", reference: `REF-${messageId.slice(0, 8).toUpperCase()}` },
        timestamp: new Date().toISOString(),
      };

      await sender.sendMessages({
        messageId,
        body,
        contentType: "application/json",
        subject: eventType,
        // clientId as application property — this is what SQL filters evaluate
        applicationProperties: { clientId },
      });

      console.log(`[producer] sent  messageId=${messageId}  clientId=${clientId}  eventType=${eventType}`);
    }
  } finally {
    await sender.close();
    await client.close();
  }
}

main().catch((err) => {
  console.error("[producer] fatal:", err);
  process.exit(1);
});
