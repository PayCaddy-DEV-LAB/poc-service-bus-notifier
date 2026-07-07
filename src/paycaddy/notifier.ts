import { ServiceBusClient, ServiceBusSender } from "@azure/service-bus";
import { v4 as uuid } from "uuid";
import { SERVICEBUS_CONNECTION_STRING, SERVICEBUS_TOPIC } from "../config.js";

// Hardcoded notification target for the PoC
export const POC_CLIENT_ID = "a41315dd-fdee-4ff3-a0c9-01905aa9dc2c";

let sbClient: ServiceBusClient | null = null;
let sender: ServiceBusSender | null = null;

function getSender(): ServiceBusSender {
  if (!sender) {
    sbClient = new ServiceBusClient(SERVICEBUS_CONNECTION_STRING);
    sender = sbClient.createSender(SERVICEBUS_TOPIC);
  }
  return sender;
}

export async function publishEvent(eventType: string, data: unknown): Promise<string> {
  const messageId = uuid();

  await getSender().sendMessages({
    messageId,
    body: {
      eventType,
      data,
      timestamp: new Date().toISOString(),
    },
    contentType: "application/json",
    subject: eventType,
    // clientId as application property — this is what SQL filters evaluate
    applicationProperties: { clientId: POC_CLIENT_ID },
  });

  return messageId;
}

export async function closeNotifier(): Promise<void> {
  await sender?.close();
  await sbClient?.close();
  sender = null;
  sbClient = null;
}
