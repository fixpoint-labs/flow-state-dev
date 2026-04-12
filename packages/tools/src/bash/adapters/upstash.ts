/**
 * Upstash Box adapter — placeholder.
 *
 * Blocked on Upstash Box API stabilization. See FIX-314 / FIX-315 for the
 * real implementation. This file provides the adapter factory so the type
 * system stays consistent.
 */

import type { Sandbox, CommandResult } from "../types";

/** Shape expected from the Upstash Box client once the API stabilizes. */
export interface UpstashBoxClient {
  id: string;
  exec(command: string): Promise<{ stdout: string; stderr: string; exitCode: number }>;
  read(path: string): Promise<string>;
  write(path: string, content: string): Promise<void>;
  destroy(): Promise<void>;
}

/** Wraps an Upstash Box client into the Sandbox interface. */
export function createUpstashAdapter(client: UpstashBoxClient): Sandbox {
  return {
    executeCommand: (cmd) => client.exec(cmd),
    readFile: (p) => client.read(p),
    writeFile: (p, c) => client.write(p, c),
    stop: () => client.destroy(),
  };
}

/**
 * Resolves an Upstash Box — placeholder that throws until FIX-315 ships.
 */
export async function resolveUpstashBox(
  _boxId?: string,
): Promise<{ sandbox: Sandbox; sandboxId: string }> {
  throw new Error(
    "Upstash Box adapter is not yet implemented. See FIX-314 / FIX-315.",
  );
}
