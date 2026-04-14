import path from "node:path";
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
 *   DATABASE_URL set        → Postgres (Neon on Vercel)
 *   STORE_TYPE=filesystem   → local filesystem (.fsdev/data/)
 *   otherwise               → in-memory (ephemeral, default for local dev)
 */
async function createStores(): Promise<StoreRegistry> {
  if (process.env.DATABASE_URL) {
    return createPostgresStores({ connectionString: process.env.DATABASE_URL });
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
        onError: (error, context) => {
          console.error(`[flow-api] ${context.method} ${context.path}:`, error.message);
        },
      })
    );
  }
  return _routerPromise;
}
