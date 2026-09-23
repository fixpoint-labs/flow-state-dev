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
 *   pnpm fsdev run kitchen-sink chat-agent -i '{"message":"hi","mode":"ask"}'
 */
import { after } from "next/server";
import path from "node:path";
import { createGateway } from "@ai-sdk/gateway";
import { createFlowState, inMemoryStores, filesystemStores, type FlowState } from "@flow-state-dev/engine";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { createSessionClient } from "@flow-state-dev/client";
import { OpenAIVoiceProvider } from "@flow-state-dev/voice-openai";
import { vercelPostgresStores } from "@flow-state-dev/vercel/store";
import { createScheduledTransportAdapter } from "@flow-state-dev/scheduled";
import { setScheduleIndexImpl } from "@/lib/schedule-index";
import { setWorkforceRegistrarImpl, workforceRegistrar } from "@/lib/workforce-registrar";
import { admitReloadedSeats } from "@/lib/roster-reload-report";
import { adminCredentialConfigured } from "@/lib/workforce-admin-auth";
import { DEFAULT_KITCHEN_SINK_MODEL } from "@/lib/models";
import { createKitchenSinkTestModelResolver } from "@/test/mock-flowstate";
import chatAgentFlow from "@/flows/chat-agent/flow";
import richTextComponentFlow from "@/flows/rich-text-component/flow";
import weeklyDigestFlow from "@/flows/weekly-digest/flow";
import workforceAdminFlow from "@/flows/workforce-admin/flow";
import { hireKitchenSinkWorkforce, kitchenSinkKinds } from "@/workforce/hire";
import { openChannels, reloadHiredSeats } from "@flow-state-dev/workforce";
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

// The team under `workforce/`, hired before the runtime is assembled.
//
// Hiring is async because a seat's configuration lives in its own `WORKER.md`:
// the roster is read from files rather than written here, which is the whole
// point of the demonstration. `createFlowState({ flows })` takes a resolved
// map, so the two are reconciled by awaiting at module scope rather than by
// registering into a running FlowState:
//
//   - One declaration stays one declaration. What this app serves is still the
//     single `flows` map below, and the registry's duplicate-id and cross-flow
//     schema checks still run at construction — a bad seat fails the boot
//     instead of the first request that happens to address it.
//   - An async boot is also the half a durable roster needs: reloading
//     previously hired seats out of the store on the next boot is another
//     await on this line. Adding a seat to an *already running* app is a
//     different question, with ordering and in-flight-request consequences
//     this app cannot answer by itself, and is left to FIX-1475.
//
// Both the Next.js route handlers and the `fsdev` CLI import this module, so
// both serve the same seats from the same files.
const workforce = await hireKitchenSinkWorkforce();

// A folder the loader could not read is a seat this app does not have. Report
// it once at boot rather than letting the roster come up quietly short.
for (const failedPath of workforce.errors) {
  console.error(`[workforce] could not read ${failedPath}`);
}

// Seats are addressed by their own ids (`support.ada`, `support.grace`, …),
// which is what a caller puts on the URL and what `fsdev run` takes.
const seatFlows = Object.fromEntries(
  workforce.seats.map((seat) => [seat.id, seat])
);

// The admin path is registered ONLY when a credential is configured, which is
// what makes it fail closed: a default deployment has no `workforce-admin`
// address at all, rather than one standing behind a check somebody could get
// wrong. The module is imported either way — importing it registers nothing.
const adminFlows: Record<string, FlowInstance<any, any>> = adminCredentialConfigured()
  ? { workforceAdmin: workforceAdminFlow }
  : {};

