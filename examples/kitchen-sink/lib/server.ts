import path from "node:path";
import { after } from "next/server";
import { openai } from "@ai-sdk/openai";
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
import { createPostgresStores } from "@flow-state-dev/store-postgres";
import kitchenSinkFlow from "@/src/flows/kitchen-sink/flow";

// Auto-detects providers from env vars (OPENAI_API_KEY, etc.).
// Model strings like "openai/gpt-5-mini" in flow definitions are resolved automatically.
const modelResolver = createModelResolver();

// Voice: speech (TTS) and transcription (STT) resolvers.
// Uses OpenAI's gpt-4o-mini-tts for speech and gpt-4o-mini-transcribe for transcription.
const speechResolver = createAiSdkSpeechResolver((modelId) => openai.speech(modelId));
const transcriptionResolver = createAiSdkTranscriptionResolver((modelId) => openai.transcription(modelId));

const registry = createFlowRegistry();
registry.register(kitchenSinkFlow);

/**
 * Resolve persistence stores based on environment:
 *   FSD_DB_URL / DATABASE_URL → Postgres (Neon on Vercel)
 *   STORE_TYPE=filesystem     → local filesystem (.fsdev/data/)
 *   otherwise                 → in-memory (ephemeral, default for local dev)
 */
async function createStores(): Promise<StoreRegistry> {
  const dbUrl = process.env.FSD_DB_URL ?? process.env.DATABASE_URL;
  if (dbUrl) {
    return createPostgresStores({ connectionString: dbUrl });
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
