/**
 * Kitchen-sink runtime assembly — the reference `createFlowState` setup.
 *
 * Replaces the hand-written `server.ts`. Everything here is user
 * configuration: registered flows, the model intent ladder, voice
 * providers, store profiles, and the error sink. Deployment glue (Vercel/Neon
 * pool tuning, schema-init skipping, live-tail polling) lives behind
 * `vercelPostgresStores()`; the lazy router and Next.js wiring live behind
 * `@flow-state-dev/vercel/next`.
 *
 * Profile selection: `FSD_ENV` picks the active profile, falling back to
 * `defaultProfile: "dev"` (in-memory) for local development and CI. Production
 * deploys set `FSD_ENV=prod` to select the Postgres-backed profile.
 */
import { after } from "next/server";
import path from "node:path";
import { createGateway } from "@ai-sdk/gateway";
import { createFlowState, createFlowRegistry, createModelResolver, createInMemoryStores, inMemoryStores, filesystemStores } from "@flow-state-dev/server";
import type { RuntimeConfig } from "@flow-state-dev/server";
import { OpenAIVoiceProvider } from "@flow-state-dev/voice-openai";
import { vercelPostgresStores } from "@flow-state-dev/vercel/store";
import { createScheduledTransportAdapter } from "@flow-state-dev/scheduled";
import { setScheduleIndexImpl } from "@/lib/schedule-index";
import { createKitchenSinkTestModelResolver } from "@/test/mock-flowstate";
import chatAgentFlow from "@/flows/chat-agent/flow";
import richTextComponentFlow from "@/flows/rich-text-component/flow";
import weeklyDigestFlow from "@/flows/weekly-digest/flow";
import { createBullmqRuntime, createRedisStreamBridge, createWorkerDispatcher } from "@flow-state-dev/bullmq";

const gatewayApiKey = process.env.AI_GATEWAY_API_KEY;
const databaseUrl = process.env.FSD_DB_URL ?? process.env.DATABASE_URL;
const openaiApiKey = process.env.OPENAI_API_KEY;
const redisUrl = process.env.REDIS_URL;
const bullmqDispatch = process.env.FSD_BULLMQ_DISPATCH === "1";

// BullMQ runtime for local dev. When REDIS_URL is set (e.g. via docker compose),
// the runtime registers a co-located worker so background jobs are durable.
// The web process enqueues and the worker runs in the same process for simplicity.
const bullmqRuntime = redisUrl
  ? createBullmqRuntime({ connection: redisUrl })
  : undefined;

// Stream bridge shared by the dispatcher (web→worker live relay) and the
// co-located worker (worker→web event push). Created once so both sides
// use the same channel prefix.
const streamBridge = redisUrl
  ? createRedisStreamBridge({ connection: redisUrl })
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

export const flowstate = createFlowState({
  flows: {
    chatAgent: chatAgentFlow,
    richTextComponent: richTextComponentFlow,
    weeklyDigest: weeklyDigestFlow,
  },
  models: {
    default: "vercel/anthropic/claude-sonnet-4.6",
    intents: {
      utility: [
        "vercel/google/gemini-3.1-flash-lite",
        "vercel/anthropic/claude-haiku-4.5",
        "vercel/openai/gpt-5.4-nano",
      ],
      chat: ["vercel/anthropic/claude-sonnet-4.6", "vercel/openai/gpt-5.5"],
      plan: ["vercel/anthropic/claude-opus-4.7", "vercel/openai/gpt-5.5"],
      synthesize: [
        "vercel/anthropic/claude-sonnet-4.6",
        "vercel/openai/gpt-5.5",
        "vercel/google/gemini-2.5-pro",
      ],
      code: ["vercel/anthropic/claude-sonnet-4.6", "vercel/openai/gpt-5.5"],
      reason: ["vercel/anthropic/claude-opus-4.7", "vercel/openai/gpt-5.5"],
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
  // alive until runAction settles so results persist after the 202.
  onBackgroundWork: (promise) => after(() => promise),
  // Schema/recovery scans on cold start can exhaust the serverless pool before
  // real requests are served.
  detectInterruptedOnStartup: false,
  // FSD_BULLMQ_DISPATCH=1 routes all action dispatches through the BullMQ
  // queue instead of running in-process. Requires REDIS_URL. Useful for
  // testing the full queue→worker→stream-bridge pipeline locally.
  dispatcher:
    bullmqDispatch && bullmqRuntime && streamBridge
      ? createWorkerDispatcher({ queue: bullmqRuntime.queue, bridge: streamBridge })
      : undefined,
  adapters: [createScheduledTransportAdapter()],
  onError: (error, ctx) => {
    console.error(`[flowstate] ${ctx.method} ${ctx.path}:`, error.message);
  },
});

// Co-located worker: when REDIS_URL is set, start a worker in the same process
// that processes enqueued jobs. Build deps from the same config used by createFlowState.
if (bullmqRuntime && redisUrl) {
  const registry = createFlowRegistry();
  registry.register(chatAgentFlow);
  registry.register(richTextComponentFlow);
  registry.register(weeklyDigestFlow);

  const stores = createInMemoryStores();

  const runtimeConfig: RuntimeConfig = {
    modelResolver:
      process.env.KITCHEN_SINK_TEST_MODE === "1"
        ? createKitchenSinkTestModelResolver()
        : createModelResolver({
            defaultModel: "vercel/anthropic/claude-sonnet-4.6",
            intents: {
              utility: [
                "vercel/google/gemini-3.1-flash-lite",
                "vercel/anthropic/claude-haiku-4.5",
                "vercel/openai/gpt-5.4-nano",
              ],
              chat: ["vercel/anthropic/claude-sonnet-4.6", "vercel/openai/gpt-5.5"],
              plan: ["vercel/anthropic/claude-opus-4.7", "vercel/openai/gpt-5.5"],
              synthesize: [
                "vercel/anthropic/claude-sonnet-4.6",
                "vercel/openai/gpt-5.5",
                "vercel/google/gemini-2.5-pro",
              ],
              code: ["vercel/anthropic/claude-sonnet-4.6", "vercel/openai/gpt-5.5"],
              reason: ["vercel/anthropic/claude-opus-4.7", "vercel/openai/gpt-5.5"],
            },
            gateways: gatewayApiKey
              ? { vercel: createGateway({ apiKey: gatewayApiKey }) }
              : undefined,
          }),
  };

  bullmqRuntime.createWorker({
    registry,
    stores,
    runtimeConfig,
    bridge: streamBridge,
  });

  console.log(
    bullmqDispatch
      ? "[flowstate] BullMQ co-located worker + dispatcher active (all actions route through queue)"
      : "[flowstate] BullMQ co-located worker started (enqueue-only, actions run in-process)"
  );
}

export { bullmqRuntime };
