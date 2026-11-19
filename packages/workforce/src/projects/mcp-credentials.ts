// BP-015.
/**
 * Each user's own keys for the MCP servers a host offers.
 *
 *   mcp-credentials/<server>    at user scope: one record per server the user set a key for
 *
 * A record is `{ value, setAt }`. Its existence is what "set" means; `setAt`
 * is when. The value is the key as the user wrote it, unencrypted, in the
 * host's store: anyone who can read that store can read it.
 *
 * **Write-only from outside.** A browser read of the collection exposes
 * `setAt` alone, so no client field, page or response carries a value.
 * The value is also declared `secret`, which keeps it out of the engine's
 * debug reads, the one path that ignores `expose`.
 * The writes go around the action pipeline, since an action's input is kept
 * on its request record: a host writes a record through its own route
 * ({@link mcpCredentialProblem} checks the value), and the one reader of the
 * value is the shared resolution that connects a run's or a worker's servers
 * (`projectMcpTools`, `projectMcpCapability`), on the server.
 *
 * Held by the block a coding run asks its tools from, and by a worker's model
 * block when it carries `projectMcpCapability` ({@link mcpCredentialsCapability}).
 * The collection is not `llmReadable`, so no resource tool lists or reads it.
 *
 * This key prefix is a public surface: moving it loses every stored key.
 *
 * **The route.** {@link connectorKeysAdapter} is that write path, which
 * `defineProjectBlocks` hands a host as `connectorKeys`: an inbound transport
 * adapter, so no request is dispatched and no record is written, and the
 * value goes to one place, the caller's record.
 *
 *     GET    CONNECTOR_KEYS_PATH            → { servers: [{ name, setAt }] }
 *     POST   CONNECTOR_KEYS_PATH/<server>   { value } → { name, setAt }
 *     DELETE CONNECTOR_KEYS_PATH/<server>   → { name, setAt: null }
 *
 * The caller is the user the projects flow's sign-in verifies from the
 * request, never a field of the body or the path; one it can't
 * verify is refused before anything is read. No answer, refusal or log line
 * carries a value.
 */

import { defineCapability, defineResourceCollection } from "@flow-state-dev/core";
import { PrincipalResolutionError, resolveSharedUserCellKey } from "@flow-state-dev/engine/host";
import type { InboundTransportAdapter, InboundTransportHost } from "@flow-state-dev/engine/host";
import { z } from "zod";
import { CONNECTOR_KEYS_PATH, PROJECTS_FLOW } from "./project-keys";

/** The resource-map ref the keys are declared under. */
export const MCP_CREDENTIALS_RESOURCE = "mcpCredentials";

/** The keys' storage prefix, at user scope: a record's key is `mcp-credentials/<server>`. */
export const MCP_CREDENTIALS_PREFIX = "mcp-credentials/";

/** One stored key: the value as written, and when it was set (ISO 8601). */
export const mcpCredentialSchema = z.object({
  value: z.string(),
  setAt: z.string()
});

/** @see mcpCredentialSchema */
export type McpCredential = z.infer<typeof mcpCredentialSchema>;

const MCP_CREDENTIALS_COLLECTION = defineResourceCollection({
  pattern: "mcp-credentials/*",
  scope: "user",
  // Shared across flows: the host's write and the run's read are on different flows.
  flowIsolation: false,
  prefetchMode: "lazy",
  stateSchema: mcpCredentialSchema,
  // The key never leaves the server, debug reads included; a run reads it through the handle.
  secret: ["value"],
  client: { state: { read: true }, expose: ["setAt"] }
});

/**
 * The keys collection, at `mcp-credentials/*` in each user's own scope. The
 * same declaration every call returns, so two blocks that hold it meet in one
 * flow without a conflict.
 */
export function defineMcpCredentialsCollection() {
  return MCP_CREDENTIALS_COLLECTION;
}

/** The keys collection, for the block a coding run's tools are resolved on. */
export const mcpCredentialsCapability = defineCapability({
  name: "mcp-credentials",
  resources: { [MCP_CREDENTIALS_RESOURCE]: MCP_CREDENTIALS_COLLECTION }
});

/** The longest key a record takes. */
const MAX_CREDENTIAL_LENGTH = 4096;

/**
 * Why `value` can't be stored as a key, or `undefined` when it can. Empty,
 * too long, or holding whitespace or a control character. Never repeats the
 * value.
 */
export function mcpCredentialProblem(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0) return "a key can't be empty. Clear it instead";
  if (value.length > MAX_CREDENTIAL_LENGTH) return `a key is at most ${MAX_CREDENTIAL_LENGTH} characters`;
  if (/[\s\u0000-\u001f\u007f]/.test(value)) return "a key can't contain whitespace or control characters";
  return undefined;
}

