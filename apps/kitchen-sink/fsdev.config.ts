/**
 * fsdev config — kitchen-sink runtime assembly, the single wiring consumed by
 * both the Next.js route handlers (via `lib/flowstate.ts`) and the `fsdev` CLI.
 *
 * Everything here is user configuration: registered flows, the model intent
 * ladder, voice providers, store profiles, and the error sink. Deployment glue
 * (Vercel/Neon pool tuning, schema-init skipping, live-tail polling) lives
 * behind `vercelPostgresStores()`; the lazy router and Next.js wiring live
 * behind `@flow-state-dev/vercel/next`.
 *
 * Profile selection: `FSD_ENV` picks the active profile, falling back to
 * `defaultProfile: "dev"` (in-memory) for local development and CI. Production
 * deploys set `FSD_ENV=prod` to select the Postgres-backed profile.
 *
 * Run a flow from the CLI without the browser (from this directory):
 *   pnpm fsdev run chat-agent run -i '{"message":"hi","mode":"ask"}'
 */
import { after } from "next/server";
import path from "node:path";
import { createGateway } from "@ai-sdk/gateway";
import { createFlowState, inMemoryStores, filesystemStores, type FlowState } from "@flow-state-dev/engine";
import { createSessionClient } from "@flow-state-dev/client";
import { OpenAIVoiceProvider } from "@flow-state-dev/voice-openai";
import { vercelPostgresStores } from "@flow-state-dev/vercel/store";
import { createScheduledTransportAdapter } from "@flow-state-dev/scheduled";
import { setScheduleIndexImpl } from "@/lib/schedule-index";
import {
  KITCHEN_SINK_ORG_ID,
  KITCHEN_SINK_USER_ID,
  resolveKitchenSinkPrincipal,
} from "@/lib/kitchen-sink-principal";
import { DEFAULT_KITCHEN_SINK_MODEL } from "@/lib/models";
import { createKitchenSinkTestModelResolver } from "@/test/mock-flowstate";
import chatAgentFlow from "@/flows/chat-agent/flow";
import richTextComponentFlow from "@/flows/rich-text-component/flow";
import weeklyDigestFlow from "@/flows/weekly-digest/flow";
import { buildKitchenSinkWorkforce } from "@/workforce/hire";
import {
  describePreRenameMarks,
  findPreRenameMarks,
  mergeSeatFlows,
  openMailboxes,
} from "@flow-state-dev/workforce";
import { bullmqWorker } from "@flow-state-dev/bullmq";

const gatewayApiKey = process.env.AI_GATEWAY_API_KEY;
const databaseUrl = process.env.FSD_DB_URL ?? process.env.DATABASE_URL;
const openaiApiKey = process.env.OPENAI_API_KEY;
const redisUrl = process.env.REDIS_URL;
const bullmqDispatch = process.env.FSD_BULLMQ_DISPATCH === "1";

// BullMQ execution backend for local dev (docker compose Redis). Created
// whenever REDIS_URL is set so Bull Board can mount the queue; only installed
// as the FlowState `worker` when FSD_BULLMQ_DISPATCH=1 routes actions through
// the queue. Colocated mode: the dispatcher and the worker run in this
// process, both against the runtime's resolved stores.
export const bullmq = redisUrl
  ? bullmqWorker({ connection: redisUrl })
  : undefined;

// Vercel/Neon-tuned Postgres adapter. Backs the prod profile's `primary` slot
// and exposes a same-pool `scheduleIndex` for the weekly-digest flow. Declared
// once so the schedule index is a stable reference.
const pgStores = vercelPostgresStores();

// Install the Postgres-backed schedule index behind the stable proxy the
// weekly-digest flow imports. The index no-ops until the prod profile resolves
// its pool, so this is safe regardless of the active profile (dev never builds
// the pool, leaving the proxy a no-op — matching in-memory's lack of scheduling).
setScheduleIndexImpl(pgStores.scheduleIndex);

// The team under `workforce/`, built before the runtime is assembled.
//
// Async because a worker's configuration lives in its own `WORKER.md`: the
// roster is read from files rather than written here, which is the whole point
// of the demonstration. `createFlowState({ flows })` takes a resolved map, so
// the two are reconciled by awaiting at module scope: what this app serves is
// still the single `flows` map below, and the registry's duplicate-id and
// cross-flow schema checks still run at construction.
//
// The workers are data. Their copies are one per worker flow, the same
// however many workers there are, so a worker a user hires or forks through
// the roster flow runs at once, on every process, with nothing registered and
// nothing to reload at the next boot.
//
// Both the Next.js route handlers and the `fsdev` CLI import this module, so
// both serve the same workers from the same files.
const workforce = await buildKitchenSinkWorkforce();

