/**
 * Upstash Box adapter — placeholder.
 *
 * Blocked on Upstash Box API stabilization. The real implementation will
 * call methods on the injected client. The variant shape and adapter
 * factory are wired now (DI: consumer passes the client via the provider
 * config) so when the SDK ships there's no API churn — the framework's
 * invariant is that adapters wrapping third-party SDKs receive the SDK
 * from the consumer rather than dynamically importing it.
 */

import type { Sandbox, UpstashBoxClientLike } from "../types";

/** Public-facing alias for the structural client shape declared in `../types`. */
export type UpstashBoxClient = UpstashBoxClientLike;

/** Wrap an Upstash Box client into the framework's `Sandbox` interface. */
export function createUpstashAdapter(client: UpstashBoxClient): Sandbox {
  return {
    executeCommand: (cmd) => client.exec(cmd),
    readFile: (p) => client.read(p),
    writeFile: (p, c) => client.write(p, c),
    stop: () => client.destroy(),
  };
}

/**
 * Resolve an Upstash Box from the injected client. Currently throws —
 * the production code path arrives once the Upstash Box SDK is GA.
 */
export async function resolveUpstashBox(_opts: {
  client: UpstashBoxClient;
  boxId?: string;
}): Promise<{ sandbox: Sandbox; sandboxId: string }> {
  throw new Error("Upstash Box adapter is not yet implemented.");
}
