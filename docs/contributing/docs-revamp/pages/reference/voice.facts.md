# Fact sheet: Voice (R-43, `reference/voice`)

Sources cited: the existing page `apps/docs/docs/advanced/voice.md` (call it **page**), exported surface and doc comments, tests, `packages/voice-openai/README.md`. No example in `examples/`, `labs/` or `goals/` uses voice, so none is cited.

Paths below are under `packages/` unless they start with `apps/`.

## 0. Rows carried from other pages (R-43 grep), checked

| # | Row | Verdict |
|---|-----|---------|
| 1 | `voice.provider` on `createFlowState` is the same provider the router's `voiceProvider` takes | Carried. `engine/src/flowstate/types.ts:50-53`, `engine/src/flowstate/createFlowState.ts:1047,1106`, `engine/src/routes/createFlowApiRouter.ts:75` |
| 2 | `voiceProvider` optional; without it TTS skipped, text still streams, transcribe returns 501 | Carried. `engine/src/routes/createFlowApiRouter.ts:70-75`, `engine/src/execution/runAction.ts:1895-1897`, `engine/src/routes/stream-routes.ts:382-384` |
| 3, 4 | Flow `voice.provider` overrides router provider for TTS only, never transcribe | Carried (one fact). `engine/src/transports/host/createInboundTransportHost.ts:790-795,1018`, `engine/src/routes/http-handlers.ts:747-752`, `engine/test/transports/host-voice-provider.test.ts:90-112` |
| 5 | `voice.tts` `model`, `voice`, `speed` optional, no framework default; `speed` multiplier, 1.0 normal; omitting `voice` entirely means no audio processing; "now goes straight" is diff narrative | Carried with a correction, see 2.3: it is omitting `voice.tts` (the `tts` key), not `voice`, that turns TTS off. The flow's `voice` object may exist without `tts` (only `provider`). "No framework default" for `speed` is true in the framework (`core/src/types/speech.ts:430-435`); the page's "1.0" default (page TTS table) is the provider's concern. Sentence "now goes straight" dropped: diff narrative. |
| 6 | Sentence boundary `.`, `!`, `?` plus whitespace; `speakStream` true emits `content.audio.delta`, else `speak()` one `OutputAudioContent`; strictly in order | Carried. `engine/src/voice/sentence-buffer.ts:10`, `engine/src/voice/tts-pipeline.ts:425-432,205-254,263-423` |
| 7 | Failed sentence skipped; non-fatal `tts.synthesis.error` event; level by kind | Carried, corrected by pass 5; see 2.6 for the exact level rule. |
| 8 | Sentence N+1 waits for N to drain | Carried. `engine/src/voice/tts-pipeline.ts:327-330` (emission chained per item), `:259-262` |
| 9 | Synthesis timeout 15 s: streaming bounds first chunk, batch bounds whole call; timed-out sentence abandoned as non-fatal error; disconnect aborts; reverse-proxy idle timeout advised | Carried. `engine/src/voice/tts-pipeline.ts:22-28,213-227,277-305`. The "reverse-proxy advice" is cited to the existing page line 105 only (a deployment recommendation, not a code fact). |
| 10 | `useVoice` return table | Carried, with the corrected types: `startListening()` and `stopListening()` are `() => Promise<void>`; `isAvailable` is part of the return. `react/src/voice/useVoice.ts:33-50` |
| 11 | `interimTranscript` from Web Speech API; final text from server transcription of the full recording; on transcription failure the interim text is sent; without the browser API no interim text | Carried. `react/src/voice/useVoice.ts:216-224,256-278`. See 2.8 for one limit on the fallback. |
| 12 | Endpoint `POST /api/flows/transcribe`, both body forms, `userId`, content type, `{ text, language }` | Carried. See 3. |
| 13 | Model resolution, `400 no_model`, 501 | Carried. `engine/src/routes/stream-routes.ts:382-389,464-473`; `engine/test/transcribe-endpoint.test.ts:43-131` |
| 14 | `OutputAudioContent` fields; batch full audio, streamed audio live-only, reconnect snapshot carries transcript with empty audio | Carried with a correction, see 5.3: neither kind of audio is kept in the stored record. |
| 15 | `VoiceProvider` fields, branching on `abilities`, throws `VoiceError`, stops on abort signal | Carried. See 4. "Stops on abort signal" is page line ~232 guidance plus `core/src/types/voice-provider.ts:48-49` (signal "forwarded to the underlying transport"); the pipeline passes `signal` on every call (`tts-pipeline.ts:213-224,289-295`). |
| 16 | `createCompositeVoiceProvider({ speak, transcribe })`; composite abilities reflect underlying | Carried and widened (also `listVoices`, `speakStream` slots). `core/src/types/voice-provider.ts:209-315` |
| 17 | `OpenAIVoiceProvider` `apiKey` omitted falls back to SDK `OPENAI_API_KEY` | Carried. `voice-openai/src/openai-voice-provider.ts:27-31`, `voice-openai/README.md:44` |

