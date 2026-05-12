import path from "node:path";
import { after } from "next/server";
import { openai } from "@ai-sdk/openai";
import { createGateway } from "@ai-sdk/gateway";
import {
  createModelResolver,
  createAiSdkSpeechResolver,
  createAiSdkTranscriptionResolver,
} from "@flow-state-dev/core/models";
import {
  createFlowApiRouter,
  createFlowRegistry,
  createFilesystemStores,
  createInMemoryStores,
  type StoreRegistry,
} from "@flow-state-dev/server";
import {
  createPgPoolTx,
  createPostgresScheduleIndex,
  createPostgresStores,
  type PoolConfig,
  type QueryExecutor,
} from "@flow-state-dev/store-postgres";
import { vercelPgPoolOptions } from "@flow-state-dev/vercel/pg";
import {
  createScheduledTransportAdapter,
  type ScheduleIndex,
  type ScheduleIndexRow,
} from "@flow-state-dev/scheduled";
import { Client as NeonClient } from "@neondatabase/serverless";
import { Pool } from "pg";

// Neon's Client is a runtime drop-in for pg's Client (that's pg.PoolConfig.Client's
// documented purpose), but their connect() signature differs slightly so the types
// don't line up. Cast once at the seam.
const NeonClientForPg = NeonClient as unknown as PoolConfig["Client"];

// ---------------------------------------------------------------------------
// Schedule index
//
// The weekly-digest flow imports `scheduleIndex` from this module and hands
// it to `defineScheduleCollection`. The real backing implementation is
// installed lazily by `createStores()` once a Postgres pool exists. Before
// that runs, mutations against the index buffer themselves as no-ops, which
// matches the "no index → no row mirrored" semantics
// `defineScheduleCollection` supports. The mutable container avoids a
// cyclic-import init-order problem.
// ---------------------------------------------------------------------------

let scheduleIndexImpl: ScheduleIndex | null = null;

export const scheduleIndex: ScheduleIndex = {
  async upsert(row: ScheduleIndexRow) {
    if (scheduleIndexImpl) return scheduleIndexImpl.upsert(row);
  },
  async claimDue(now: number, limit?: number) {
    if (!scheduleIndexImpl) return [];
    return scheduleIndexImpl.claimDue(now, limit);
  },
  async remove(userId: string, key: string) {
    if (scheduleIndexImpl) return scheduleIndexImpl.remove(userId, key);
  },
};

// Flows are imported AFTER scheduleIndex is exported so the cyclic-import
// binding from `flows/weekly-digest/flow.ts` resolves to the wrapper above.
// eslint-disable-next-line import/first
import chatAgentFlow from "@/flows/chat-agent/flow";
// eslint-disable-next-line import/first
import richTextComponentFlow from "@/flows/rich-text-component/flow";
// eslint-disable-next-line import/first
import weeklyDigestFlow from "@/flows/weekly-digest/flow";

// Pass explicit provider/gateway instances. The model resolver's dynamic
// require() path doesn't work in bundled Next.js — static imports do.
// Only bind the openai provider when OPENAI_API_KEY is present; otherwise
// leave the openai slot empty so availability-based resolution can route
// openai/* model strings through the configured gateway.
const gatewayApiKey = process.env.AI_GATEWAY_API_KEY;
const modelResolver = createModelResolver({
  gateways: gatewayApiKey
    ? { vercel: createGateway({ apiKey: gatewayApiKey }) }
    : undefined,
  // Concrete fallback when an `intent/<name>` string can't resolve.
  defaultModel: "vercel/anthropic/claude-sonnet-4.6",
  // Starter intent map. Apps can tune later — the resolver walks each list
  // and picks the first available candidate. `synthesize` doubles as the
  // structured-JSON intent so we point it at JSON-reliable models, not the
  // cheapest tier.
  intents: {
    utility: [
      "vercel/anthropic/claude-haiku-4.5",
      "vercel/openai/gpt-5.5-nano",
    ],
    chat: [
      "vercel/anthropic/claude-sonnet-4.6",
      "vercel/openai/gpt-5.5",
    ],
    plan: [
      "vercel/anthropic/claude-opus-4.7",
      "vercel/openai/gpt-5.5",
    ],
    synthesize: [
      "vercel/anthropic/claude-sonnet-4.6",
      "vercel/openai/gpt-5.5",
      "vercel/google/gemini-2.5-pro",
    ],
    code: [
      "vercel/anthropic/claude-sonnet-4.6",
      "vercel/openai/gpt-5.5",
    ],
    reason: [
      "vercel/anthropic/claude-opus-4.7",
      "vercel/openai/gpt-5.5",
    ],
  },
});

