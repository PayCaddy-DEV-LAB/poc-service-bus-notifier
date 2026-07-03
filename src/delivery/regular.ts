import axios from "axios";
import { ClientConfig } from "../config.js";
import { DeliveryResult, DeliveryStrategy } from "./types.js";

export class RegularClientStrategy implements DeliveryStrategy {
  async deliver(payload: unknown, config: ClientConfig): Promise<DeliveryResult> {
    try {
      const response = await axios.post(config.webhookUrl, payload, {
        headers: {
          "Content-Type": "application/json",
          ...(config.apiKey ? { "X-Api-Key": config.apiKey } : {}),
        },
        timeout: 10_000,
        validateStatus: () => true, // handle status codes ourselves
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
}