// A folder the loader could not read is a worker this app does not have.
// Report it once at boot rather than letting the roster come up quietly short.
for (const failedPath of workforce.errors) {
  console.error(`[workforce] could not read ${failedPath}`);
}

// One instance per mailbox KIND the tree selected, never one per mailbox — a
// mailbox kind is a singleton, so its address is its kind and every mailbox is
// a named session on it.
//
// These replace the hand-registered built-in this app used to carry: only the binder hands a kind the ledgers a roster minted, so
// an instance built by hand answers no board call however many `boards:` lines
// the tree declares.
const mailboxFlows = Object.fromEntries(
  workforce.mailboxFlows.map((instance) => [instance.id, instance])
);

// The workforce's copies are addressed by their flow's kind (`agent`, and
// `workforce-roster` for the roster flow). A session with a worker is a session
// on its flow's copy, created naming the worker. `mergeSeatFlows` refuses a
// copy at an id a flow of this app already holds rather than letting it
// replace that flow.
const flowstate = createFlowState({
  flows: mergeSeatFlows(
    {
      ...mailboxFlows,
      chatAgent: chatAgentFlow,
      richTextComponent: richTextComponentFlow,
      weeklyDigest: weeklyDigestFlow,
    },
    workforce.copies
  ),
  models: {
    default: DEFAULT_KITCHEN_SINK_MODEL,
    intents: {
      utility: [
        "vercel/google/gemini-3.1-flash-lite",
        "vercel/anthropic/claude-haiku-4.5",
        "vercel/openai/gpt-5.4-nano",
      ],
      chat: ["vercel/anthropic/claude-sonnet-5", "vercel/openai/gpt-5.6-luna"],
      plan: ["vercel/anthropic/claude-opus-4.8", "vercel/openai/gpt-5.6-sol"],
      synthesize: [
        "vercel/anthropic/claude-sonnet-5",
        "vercel/openai/gpt-5.6-terra",
        "vercel/google/gemini-2.5-pro",
      ],
      code: ["vercel/anthropic/claude-sonnet-5", "vercel/openai/gpt-5.6-terra"],
      reason: ["vercel/anthropic/claude-opus-4.8", "vercel/openai/gpt-5.6-sol"],
    },
    // Bind the gateway explicitly: the resolver's dynamic require() path
    // doesn't run in bundled Next.js, so a static instance is required.
    gateways: gatewayApiKey
      ? { vercel: createGateway({ apiKey: gatewayApiKey }) }
      : undefined,
  },
  // E2E runs with mocked generators; production builds a real resolver.
  modelResolver:
    process.env.KITCHEN_SINK_TEST_MODE === "1"
      ? createKitchenSinkTestModelResolver()
      : undefined,
  // Only wire voice when a key is present. `new OpenAIVoiceProvider()`
  // constructs an `OpenAI` client eagerly, and the SDK throws "Missing
  // credentials" with no `OPENAI_API_KEY` — which would crash module load
  // (and Next.js page-data collection for the flows route) in CI / E2E
  // builds that run without the key. Mirrors the conditional `gateways`
  // wiring above.
  voice: openaiApiKey
    ? { provider: new OpenAIVoiceProvider({ apiKey: openaiApiKey }) }
    : undefined,
  stores: {
    prod: { primary: pgStores, scheduler: pgStores },
    // `STORE_TYPE=filesystem` opts the local profile into on-disk persistence
    // (`.fsdev/data`); otherwise dev runs against ephemeral in-memory stores.
    dev: {
      primary:
        process.env.STORE_TYPE === "filesystem"
          ? filesystemStores({ rootDir: path.join(process.cwd(), ".fsdev", "data") })
          : inMemoryStores(),
    },
  },
  // Default to the Postgres profile whenever a database URL is configured
  // (the deployed/Vercel case), so persistence works without a separate
  // FSD_ENV. Local dev with no DB falls back to in-memory. An explicit
  // FSD_ENV always overrides this default.
  defaultProfile: databaseUrl ? "prod" : "dev",
  // Scheduled dispatches are fire-and-forget; keep the serverless function
  // alive until runAction settles so results persist after the 202. `after`
  // (from next/server) throws if called outside a Next request scope, so the
  // hook is wired only under the Next runtime — the `fsdev` CLI, which imports
  // this config, sets no NEXT_RUNTIME and runs synchronously to completion.
  onBackgroundWork: process.env.NEXT_RUNTIME
    ? (promise) => after(() => promise)
    : undefined,
  // Schema/recovery scans on cold start can exhaust the serverless pool before
  // real requests are served.
  detectInterruptedOnStartup: !databaseUrl,
  // Durable execution (FIX-140/141). Builds the checkpoint durability provider
  // from the active profile's stores, so actions marked `durable: true` (e.g.
  // chat-agent's `requestApproval` HITL gate) get ctx.suspend() and
  // checkpoint-based resume. The retention sweeper bounds checkpoint/suspension/
  // lease growth; a 60s cadence here makes its effect observable in dev.
  durable: true,
  durabilityRetention: { sweepIntervalMs: 60_000 },
  // Enable the gated debug endpoints (incl. the DevTool Suspensions list) for
  // local dev only. Deployed (DB present) stays fail-closed / env-gated.
  debugEndpointsEnabled: databaseUrl ? undefined : true,
  // The embedded DevTool at /devtool reads them with same-origin GETs, which
  // carry no Origin header; admit those locally too. Deployed stays closed.
  debugAllowAnonymousLocal: databaseUrl ? undefined : true,
  // FSD_BULLMQ_DISPATCH=1 routes all action dispatches through the BullMQ
  // queue instead of running in-process. Requires REDIS_URL. The adapter
  // wires the dispatcher and the co-located worker against the same resolved
  // runtime the router uses.
  worker: bullmqDispatch ? bullmq : undefined,
  adapters: [createScheduledTransportAdapter()],
  // Who every caller is, for every flow that brings no resolver of its own:
  // the assistant's flow, the workforce's copies, every mailbox. One
  // organization and one user, both constants, read from nothing on the
  // request (`lib/kitchen-sink-principal.ts`). `weekly-digest` keeps its own.
  resolvePrincipal: resolveKitchenSinkPrincipal,
  onError: (error, ctx) => {
    console.error(`[flowstate] ${ctx.method} ${ctx.path}:`, error.message);
  },
});

