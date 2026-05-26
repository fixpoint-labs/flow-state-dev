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
import { openai } from "@ai-sdk/openai";
import { createGateway } from "@ai-sdk/gateway";
import { createFlowState, filesystemStores, inMemoryStores } from "@flow-state-dev/server";
import { vercelPostgresStores } from "@flow-state-dev/vercel/store";
import { createScheduledTransportAdapter } from "@flow-state-dev/scheduled";
import { setScheduleIndexImpl } from "@/lib/schedule-index";
import { createKitchenSinkTestModelResolver } from "@/test/mock-flowstate";
import chatAgentFlow from "@/flows/chat-agent/flow";
import richTextComponentFlow from "@/flows/rich-text-component/flow";
import weeklyDigestFlow from "@/flows/weekly-digest/flow";

const gatewayApiKey = process.env.AI_GATEWAY_API_KEY;
const databaseUrl = process.env.FSD_DB_URL ?? process.env.DATABASE_URL;

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
  voice: {
    speech: (modelId) => openai.speech(modelId),
    transcription: (modelId) => openai.transcription(modelId),
  },
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
  adapters: [createScheduledTransportAdapter()],
  onError: (error, ctx) => {
    console.error(`[flowstate] ${ctx.method} ${ctx.path}:`, error.message);
  },
});
