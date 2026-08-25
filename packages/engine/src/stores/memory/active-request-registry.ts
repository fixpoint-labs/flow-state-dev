import type { ActiveRequestEntry, ActiveRequestRegistry } from "../types";
import { withActiveRequestSourceDefault } from "../shared";

export class InMemoryActiveRequestRegistry implements ActiveRequestRegistry {
  /**
   * Entries live in this process's heap and nothing else can see them, so this
   * is a definite `false` rather than a cautious one (FIX-999). This is the
   * shipped default registry, which makes it the reason the liveness gate
   * refuses out of the box.
   */
  readonly sharedAcrossProcesses = false;

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
        stale.push(withActiveRequestSourceDefault({ ...entry }));
      }
    }
    return stale;
  }

  async listAll(): Promise<ActiveRequestEntry[]> {
    return Array.from(this.entries.values()).map((e) =>
      withActiveRequestSourceDefault({ ...e })
    );
  }

  async get(requestId: string): Promise<ActiveRequestEntry | undefined> {
    const entry = this.entries.get(requestId);
    return entry === undefined
      ? undefined
      : withActiveRequestSourceDefault({ ...entry });
  }
}

export function createInMemoryActiveRequestRegistry(): ActiveRequestRegistry {
  return new InMemoryActiveRequestRegistry();
}