// One instance per channel KIND the tree selected, never one per channel — a
// channel kind is a singleton, so its address is its kind and every channel is
// a named session on it. `seatFlows` above goes the other way, one entry per
// seat, because a seat kind is a `collection` and every seat is its own
// addressable copy. Both lines follow the kind's declared cardinality; neither
// is this app choosing a convention.
//
// These replace the hand-registered built-in this app used to carry: only the binder hands a kind the ledgers a roster minted, so
// an instance built by hand answers no board call however many `boards:` lines
// the tree declares.
const channelFlows = Object.fromEntries(
  workforce.channelFlows.map((instance) => [instance.id, instance])
);

const flowstate = createFlowState({
  flows: {
    ...channelFlows,
    chatAgent: chatAgentFlow,
    richTextComponent: richTextComponentFlow,
    weeklyDigest: weeklyDigestFlow,
    ...seatFlows,
    ...adminFlows,
  },
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
  // FSD_BULLMQ_DISPATCH=1 routes all action dispatches through the BullMQ
  // queue instead of running in-process. Requires REDIS_URL. The adapter
  // wires the dispatcher and the co-located worker against the same resolved
  // runtime the router uses.
  worker: bullmqDispatch ? bullmq : undefined,
  adapters: [createScheduledTransportAdapter()],
  onError: (error, ctx) => {
    console.error(`[flowstate] ${ctx.method} ${ctx.path}:`, error.message);
  },
});

// ---------------------------------------------------------------------------
// The durable half: seats hired while a PREVIOUS run of this app was serving.
//
// After `createFlowState`, not beside the file hire above, because the stores
// only exist once the FlowState does. Awaited at module scope for the reason
// the file hire is: both the Next route handlers and the `fsdev` CLI import
// this module, so finishing here is what guarantees no request arrives
// mid-reload and sees a roster that is half-loaded.
//
// Seats are admitted ONE AT A TIME. A batch keeps the earlier entries when a
// later one is refused and ends there, so one refusable row would take the rest
// of the roster with it and fail the boot — which is the degrade rule broken by
// mechanism rather than by intent.
//
// The cost this accepts, stated rather than hidden: resolving the runtime here
// opens the store pool at module load instead of on the first request. A
// durable roster cannot be served without reading it before the first request,
// so the eager open is the price of the feature rather than an oversight.
// ---------------------------------------------------------------------------
const runtime = await flowstate.getRuntime();

// Install the admission door behind the proxy the admin flow imports. Before
// the reload, so the two go through one seam rather than two.
setWorkforceRegistrarImpl({
  register: (flow) => flowstate.register(flow),
  unregister: (id) => flowstate.unregister(id),
  // From the runtime's registry because `FlowState` publishes no read of what
  // holds an address — `meta.flowKeys` answers which ids, not which kinds.
  // Recorded as a follow-up rather than quietly normalised.
  kindAt: (id) => runtime.registry.get(id)?.kind,
});

/**
 * What the boot brought back, and what it could not.
 *
 * The log lines below print it. The browser does not read this: the shell's
 * roster panel reads the per-organization report `admitReloadedSeats` writes.
 *
 * `reportErrors` is kept apart from `problems`: a report that failed to write
 * describes a seat that *was* admitted, so it must never inflate the "stored
 * seat(s) could not be brought back" count below.
 */
export const hiredRosterReload: { seats: string[]; problems: string[]; reportErrors: string[] } = {
  seats: [],
  problems: [],
  reportErrors: [],
};