Nothing dropped as untrue. Rows 3 and 4 merged. The "now goes straight" sentence in row 5 is dropped as diff narrative (as the row itself says).

## 1. Server and flow settings

### 1.1 Server settings

- `createFlowApiRouter({ registry, voiceProvider? })`: `voiceProvider?: VoiceProvider`, "for TTS and STT. Optional". `engine/src/routes/createFlowApiRouter.ts:70-75`
- `createFlowState({ voice?: { provider?: VoiceProvider } })`: `FlowStateVoiceConfig`. The provider is an instance, e.g. `new OpenAIVoiceProvider({ apiKey })`. `engine/src/flowstate/types.ts:46-53,198-199`; page lines 36-41
- `createFlowState` hands `voice.provider` to the runtime config as `voiceProvider`. `engine/src/flowstate/createFlowState.ts:1047,1106`
- `createFlowState({ flows })` takes an array of flow instances (`engine/src/flowstate/types.ts:157`); the keyed-record form is rejected. `defineFlow` returns a factory, so the page example passes `narration()`, as `apps/kitchen-sink/flows/chat-agent/flow.ts:134` does.
- With no provider at all: flows that ask for TTS skip synthesis and text still streams (no error, no log; the pipeline is simply not built). `engine/src/execution/runAction.ts:1895-1897`, doc comment `createFlowApiRouter.ts:70-72`
- With a provider that has neither `speak` nor `speakStream` and a flow that asks for TTS: the run continues text-only and a `warn` runtime log line is written ("flow requested TTS but the voice provider supports neither speak nor speakStream; continuing text-only", fields `requestId`, `provider`). `engine/src/execution/runAction.ts:1895-1914`
- Credentials: each provider reads its own (page line 239).

### 1.2 Flow settings (`defineFlow({ voice })`)

`VoiceConfig = { tts?: TTSConfig; provider?: VoiceProvider }`. `core/src/types/speech.ts:437-446`; `defineFlow` carries `voice` through (`core/src/flow/defineFlow.ts:1610`); on the flow type at `core/src/types/flow.ts:640`.

| Key | Type | Default | Meaning |
|---|---|---|---|
| `voice.provider` | `VoiceProvider` | the server-level provider | Provider for this flow's TTS. Applies to TTS only. `speech.ts:441-445`, `createInboundTransportHost.ts:790-795` |
| `voice.tts` | `TTSConfig` | absent | Presence turns on TTS for the flow (still needs the client opt-in, 1.3). `runAction.ts:1895` |
| `voice.tts.model` | `string` | none in the framework; the provider's default applies | Speak model id passed to the provider. `speech.ts:431-432` |
| `voice.tts.voice` | `string` | none in the framework; provider default (OpenAI: `alloy`) | Provider-specific voice id. `voice-provider.ts:40`, `openai-voice-provider.ts:42,75` |
| `voice.tts.speed` | `number` | none in the framework | Speech speed multiplier, 1.0 = normal; "Provider may clamp". `voice-provider.ts:44` |

