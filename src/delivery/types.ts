import { ClientConfig } from "../config.js";

export type DeliveryResult = {
  success: boolean;
  statusCode?: number;
  errorMessage?: string;
};

export interface DeliveryStrategy {
  deliver(payload: unknown, config: ClientConfig): Promise<DeliveryResult>;
}

// Imported lazily to avoid circular deps — strategies import config, not the other way around.
let _regular: DeliveryStrategy | null = null;
let _jit: DeliveryStrategy | null = null;

export async function strategyFor(config: ClientConfig): Promise<DeliveryStrategy> {
  if (config.type === "regular") {
    if (!_regular) {
      const { RegularClientStrategy } = await import("./regular.js");
      _regular = new RegularClientStrategy();
    }
    return _regular;
  }
  if (!_jit) {
    const { JitClientStrategy } = await import("./jit.js");
    _jit = new JitClientStrategy();
  }
  return _jit;
}
