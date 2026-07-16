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
import { OpenAIVoiceProvider } from "@flow-state-dev/voice-openai";
import { vercelPostgresStores } from "@flow-state-dev/vercel/store";
import { createScheduledTransportAdapter } from "@flow-state-dev/scheduled";
import { setScheduleIndexImpl } from "@/lib/schedule-index";
import { createKitchenSinkTestModelResolver } from "@/test/mock-flowstate";
import chatAgentFlow from "@/flows/chat-agent/flow";
import richTextComponentFlow from "@/flows/rich-text-component/flow";
import weeklyDigestFlow from "@/flows/weekly-digest/flow";
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

const flowstate = createFlowState({
  flows: {
    chatAgent: chatAgentFlow,
    richTextComponent: richTextComponentFlow,
    weeklyDigest: weeklyDigestFlow,
  },
  models: {
    default: "vercel/anthropic/claude-sonnet-5",
    intents: {
      utility: [
        "vercel/google/gemini-3.1-flash-lite",
        "vercel/anthropic/claude-haiku-4.5",
        "vercel/openai/gpt-5.6-sol",
      ],
      chat: ["vercel/anthropic/claude-sonnet-5", "vercel/openai/gpt-5.6-luna"],
      plan: ["vercel/anthropic/claude-opus-4.8", "vercel/openai/gpt-5.6-terra"],
      synthesize: [
        "vercel/anthropic/claude-sonnet-5",
        "vercel/openai/gpt-5.6-luna",
        "vercel/google/gemini-2.5-pro",
      ],
      code: ["vercel/anthropic/claude-sonnet-5", "vercel/openai/gpt-5.6-luna"],
      reason: ["vercel/anthropic/claude-opus-4.8", "vercel/openai/gpt-5.6-terra"],
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