`voice.tts` fields are passed to every `speak`/`speakStream` call as `voice`, `speed`, `model`, plus `text` and `signal`. `tts-pipeline.ts:218-224,289-295`. `outputFormat` is not set by the pipeline, so the provider's default format applies (OpenAI: `mp3`, `audio/mpeg`). `voice-openai/src/output-format.ts:32-35`

### 1.3 When TTS actually runs (three conditions)

1. The flow has `voice.tts`. 2. The provider can `speak` or `speakStream`. 3. The request opts in: request metadata `voice.ttsEnabled === true`. "TTS is off by default." `runAction.ts:1255-1267,1895-1897`. `useVoice` sets `ttsEnabled` from its `autoPlayTTS` option (default true) on each action it sends (`useVoice.ts:247-254`). A client calling an action itself must pass `metadata: { voice: { ttsEnabled: true } }`; `runAction` reads `options.metadata?.voice` (`runAction.ts:1264-1267`).
- `inputModality: "speech"` is the other metadata field `useVoice` sends. `useVoice.ts:249-252`
- `voiceContext` (exported from `@flow-state-dev/engine`): a context function for a generator's `context` array. When `ttsEnabled` it adds an instruction to keep sentences short and avoid markdown, tables, code blocks and bullet lists; when `inputModality === "speech"` it adds that the user spoke. Returns nothing if there is no voice metadata. `engine/src/voice/context.ts:1-37`, export `engine/src/index.ts:54`

## 2. How synthesis behaves (rows)

2.1 **Sentence boundary**: one of `.`, `!`, `?` followed by whitespace. Text left in the buffer when the content part finishes is sent as the final sentence. Known limit: it splits on abbreviations ("Dr. Smith"). `engine/src/voice/sentence-buffer.ts:6-10,34-52,54-58`; `engine/src/voice/tts-emitter-hook.ts` (flush on `content.done`). Only assistant messages are voiced (`tts-emitter-hook.ts`, `assistantMessageIds`).
2.2 **Dispatch**: provider `abilities.speakStream === true` → `speakStream()`, emitted as `content.added` (empty-audio placeholder with the transcript), a run of `content.audio.delta` events, then `content.done`. Otherwise `speak()` → `content.added` and `content.done` with the full audio. `tts-pipeline.ts:205-254,263-423,425-432`
2.3 *(Flow-setting nuance referenced above.)* `voice` omitted, or `voice.tts` omitted: no TTS. `runAction.ts:1895`.
2.4 **Order**: audio is emitted strictly in sentence order per message item: all chunks of sentence N before the first of N+1. `tts-pipeline.ts:72-74,327-330`
2.5 **Concurrency**: up to 3 synthesis calls in flight at once (`MAX_CONCURRENCY = 3`). For a streaming provider a call holds its slot until its sentence has drained. `tts-pipeline.ts:20-21,259-262`
2.6 **Failed sentence**: skipped; text streaming continues. Reported as a debug event named `tts.synthesis.error` with data `{ itemId, text (first 100 chars), kind, retryable, level, message }`. A thrown non-`VoiceError` is reported as `kind: "unknown"`. `level`: `kind === "aborted"` → `debug`; `kind === "unknown"` → `error`; otherwise `retryable` → `info`; otherwise `warn`. Test: `engine/test/tts-pipeline.test.ts:121-190,462`. `tts-pipeline.ts:143-182`. (The page says "logged"; the code emits a debug stream event carrying the level. Debug events are not replayed on reconnect: `engine/src/streaming/resume.ts:143-150`.)
2.7 **Timeout**: `SYNTHESIS_TIMEOUT_MS = 15_000`. Streaming: bounds time to the first chunk of each sentence; the timer is dropped once the first chunk arrives, so a long sentence is not cut off. Batch: bounds the whole `speak()` call. A sentence that times out is abandoned and reported through 2.6. A stream that stalls after its first chunk is stopped only by the request abort. Client disconnect (request signal) cancels in-flight synthesis. `tts-pipeline.ts:22-28,213-227,277-305,366-387`; page line 105. A provider that ignores `signal` still times out on the first chunk (`tts-pipeline.ts:302-305`).
2.8 **A part that fails mid-stream** is still closed with `content.done` (so the client has no dangling empty `output_audio`). `tts-pipeline.ts:398-413`
2.9 **Not replayed**: `content.audio.delta` is not replayable or persisted in the event log; `content.added`/`content.done` are. `engine/src/streaming/response-emitter.ts:775-800`, test `engine/test/streaming/audio-delta.test.ts:117-175`

