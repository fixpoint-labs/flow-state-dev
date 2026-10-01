# Voice

STT input and TTS output through one `VoiceProvider` (`packages/core/src/types/voice-provider.ts`). Setup, `useVoice`, the transcription endpoint and writing a provider are user-facing: [Voice](../../apps/docs/docs/advanced/voice.md). Reference provider: `@flow-state-dev/voice-openai` (`speak`, `transcribe`, `listVoices`; no streaming).

## Capability narrowing

A provider declares `abilities` (`speak`, `speakStream`, `transcribe`, `listVoices`). The router and pipeline **never call a method blindly**; they narrow with `canSpeak` / `canSpeakStream` / `canTranscribe` / `canListVoices`, so a partial provider degrades cleanly (transcribe-only → no TTS; no streaming → batch `speak`). No provider → TTS skipped and `POST /api/flows/transcribe` returns 501. A flow's `voice.provider` overrides the router-level one.

## TTS pipeline (`packages/engine/src/voice/`)

Runs inside `runAction` when the flow has `voice.tts`. `TTSEmitterHook` observes the emitter (via `addEventObserver`, a read-only consumer beside the SSE writer). Assistant `content.delta` text feeds a `SentenceBuffer` (boundary: `.`/`!`/`?` + whitespace); each sentence goes to `speakStream()` if advertised, else `speak()`; remaining text flushes on completion.

- **Synthesis errors are non-fatal**: reported and logged; text streaming continues.
- **Batch path:** one `OutputAudioContent` per sentence via `content.added`.
- **Streaming path:** `content.added` placeholder declaring `mediaType`, then `content.audio.delta` chunks, then a `content.done` snapshot closing the part. The first chunk is pulled under a first-chunk timeout composed with the request signal; the rest drain with no per-chunk timer. A synthesis slot is held for the whole drain, so **head-of-line blocking across sentences is intrinsic and accepted**.
- Chunks are **not replayable**; the durable form is the final snapshot ([Streaming](./streaming.md#durability-ordering)).
- `ttsHook.cancel()` on failure paths must not throw (see [Execution and Errors](./execution-and-errors.md#drain-on-terminal-paths)).

## Client

The React audio player (`packages/react/src/voice/audio-player.ts`) schedules decoded chunks on `AudioBufferSourceNode`s at a moving `nextStartTime` cursor so they butt up gap-free; the batch path is `enqueueChunk` with `isLast: true`. MP3 only for streaming (PCM/WAV need header injection or an AudioWorklet). `useVoice` records `(itemId, contentIndex)` pairs that received chunks and skips the batch scanner for them, so the final snapshot **doesn't double-play**.
