# Facts for Voice (K-43, catalog)

Every fact the page may state, with file and line. Sources are limited to what a fact sheet may cite: existing user docs, the exported surface and its doc comments, tests, `goals/`, one example. No spec is cited. Paths are from the repo root.

Legend: **[page]** the page states it. **[ref]** belongs on `reference/voice`; the page links, does not state it. **[gap]** nothing citable exists; the page must not assert it. **[contradiction]** code and the existing page disagree; the code wins.

Abbreviations: `ov` = `apps/docs/docs/advanced/voice.md` (the page this one keeps) · `vp` = `packages/voice-openai/src/openai-voice-provider.ts` · `vc` = `packages/voice-openai/src/voice-catalog.ts` · `of` = `packages/voice-openai/src/output-format.ts` · `vpk` = `packages/voice-openai/package.json` · `vr` = `packages/voice-openai/README.md` · `ra` = `packages/engine/src/execution/runAction.ts` · `sr` = `packages/engine/src/routes/stream-routes.ts` · `fa` = `packages/engine/src/routes/createFlowApiRouter.ts` · `fs` = `packages/engine/src/flowstate/{types,createFlowState}.ts` · `sp` = `packages/core/src/types/speech.ts` · `vpc` = `packages/core/src/types/voice-provider.ts` · `uv` = `packages/react/src/voice/useVoice.ts` · `tp` = `packages/engine/src/voice/tts-pipeline.ts` · `ks` = `apps/kitchen-sink`.

## Flags against the page plan and the kept page (read first)

