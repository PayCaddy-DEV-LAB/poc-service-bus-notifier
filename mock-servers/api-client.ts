import "dotenv/config";
import express, { Request, Response } from "express";
import { forwardToPayCaddy } from "../src/paycaddy/client.js";
import { publishEvent, closeNotifier, POC_CLIENT_ID } from "../src/paycaddy/notifier.js";

const PORT = parseInt(process.env.API_CLIENT_PORT ?? "3003", 10);

const app = express();
app.use(express.json());

async function passthrough(req: Request, res: Response, path: string, eventType: string) {
  try {
    const { status, data } = await forwardToPayCaddy(path, req.body);

    if (status >= 200 && status < 300) {
      try {
        const messageId = await publishEvent(eventType, data);
        console.log(
          `[api-client] ${status} ${path}  published ${eventType}  messageId=${messageId}  clientId=${POC_CLIENT_ID}`
        );
      } catch (err) {
        // The resource was already created upstream; don't fail the caller over the notification
        console.error(`[api-client] publish failed for ${eventType}:`, err);
      }
    } else {
      console.log(`[api-client] ${status} ${path}  no notification`);
    }

    res.status(status).json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[api-client] upstream error on ${path}: ${message}`);
    res.status(502).json({ error: "upstream request failed", detail: message });
  }
}

app.post("/v2/SR/EndUserSRs", (req, res) => passthrough(req, res, "/v2/SR/EndUserSRs", "enduser.created"));
app.post("/v1/wallets", (req, res) => passthrough(req, res, "/v1/wallets", "wallet.created"));
app.post("/v1/debitCards", (req, res) => passthrough(req, res, "/v1/debitCards", "card.created"));

// PoC-only: publish any event directly to the bus without calling the real API
app.post("/mock/:eventType", async (req: Request, res: Response) => {
  const eventType = req.params.eventType;
  try {
    const messageId = await publishEvent(eventType, req.body);
    console.log(`[api-client] mock published  eventType=${eventType}  messageId=${messageId}  clientId=${POC_CLIENT_ID}`);
    res.json({ ok: true, messageId, eventType, clientId: POC_CLIENT_ID });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[api-client] mock publish failed for ${eventType}:`, err);
    res.status(500).json({ error: "publish failed", detail: message });
  }
});

app.listen(PORT, () => {
  console.log(`[api-client] listening on http://localhost:${PORT}`);
});

process.on("SIGINT", async () => {
  await closeNotifier();
  process.exit(0);
});