## 3. The transcription endpoint

`POST /api/flows/transcribe`. Route `engine/src/routes/router.ts:48`; client path `client/src/client.ts:839`. Not tied to a flow; always uses the server-level provider (`http-handlers.ts:747-752`). Needs an authenticated caller (route-auth kind `host`, shared with `list_sessions`); the page links Authentication and tenancy for it ("host" check); stores nothing (`engine/src/routes/route-auth.ts:260-270`).

| Form | Request | Fields |
|---|---|---|
| JSON | `Content-Type: application/json` (contains `application/json`) | `userId` (required, non-empty), `audio` (required, base64), `mediaType` (default `audio/webm`), `language`, `model` |
| Raw | any other content type | body is the audio; query `userId` (required), `language`, `model`; `mediaType` is the `Content-Type` without parameters, default `audio/webm` |

`stream-routes.ts:394-462`; page lines 150-172.

Response `200`: `{ text, language }` (`language` is `undefined` when the provider returns none; OpenAI echoes the request's `language`, `openai-voice-provider.ts:158`). `stream-routes.ts:483-486`

| Status | Body `error` | When |
|---|---|---|
| 200 | | transcribed |
| 400 | `Transcription requires non-empty userId` / `... userId query parameter` | no `userId` |
| 400 | `Transcription requires audio data (base64 in 'audio' field)` / `... non-empty audio data` / `... audio data in request body` | no audio |
| 400 | `no_model` (with a `message`) | request has no `model` (empty string counts as none) and the provider has no `defaultModels.transcribe`. `stream-routes.ts:464-473`; tests `transcribe-endpoint.test.ts:77-108` |
| 413 | `Audio payload exceeds maximum size of 26214400 bytes` | audio over 25 MiB (`25 * 1024 * 1024`); the raw form checks `Content-Length` first. `stream-routes.ts:392,421-425,437-456` |
| 501 | `transcription_not_configured` | no provider. `stream-routes.ts:382-384`; test `:110` |
| 501 | `provider_does_not_support_transcription` | provider's `abilities.transcribe` false. `:385-389`; test `:120` |
| by `VoiceError` kind | `{ error: <kind>, message }` | provider threw a `VoiceError`: `auth` 401, `rate_limit` 429, `not_found` 404, `invalid_input` 400, `format_unsupported` 415, `provider_unavailable` 503, `network` 502, `aborted` 499, `unknown` 500. `stream-routes.ts:486-523` |

Model resolution: request `model`, else the provider's `defaultModels.transcribe`, else `400 no_model`. No framework default. `stream-routes.ts:464-473`

Client: `client.transcribe({ audio: Uint8Array | Blob, mediaType?, language? })` returns `{ text, language? }`; `mediaType` defaults to `audio/webm`; sends the raw form with the session's `userId`. `client/src/client.ts:192-201,832-844`

## 4. Providers

### 4.1 `VoiceProvider`

Exported from `@flow-state-dev/core`. `core/src/types/voice-provider.ts:135-155`

| Member | Type | Meaning |
|---|---|---|
| `id` | `string` | stable id for telemetry |
| `providerName` | `string` | short name (`"openai"`, `"composite"`) |
| `abilities` | `{ speak, speakStream, transcribe, listVoices }` (booleans) | `true` guarantees the method exists; `false` means it is absent. Provider authors keep flags and methods in sync. `:20-30,128-134` |
| `defaultModels?` | `{ speak?, transcribe? }` | used when the call gives no `model` (the transcribe endpoint reads `transcribe`) |
| `speak?(options)` | `Promise<{ audio: Uint8Array; mediaType: string }>` | batch synthesis |
| `speakStream?(options)` | `AsyncIterable<{ kind: "audio"; bytes: Uint8Array; mediaType: string; isLast?: boolean }>` | streamed synthesis; `isLast` set on the final chunk |
| `transcribe?(options)` | `Promise<{ text: string; language?: string }>` | speech to text |
| `listVoices?()` | `Promise<VoiceInfo[]>` | voice catalog; `VoiceInfo` = `id`, `name`, `provider`, optional `language`, `accent`, `gender`, `age`, `previewUrl`, `supportedModels`, `raw` (`:101-122`) |

`SpeakOptions`: `text`, `voice?`, `model?`, `speed?`, `outputFormat?`, `signal?`, `providerOptions?`. `TranscribeOptions`: `audio` (`Uint8Array | Blob`), `mediaType?`, `language?` (BCP-47 hint), `model?`, `signal?`, `providerOptions?`. `:36-95`

Guards: `canSpeak`, `canSpeakStream`, `canTranscribe`, `canListVoices` check `abilities` (`:185-203`). The framework picks streaming when `canSpeakStream`, else batch (`tts-pipeline.ts:76,425-432`). A `true` flag with a missing method throws a native `TypeError` when called (`:128-134`).

### 4.2 `VoiceError`

`new VoiceError({ kind, provider, message, retryable?, status?, cause? })`; fields `kind`, `provider`, `retryable`, `status`. Exported from `@flow-state-dev/core`. `core/src/types/voice-error.ts:355-420`

| `kind` | `retryable` default |
|---|---|
| `auth` | false |
| `rate_limit` | true |
| `not_found` | false |
| `invalid_input` | false |
| `format_unsupported` | false |
| `provider_unavailable` | true |
| `network` | true |
| `aborted` | false |
| `unknown` | false |

(9 kinds, so a six-row table needs a split or a list; `voice-error.ts:366-377`.) Tests: `core/test/voice/voice-provider.test.ts:262-314`.

### 4.3 `createCompositeVoiceProvider`

`createCompositeVoiceProvider({ speak?, speakStream?, transcribe?, listVoices? })` each slot a `VoiceProvider`. `core/src/types/voice-provider.ts:210-241`
- `providerName` is `"composite"`; `id` is `composite:speak=<id>|stream=<id>|tx=<id>|voices=<id>`, empty slots `-`. `:226-237`
- `abilities` are read from the underlying provider for each slot, so a slot whose provider lacks the ability gives `false`, not a runtime failure. `:252-257`
- `speakStream` slot omitted: the `speak` provider is used for streaming when it advertises `speakStream`. `:217-222,250,157-186 test`
- No slots: every ability false; calling a method by a bad cast throws `VoiceError({ kind: "invalid_input" })`. `:300-312`; test `voice-provider.test.ts:227`

### 4.4 `OpenAIVoiceProvider` (`@flow-state-dev/voice-openai`)

`new OpenAIVoiceProvider(options?)`. Exports: `OpenAIVoiceProvider`, `OpenAIVoiceProviderOptions`, `OPENAI_VOICE_CATALOG`. `voice-openai/src/index.ts`

| Option | Default | Meaning |
|---|---|---|
| `apiKey` | SDK reads `OPENAI_API_KEY` | `openai-voice-provider.ts:27-31` |
| `baseURL` | OpenAI's | override for compatible endpoints / proxies |
| `organization`, `project` | none | forwarded to the SDK |
| `ttsModel` | `gpt-4o-mini-tts` | becomes `defaultModels.speak` |
| `sttModel` | `gpt-4o-mini-transcribe` | becomes `defaultModels.transcribe` |
| `voice` | `alloy` | default voice for `speak` |
| `client` | none | a pre-built `OpenAI` client; when set, `apiKey`, `baseURL`, `organization`, `project` are ignored |

`:25-50,71-83`. Abilities: `speak` true, `speakStream` **false**, `transcribe` true, `listVoices` true. So with it, TTS always takes the batch path. `:60-65`
- `speak`: `outputFormat` one of `mp3` (default), `opus`, `aac`, `flac`, `wav`, `pcm`, with media types `audio/mpeg`, `audio/ogg; codecs=opus`, `audio/aac`, `audio/flac`, `audio/wav`, `audio/pcm;rate=24000` (24 kHz 16-bit LE mono); anything else throws `format_unsupported`. `output-format.ts:13-47`
- `providerOptions.openai.instructions` is passed through; on `tts-1` and `tts-1-hd` it throws `invalid_input`. `openai-voice-provider.ts:102-115`
- `transcribe`: a `Uint8Array` needs `mediaType` or throws `invalid_input`; a `Blob` passes through. `:203-218`. OpenAI's reply carries no language, so `language` in the result is the request's hint. `:153-158`
- `listVoices()`: 13 voices: alloy, ash, ballad, coral, echo, fable, nova, onyx, sage, shimmer, verse, marin, cedar; `marin` and `cedar` list `supportedModels: ["gpt-4o-mini-tts"]`. `voice-catalog.ts:16-30`
- OpenAI errors map to `VoiceError` kinds (auth/permission → `auth`; rate limit → `rate_limit`; not found → `not_found`; bad request → `invalid_input` or `format_unsupported`; server error → `provider_unavailable`; connection → `network`; user abort → `aborted`; else `unknown`). `voice-openai/src/translate-error.ts`
- `id` is `openai:<12 hex chars of a hash of its configuration>`; the key is not part of it. `:182-195`

Existing page says an ElevenLabs adapter is planned (page line 13): not shipped, no surface; leave out.

## 5. Audio content type

### 5.1 `OutputAudioContent`

Member of the `Content` union. `contracts/src/items/content.ts:34-46`; import from `@flow-state-dev/core/items` (`tts-pipeline.ts:12`)

| Field | Type | Meaning |
|---|---|---|
| `type` | `"output_audio"` | |
| `audio` | `string` | base64 audio; empty string while streaming |
| `mediaType` | `string` | e.g. `audio/mpeg` |
| `transcript?` | `string` | the sentence that was synthesized |
| `ephemeral?` | `boolean` | the pipeline always sets `true` (`tts-pipeline.ts:190-196`) |

The page's type block (lines 187-193) omits `ephemeral`. The page's `"audio/mp3"` example is a comment only.

### 5.2 `content.audio.delta` event

`{ type: "content.audio.delta", itemId, contentIndex, audio (base64 chunk), isLast? }`. `contracts/src/items/events.ts:95-102`. `emitContentAudioDelta` takes `{ bytes, isLast }` and base64-encodes. `tts-pipeline.ts:374-387`.

### 5.3 What a reader sees where

- One audio part per sentence: each sentence is its own content part on the assistant message, indexed from 100 up (`getNextContentIndex` starts at 99 and adds 1, `tts-pipeline.ts:131-136`; text content uses low indexes).
- Batch: `content.added` then `content.done`, both carrying the full audio. Streaming: `content.added` (empty audio, default `audio/mpeg`), deltas, then `content.done` (empty audio, `mediaType` of the last chunk, the transcript). `tts-pipeline.ts:240-247,351-393`
- Stored items: content with `ephemeral: true` is dropped from the items written to the request record, so neither batch nor streamed audio is in the stored items. It is removed, not blanked. The event log is separate: `content.added` and `content.done` are saved with the part unfiltered (`response-emitter.ts:781-799,879-890`; `resume.ts:145-153`), so a reconnect replays a batch sentence's audio and transcript, and a streamed sentence's transcript with empty audio. `runAction.ts:430-466,661-690`. The page (line 198) says a snapshot "carries the transcript with empty audio" for streaming on reconnect: true of the live/replayed `content.done` event, not of the stored items. `useVoice` skips parts whose `audio` is empty. `useVoice.ts:181-190`
- Reconnect: `content.audio.delta` is never replayed, so a client that reconnects mid-sentence hears no more of that sentence; the transcript of a streamed sentence is recovered from the replayed `content.added`/`content.done`. `resume.ts:143-150`, `response-emitter.ts:775-800`

## 6. `useVoice` (React)

`useVoice(session: SessionView, options: UseVoiceOptions): VoiceState`, exported from `@flow-state-dev/react`. `react/src/voice/useVoice.ts:56-59`, `react/src/index.ts:228-231`

| Option | Type | Default | Meaning |
|---|---|---|---|
| `action` | `string` | required | action to send the transcript to |
| `buildInput` | `(text: string) => unknown` | `text => ({ message: text })` | transcript to action input |
| `baseUrl` | `string` | none | base URL for the transcription call |
| `apiPath` | `string` | `"/api/flows"` | where the flow API is mounted |
| `language` | `string` | `en-US` for browser recognition (`react/src/voice/speech-recognition.ts:67`); no default sent to transcription | language for recognition and the transcription hint |
| `autoPlayTTS` | `boolean` | `true` | play audio from assistant messages; also sets `ttsEnabled` on requests |

`useVoice.ts:18-31,82-83,216-224`.

Return (`VoiceState`): `isListening`, `isSpeaking`, `isProcessing`, `interimTranscript` (string), `isAvailable` (true after mount when `navigator.mediaDevices.getUserMedia` and `MediaRecorder` exist; false on first render), `startListening(): Promise<void>`, `stopListening(): Promise<void>`, `stopSpeaking(): void`. `useVoice.ts:33-50,88-93,307-316`
- `startListening` does nothing when `isAvailable` is false or already listening. `:207-208`
- `stopListening` stops recording, calls `client.transcribe` (media type from the recording, `audio/webm` if empty), then, if the text is not blank, sends `session.sendAction(action, buildInput(text), { metadata: { voice: { inputModality: "speech", ttsEnabled: autoPlayTTS } } })`. `:230-291`
- If transcription throws, the interim transcript is sent instead when it is non-blank; if there is none, nothing is sent and no error surfaces. Blank transcription text sends nothing. `:268-278`
- Interim text comes from the browser's Web Speech API and is empty without it. `:216-224`
- Streaming and batch audio both play, each part once; replayed parts with empty `audio` are skipped (`useVoice.ts:184-190`). `:112-202`
- Playback is stopped by `stopSpeaking()`.

## 7. Storage questions

Voice stores nothing of its own, so each part's answer:

- **Provider and `voice` config**: code (`createFlowState`, `createFlowApiRouter`, `defineFlow`); owner is the app; visible to nobody at runtime; not stored; one server-level provider plus at most one per flow.
- **Audio of a spoken reply**: owner is the request that produced it; visible over the stream; not in the stored items (marked `ephemeral`); a batch sentence's audio is replayed from the event log on reconnect, streamed audio deltas never are; one part per sentence for that request.
- **Transcript text of a reply sentence**: carried as `transcript` on the same part; replayed on reconnect via `content.added`/`content.done`, absent from the stored items. The reply's text is the normal assistant message and is stored as usual.
- **Uploaded audio for transcription**: owner is the caller (`userId`); only the caller's response sees the text; not stored by the endpoint (stateless; `route-auth.ts:262-264`); one request, one result. 25 MiB cap.
- **The transcript `useVoice` sends**: becomes an ordinary action input, stored as any action input is.

## 8. Left out, and why

- ElevenLabs adapter (page lines 13, 52-61): planned, no shipped surface. A custom-provider example may keep an invented `ElevenLabsVoiceProvider` only if it is declared in the example.
- "Voice is opt-in on two sides" framing and the page's three-step "What you need" list: narrative for the Concepts page, not Reference.
- Page statement "`voice.tts` ... so flows that don't opt in are unaffected" (page line 7): true (`runAction.ts:1895`) but a concept sentence.
- Page's `Content` "Voice adds one member": diff-flavoured; state the type, not the addition.
- Everything about the pipeline's concurrency slots, iterator return and cancel internals beyond 2.5: mechanism a reader cannot observe.

## 9. Open checks for the draft

1. Table budget: Reference has no row cap on words, but `user-docs.md` says no table over six rows; split the 9-kind `VoiceError` table and the 13-voice catalog (list, do not table).
