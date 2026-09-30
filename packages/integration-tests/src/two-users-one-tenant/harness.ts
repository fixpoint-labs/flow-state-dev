/**
 * The two-users-one-tenant HTTP suite's server: a real `@flow-state-dev/node`
 * server on a loopback port, backed by the SQLite store adapter, with a
 * host-level principal resolver that stands in for an app's real one (JWT,
 * session cookie). Two users, `alice` and `bob`, share one tenant and one
 * organization, so the only thing separating their records is the user.
 *
 * Every case in this suite asks for a hole the way an attacker would: over
 * HTTP, as the second user, with an id learned from the first user's
 * response. A case imports only from package entry points — never `src`, a
 * store, or an engine function — so the same files can run against installed
 * tarballs. Each case owns its own flows; this file owns only the server and
 * the callers.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FlowInstance } from "@flow-state-dev/core";
import {
  createFlowApiRouter,
  createFlowRegistry,
  type InboundTransportAdapter
} from "@flow-state-dev/engine";
import { serve, type ServeHandle } from "@flow-state-dev/node";
import { createSQLiteStores, type SQLiteStoreRegistry } from "@flow-state-dev/store-sqlite";

/** The tenant both users share. */
export const TENANT_ID = "tenant_shared";
/** The organization both users share. */
export const ORG_ID = "org_shared";
/** The header the stand-in resolver reads the verified user from. */
const USER_HEADER = "x-verified-user";

/** One running server and the two callers that talk to it. */
export type TwoUserServer = {
  /** Base URL of the flow API, e.g. `http://127.0.0.1:1234/api/flows`. */
  readonly api: string;
  /** A `fetch` that authenticates as `userId` in the shared tenant. */
  as(userId: string): (path: string, init?: RequestInit) => Promise<Response>;
  /**
   * The server's stores. Only for leaving a record the way an older release
   * wrote it, before a case probes it over HTTP; a probe never uses them.
   */
  readonly stores: SQLiteStoreRegistry;
  /** Stop the server and delete its database. */
  close(): Promise<void>;
};

/** What a case may turn on in the server, beyond the defaults every case gets. */
export type TwoUserServerOptions = {
  /** Serve the session debug routes, as a development deployment does. */
  debugEndpointsEnabled?: boolean;
  /**
   * Inbound transports mounted beside HTTP, for a case whose hole depends on
   * which transport a request arrived on.
   */
  adapters?: InboundTransportAdapter[];
  /**
   * The organization the resolver names for every caller. Defaults to
   * {@link ORG_ID}. `null` stands in for an app whose resolver verifies the
   * user but names no organization.
   */
  orgId?: string | null;
};

/**
 * Start a server hosting `flows`. Call `close()` in `afterEach`/`afterAll`.
 */
export async function startTwoUserServer(
  flows: FlowInstance[],
  options: TwoUserServerOptions = {}
): Promise<TwoUserServer> {
  const orgId = options.orgId === undefined ? ORG_ID : options.orgId;
  const dir = await mkdtemp(join(tmpdir(), "fsd-two-users-"));
  const stores: SQLiteStoreRegistry = createSQLiteStores({ filename: join(dir, "store.db") });
  const registry = createFlowRegistry();
  registry.registerMany(flows);
  const router = createFlowApiRouter({
    registry,
    stores,
    adapters: options.adapters,
    ...(options.debugEndpointsEnabled === undefined
      ? {}
      : { debugEndpointsEnabled: options.debugEndpointsEnabled }),
    resolvePrincipal: (context) => {
      const userId = context.request?.headers.get(USER_HEADER);
      if (userId == null || userId === "") return null;
      return orgId === null ? { userId } : { userId, orgId };
    }
  });
  const handle: ServeHandle = await serve(router, {
    port: 0,
    host: "127.0.0.1",
    handleSignals: false,
    shutdownGraceMs: 100
  });
  const api = `http://127.0.0.1:${handle.port}/api/flows`;

  return {
    api,
    stores,
    as: (userId) => (path, init) =>
      fetch(`${api}${path}`, {
        ...init,
        headers: {
          "content-type": "application/json",
          "x-tenant-id": TENANT_ID,
          [USER_HEADER]: userId,
          ...(init?.headers as Record<string, string> | undefined)
        }
      }),
    close: async () => {
      await handle.close();
      stores.close();
      await rm(dir, { recursive: true, force: true });
    }
  };
}

/** Poll `probe` until it returns a value, or fail after `timeoutMs`. */
export async function waitFor<T>(
  probe: () => Promise<T | undefined>,
  what: string,
  timeoutMs = 5_000
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}
