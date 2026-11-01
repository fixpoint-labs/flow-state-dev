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
 * Profile selection: an explicit `FSD_ENV` wins. Without it, the Postgres-backed
 * `prod` profile is picked whenever `FSD_DB_URL` or `DATABASE_URL` is set, and
 * the SQLite-backed `dev` profile otherwise. A database URL also closes the
 * DevTool's debug endpoints and skips the interrupted-run scan, whichever
 * profile is active, so a stray `FSD_DB_URL` in a local shell moves dev onto
 * Postgres. The `[flowstate]` line logged at startup names what was picked.
 *
 * Run a flow from the CLI without the browser (from this directory):
 *   pnpm fsdev run chat-agent run -i '{"message":"hi","mode":"ask"}'
 */
import { after } from "next/server";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { createGateway } from "@ai-sdk/gateway";
import { createFlowState, inMemoryStores, filesystemStores, type FlowState, type StoreAdapter } from "@flow-state-dev/engine";
import type { FlowInstance } from "@flow-state-dev/core";
import { OpenAIVoiceProvider } from "@flow-state-dev/voice-openai";
import { vercelPostgresStores } from "@flow-state-dev/vercel/store";
import { sqliteStores } from "@flow-state-dev/store-sqlite";
import { createScheduledTransportAdapter } from "@flow-state-dev/scheduled";
import { setScheduleIndexImpl } from "@/lib/schedule-index";
import { resolveKitchenSinkPrincipal } from "@/lib/kitchen-sink-principal";
import { DEFAULT_KITCHEN_SINK_MODEL } from "@/lib/models";
import { createKitchenSinkTestModelResolver } from "@/lib/test-model-resolver";
import chatAgentFlow from "@/flows/chat-agent/flow";
import richTextComponentFlow from "@/flows/rich-text-component/flow";
import weeklyDigestFlow from "@/flows/weekly-digest/flow";
import { buildKitchenSinkWorkforce } from "@/workforce/hire";
import { availableHarnessFlows } from "@/lib/harness-gate";
import { claudeCodeSessionFlow } from "@/lib/claude-code-mode";
import { codexSessionFlow } from "@/lib/codex-mode";
import { cursorSessionFlow } from "@/lib/cursor-mode";
import { afterStoredWorkUpgrade } from "@/lib/stored-work-upgrade";
import { mergeWorkerFlows } from "@flow-state-dev/workforce";
import { bullmqWorker } from "@flow-state-dev/bullmq";

const gatewayApiKey = process.env.AI_GATEWAY_API_KEY;
/**
 * The local SQLite store, its folder made when the store is first used, not when
 * this file loads: a deployment on Postgres never opens it and may not be able
 * to write here. SQLite opens a file in a folder that exists, and a fresh
 * checkout has no `.fsdev/data`.
 */
function localSqliteStores(): StoreAdapter {
  const dir = path.join(process.cwd(), ".fsdev", "data");
  let inner: StoreAdapter | undefined;
  return {
    capabilities: ["primary"],
    resolve(slots) {
      if (inner === undefined) {
        mkdirSync(dir, { recursive: true });
        inner = sqliteStores({ filename: path.join(dir, "flowstate.db") });
      }
      return inner.resolve(slots);
    },
    dispose() {
      return inner?.dispose?.();
    },
  };
}

const databaseUrl = process.env.FSD_DB_URL ?? process.env.DATABASE_URL;
const openaiApiKey = process.env.OPENAI_API_KEY;
const redisUrl = process.env.REDIS_URL;
const bullmqDispatch = process.env.FSD_BULLMQ_DISPATCH === "1";
// Durable execution, read by `createFlowState` and the startup line alike.
const durable = true;
// The `dev` profile's store: SQLite unless `STORE_TYPE` asks for another.
const devStore =
  process.env.STORE_TYPE === "memory"
    ? "memory"
    : process.env.STORE_TYPE === "filesystem"
      ? "filesystem"
      : "sqlite";

// BullMQ execution backend for local dev (docker compose Redis). Created
// whenever REDIS_URL is set so Bull Board can mount the queue; only installed
// as the FlowState `worker` when FSD_BULLMQ_DISPATCH=1 routes actions through
// the queue. Colocated mode: the runner and the worker run in this
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
// the pool, leaving the proxy a no-op, so nothing is scheduled outside prod).
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

// Each coding harness mode's session flow, registered only while that mode is
// available on this host (`lib/harness-gate.ts`): on a host that can't run a
// mode, `/api/flows/<its flow>/…` is not found, so the picker is not the only
// fence. Decided once per server start, the same answer the picker reads.
// A mode's issue adds its flow here, by mode id.
const harnessFlows = await availableHarnessFlows<FlowInstance<any, any>>({
  "claude-code": claudeCodeSessionFlow,
  codex: codexSessionFlow,
  cursor: cursorSessionFlow,
});

