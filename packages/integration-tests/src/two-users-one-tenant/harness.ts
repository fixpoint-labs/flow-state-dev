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
 *
 * `startQueueDeployment` is the same server on a BullMQ host: a web runtime
 * that only enqueues, served over HTTP, and two worker runtimes that take
 * jobs off a real Redis, all over one SQLite file. Each runtime is its own
 * `createFlowState`, with its own arbiter and its own connections, standing
 * in for its own process.
 */
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FlowInstance } from "@flow-state-dev/core";
import {
  createFlowApiRouter,
  createFlowRegistry,
  createFlowState,
  createInMemoryLeaseBackend,
  type ConcurrencyLeaseBackend,
  type FlowState,
  type LeasePlace,
  type InboundTransportAdapter,
  type ResolvePrincipalFn,
  type WorkerAdapter,
  type WorkerMode
} from "@flow-state-dev/engine";
import {
  bullmqWorker,
  createBullmqRuntime,
  createRedisStreamBridge,
  createWorkerDispatcher
} from "@flow-state-dev/bullmq";
import { serve, type ServeHandle } from "@flow-state-dev/node";
import {
  createSQLiteStores,
  sqliteStores,
  type SQLiteStoreRegistry
} from "@flow-state-dev/store-sqlite";

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
    as: callerFor(api),
    close: async () => {
      await handle.close();
      stores.close();
      await rm(dir, { recursive: true, force: true });
    }
  };
}

/** A `fetch` that authenticates as `userId` in the shared tenant. */
function callerFor(api: string): TwoUserServer["as"] {
  return (userId) => (path, init) =>
    fetch(`${api}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        "x-tenant-id": TENANT_ID,
        [USER_HEADER]: userId,
        ...(init?.headers as Record<string, string> | undefined)
      }
    });
}

/** The stand-in resolver: the verified user from a header, the shared org. */
const headerPrincipal: ResolvePrincipalFn = (context) => {
  const userId = context.request?.headers.get(USER_HEADER);
  if (userId == null || userId === "") return null;
  return { userId, orgId: ORG_ID };
};

/** The Redis a queue deployment runs on, or `undefined` when none was given. */
export const REDIS_URL = process.env.REDIS_URL;

/** A BullMQ deployment's web server and the two callers that talk to it. */
export type QueueDeployment = Omit<TwoUserServer, "stores">;

/** How the deployment's lease backend is set up. */
export type QueueDeploymentOptions = {
  /**
   * `"shared"` (default): the adapter's Redis backend, one line per key for
   * every runtime. `"local"`: each runtime keeps its own lines in memory,
   * so nothing lines runs up across runtimes (a control). `"none"`: the
   * adapter supplies no backend, as an adapter that cannot arbitrate across
   * processes.
   */
  leases?: "shared" | "local" | "none";
};

/**
 * Start a BullMQ deployment hosting `flows`: a `dispatch-only` web runtime
 * served over HTTP, and two worker runtimes that each run two jobs at a
 * time. The workers are `colocated`, so work a run hands off inside a worker
 * goes back through the queue too. Needs `REDIS_URL`.
 */
export async function startQueueDeployment(
  flows: FlowInstance[],
  options: QueueDeploymentOptions = {}
): Promise<QueueDeployment> {
  if (REDIS_URL === undefined || REDIS_URL === "") {
    throw new Error("startQueueDeployment needs REDIS_URL");
  }
  const leases = options.leases ?? "shared";
  const dir = await mkdtemp(join(tmpdir(), "fsd-queue-deploy-"));
  const filename = join(dir, "store.db");
  const prefix = `fsdq-${randomUUID().slice(0, 8)}`;

  const runtimeOf = (mode: WorkerMode): FlowState => {
    let worker: WorkerAdapter;
    if (leases === "local") {
      worker = processLocalAdapter(REDIS_URL, prefix, mode);
    } else {
      const adapter = bullmqWorker({ connection: REDIS_URL, prefix, mode, concurrency: 2 });
      // Without a backend the jobs carry no place, so the worker runs them as
      // soon as it takes them.
      worker = leases === "none" ? { ...adapter, leaseBackend: undefined } : adapter;
    }
    return createFlowState({
      flows: Object.fromEntries(flows.map((flow) => [flow.id, flow])),
      stores: { default: { primary: sqliteStores({ filename }) } },
      resolvePrincipal: headerPrincipal,
      worker
    });
  };

  const web = runtimeOf("dispatch-only");
  const workers = [runtimeOf("colocated"), runtimeOf("colocated")];
  await Promise.all(workers.map((w) => w.ready()));
  const handle: ServeHandle = await serve(web, {
    port: 0,
    host: "127.0.0.1",
    handleSignals: false,
    shutdownGraceMs: 100
  });
  const api = `http://127.0.0.1:${handle.port}/api/flows`;

  return {
    api,
    as: callerFor(api),
    close: async () => {
      await handle.close();
      for (const w of workers) await w.dispose();
      await rm(dir, { recursive: true, force: true });
    }
  };
}

/**
 * The BullMQ adapter assembled from its public parts, with one lease backend
 * kept in this runtime's memory for both the engine and the worker: the
 * `local` control.
 */
function processLocalAdapter(connection: string, prefix: string, mode: WorkerMode): WorkerAdapter {
  const leaseBackend = processLocalLeases();
  const runtime = createBullmqRuntime({ connection, prefix });
  const bridge = createRedisStreamBridge({ connection });
  return {
    mode,
    leaseBackend,
    createDispatcher: () => createWorkerDispatcher({ queue: runtime.queue, bridge }),
    startWorker: (rt) => {
      const worker = runtime.createWorker({
        registry: rt.registry,
        stores: rt.stores,
        runtimeConfig: rt.runtimeConfig,
        bridge,
        concurrency: 2,
        leaseBackend
      });
      return { close: () => worker.close() };
    },
    close: () => runtime.close()
  };
}

/**
 * Lines kept in this runtime's memory only: the control that stands for a
 * lock each process holds for itself. Tickets carry the runtime's own tag,
 * so a place one runtime took is not mistaken for another's with the same
 * number: to any other runtime it is simply missing.
 */
function processLocalLeases(): ConcurrencyLeaseBackend {
  const inner = createInMemoryLeaseBackend();
  const tag = randomUUID().slice(0, 8);
  const local = (place: LeasePlace): LeasePlace | undefined =>
    place.ticket.startsWith(`${tag}-`)
      ? { key: place.key, ticket: place.ticket.slice(tag.length + 1) }
      : undefined;
  return {
    take: async (input) => {
      const taken = await inner.take(input);
      return "place" in taken
        ? { place: { key: taken.place.key, ticket: `${tag}-${taken.place.ticket}` } }
        : taken;
    },
    isMyTurn: async (place) => {
      const own = local(place);
      return own === undefined ? "missing" : inner.isMyTurn(own);
    },
    giveBack: async (place) => {
      const own = local(place);
      if (own !== undefined) await inner.giveBack(own);
    },
    renew: async (place) => (local(place) === undefined ? false : true)
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
