/**
 * The user's own keys for the Lab's MCP servers, through the connector keys
 * route a Lab's project blocks serve (workforce's `defineProjectBlocks().connectorKeys`).
 *
 * A read answers each server the Lab offers and when the user's key for it
 * was set, never the key. A set sends the key once and gets back only when it
 * was set; nothing here keeps it.
 */
import { withBearerToken } from "@flow-state-dev/devtool/react";
import { useCallback, useEffect, useState } from "react";
import { CONNECTOR_KEYS_PATH, type ConnectorKeyStatus } from "@flow-state-dev/workforce/browser";
import type { Connection } from "./connection";
import type { Failure } from "./failure";
import { useLab } from "./lab-data";

/** What a read found: each server the Lab offers with when the user's key for it was set, a Lab that offers none, or a failure. */
type KeysRead = { servers: ConnectorKeyStatus[] } | { none: true } | { failure: Failure };

const pathOf = (connection: Connection, server?: string) =>
  `${connection.baseUrl ?? ""}${CONNECTOR_KEYS_PATH}${server === undefined ? "" : `/${encodeURIComponent(server)}`}`;

/**
 * The connection's fetch, its bearer token on every request. This is the
 * Lab's own route, not a flow route, so it is called directly rather than
 * through the client.
 */
const fetchAs = (connection: Connection): typeof fetch => withBearerToken(connection.bearerToken) ?? fetch;

/** A failed answer's status and the Lab's message, never the request's body. */
async function failureOf(response: Response): Promise<Failure> {
  const body = (await response.json().catch(() => undefined)) as { message?: unknown } | undefined;
  return { httpStatus: response.status, message: typeof body?.message === "string" ? body.message : response.statusText };
}

/** Read which servers the Lab offers and which of them this user has a key for. */
async function readMcpKeys(connection: Connection): Promise<KeysRead> {
  try {
    const response = await fetchAs(connection)(pathOf(connection), { headers: { accept: "application/json" } });
    // A Lab that offers no MCP servers serves no such route.
    if (response.status === 404) return { none: true };
    if (!response.ok) return { failure: await failureOf(response) };
    const body = (await response.json()) as { servers: ConnectorKeyStatus[] };
    return { servers: body.servers };
  } catch (error) {
    return { failure: { message: error instanceof Error ? error.message : String(error) } };
  }
}

/**
 * Set this user's key for `server`, or clear it (`value: null`).
 *
 * @returns `undefined` when the Lab took it, or why it refused.
 */
export async function writeMcpKey(connection: Connection, server: string, value: string | null): Promise<Failure | undefined> {
  try {
    const response = await fetchAs(connection)(
      pathOf(connection, server),
      value === null
        ? { method: "DELETE", headers: { accept: "application/json" } }
        : {
            method: "POST",
            headers: { accept: "application/json", "content-type": "application/json" },
            body: JSON.stringify({ value }),
          },
    );
    return response.ok ? undefined : await failureOf(response);
  } catch (error) {
    return { message: error instanceof Error ? error.message : String(error) };
  }
}

/** The user's keys, read when the screen opens and again on `reread` (after a set or a clear). `undefined` until read. */
export function useMcpKeys(): { read: KeysRead | undefined; reread: () => void } {
  const { connection } = useLab();
  const [read, setRead] = useState<KeysRead | undefined>(undefined);
  const reread = useCallback(() => {
    void readMcpKeys(connection).then(setRead);
  }, [connection]);
  useEffect(reread, [reread]);
  return { read, reread };
}
