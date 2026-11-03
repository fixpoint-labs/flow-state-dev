/**
 * One `LISTEN` connection, checked out of the tail pool: the part request
 * tails (`LISTEN flow_events`) and the change bus (`LISTEN fsd_bus`) share.
 *
 * Each caller keeps its own loop and its own end. A request tail gives up
 * after its reconnect budget; the bus never does, since a bus that stops is a
 * process whose views stop. What they share is how a connection is opened,
 * how its loss is heard, how it goes back to the pool, and the capped backoff
 * between attempts.
 */
import type { Pool, PoolClient } from "pg";

/** A held `LISTEN` connection. */
export type ListenConnection = {
  /** Whether the connection failed (an error, or the server ended it). */
  readonly lost: boolean;
  /**
   * Hand the connection back: `UNLISTEN` and back to the pool when healthy,
   * discarded when lost or `broken`. Safe to call more than once.
   */
  release(broken?: boolean): Promise<void>;
};

/**
 * Check a connection out of `pool` and `LISTEN` on `channel`.
 *
 * @param handlers.notification Called with each payload on `channel`.
 * @param handlers.lost Called once, when the connection fails after `LISTEN` succeeded.
 * @throws When the checkout or the `LISTEN` fails; the connection is discarded first.
 */
export async function openListen(
  pool: Pool,
  channel: string,
  handlers: { notification(payload: string): void; lost(): void }
): Promise<ListenConnection> {
  const client: PoolClient = await pool.connect();
  let lost = false;
  let listening = false;
  let released = false;

  const onNotification = (msg: { channel: string; payload?: string }): void => {
    if (msg.channel !== channel || msg.payload === undefined) return;
    handlers.notification(msg.payload);
  };
  const onLost = (): void => {
    if (lost) return;
    lost = true;
    if (listening && !released) handlers.lost();
  };

  const connection: ListenConnection = {
    get lost() {
      return lost;
    },
    async release(broken = false) {
      if (released) return;
      released = true;
      client.removeListener("notification", onNotification);
      try {
        if (!lost && !broken) await client.query(`UNLISTEN ${channel}`).catch(() => {});
      } finally {
        client.removeListener("error", onLost);
        client.removeListener("end", onLost);
        // `true` makes `pg` discard a broken connection instead of handing a
        // half-dead client to the next checkout.
        client.release(lost || broken ? true : undefined);
      }
    }
  };

  client.on("notification", onNotification);
  client.on("error", onLost);
  client.on("end", onLost);
  try {
    await client.query(`LISTEN ${channel}`);
  } catch (error) {
    lost = true;
    await connection.release(true);
    throw error;
  }
  listening = true;
  return connection;
}

/** The wait before reconnect attempt `attempt` (1-based): doubling from `minMs`, capped at `maxMs`. */
export function reconnectDelay(attempt: number, minMs: number, maxMs: number): number {
  return Math.min(minMs * 2 ** Math.max(0, attempt - 1), maxMs);
}
