import "dotenv/config";
import express from "express";

const PORT = parseInt(process.env.REGULAR_CLIENT_PORT ?? "3001", 10);
const EXPECTED_API_KEY = "test-key-acme";

const app = express();
app.use(express.json());

app.post("/webhook", (req, res) => {
  const apiKey = req.headers["x-api-key"];

  if (apiKey !== EXPECTED_API_KEY) {
    console.log(`[regular-client] 401  missing or wrong X-Api-Key (got: ${apiKey})`);
    res.status(401).json({ error: "invalid api key" });
    return;
  }

  const body = req.body as Record<string, unknown>;

  if (body?.simulateFailure === true) {
    console.log("[regular-client] 500  simulated failure");
    res.status(500).json({ error: "simulated failure" });
    return;
  }

  console.log("[regular-client] 200  received:", JSON.stringify(body));
  res.status(200).json({ received: true });
});

app.listen(PORT, () => {
  console.log(`[regular-client] listening on http://localhost:${PORT}`);
});
