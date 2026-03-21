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
} from "@flow-state-dev/server";
import kitchenSinkFlow from "@/src/flows/kitchen-sink/flow";

// Auto-detects providers from env vars (OPENAI_API_KEY, etc.).
// Model strings like "openai/gpt-5-mini" in flow definitions are resolved automatically.
const modelResolver = createModelResolver();

// Voice: speech (TTS) and transcription (STT) resolvers.
// Uses OpenAI's gpt-4o-mini-tts for speech and gpt-4o-mini-transcribe for transcription.
const speechResolver = createAiSdkSpeechResolver((modelId) => openai.speech(modelId));
const transcriptionResolver = createAiSdkTranscriptionResolver((modelId) => openai.transcription(modelId));

// Store type: "filesystem" persists to .fsdev/data/, "memory" (default) is ephemeral.
const stores = process.env.STORE_TYPE === "filesystem"
  ? createFilesystemStores({ rootDir: path.join(process.cwd(), ".fsdev", "data") })
  : createInMemoryStores();

const registry = createFlowRegistry();
registry.register(kitchenSinkFlow);

export const router = createFlowApiRouter({
  registry,
  stores,
  modelResolver,
  speechResolver,
  transcriptionResolver,
  onError: (error, context) => {
    console.error(`[flow-api] ${context.method} ${context.path}:`, error.message);
  },
});
