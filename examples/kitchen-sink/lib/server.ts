import { openai } from "@ai-sdk/openai";
import {
  createFlowApiRouter,
  createFlowRegistry,
  createAiSdkModelResolver,
  createAiSdkSpeechResolver,
  createAiSdkTranscriptionResolver,
} from "@flow-state-dev/server";
import kitchenSinkFlow from "@/src/flows/kitchen-sink/flow";

// Pass the openai provider directly — reads OPENAI_API_KEY from env.
// Model strings like "gpt-5-mini" in flow definitions are resolved via openai().
const modelResolver = createAiSdkModelResolver(openai);

// Voice: speech (TTS) and transcription (STT) resolvers.
// Uses OpenAI's tts-1/gpt-4o-mini-tts for speech and whisper-1/gpt-4o-mini-transcribe for transcription.
const speechResolver = createAiSdkSpeechResolver((modelId) => openai.speech(modelId));
const transcriptionResolver = createAiSdkTranscriptionResolver((modelId) => openai.transcription(modelId));

const registry = createFlowRegistry();
registry.register(kitchenSinkFlow);

export const router = createFlowApiRouter({
  registry,
  modelResolver,
  speechResolver,
  transcriptionResolver,
  onError: (error, context) => {
    console.error(`[flow-api] ${context.method} ${context.path}:`, error.message);
  },
});
