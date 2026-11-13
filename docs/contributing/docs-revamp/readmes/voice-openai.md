# @flow-state-dev/voice-openai

OpenAI text-to-speech, transcription and voices, as a `VoiceProvider`.

```bash
pnpm add @flow-state-dev/voice-openai
```

```ts
import { OpenAIVoiceProvider } from "@flow-state-dev/voice-openai";

const provider = new OpenAIVoiceProvider({ apiKey: process.env.OPENAI_API_KEY });

const { audio, mediaType } = await provider.speak({ text: "Hello, world." });
// audio: Uint8Array (MP3 by default), mediaType: "audio/mpeg"
```

Reference: [the `voice-openai` section of the Flow State API reference](https://flow-state.dev/docs/reference/api/voice-openai).
