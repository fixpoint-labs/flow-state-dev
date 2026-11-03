/**
 * A stand-in for a Postgres server's `LISTEN` / `NOTIFY`, for the bus's and
 * the listen helper's unit tests: a pool whose clients `LISTEN`, an executor
 * whose `pg_notify` reaches them, and the ways a real path fails (a pooler
 * that delivers nothing, a connection killed, one that goes quiet).
 */
import { EventEmitter } from "node:events";
import type { Pool } from "pg";
import type { QueryExecutor } from "../src/types";

export class FakeClient extends EventEmitter {
  readonly listening = new Set<string>();
  /** Set on release: whether it was handed back broken. */
  released: { broken: boolean } | undefined;
  /** A connection that stopped hearing, with no error. */
  silent = false;
  readonly statements: string[] = [];

  constructor(private readonly network: FakeNotifyNetwork) {
    super();
  }

  async query(text: string): Promise<{ rows: never[]; rowCount: number }> {
    this.statements.push(text);
    if (this.network.failListen) throw new Error("LISTEN refused");
    const [verb, channel] = text.split(/\s+/);
    if (verb === "LISTEN") this.listening.add(channel!);
    if (verb === "UNLISTEN") this.listening.delete(channel!);
    return { rows: [], rowCount: 0 };
  }

  release(broken?: boolean): void {
    if (this.released !== undefined) throw new Error("released twice");
    this.released = { broken: broken === true };
    this.network.open.delete(this);
  }

  /** The server ends the backend, as `pg_terminate_backend` does. */
  kill(): void {
    this.emit("error", new Error("terminating connection due to administrator command"));
    this.emit("end");
  }
}

export class FakeNotifyNetwork {
  /** Clients checked out and not yet released. */
  readonly open = new Set<FakeClient>();
  /** Every client ever checked out, in order. */
  readonly clients: FakeClient[] = [];
  /** Every `pg_notify` the executor ran: channel and payload. */
  readonly notified: Array<{ channel: string; payload: string }> = [];
  /** `false` is a transaction pooler: `LISTEN` succeeds, nothing is delivered. */
  deliver = true;
  /** Checkouts still to fail. */
  failConnects = 0;
  failListen = false;

  readonly executor: QueryExecutor = {
    query: async (text: string, values?: unknown[]) => {
      if (text.includes("pg_notify")) this.notify(String(values?.[0]), String(values?.[1]));
      return { rows: [], rowCount: 0 };
    }
  };

  readonly pool = {
    connect: async () => {
      if (this.failConnects > 0) {
        this.failConnects -= 1;
        throw new Error("connect refused");
      }
      const client = new FakeClient(this);
      this.open.add(client);
      this.clients.push(client);
      return client;
    }
  } as unknown as Pool;

  notify(channel: string, payload: string): void {
    this.notified.push({ channel, payload });
    if (!this.deliver) return;
    setTimeout(() => {
      for (const client of [...this.open]) {
        if (client.silent || !client.listening.has(channel)) continue;
        client.emit("notification", { channel, payload });
      }
    }, 1);
  }

  /** The clients holding `LISTEN` on `channel` now. */
  listeners(channel: string): FakeClient[] {
    return [...this.open].filter((client) => client.listening.has(channel));
  }
}

/** Wait until `check` holds, up to `ms`. */
export async function until(check: () => boolean, ms = 1_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("timed out waiting");
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}

export const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
