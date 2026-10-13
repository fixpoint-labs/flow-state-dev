/**
 * The user's own keys for the Lab's MCP servers, through the Lab's
 * `/api/flows/mcp-credentials` route (`teams/devteam/mcp-credentials.mts`).
 *
 * A read answers each server the Lab offers and when the user's key for it
 * was set, never the key. A set sends the key once and gets back only when it
 * was set; nothing here keeps it.
 */
import type { LabClients } from "./connection";
import type { Failure } from "./reads";

/** One server the Lab offers, and when this user's key for it was set (`null`: not set). */
export type McpServerKey = { name: string; setAt: string | null };

/** What a read found: the servers, a Lab that offers none, or a failure. */
export type McpKeysRead = { servers: McpServerKey[] } | { none: true } | { failure: Failure };

const pathOf = (clients: LabClients, server?: string) =>
  `${clients.baseUrl ?? ""}/api/flows/mcp-credentials${server === undefined ? "" : `/${encodeURIComponent(server)}`}`;

/** A failed answer's status and the Lab's message, never the request's body. */
async function failureOf(response: Response): Promise<Failure> {
  const body = (await response.json().catch(() => undefined)) as { message?: unknown } | undefined;
  return { httpStatus: response.status, message: typeof body?.message === "string" ? body.message : response.statusText };
}

/** Read which servers the Lab offers and which of them this user has a key for. */
export async function readMcpKeys(clients: LabClients): Promise<McpKeysRead> {
  try {
    const response = await clients.fetcher(pathOf(clients), { headers: { accept: "application/json" } });
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
export async function writeMcpKey(clients: LabClients, server: string, value: string | null): Promise<Failure | undefined> {
  try {
    const response = await clients.fetcher(
      pathOf(clients, server),
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
