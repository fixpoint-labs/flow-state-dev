/**
 * The user's own keys for the Lab's MCP servers, through the Lab's
 * `/api/flows/mcp-credentials` route (`teams/devteam/mcp-credentials.mts`).
 *
 * A read answers each server the Lab offers and when the user's key for it
 * was set, never the key. A set sends the key once and gets back only when it
 * was set; nothing here keeps it.
 */
import { withBearerToken } from "@flow-state-dev/devtool/react";
import type { Connection } from "./connection";
import type { Failure } from "./reads";

/** One server the Lab offers, and when this user's key for it was set (`null`: not set). */
export type McpServerKey = { name: string; setAt: string | null };

/** What a read found: the servers, a Lab that offers none, or a failure. */
export type McpKeysRead = { servers: McpServerKey[] } | { none: true } | { failure: Failure };

/** Where the Lab's route lives, under the engine's own `/api/flows` mount: the route and this client both read it. */
export const MCP_CREDENTIALS_PATH = "/api/flows/mcp-credentials";

const pathOf = (connection: Connection, server?: string) =>
  `${connection.baseUrl ?? ""}${MCP_CREDENTIALS_PATH}${server === undefined ? "" : `/${encodeURIComponent(server)}`}`;

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
export async function readMcpKeys(connection: Connection): Promise<McpKeysRead> {
  try {
    const response = await fetchAs(connection)(pathOf(connection), { headers: { accept: "application/json" } });
    // A Lab that offers no MCP servers serves no such route.
    if (response.status === 404) return { none: true };
    if (!response.ok) return { failure: await failureOf(response) };
    const body = (await response.json()) as { servers: McpServerKey[] };
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
