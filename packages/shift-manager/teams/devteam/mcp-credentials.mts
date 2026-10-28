/**
 * The Lab's route for a user's own MCP server keys: read which are set, set
 * one, clear one. What Shift Manager's Settings page writes through.
 *
 *     GET    /api/flows/mcp-credentials            → { servers: [{ name, setAt }] }
 *     POST   /api/flows/mcp-credentials/<server>   { value } → { name, setAt }
 *     DELETE /api/flows/mcp-credentials/<server>   → { name, setAt: null }
 *
 * **A route, not a flow action.** An action's input is kept on its request
 * record, so a key sent as an action's input would be stored beside every
 * other request. This route is a transport adapter's own: no request is
 * dispatched, no record is written, and the value goes to one place, the
 * caller's `mcp-credentials/<server>` record at user scope.
 *
 * **Whose key.** The caller is the user the Lab's principal resolver verifies
 * from the request's bearer, never a field of the body or the path (BP-031). A
 * request it can't verify is refused, 401, before anything is read.
 *
 * **Never echoed.** No answer, refusal or log line carries the value or any
 * part of it. A read answers each server's name and when its key was set.
 */

import {
  PrincipalResolutionError,
  resolveUserStorageKey,
  type InboundTransportAdapter,
  type InboundTransportHost,
} from "@flow-state-dev/engine";
import { MCP_CREDENTIALS_PREFIX, mcpCredentialProblem } from "@flow-state-dev/workforce";
import { MCP_CREDENTIALS_PATH } from "../../src/lib/mcp-credentials.ts";

/** The source stamped on the principal lookups this route makes. */
const SOURCE = "lab-mcp-credentials";

/** The flow the caller is resolved against: the Lab's projects flow, whose resolver is the Lab's. */
const RESOLVE_AS = { flowKind: "projects", action: "mcpCredentials", input: {} };

/** One offered server, as a read answers it. */
export interface McpCredentialStatus {
  name: string;
  /** When the caller's key for it was set, ISO 8601; `null` when it isn't. */
  setAt: string | null;
}

/**
 * The route, as a transport adapter for `createFlowState({ adapters })`.
 *
 * @param servers The names of the MCP servers the Lab offers. A set or clear
 *   for any other name is refused, `unknown-mcp-server`.
 * @returns The adapter.
 */
export function mcpCredentialsAdapter(servers: readonly string[]): InboundTransportAdapter {
  const offered = [...servers];
  return {
    source: SOURCE,
    createBindings: (host) => {
      const cellOf = async (req: Request): Promise<{ cell: string } | Response> => {
        try {
          const principal = await host.resolvePrincipal({ source: SOURCE, request: req, envelope: RESOLVE_AS });
          return { cell: resolveUserStorageKey(principal.userId, principal.orgId, { id: "", isolateUserState: false }) };
        } catch (error) {
          if (error instanceof PrincipalResolutionError) {
            return json(error.status, { error: "unauthorized", message: error.message });
          }
          throw error;
        }
      };
      const unknown = (name: string) =>
        json(404, {
          error: "unknown-mcp-server",
          message:
            offered.length === 0
              ? `"${name}" is not an MCP server this Lab offers: it offers none.`
              : `"${name}" is not an MCP server this Lab offers. It offers: ${offered.join(", ")}.`,
        });

      return {
        routes: [
          {
            method: "GET",
            path: MCP_CREDENTIALS_PATH,
            handler: async (req) => {
              const caller = await cellOf(req);
              if (caller instanceof Response) return caller;
              return json(200, { servers: await statusOf(host, caller.cell, offered) });
            },
          },
          {
            method: "POST",
            path: `${MCP_CREDENTIALS_PATH}/:server`,
            handler: async (req, { params }) => {
              const caller = await cellOf(req);
              if (caller instanceof Response) return caller;
              const name = params.server ?? "";
              if (!offered.includes(name)) return unknown(name);
              const value = await valueOf(req);
              const problem = typeof value === "string" ? mcpCredentialProblem(value) : "send it as `{ \"value\": \"<key>\" }`";
              if (problem !== undefined) {
                return json(400, { error: "invalid-mcp-credential", message: `That key for "${name}" can't be stored: ${problem}.` });
              }
              const setAt = new Date().toISOString();
              await host.stores.resourceState.set("user", caller.cell, keyOf(name), { value: value as string, setAt }, "any");
              return json(200, { name, setAt });
            },
          },
          {
            method: "DELETE",
            path: `${MCP_CREDENTIALS_PATH}/:server`,
            handler: async (req, { params }) => {
              const caller = await cellOf(req);
              if (caller instanceof Response) return caller;
              const name = params.server ?? "";
              if (!offered.includes(name)) return unknown(name);
              await host.stores.resourceState.delete("user", caller.cell, keyOf(name), "any");
              return json(200, { name, setAt: null });
            },
          },
        ],
      };
    },
  };
}

/**
 * Each offered server, and when the caller's key for it was set. Read
 * through the store directly, and only `setAt` leaves it.
 *
 * @param host The engine host the route runs on.
 * @param cell The caller's user cell.
 * @param offered The servers the Lab offers.
 */
export async function statusOf(
  host: Pick<InboundTransportHost, "stores">,
  cell: string,
  offered: readonly string[],
): Promise<McpCredentialStatus[]> {
  return Promise.all(
    offered.map(async (name) => {
      const stored = await host.stores.resourceState.get("user", cell, keyOf(name));
      const setAt = (stored?.state as { setAt?: unknown } | undefined)?.setAt;
      return { name, setAt: typeof setAt === "string" ? setAt : null };
    }),
  );
}

/** The record a server's key is stored under. */
const keyOf = (name: string) => `${MCP_CREDENTIALS_PREFIX}${name}`;

/** The body's `value`, or `undefined` for a body that isn't `{ value }` JSON. */
async function valueOf(req: Request): Promise<unknown> {
  try {
    const body = (await req.json()) as { value?: unknown } | null;
    return body !== null && typeof body === "object" ? body.value : undefined;
  } catch {
    return undefined;
  }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