// FIX-2775 D3.
/** One offered connector, as the keys route answers it. Never the key. */
export interface ConnectorKeyStatus {
  name: string;
  /** When the caller's key for it was set, ISO 8601; `null` when it isn't. */
  setAt: string | null;
}

/** The source stamped on the principal lookups the keys route makes. */
const SOURCE = "connector-keys";

/**
 * What the keys route resolves its caller as: the projects flow, whose
 * sign-in is the host's for projects, under the route's own name as the
 * envelope's action. `connectorKeys` is a label for the resolver to read,
 * never dispatched: no action answers to it, and nothing runs under it.
 */
const RESOLVE_AS = { flowKind: PROJECTS_FLOW, action: "connectorKeys", input: {} };

/**
 * The connector keys route, as a transport adapter for
 * `createFlowState({ adapters })`. `defineProjectBlocks` builds it from its
 * own `mcpServers`, so a host keeps one list. Offering none, it serves no
 * route, and a client's read answers 404.
 *
 * @param servers The names of the connectors the host offers. A set or clear
 *   for any other name is refused, 404 `unknown-mcp-server`.
 */
export function connectorKeysAdapter(servers: readonly string[]): InboundTransportAdapter {
  const offered = [...servers];
  return {
    source: SOURCE,
    createBindings: (host) => {
      if (offered.length === 0) return {};
      const cellOf = async (req: Request): Promise<{ cell: string } | Response> => {
        try {
          const principal = await host.resolvePrincipal({ source: SOURCE, request: req, envelope: RESOLVE_AS });
          return { cell: resolveSharedUserCellKey(principal.userId, principal.orgId, PROJECTS_FLOW) };
        } catch (error) {
          if (error instanceof PrincipalResolutionError) {
            return json(error.status, { error: "unauthorized", message: error.message });
          }
          throw error;
        }
      };
      /** The caller's cell, once the named connector is one offered; or the refusal that stops the request. */
      const callerFor = async (req: Request, name: string): Promise<{ cell: string } | Response> => {
        const caller = await cellOf(req);
        if (caller instanceof Response || offered.includes(name)) return caller;
        return json(404, {
          error: "unknown-mcp-server",
          message: `"${name}" is not an MCP server this host offers. It offers: ${offered.join(", ")}.`
        });
      };

      return {
        routes: [
          {
            method: "GET",
            path: CONNECTOR_KEYS_PATH,
            handler: async (req) => {
              const caller = await cellOf(req);
              if (caller instanceof Response) return caller;
              return json(200, { servers: await connectorKeyStatuses(host, caller.cell, offered) });
            }
          },
          {
            method: "POST",
            path: `${CONNECTOR_KEYS_PATH}/:server`,
            handler: async (req, { params }) => {
              const name = params.server ?? "";
              const caller = await callerFor(req, name);
              if (caller instanceof Response) return caller;
              const value = await valueOf(req);
              const problem = typeof value === "string" ? mcpCredentialProblem(value) : 'send it as `{ "value": "<key>" }`';
              if (problem !== undefined) {
                return json(400, { error: "invalid-mcp-credential", message: `That key for "${name}" can't be stored: ${problem}.` });
              }
              const setAt = new Date().toISOString();
              await host.stores.resourceState.set("user", caller.cell, keyOf(name), { value: value as string, setAt }, "any");
              return json(200, { name, setAt } satisfies ConnectorKeyStatus);
            }
          },
          {
            method: "DELETE",
            path: `${CONNECTOR_KEYS_PATH}/:server`,
            handler: async (req, { params }) => {
              const name = params.server ?? "";
              const caller = await callerFor(req, name);
              if (caller instanceof Response) return caller;
              await host.stores.resourceState.delete("user", caller.cell, keyOf(name), "any");
              return json(200, { name, setAt: null } satisfies ConnectorKeyStatus);
            }
          }
        ]
      };
    }
  };
}

/**
 * Each offered connector, and when the user whose cell this is set a key for
 * it. Read through the store directly, and only `setAt` leaves it: what the
 * route's read answers, and what a host's start line can say.
 *
 * @param host The engine host (or runtime) whose stores hold the keys.
 * @param cell The user's cell (`resolveSharedUserCellKey`).
 * @param offered The connectors the host offers.
 */
export async function connectorKeyStatuses(
  host: Pick<InboundTransportHost, "stores">,
  cell: string,
  offered: readonly string[]
): Promise<ConnectorKeyStatus[]> {
  return Promise.all(
    offered.map(async (name) => {
      const stored = await host.stores.resourceState.get("user", cell, keyOf(name));
      const setAt = (stored?.state as { setAt?: unknown } | undefined)?.setAt;
      return { name, setAt: typeof setAt === "string" ? setAt : null };
    })
  );
}

/** The record a connector's key is stored under. */
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