1. **[contradiction] `useVoice` has an eighth member the kept page's table omits.** `isAvailable: boolean` ("Whether voice APIs are available in this browser") is on `VoiceState`, `uv:42`. It is `false` on the first render and becomes `true` in an effect only when `navigator.mediaDevices.getUserMedia` and `MediaRecorder` both exist, `uv:85-93`. `startListening` and `stopListening` return `Promise<void>`, not `() => void`, `uv:45-47`. The kept page's table is wrong on both.
2. **[contradiction] The kept page's `useVoice` example omits what the action needs.** `UseVoiceOptions` is `{ action (required), buildInput?, baseUrl?, apiPath?, language?, autoPlayTTS? }`, `uv:18-31`. The kept example passes `action` and `buildInput`, which is valid. It calls `useSession(sessionId)`; the page must show where `sessionId` and the user come from (a free variable). `useVoice` takes a `SessionView` and reads `session.userId` for the transcribe call, `uv:205`.
3. **[contradiction] The kept page's "Environment variables" claim is thin but true.** `OpenAIVoiceProvider` reads `OPENAI_API_KEY` through the SDK when `apiKey` is omitted, `vp:28-31`. Do not carry the sentence "Each provider reads its own credentials" as a framework rule.
4. **[contradiction] `speakStream` is not on the OpenAI provider.** `abilities.speakStream` is `false`, `vp:60-65`. The kept page's prose says "`@flow-state-dev/voice-openai` ships now; an ElevenLabs adapter is planned" and its per-flow example uses `ElevenLabsVoiceProvider`. No such class is in the repo (grep over `packages/*/src` finds none). **[gap]** The page must not name ElevenLabs as shipped, and must not use `ElevenLabsVoiceProvider` in an example; use a hand-written provider or two `OpenAIVoiceProvider` instances.
5. **[contradiction] The kept page's server snippet.** `createFlowApiRouter({ registry, voiceProvider })` is correct, `fa:73`. `createFlowState({ voice: { provider } })` is correct, `fs` (`types.ts:47-49,165-166`, `createFlowState.ts:991`). An app that uses `fsdev.config.ts` sets the same `voice: { provider }` key on its config, `ks/fsdev.config.ts:177-179`. **[page]** The server example for the page's layout is the config form (the revamp's one app has `fsdev.config.ts`, per `user-docs.md` "Code examples").
6. **[gap] No test covers the `ttsEnabled` gate.** A grep of `packages/*/test`, `apps/kitchen-sink/test` and `goals/` for `ttsEnabled` finds nothing. The gate is read from `ra:1263-1267` and the sender is `uv:247-254`. The page may state the observable consequence (no audio unless the client asks, and `useVoice` asks by default), cited to code; do not cite a test.
7. **[gap] No `reference/voice` page exists yet** (`docs/contributing/docs-revamp/pages/reference/` holds `concurrency.md`, `glossary.md`). The page links to it by slug `../reference/voice.md` per the plan. Everything marked **[ref]** below is its content.
8. **[page] Names to use.** Product "Flow State". "Text to speech" and "speech to text" in prose first, `speak` and `transcribe` as the provider methods after. "Voice provider" is the object a package such as `@flow-state-dev/voice-openai` supplies.

## 1. What you need (questions 1, 2, 3)

- A voice provider on the server. The package `@flow-state-dev/voice-openai` is "OpenAI voice transport for flow-state-dev." `vpk:4`. Its class `OpenAIVoiceProvider` is the only export besides `OPENAI_VOICE_CATALOG` and the options type. `packages/voice-openai/src/index.ts:3-5`. **[page]**
- `voice` on the flow: `defineFlow({ voice: { tts: { ... } } })`. `voice?: VoiceConfig` on the flow definition types, `packages/core/src/types/flow.ts:640` (and 756, 819, 901). `VoiceConfig = { tts?: TTSConfig; provider?: VoiceProvider }`, `sp:18-26`. **[page]**
- `useVoice(session, options)` from `@flow-state-dev/react`, a root export, `packages/react/src/index.ts:220-223`. **[page]**
- Install line: `pnpm add @flow-state-dev/voice-openai`. `openai` is a direct dependency of the package, not a peer; the reader need not install it. `vr` "Installation", `vpk:58` (`"openai": "^6.38.0"` under dependencies; confirm the block it sits in before stating "dependency": `sed -n 50,62p vpk`). **[page]**
- `@flow-state-dev/react/voice` is a second subpath that carries "exactly the voice primitives, and not `useVoice`" (the recorder, player and speech-recognition wrappers), for an app that builds its own loop. `packages/react/test/voice-subpath.test.ts:63-71`, `packages/react/src/voice/index.ts:1-6`. **[ref]** (one clause at most; the page does not explain them).

## 2. Does a flow that does not opt in change? (question 1)

Three independent gates, each observable:

- **No `voice` on the flow: no synthesis.** TTS starts only when `flow.voice.tts` is defined, `ra:1895`. **[page]**
- **The client must ask.** TTS also needs the request's `metadata.voice.ttsEnabled === true`, `ra:1264-1267`, with the comment "TTS is off by default — we don't want to synthesize audio unless the client specifically asks for it", `ra:1255-1257`. `useVoice` sends `ttsEnabled: autoPlayTTS` with each voice-originated action, `uv:247-254`, and `autoPlayTTS` defaults to `true`, `uv:82`. A typed message sent through `sendAction` without that metadata gets no audio. **[page]** (cite code; see flag 6)
- **No provider: text still streams.** With `flow.voice.tts` set but no provider, `ttsHook` is never built and the run continues text-only, `ra:1895-1898`. If a provider exists but advertises neither `speak` nor `speakStream`, the run logs a warning and continues text-only, `ra:1908-1913`. `createFlowApiRouter` doc: "If omitted, flows requesting TTS silently skip synthesis (text continues), and the transcribe endpoint returns 501." `fa:68-73`. **[page]**
- Synthesis failure never stops the text. A sentence that fails to synthesize is reported as a non-fatal item, `tp` header and `packages/engine/test/tts-pipeline.test.ts:106-170` ("reports a non-fatal error", log level by `VoiceError` kind). **[page]** one sentence; the kinds and log levels are **[ref]**.
- The text the generator streams is the input to speech, the flow is not changed. The pipeline is fed by `content.delta` and `content.done` events from the response stream (`packages/engine/src/voice/tts-emitter-hook.ts:3-10`), registered as an event observer on the response emitter, `ra:1903-1906`. **[page]** as "the flow runs as before; the server listens to its text". Mechanism (sentence buffer, concurrency of 3, 15 s timeout) is **[ref]**: `tp:20-28`; the sentence boundary rule is on the kept page, `ov` "How TTS works", and the buffer is in `packages/engine/src/voice/` (confirm the exact rule against `sentence-buffer` before stating it on `reference/voice`).

## 3. Where transcription happens (question 3)

- **On the server, through the voice provider, over HTTP.** `useVoice.stopListening` records, then calls `fsd.transcribe({ audio, mediaType, language })`, `uv:256-264`, which POSTs the audio to `/api/flows/transcribe` as the request body with `content-type` set to the media type and `userId` and `language` as query parameters. `packages/client/src/client.ts:824-833`. The server calls `provider.transcribe(...)`, `sr:476-482`, and returns `{ text, language }`, `sr:483-486`. **[page]**
- The browser's own speech recognition only supplies the live "interim" text while the user holds the button. `uv:216-224`; `isSpeechRecognitionAvailable()` gates it, and when it is missing `useVoice` still works with no interim text. The text sent to the flow is the server's. `uv:266-270`. **[page]**
- If the server transcription throws, `useVoice` falls back to the interim transcript when it has one and sends that, `uv:272-278`. Otherwise it sends nothing. **[page]** one sentence. (`catch` swallows the error; the hook does not expose it. Do not claim an error is surfaced.)
- Empty or whitespace-only transcripts are not sent: `result.text.trim().length > 0`, `uv:268`. **[page]**
- The transcribe route is not tied to a flow, so the per-flow `voice.provider` does not apply to it; it uses the router-level provider. `sr:377-386` takes `ctx.voiceProvider` only; the per-flow merge is in the dispatch of an action, `packages/engine/test/transports/host-voice-provider.test.ts:90-117` ("host.resolvers.voice holds the router-level provider regardless of override", line 112). **[page]**
- Route status codes (501 `transcription_not_configured`, 501 `provider_does_not_support_transcription`, 400 `no_model`, 413 over 25 MiB, `VoiceError` kinds mapped to 401/429/404/400/415/503/502/499/500): `sr:384-390,402-410,466-474,499-523`, `packages/engine/test/transcribe-endpoint.test.ts:42-148`. **[ref]**
- Request forms (base64 JSON with `userId`, `audio`, `mediaType`, `language`, `model`; raw binary with `?userId=`, `language`, `model`): `sr:394-460`. **[ref]**
- Model resolution: per-request `model`, then `provider.defaultModels.transcribe`, else 400 `no_model`; "No framework-level default literal." `sr:464-474`. **[ref]**
- Media type default when none is given: `audio/webm`, `sr:421,455`. **[ref]**

## 4. What the page uses to record and play (question 2)

- **Record:** the browser's `MediaRecorder` over `navigator.mediaDevices.getUserMedia({ audio: true })`. `packages/react/src/voice/audio-recorder.ts:20-60`. `createAudioRecorder` returns `null` without them, `audio-recorder.ts:25-31`. Preferred types in order: `audio/webm;codecs=opus`, `audio/webm`, `audio/ogg;codecs=opus`, `audio/mp4`, the first one `MediaRecorder.isTypeSupported` accepts, `audio-recorder.ts:127-137`. **[page]** first clause; the type order is **[ref]**.
- **Live text while recording:** the browser's Web Speech `SpeechRecognition`, `packages/react/src/voice/speech-recognition.ts:1-6`. **[page]**
- **Play:** the Web Audio `AudioContext`; replies are decoded with `decodeAudioData`, queued and played in order. `packages/react/src/voice/audio-player.ts:15-18,47,57`. The hook disposes the context on unmount, `uv:95-110`. **[page]**
- Browser support: `isAvailable` is `true` only when both `getUserMedia` and `MediaRecorder` exist, and is `false` during server render and the first client render, `uv:85-93`. `startListening` does nothing when `isAvailable` is `false`, `uv:208`. **[page]** (a reader hits this on first render)
- Both batch and streamed audio play with no change to the component: batch `output_audio` parts from `session.items` play once, keyed by item, `uv:173-202`; streamed chunks arrive through `session.subscribeAudioDelta` and are queued as they come, `uv:115-166`. A streamed part is not played a second time from the final snapshot, `uv:190-194`. **[page]**
- Replies are played once per item: a reload of the same session does not replay a streamed turn, because its persisted snapshot carries empty audio, `uv:184-190`. A reply synthesized in batch mode carries its audio in the item and would be queued by a fresh `useVoice` on a loaded session (`playedKeysRef` is per mount, `uv:68`). **[page]** only the first half; the second is an edge the page should not assert beyond "plays each reply once per mount". **[gap]** no test.
- Two `useVoice` instances on one session would each play each reply; the kitchen-sink app draws its chat panel twice and mounts one `useVoice` so a reply is spoken once. `ks/test/flow-state-page-voice.test.tsx:1-10`, `ks/app/flow-state/page.tsx:303-313`. **[ref]** (a note on Reference's `useVoice` row, or cut).
- Options: `autoPlayTTS: false` turns off playback and also sends `ttsEnabled: false`, so the server skips synthesis. `uv:82,98-100,251`. **[page]**
- `language` (default `"en-US"` per the comment, `uv:27-28`) goes to browser recognition and to the transcribe call. `uv:221,262-263`. **[ref]** (the default is the doc comment's; the code passes `undefined` when unset: `{ language: options.language }`, so the actual default is the browser's. Do not state `en-US` as a default. **[contradiction]** doc comment vs code.)
- `baseUrl` and `apiPath` (default `"/api/flows"`) reach the client the hook builds for transcription, `uv:22-26,205`. **[ref]**
- `buildInput` default: `(text) => ({ message: text })`, `uv:83`. **[page]**
- The voice-originated action carries `metadata: { voice: { inputModality: "speech", ttsEnabled } }`, `uv:247-254`, passed as the third argument of `session.sendAction(action, input, { metadata })`, `uv:270`. **[ref]**

## 5. `useVoice` return value

All from `VoiceState`, `uv:33-50`:

| Member | Type | Meaning |
| --- | --- | --- |
| `isListening` | `boolean` | Microphone recording |
| `isSpeaking` | `boolean` | Audio is playing; `playerState === "playing"`, `uv:309` |
| `isProcessing` | `boolean` | Transcription in flight; set from `stopListening` until the action is sent, `uv:246,279-281` |
| `interimTranscript` | `string` | Live browser text; cleared after the send, `uv:266,281` |
| `isAvailable` | `boolean` | Browser can record |
| `startListening()` | `Promise<void>` | Starts recorder and recognition |
| `stopListening()` | `Promise<void>` | Stops, transcribes, sends the action |
| `stopSpeaking()` | `void` | Stops playback, `uv:293-295` |

**[page]** the example uses four of them; the table is **[ref]**.

## 6. Use it (server, flow, page): the three examples

Server, `fsdev.config.ts`. `voice: { provider: new OpenAIVoiceProvider({ apiKey }) }`, `ks/fsdev.config.ts:177-179`, type `FlowStateVoiceConfig = { provider?: VoiceProvider }`, `fs` `types.ts:47-49`. Without `apiKey` the SDK reads `OPENAI_API_KEY`, `vp:28-31`. **A provider built with no key throws at construction** ("Missing credentials" from the SDK), which is why kitchen-sink wires voice only when a key is present, `ks/fsdev.config.ts:171-179` (comment). **[page]** as one sentence: "`OpenAIVoiceProvider` needs a key when it is constructed." The comment's claim is about the SDK; state it flat, cited to the example. A router-level form `createFlowApiRouter({ registry, voiceProvider })`, `fa:73`, is **[ref]**.

Flow, `src/flows/<flow>/flow.ts`. `defineFlow({ voice: { tts: { voice: "alloy" } }, actions })`, `ks/flows/chat-agent/flow.ts:46-50`. `TTSConfig = { model?, voice?, speed? }`, `sp:10-15`. Defaults when omitted: the provider's, see `vp:72-75` (`gpt-4o-mini-tts`, `gpt-4o-mini-transcribe`, voice `alloy`). `speed` has no default in the type; `1.0` on the kept page is the doc's claim, and `OpenAIVoiceProvider` passes `speed: o.speed` through unchanged, `vp:127`, so the page does not state a default. **[contradiction]** kept page table says `speed` default `1.0`; code leaves it to the provider. **[page]** `voice`; `model` and `speed` **[ref]**.

Page. `useVoice(session, { action: "run", buildInput: (text) => ({ message: text }) })`, `ks/app/flow-state/page.tsx:308-312`. A press-and-hold button calls `startListening` on pointer down and `stopListening` on pointer up (the kept page's example; `ov`). **[page]** The action named must accept the input `buildInput` returns. The kitchen-sink flow's action is `run`, `ks/flows/chat-agent/flow.ts:52-53`.

Model names in examples: `OpenAIVoiceProvider`'s defaults `gpt-4o-mini-tts` and `gpt-4o-mini-transcribe` (`vp:72-73`) are speech models, not the chat models the model-name rule covers; the page need not name them.

## 7. What the OpenAI provider supports (links out; Reference)

- Abilities: `speak: true`, `speakStream: false`, `transcribe: true`, `listVoices: true`. `vp:60-65`. **[page]** one clause: it speaks and transcribes in whole pieces, not streamed. **[ref]** the rest.
- Options: `apiKey`, `baseURL`, `organization`, `project`, `ttsModel`, `sttModel`, `voice`, `client`. `vp:25-50`. **[ref]**
- Output formats: `mp3`, `opus`, `aac`, `flac`, `wav`, `pcm`; default `mp3`; media types `audio/mpeg`, `audio/ogg; codecs=opus`, `audio/aac`, `audio/flac`, `audio/wav`, `audio/pcm;rate=24000`. Unknown format throws `VoiceError` kind `format_unsupported`. `of:43-72`. **[ref]**
- `instructions` via `providerOptions.openai.instructions` is rejected on `tts-1` and `tts-1-hd` with `VoiceError` kind `invalid_input`. `vp:105-115`. **[ref]**
- `transcribe` with a `Uint8Array` and no `mediaType` throws `invalid_input`. `vp:209-216`. **[ref]**
- `listVoices()` returns 13 voices: `alloy, ash, ballad, coral, echo, fable, nova, onyx, sage, shimmer, verse, marin, cedar`; `marin` and `cedar` declare `supportedModels: ["gpt-4o-mini-tts"]`. `vc:16-30`. **[ref]**
- The provider's `id` is `openai:` plus the first 12 hex characters of a SHA-256 over its model, voice and endpoint settings; the key is not included. `vp:182-195`. **[ref]** or cut.

## 8. Change it (your own provider)

- The contract: `VoiceProvider = { id, providerName, abilities: { speak, speakStream, transcribe, listVoices }, defaultModels?: { speak?, transcribe? }, speak?, speakStream?, transcribe?, listVoices? }`, `vpc:100-130` (read: `sed -n 120,160p vpc` for exact lines before citing). A `true` ability "guarantees the method is present". `vpc:22-27`. **[page]**
- Methods: `speak(options) -> Promise<{ audio: Uint8Array, mediaType }>`; `speakStream(options) -> AsyncIterable<{ kind: "audio", bytes, mediaType, isLast? }>`; `transcribe(options) -> Promise<{ text, language? }>`; `listVoices() -> Promise<VoiceInfo[]>`. `vpc:36-120`. **[page]** the two the example uses; **[ref]** the rest.
- The pipeline picks `speakStream` over `speak` when the provider advertises it, per sentence. `ra:1899-1907` comment ("the pipeline branches on `canSpeakStream` per sentence"); `packages/engine/test/tts-pipeline.test.ts:54,202`. **[page]**
- Type guards `canSpeak`, `canSpeakStream`, `canTranscribe`, `canListVoices` narrow on `abilities`. `vpc:` after line 160 (confirm). **[ref]**
- Failures: throw `VoiceError` with a typed `kind`, `packages/core/src/types/voice-error.ts`; the OpenAI provider maps SDK errors through `translateError`, `vp:135,160`. The kinds are `auth`, `rate_limit`, `not_found`, `invalid_input`, `format_unsupported`, `provider_unavailable`, `network`, `aborted`, `unknown`, per the status map `sr:499-523`. **[ref]**
- A provider stops producing audio when its abort `signal` fires; the signal is the request's. `ra:1901-1904` passes `composedSignal`. `SpeakOptions.signal`, `vpc:56-57`. **[page]** one clause.
- `createCompositeVoiceProvider({ speak, transcribe })` mixes two providers; its `providerName` is `"composite"` (`vpc` doc, "Short provider name (e.g. ... `"composite"`)"). Exported from `@flow-state-dev/core`. `packages/core/test/voice-provider.test.ts` (confirm the export with `grep -n createCompositeVoiceProvider packages/core/src/index.ts`). **[page]** one sentence and a link, or **[ref]**.
- Per-flow provider: `voice: { provider, tts }` on the flow definition wins over the server's provider for that flow's synthesis. `sp:20-25`, `packages/engine/test/transports/host-voice-provider.test.ts:90-104`. It does not apply to transcription (section 3). **[page]**
- Hand-written provider example, a one-ability provider: `abilities: { speak: true, speakStream: false, transcribe: false, listVoices: false }` plus `speak`. Type-checks against `VoiceProvider`, `vpc`. Import from `@flow-state-dev/core`: `import type { VoiceProvider } from "@flow-state-dev/core"` (the OpenAI package imports the type from there, `vp:11-19`). **[page]**

## 9. The content type

- Synthesized audio is an `output_audio` part on the assistant message: `{ type: "output_audio", audio: string (base64), mediaType: string, transcript?: string }`. `packages/contracts/src/items/content.ts:34-39`. **[ref]**
- Streamed audio arrives as `content.audio.delta` events, `packages/contracts/src/items/events.ts:86`; streamed bytes "are live-only and not replayable on reconnect" and the stored part has empty `audio`. `uv:184-190`. **[ref]**

## 10. Stored data: the four questions

Voice declares no resource, collection or store of its own. The only thing it leaves behind is the audio part on a reply.

| Part | Owner | Who sees it | Where it is stored | How many |
| --- | --- | --- | --- | --- |
| Recording the user makes | The browser, until `stopListening`; then the server request body | Nobody else: it is sent to the transcribe route and handed to the provider; the route does not store it, `sr:476-486` (returns `{ text, language }` only) | Not stored by the framework. The provider (OpenAI, for `OpenAIVoiceProvider`) receives it. | One per press |
| The transcript | The user's session: it becomes the action input | Whoever can read the session's items | As the action input the flow records, like a typed message | One per send |
| Synthesized audio, batch provider | The assistant message in the session | Whoever can read the session's items | In the item's `output_audio` content, base64 | One part per sentence (the pipeline synthesizes per sentence, `tp` header, `ra:1899-1907`) |
| Synthesized audio, streaming provider | The session, but only an empty-audio snapshot with the transcript | Same | Chunks are live-only; the persisted part has empty `audio` | One snapshot part per sentence |

Cite for rows 3 and 4: `uv:181-190` (the hook reads batch parts with audio and skips empty ones "streaming TTS turns persist an empty-audio `content.done` snapshot"), `packages/contracts/src/items/content.ts:34-39`. **[gap]** the per-sentence part count for the batch row is read from the pipeline test `packages/engine/test/tts-pipeline.test.ts:54-76` ("dispatches to speak() and emits content.added + content.done"); confirm whether one part per sentence or one part per message before the page states a count. Row 1: the 25 MiB cap, `sr:402` (`MAX_AUDIO_BYTES`), is **[ref]**. Voice owns no data, so the page states one sentence: audio you synthesize is part of the session's items; a recording is not kept by the framework. Put the second clause on the page only after confirming the provider does not persist it, which is the provider's own policy and not observable here: **[gap]** state only "the framework does not keep it".

## 11. Figure facts (Voice around a text flow)

- Order the figure shows: recording, speech to text (`/api/flows/transcribe`, `sr`), the text becomes the action input (`uv:268-270`), the flow runs unchanged and streams text, text to speech (the pipeline reads the text events, `ra:1903-1906`), audio parts reach the page (`uv:115-202`). **[page]**
- The unchanged flow carries no voice code in its blocks: `voice` is on the flow definition only, `ks/flows/chat-agent/flow.ts:46-50`, and `run` is a block sequencer, `flow.ts:52-53`. **[page]** (highlighter target)

## 12. Leave out

- The kept page's "Streaming and the first-chunk timeout" section: 15 s first-chunk timeout, head-of-line ordering, reverse-proxy advice. Mechanism, **[ref]** (`tp:20-28`).
- The kept page's "Environment variables" section (flag 3).
- The sentence-boundary regex, concurrency of 3, order guarantees: **[ref]**.
- Upgrade notes in the kept page: "The model now goes straight to the provider; there's no separate resolver to register", "single `voiceProvider` ... instead of two resolver functions", "Replaces the previous two-resolver-factory pattern" (`vpc:1-8`). Diff narrative; cut.
- ElevenLabs as shipped (flag 4).
- `FIX-` numbers that appear in source comments (`uv:69,112`, `vpc:1`); never on a page.

## Checks closed

1. Batch audio is one `output_audio` part per sentence: two sentences ("One. Two. ") make two `speak` calls and two `content.done` parts, each with its own transcript. `packages/engine/test/tts-pipeline.test.ts:78-104`. Section 10's count stands.
2. The sentence-boundary rule is tested only by example ("One. Two. " splits at the period, `tts-pipeline.test.ts:92-102`). The kept page's `.`, `!`, `?` plus whitespace is not confirmed here. **[gap]** The page does not state the rule.
3. `createCompositeVoiceProvider` is exported from `@flow-state-dev/core`, `packages/core/src/index.ts:401`, slot config type at `packages/core/src/types/voice-provider.ts:209`.
4. `openai` sits under `dependencies` in `packages/voice-openai/package.json` (the block ending `"openai": "^6.38.0"`), as does `@flow-state-dev/core`. Not a peer.

## Revise round 1 (page as rewritten)

- Page now states: opt-in text, three needs, install line, `fsdev.config.ts` with `createFlowState({ flows: [chat], voice: { provider } })` (`flows` is `readonly FlowInstance[]`, `packages/engine/src/flowstate/types.ts:124`), `defineFlow({ voice: { tts } })`, the `useVoice` example, the client opt-in (`ttsEnabled` sent by default, `autoPlayTTS: false` off, `uv:82,247-254`), `isAvailable` (`uv:85-93`), interim-text fallback (`uv:272-278`), sentence-by-sentence synthesis, the 15 s no-audio skip, session storage of audio, a custom-provider example.
- No ElevenLabs anywhere; per-flow override and composite providers are one sentence each with a Reference link.
- `OPENAI_API_KEY` is mentioned in the server paragraph; the separate "Environment variables" section is cut. Reference R-15 row still needed.
- Moved to `../reference/voice.md` (R-43), which does not exist yet: both provider settings and status codes, `voice.tts` option table, sentence rule, error event levels, head-of-line ordering, timeout detail, `useVoice` return table (including `isAvailable`, `Promise<void>` start/stop), transcription endpoint forms and model resolution, `OutputAudioContent`, `VoiceProvider` fields, composite abilities.

## Revise round 2 (type-check fixes)

- `defineFlow(...)` returns a flow type; calling it returns the `FlowInstance` that `createFlowState({ flows })` takes. `ks/flows/chat-agent/flow.ts:35,134` (`const chatAgentFlow = defineFlow({...}); const flow = chatAgentFlow();`). The page's `chat` is `defineFlow({...})()`.
- The flow's one block is now shown: `src/flows/chat/blocks/reply.ts`, a `generator` with `name`, `model`, `prompt`, `user`, the shape in `docs/contributing/docs-revamp/pages/catalog/patterns/response-auditor.md:35-40`. It streams the text the voice pipeline reads (section 2).
- The custom provider no longer imports a client: `speakStream` reads a `fetch` response body with `getReader()` and yields `{ kind: "audio", bytes, mediaType }`. Chunk type is `Uint8Array`.

## Revise round 3 (cold-read gaps)

- Browser features and first render: `MediaRecorder` over `navigator.mediaDevices.getUserMedia({ audio: true })` records (`packages/react/src/voice/audio-recorder.ts:20-60`); Web Audio `AudioContext` plays, decoded and queued in order (`audio-player.ts:15-18,47,57`). `isAvailable` is `false` on server render and first client render, `true` only after an effect finds both; `startListening` does nothing while `false` (`uv:85-93,208`).
- No provider: run continues text-only (`ra:1895-1898`; `fa:68-73`), transcribe route returns 501 (`fa:68-73`, `sr:384-390`). `OpenAIVoiceProvider` needs a key at construction, so wire it only when a key exists (`ks/fsdev.config.ts:171-179`).
- One sentence fails: reported as a non-fatal item, text continues (`packages/engine/test/tts-pipeline.test.ts:106-170`).
- Transcription throws: interim transcript sent if non-empty, else nothing; empty transcript never sent (`uv:268-278`).