// Voice: speech (TTS) and transcription (STT) resolvers.
// Uses OpenAI's gpt-4o-mini-tts for speech and gpt-4o-mini-transcribe for transcription.
const speechResolver = createAiSdkSpeechResolver((modelId) => openai.speech(modelId));
const transcriptionResolver = createAiSdkTranscriptionResolver((modelId) => openai.transcription(modelId));

const registry = createFlowRegistry();
registry.register(chatAgentFlow);
registry.register(richTextComponentFlow);
registry.register(weeklyDigestFlow);

/**
 * Resolve persistence stores based on environment:
 *   FSD_DB_URL / DATABASE_URL → Postgres (Neon on Vercel)
 *   STORE_TYPE=filesystem     → local filesystem (.fsdev/data/)
 *   otherwise                 → in-memory (ephemeral, default for local dev)
 *
 * On Vercel, cold-start requests against an auto-suspended database race the
 * warm function's cached pg.Pool sockets. `vercelPgPoolOptions` closes that
 * race with a short idle timeout + wake-up-friendly connection timeout. When
 * the database is Neon, we also swap in their WebSocket Client to trim the
 * 1–3s wake-up latency that the default pg driver pays on the first request.
 *
 * `skipSchemaInit` on Vercel: schema init runs out-of-band via `scripts/migrate.mjs`
 * during `vercel-build`, so the runtime pool can skip ~30 idempotent DDL
 * roundtrips and the advisory-lock dance on every cold start. Off-Vercel
 * (local dev, self-hosted, Docker), keep auto-init so devs and other
 * deployments don't have to remember a separate migrate step.
 *
 * When Postgres is in use, this also constructs a `ScheduleIndex` against
 * the same pool and installs it as the backing implementation behind the
 * exported `scheduleIndex` wrapper. The weekly-digest flow depends on this
 * for its `defineScheduleCollection({ index })` wiring.
 */
async function createStores(): Promise<StoreRegistry> {
  const dbUrl = process.env.FSD_DB_URL ?? process.env.DATABASE_URL;
  if (dbUrl) {
    const onVercel = !!process.env.VERCEL;
    const isNeon = dbUrl.includes(".neon.tech");
    // Build the pool here (rather than letting `createPostgresStores`
    // build it from `connectionString`) so the same executor backs both
    // the stores and `createPostgresScheduleIndex`.
    const pool = new Pool({
      connectionString: dbUrl,
      max: 10,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 30_000,
      allowExitOnIdle: true,
      ...(onVercel ? vercelPgPoolOptions : {}),
      ...(onVercel && isNeon ? { Client: NeonClientForPg } : {}),
    });
    pool.on("error", () => {});

    const executor: QueryExecutor = {
      async query(text: string, values?: unknown[]) {
        const result = await pool.query(text, values);
        return {
          rows: result.rows as Record<string, unknown>[],
          rowCount: result.rowCount ?? 0,
        };
      },
      async beginTx() {
        return createPgPoolTx(pool);
      },
    };

    // Install the real ScheduleIndex impl behind the wrapper before any
    // collection hook runs (collection hooks fire only on resource writes,
    // which require a request — long after this resolves).
    scheduleIndexImpl = createPostgresScheduleIndex(executor);

    return createPostgresStores({
      pool,
      skipSchemaInit: onVercel,
      // Vercel functions can't hold a usable `LISTEN flow_events` session: Neon's
      // pooled endpoint is pgbouncer in transaction mode (LISTEN registers on a
      // backend that's recycled at transaction end), and even on direct endpoints
      // the function lifetime makes long-lived listeners impractical. Force the
      // store's polling fallback instead — it's correct for serverless and the
      // user-visible cost (a ~250ms tail latency) is invisible alongside model
      // generation.
      liveTailPool: onVercel ? null : undefined,
    });
  }
  if (process.env.STORE_TYPE === "filesystem") {
    return createFilesystemStores({ rootDir: path.join(process.cwd(), ".fsdev", "data") });
  }
  return createInMemoryStores();
}

type FlowApiRouter = ReturnType<typeof createFlowApiRouter>;

let _routerPromise: Promise<FlowApiRouter> | null = null;

/** Lazily initialised router — awaits async Postgres pool+schema on first call. */
export function getRouter(): Promise<FlowApiRouter> {
  if (!_routerPromise) {
    _routerPromise = createStores().then((stores) =>
      createFlowApiRouter({
        registry,
        stores,
        modelResolver,
        speechResolver,
        transcriptionResolver,
        adapters: [createScheduledTransportAdapter()],
        detectInterruptedOnStartup: false,
        // Keep the serverless function alive while runAction executes.
        // Without this, Vercel kills the function after the 202 response,
        // before results are persisted — causing stream 404s and lost data.
        onBackgroundWork: (promise) => after(() => promise),
        onError: (error, context) => {
          console.error(`[flow-api] ${context.method} ${context.path}:`, error.message);
        },
      })
    );
  }
  return _routerPromise;
}
