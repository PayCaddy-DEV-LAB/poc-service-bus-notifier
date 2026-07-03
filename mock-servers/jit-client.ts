import "dotenv/config";
import express, { Request, Response } from "express";
import crypto from "crypto";

const PORT = parseInt(process.env.JIT_CLIENT_PORT ?? "3002", 10);
const HMAC_SECRET = "bank-hmac-secret";

const app = express();

// Must capture the raw buffer before JSON parsing so HMAC can be verified
// over the exact bytes the sender signed.
app.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  (req: Request, res: Response) => {
    const rawBody = req.body as Buffer;
    const sigHeader = req.headers["x-signature"] as string | undefined;

    if (!sigHeader) {
      console.log("[jit-client] 401  missing X-Signature header");
      res.status(401).json({ error: "missing signature" });
      return;
    }

    const expected = `sha256=${crypto.createHmac("sha256", HMAC_SECRET).update(rawBody).digest("hex")}`;
    const sigBuffer = Buffer.from(sigHeader);
    const expectedBuffer = Buffer.from(expected);

    if (
      sigBuffer.length !== expectedBuffer.length ||
      !crypto.timingSafeEqual(sigBuffer, expectedBuffer)
    ) {
      console.log(`[jit-client] 401  invalid HMAC (got: ${sigHeader})`);
      res.status(401).json({ error: "invalid signature" });
      return;
    }

    const body = JSON.parse(rawBody.toString("utf8")) as Record<string, unknown>;

    if (body?.simulateFailure === true) {
      console.log("[jit-client] 500  simulated failure");
      res.status(500).json({ error: "simulated failure" });
      return;
    }

    console.log("[jit-client] 200  received:", JSON.stringify(body));
    res.status(200).json({ received: true });
  }
);

app.listen(PORT, () => {
  console.log(`[jit-client] listening on http://localhost:${PORT}`);
});