const runtime = await flowstate.getRuntime();

// ---------------------------------------------------------------------------
// The mailboxes the tree declared, opened.
//
// After `createFlowState`, not beside the workforce build above, because opening a
// mailbox is a session create and there is no session route until the
// FlowState exists. Awaited at module scope for the reason the build is: both
// the Next route handlers and the `fsdev` CLI import this module, so finishing
// here is what guarantees no request arrives before the mailboxes are open.
//
// Unguarded on every boot, deliberately. Opening is idempotent — an open
// mailbox is left exactly as it is — and the board list is the one thing
// re-opening carries, so a "first boot only" flag would strand a board added
// to a `MAILBOX.md` later.
// ---------------------------------------------------------------------------

/**
 * Who every mailbox session belongs to: the app's one user.
 *
 * A session belongs to one user, so a mailbox does too. The session route takes
 * its owner from the resolved principal, which is `KITCHEN_SINK_USER_ID` for
 * every caller, so opening the mailboxes as anyone else would make the binder
 * refuse its own sessions on the next boot.
 */
const MAILBOX_OWNER = KITCHEN_SINK_USER_ID;

// The session client, over this app's own router rather than over the network:
// the app is the server, so a loopback fetcher hands the request straight to
// the handler the Next route would have called.
const mailboxSessions = createSessionClient({
  fetcher: async (input, init) => {
    const router = await flowstate.getRouter();
    // The client builds `/api/flows/...`; the catch-all handler takes the
    // segments beneath that prefix as its `path` param.
    const url = new URL(String(input), "http://kitchen-sink.local");
    const path = url.pathname
      .replace(/^\/api\/flows\/?/, "")
      .split("/")
      .filter((segment) => segment.length > 0)
      .map(decodeURIComponent);
    const method = (init?.method ?? "GET").toUpperCase();
    if (method !== "GET" && method !== "POST" && method !== "PATCH" && method !== "DELETE") {
      throw new Error(`[workforce] the mailbox session client does not issue ${method}`);
    }
    return await router[method](new Request(url, init), { params: { path } });
  },
});

