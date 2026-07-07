import axios from "axios";
import { PAYCADDY_API_BASE_URL, PAYCADDY_API_KEY } from "../config.js";

export type PayCaddyResponse = {
  status: number;
  data: unknown;
};

export async function forwardToPayCaddy(path: string, body: unknown): Promise<PayCaddyResponse> {
  console.debug(PAYCADDY_API_KEY)
  const response = await axios.post(`${PAYCADDY_API_BASE_URL}${path}`, body, {
    headers: {
      "Content-Type": "application/json",
      "X-API-KEY": PAYCADDY_API_KEY,
    },
    timeout: 30_000,
    validateStatus: () => true, // caller decides what to do per status
  });

  return { status: response.status, data: response.data };
}
