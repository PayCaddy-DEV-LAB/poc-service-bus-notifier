import axios from "axios";
import crypto from "crypto";
import { ClientConfig, JitAuth } from "../config.js";
import { DeliveryResult, DeliveryStrategy } from "./types.js";

export class JitClientStrategy implements DeliveryStrategy {
  async deliver(payload: unknown, config: ClientConfig): Promise<DeliveryResult> {
    if (!config.jitAuth) {
      return { success: false, errorMessage: "JIT client missing jitAuth config" };
    }

    try {
      const body = JSON.stringify(payload);
      const headers = this.buildHeaders(body, config.jitAuth);

      const response = await axios.post(config.webhookUrl, body, {
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
        timeout: 10_000,
        validateStatus: () => true,
      });

      if (response.status >= 200 && response.status < 300) {
        return { success: true, statusCode: response.status };
      }

      return {
        success: false,
        statusCode: response.status,
        errorMessage: `HTTP ${response.status}: ${JSON.stringify(response.data).slice(0, 200)}`,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, errorMessage: message };
    }
  }

  private buildHeaders(rawBody: string, auth: JitAuth): Record<string, string> {
    switch (auth.method) {
      case "hmac": {
        const sig = crypto.createHmac("sha256", auth.secret).update(rawBody).digest("hex");
        return { "X-Signature": `sha256=${sig}` };
      }
      case "mtls":
        // TODO: create https.Agent with client cert/key and attach to axios
        // For now: no extra header — network-level auth handled by infra
        return {};
      case "oauth":
        // TODO: fetch bearer token via client_credentials grant, cache it
        return {};
    }
  }
}
