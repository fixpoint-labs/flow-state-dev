import type { ActiveRequestEntry, ActiveRequestRegistry } from "../types";

export class InMemoryActiveRequestRegistry implements ActiveRequestRegistry {
  private readonly entries = new Map<string, ActiveRequestEntry>();

  async register(entry: ActiveRequestEntry): Promise<void> {
    this.entries.set(entry.requestId, { ...entry });
  }

  async heartbeat(requestId: string): Promise<void> {
    const entry = this.entries.get(requestId);
    if (entry !== undefined) {
      entry.lastHeartbeatAt = Date.now();
    }
  }

  async deregister(requestId: string): Promise<void> {
    this.entries.delete(requestId);
  }

  async listStale(thresholdMs: number): Promise<ActiveRequestEntry[]> {
    const cutoff = Date.now() - thresholdMs;
    const stale: ActiveRequestEntry[] = [];
    for (const entry of this.entries.values()) {
      if (entry.lastHeartbeatAt < cutoff) {
        stale.push({ ...entry });
      }
    }
    return stale;
  }

  async listAll(): Promise<ActiveRequestEntry[]> {
    return Array.from(this.entries.values()).map((e) => ({ ...e }));
  }

  async get(requestId: string): Promise<ActiveRequestEntry | undefined> {
    const entry = this.entries.get(requestId);
    return entry === undefined ? undefined : { ...entry };
  }
}

export function createInMemoryActiveRequestRegistry(): ActiveRequestRegistry {
  return new InMemoryActiveRequestRegistry();
}