// The workforce's copies are addressed by their flow's name (`agent`,
// `coordinator`, and `workforce-roster` for the roster flow). A session with a
// worker is a session on its flow's copy, created naming the worker: a
// user's conversation with `support.help` is a session on `coordinator`.
// `mergeWorkerFlows` refuses a copy at an id a flow of this app already holds
// rather than letting it replace that flow.
const flowstate = createFlowState({
  flows: mergeWorkerFlows(
    {
      chatAgent: chatAgentFlow,
      richTextComponent: richTextComponentFlow,
      weeklyDigest: weeklyDigestFlow,
      ...harnessFlows,
    },
    workforce.copies
  ),
  models: {
    default: DEFAULT_KITCHEN_SINK_MODEL,
    intents: {
      utility: [
        "vercel:google/gemini-3.1-flash-lite",
        "vercel:anthropic/claude-haiku-5.5",
        "vercel:openai/gpt-6-luna",
      ],
      chat: ["vercel:anthropic/claude-sonnet-5.5", "vercel:openai/gpt-6-luna"],
      plan: ["vercel:anthropic/claude-opus-5.5", "vercel:openai/gpt-6-astra"],
      synthesize: [
        "vercel:anthropic/claude-sonnet-5.5",
        "vercel:openai/gpt-6.1-sol",
        "vercel:google/gemini-2.5-pro",
      ],
      code: ["vercel:anthropic/claude-sonnet-5.5", "vercel:openai/gpt-6.1-sol"],
      reason: ["vercel:anthropic/claude-opus-5.5", "vercel:openai/gpt-6-astra"],
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
    // The local profile persists to SQLite (`.fsdev/data/flowstate.db`) so
    // sessions and hired workers survive a restart. `STORE_TYPE=memory` opts
    // into ephemeral in-memory stores (tests, e2e); `STORE_TYPE=filesystem`
    // keeps the JSON-file store.
    dev: {
      primary:
        devStore === "memory"
          ? inMemoryStores()
          : devStore === "filesystem"
            ? filesystemStores({ rootDir: path.join(process.cwd(), ".fsdev", "data") })
            : localSqliteStores(),
    },
  },
  // Default to the Postgres profile whenever a database URL is configured
  // (the deployed/Vercel case), so persistence works without a separate
  // FSD_ENV. Local dev with no DB gets the SQLite `dev` profile. An explicit
  // FSD_ENV always overrides this default; the gates below still follow the
  // database URL, not the profile.
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
  // Durable execution is on by default wherever stores persist (Postgres,
  // SQLite, filesystem). `true` also forces it on under `STORE_TYPE=memory`
  // (tests, e2e), where its stops are lost when the process ends. The
  // retention sweeper bounds checkpoint/suspension/lease growth; a 60s
  // cadence makes it observable.
  durable,
  durabilityRetention: { sweepIntervalMs: 60_000 },
  // Enable the gated debug endpoints (incl. the DevTool Suspensions list) for
  // local dev only. Deployed (DB present) stays fail-closed / env-gated.
  debugEndpointsEnabled: databaseUrl ? undefined : true,
  // The embedded DevTool at /devtool reads them with same-origin GETs, which
  // carry no Origin header; admit those locally too. Deployed stays closed.
  debugAllowAnonymousLocal: databaseUrl ? undefined : true,
  // FSD_BULLMQ_DISPATCH=1 routes all action dispatches through the BullMQ
  // queue instead of running in-process. Requires REDIS_URL. The adapter
  // wires the runner and the co-located worker against the same resolved
  // runtime the router uses.
  worker: bullmqDispatch ? bullmq : undefined,
  adapters: [createScheduledTransportAdapter()],
  // Who every caller is, for every flow that brings no resolver of its own:
  // the assistant's flow and the workforce's copies. One
  // organization and one user, both constants, read from nothing on the
  // request (`lib/kitchen-sink-principal.ts`). `weekly-digest` keeps its own.
  resolvePrincipal: resolveKitchenSinkPrincipal,
  onError: (error, ctx) => {
    console.error(`[flowstate] ${ctx.method} ${ctx.path}:`, error.message);
  },
});

// Which store this process runs on, said once per start (and once per HMR
// re-evaluation, which builds a fresh FlowState). Reading `activeProfile`
// resolves `FSD_ENV` now, so a profile name that isn't declared fails the
// start here rather than at the first request. Written to stderr: the `fsdev`
// CLI imports this config and keeps stdout for its NDJSON.
const activeProfile = flowstate.activeProfile;
const activeStore = activeProfile === "prod" ? "postgres" : devStore;
console.error(
  `[flowstate] profile=${activeProfile} store=${activeStore} durable=${durable} interruptedScan=${!databaseUrl}`,
);

// The workforce's stored-work upgrade runs before the first router (`lib/stored-work-upgrade.ts`).
// Every caller gets this handle; only the HMR slot below keeps the raw one, to dispose it.
const upgradedFlowstate = afterStoredWorkUpgrade(flowstate);
export default upgradedFlowstate;

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
  // Through the upgraded handle, so the stored-work upgrades run before the
  // router and its sweep. A failed upgrade fails the start: the host refuses
  // to serve records it can't resume.
  upgradedFlowstate.ready().then(
    () => {
      console.log("[flowstate] BullMQ worker adapter active (all actions route through queue)");
    },
    (error: unknown) => {
      console.error("[flowstate] start failed:", error instanceof Error ? error.message : error);
      process.exit(1);
    },
  );

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
