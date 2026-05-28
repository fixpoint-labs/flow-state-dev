---
"@flow-state-dev/server": minor
"@flow-state-dev/core": minor
---

Replace the `speechResolver` / `transcriptionResolver` factory options with a single `voiceProvider: VoiceProvider` on `createFlowApiRouter` and `createFlowState`. Streaming-capable providers now emit chunked audio for lower first-audio latency, the request abort signal cancels in-flight synthesis, and the transcribe endpoint resolves its model from the request or the provider's defaults instead of a hardcoded string (returning 400 when neither is set). A per-flow `voice.provider` overrides the router-level provider for that flow.

This is a breaking change to the router's voice options.

**Migration:**

Before:

```ts
import { createAiSdkSpeechResolver, createAiSdkTranscriptionResolver } from "@flow-state-dev/core";
import { openai } from "@ai-sdk/openai";

createFlowApiRouter({
  speechResolver: createAiSdkSpeechResolver((id) => openai.speech(id)),
  transcriptionResolver: createAiSdkTranscriptionResolver((id) => openai.transcription(id)),
});
```

After:

```ts
import { OpenAIVoiceProvider } from "@flow-state-dev/voice-openai";

createFlowApiRouter({
  voiceProvider: new OpenAIVoiceProvider({ apiKey: process.env.OPENAI_API_KEY }),
});
```

The transcribe endpoint now requires either a per-request `model` or `voiceProvider.defaultModels.transcribe`; if neither is set it returns `400 no_model`.
