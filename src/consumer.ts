import { ServiceBusClient, ServiceBusReceivedMessage, ServiceBusReceiver } from "@azure/service-bus";
import crypto from "crypto";
import {
  CLIENT_REGISTRY,
  ClientConfig,
  SERVICEBUS_CONNECTION_STRING,
  SERVICEBUS_TOPIC,
} from "./config.js";
import { logDelivery } from "./db.js";
import { strategyFor } from "./delivery/types.js";

function payloadHash(payload: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

async function processMessage(
  msg: ServiceBusReceivedMessage,
  receiver: ServiceBusReceiver,
  config: ClientConfig
) {
  const messageId = msg.messageId as string;
  const payload = msg.body as unknown;
  const eventType = (msg.subject ?? (payload as Record<string, unknown>)?.eventType ?? "unknown") as string;
  const attempt = (msg.deliveryCount ?? 0) + 1;

  console.log(`[consumer] received  clientId=${config.clientId}  messageId=${messageId}  attempt=${attempt}`);

  const strategy = await strategyFor(config);
  const result = await strategy.deliver(payload, config);

  if (result.success) {
    await receiver.completeMessage(msg);
    logDelivery({
      message_id: messageId,
      client_id: config.clientId,
      event_type: eventType,
      payload_hash: payloadHash(payload),
      status: "DELIVERED",
      attempt,
      http_status: result.statusCode ?? null,
      error_message: null,
    });
    console.log(`[consumer] delivered  clientId=${config.clientId}  messageId=${messageId}  status=${result.statusCode}`);
  } else {
    await receiver.abandonMessage(msg);
    logDelivery({
      message_id: messageId,
      client_id: config.clientId,
      event_type: eventType,
      payload_hash: payloadHash(payload),
      status: "FAILED",
      attempt,
      http_status: result.statusCode ?? null,
      error_message: result.errorMessage ?? null,
    });
    console.log(
      `[consumer] failed  clientId=${config.clientId}  messageId=${messageId}  attempt=${attempt}  error=${result.errorMessage}`
    );
  }
}

async function main() {
  const sbClient = new ServiceBusClient(SERVICEBUS_CONNECTION_STRING);
  const receivers: ServiceBusReceiver[] = [];

  for (const config of Object.values(CLIENT_REGISTRY)) {
    const subscriptionName = `client-${config.clientId}`;
    const receiver = sbClient.createReceiver(SERVICEBUS_TOPIC, subscriptionName, {
      receiveMode: "peekLock",
    });

    receiver.subscribe(
      {
        processMessage: (msg) => processMessage(msg, receiver, config),
        processError: async (err) => {
          console.error(`[consumer] broker error  clientId=${config.clientId}:`, err.error);
        },
      },
      { maxConcurrentCalls: 1 }
    );

    receivers.push(receiver);
    console.log(`[consumer] listening on subscription ${subscriptionName}`);
  }

  const shutdown = async (signal: string) => {
    console.log(`\n[consumer] ${signal} received — shutting down...`);
    await Promise.all(receivers.map((r) => r.close()));
    await sbClient.close();
    console.log("[consumer] closed");
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  console.log("[consumer] ready — press Ctrl+C to stop");
}

main().catch((err) => {
  console.error("[consumer] fatal:", err);
  process.exit(1);
});