/** What to do about a store this app will not open: the same for every reason it refuses one. */
const RESET_THE_STORE =
  `Earlier data is not carried over. Delete the store and restart: for the dev profile ` +
  `(STORE_TYPE=filesystem) remove .fsdev/data; for the prod profile, point FSD_DB_URL at an empty database.`;

// A store written before this app named its organization holds its mailbox
// sessions under the framework's development organization, and this app can
// neither open nor read them. There is no upgrade path: the store is wiped and
// the app starts fresh. So the boot stops here and says so, naming every such
// mailbox, instead of failing on the first one with a bare 403 from the open
// below. It only reads: it writes, moves and deletes nothing, so two processes
// booting over the same store at once cannot race each other here.
{
  const stale: string[] = [];
  for (const mailbox of workforce.mailboxes) {
    const stored = await runtime.stores.session.get(mailbox.id);
    // A session stored with no organization at all (BP-030) is not this app's either.
    if (stored !== undefined && stored.orgId !== KITCHEN_SINK_ORG_ID) {
      stale.push(`"${mailbox.id}" (organization "${stored.orgId ?? "none"}")`);
    }
  }
  if (stale.length > 0) {
    throw new Error(
      `[workforce] this store was written before kitchen-sink ran as organization ` +
        `"${KITCHEN_SINK_ORG_ID}", and its mailboxes belong to another organization: ` +
        `${stale.join(", ")}. ${RESET_THE_STORE}`,
    );
  }
}

// A store written before mailboxes were renamed holds sessions, transcript
// lines and inventory rows under names nothing reads any more, so it is not
// carried over either. Same answer as above: stop, name each mark, say how to
// reset. Keyed on the store rather than the kind, because a custom kind kept
// its name through the rename. Reads only.
{
  const marks = await findPreRenameMarks(runtime.stores, {
    mailboxIds: workforce.mailboxes.map((mailbox) => mailbox.id),
    orgIds: [KITCHEN_SINK_ORG_ID],
  });
  if (marks.sessions.length > 0 || marks.organizations.length > 0) {
    throw new Error(`[workforce] this store was ${describePreRenameMarks(marks)}. ${RESET_THE_STORE}`);
  }
}

await openMailboxes(workforce.mailboxes, {
  client: {
    createSession: mailboxSessions.createSession,
    deleteSession: mailboxSessions.deleteSession,
    // The binder reads the mailbox's raw state to tell an open mailbox from an
    // empty one, and the session route sends a client only the state its flow
    // exposes. So the occupant is read from the store, as the checks above
    // read it: single-tenant, so the storage key is the bare id.
    getSession: async (sessionId) => {
      const stored = await runtime.stores.session.get(sessionId);
      if (stored === undefined) throw new Error(`[workforce] no session "${sessionId}" behind the taken id`);
      return stored;
    },
  },
  userId: MAILBOX_OWNER,
});

export default flowstate;

// `next dev` re-evaluates this module on every HMR edit, building a fresh
// FlowState (and, under dispatch mode, a fresh BullMQ worker) each time.
// Dispose the previous generation so its worker stops consuming the queue
// and its pools close — otherwise stale workers accumulate and can claim
// jobs against orphaned stores. Production evaluates once; this is a no-op
// there. Deliberately NOT the cache-on-globalThis pattern: caching would
// freeze flows/config until restart, defeating the source-HMR dev loop.
const hmr = globalThis as typeof globalThis & {
  __fsdFlowstate?: FlowState;
  __fsdShutdownRegistered?: boolean;
};
if (hmr.__fsdFlowstate !== undefined) {
  void hmr.__fsdFlowstate.dispose();
}
hmr.__fsdFlowstate = flowstate;

// Runtime init is lazy; warm it eagerly under dispatch mode so the colocated
// worker consumes the queue from boot rather than from the first web request.
// dispose() drains the worker and closes the queue before the stores.
if (bullmq && bullmqDispatch) {
  void flowstate.ready().then(() => {
    console.log("[flowstate] BullMQ worker adapter active (all actions route through queue)");
  });

  // Register signal handlers once per process (not per HMR generation —
  // process.on accumulates listeners across re-evaluations otherwise) and
  // always dispose the CURRENT generation via the globalThis slot.
  if (hmr.__fsdShutdownRegistered !== true) {
    hmr.__fsdShutdownRegistered = true;
    const shutdown = () => { void hmr.__fsdFlowstate?.dispose(); };
    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
  }
}
