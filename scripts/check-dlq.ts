import "dotenv/config";
import { ServiceBusClient } from "@azure/service-bus";
import crypto from "crypto";
import { SERVICEBUS_CONNECTION_STRING, SERVICEBUS_TOPIC, CLIENT_REGISTRY } from "../src/config.js";
import { logDelivery } from "../src/db.js";

function parseArgs(): { clientId: string } {
  const args = process.argv.slice(2);
  const i = args.indexOf("--clientId");
  const clientId = i !== -1 && args[i + 1] ? args[i + 1] : "";
  return { clientId };
}

async function drainDlq(clientId: string) {
  const config = CLIENT_REGISTRY[clientId];
  if (!config) {
    console.error(`Unknown clientId: "${clientId}". Known: ${Object.keys(CLIENT_REGISTRY).join(", ")}`);
    process.exit(1);
  }

  const sbClient = new ServiceBusClient(SERVICEBUS_CONNECTION_STRING);
  const subscriptionName = `client-${clientId}`;

  const receiver = sbClient.createReceiver(SERVICEBUS_TOPIC, subscriptionName, {
    receiveMode: "receiveAndDelete",
    subQueueType: "deadLetter",
  });

  console.log(`\nChecking DLQ for subscription: ${subscriptionName}\n`);

  let found = 0;
  try {
    while (true) {
      const messages = await receiver.receiveMessages(10, { maxWaitTimeInMs: 3_000 });
      if (messages.length === 0) break;

      for (const msg of messages) {
        found++;
        const messageId = msg.messageId as string;
        const payload = msg.body as unknown;
        const eventType = (msg.subject ?? "unknown") as string;

        console.log(`--- DLQ message #${found} ---`);
        console.log(`  messageId:              ${messageId}`);
        console.log(`  deliveryCount:          ${msg.deliveryCount}`);
        console.log(`  deadLetterReason:       ${msg.deadLetterReason ?? "n/a"}`);
        console.log(`  deadLetterDescription:  ${msg.deadLetterErrorDescription ?? "n/a"}`);
        console.log(`  body:                   ${JSON.stringify(payload)}`);

        logDelivery({
          message_id: messageId,
          client_id: clientId,
          event_type: eventType,
          payload_hash: crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex"),
          status: "DLQ",
          attempt: msg.deliveryCount ?? 0,
          http_status: null,
          error_message: msg.deadLetterReason ?? msg.deadLetterErrorDescription ?? null,
        });
      }
    }
  } finally {
    await receiver.close();
    await sbClient.close();
  }

  if (found === 0) {
    console.log("DLQ is empty.");
  } else {
    console.log(`\nTotal DLQ messages drained: ${found}`);
  }
}

const { clientId } = parseArgs();
if (!clientId) {
  console.error("Usage: npm run check-dlq -- --clientId <clientId>");
  process.exit(1);
}

drainDlq(clientId).catch((err) => {
  console.error("[check-dlq] fatal:", err);
  process.exit(1);
});