{
  // The app names which organizations to reload — the framework cannot, because
  // there is no org-filtered read path to inherit. Here that is every org this
  // deployment has a record for; `orgId` rather than `id`, since the record's
  // id is a storage key that carries the flow when org state is isolated.
  // Deliberately every stored org, not just the ones with a configured admin
  // credential: a hired seat should keep running after its org's token is
  // rotated out of `WORKFORCE_ADMIN_TOKENS`, since firing it is a separate act
  // from revoking who can hire and fire.
  const orgIds = [
    ...new Set((await runtime.stores.org.list()).map((record) => record.orgId)),
  ].sort();

  const reload = await reloadHiredSeats({
    stores: runtime.stores,
    orgIds,
    kinds: kitchenSinkKinds,
  });
  hiredRosterReload.problems.push(...reload.problems);

  // One organization at a time, so a refusal is filed under the organization
  // the seat was hired for. Each organization's report is written to its own
  // scope, which is where the shell's roster panel reads it. Refusals also go
  // into the flat list above, which is what the log lines below print.
  const admitted = await admitReloadedSeats({
    reload,
    stores: runtime.stores,
    // Through the registrar, not `flowstate.register`: these seats came from
    // roster rows, and that provenance is what `fire` checks before it
    // releases an address (BR-28). Registering them directly would leave
    // every reloaded seat unfireable after a restart.
    admit: (seat) =>
      workforceRegistrar.registerFromRoster(
        seat,
        seat.ownerPin !== undefined ? { pin: seat.ownerPin } : undefined
      ),
  });
  hiredRosterReload.seats.push(...admitted.seats);
  hiredRosterReload.problems.push(...admitted.problems);
  hiredRosterReload.reportErrors.push(...admitted.reportErrors);

  if (hiredRosterReload.seats.length > 0) {
    console.log(
      `[workforce] reloaded ${hiredRosterReload.seats.length} hired seat(s): ${hiredRosterReload.seats.join(", ")}`,
    );
  }
  for (const problem of hiredRosterReload.problems) {
    console.error(`[workforce] skipped a hired seat — ${problem}`);
  }
  if (hiredRosterReload.problems.length > 0) {
    console.error(
      `[workforce] ${hiredRosterReload.problems.length} stored seat(s) could not be brought back; ` +
        `the rest of the roster is serving`,
    );
  }
  // A report-write failure is not a skipped seat — the seat above is running.
  // Only the roster panel's picture of it, for that one organization, is
  // stale until the next boot.
  for (const reportError of hiredRosterReload.reportErrors) {
    console.error(`[workforce] a roster boot report could not be written — ${reportError}`);
  }
}

// ---------------------------------------------------------------------------
// The channels the tree declared, opened.
//
// After `createFlowState`, not beside the file hire above, because opening a
// channel is a session create and there is no session route until the
// FlowState exists. Awaited at module scope for the reason the hire is: both
// the Next route handlers and the `fsdev` CLI import this module, so finishing
// here is what guarantees no request arrives before the channels are open.
//
// Unguarded on every boot, deliberately. Opening is idempotent — an open
// channel is left exactly as it is — and the board list is the one thing
// re-opening carries, so a "first boot only" flag would strand a board added
// to a `CHANNEL.md` later.
// ---------------------------------------------------------------------------

/**
 * Who every channel session belongs to.
 *
 * A session belongs to one user, so a channel does too — and sessions are
 * per-user, so this value decides who can SEE the channels at all. It has to be
 * the id this app's callers use: `app/page.tsx` and `app/devtool/page.tsx` both
 * call as `devuser` (overridden per test by `?e2eUserId=`), so a channel opened
 * under any other id is one the app ships and none of its own pages can list.
 * That is a reachability rule rather than an authentication one, and it binds
 * here, where nothing is verified. An app that authenticates should open its
 * channels as an identity its callers actually resolve to.
 *
 * Deliberately a literal rather than an import from `app/`: this module is the
 * runtime assembly and the pages are its consumers, so importing upward would
 * invert the dependency. V13 of the goal check reads both and fails on drift.
 */
const CHANNEL_OWNER = "devuser";

// The session client, over this app's own router rather than over the network:
// the app is the server, so a loopback fetcher hands the request straight to
// the handler the Next route would have called.
const channelSessions = createSessionClient({
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
      throw new Error(`[workforce] the channel session client does not issue ${method}`);
    }
    return await router[method](new Request(url, init), { params: { path } });
  },
});

await openChannels(workforce.channels, {
  client: channelSessions,
  userId: CHANNEL_OWNER,
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
