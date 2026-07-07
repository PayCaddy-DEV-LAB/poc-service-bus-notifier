import "dotenv/config";

export type JitAuth =
  | { method: "hmac"; secret: string }
  | { method: "mtls"; certPath: string; keyPath: string }
  | { method: "oauth"; tokenUrl: string; clientId: string; clientSecret: string };

export type ClientConfig = {
  clientId: string;
  type: "regular" | "jit";
  webhookUrl: string;
  apiKey?: string;
  jitAuth?: JitAuth;
};

export const CLIENT_REGISTRY: Record<string, ClientConfig> = {
  acme: {
    clientId: "acme",
    type: "regular",
    webhookUrl: process.env.ACME_WEBHOOK_URL ?? "http://localhost:3001/webhook",
    apiKey: "test-key-acme",
  },
  firstbank: {
    clientId: "firstbank",
    type: "jit",
    webhookUrl: process.env.FIRSTBANK_WEBHOOK_URL ?? "http://localhost:3002/webhook",
    jitAuth: {
      method: "hmac",
      secret: "bank-hmac-secret",
    },
  },
  // PoC client notified by the api-client mock server (hardcoded target)
  "a41315dd-fdee-4ff3-a0c9-01905aa9dc2c": {
    clientId: "a41315dd-fdee-4ff3-a0c9-01905aa9dc2c",
    type: "regular",
    webhookUrl: process.env.POC_WEBHOOK_URL ?? "http://localhost:3001/webhook",
    apiKey: "test-key-acme",
  },
};

export const SERVICEBUS_CONNECTION_STRING =
  process.env.SERVICEBUS_CONNECTION_STRING ??
  "Endpoint=sb://localhost;SharedAccessKeyName=RootManageSharedAccessKey;SharedAccessKey=SAS_KEY_VALUE;UseDevelopmentEmulator=true;";

export const SERVICEBUS_TOPIC = process.env.SERVICEBUS_TOPIC ?? "webhook-events";

export const DB_PATH = process.env.DB_PATH ?? "./data/tracking.db";

export const PAYCADDY_API_BASE_URL =
  process.env.PAYCADDY_API_BASE_URL ?? "https://int.api.paycaddy.dev";

export const PAYCADDY_API_KEY = process.env.PAYCADDY_API_KEY ?? "";
