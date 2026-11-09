---
"@flow-state-dev/react": minor
---

**Breaking:** the `@flow-state-dev/react` root drops fifteen names (FIX-2604): three that only the framework reads, and the twelve voice primitives, which move to a new subpath, `@flow-state-dev/react/voice`. No deprecated aliases: an old root import fails to compile with "has no exported member". The hooks these names sit behind, `useVoice` among them, stay on the root unchanged.

- `deriveSuspensions` moves to `@flow-state-dev/react/internal`, for the framework's own packages. An app reads pending stops through `useSuspensions`.
- `analyzeResumeSchema` is no longer published. Use `useSuspensionForm`, or `suspensionShape` to classify a stop.
- `INTERRUPT_WINDOW_MS` is no longer published. `useInterruptKeys` and `createInterruptKeys` keep the same window.
- The voice primitives move to `@flow-state-dev/react/voice`: `createAudioRecorder`, `createAudioPlayer`, `createSpeechRecognition`, `isSpeechRecognitionAvailable`, and the types `AudioRecorder`, `AudioRecorderOptions`, `AudioRecorderStatus`, `AudioPlayer`, `AudioPlayerCallbacks`, `AudioPlayerStatus`, `SpeechRecognitionCallbacks` and `SpeechRecognitionHandle`. Change `from "@flow-state-dev/react"` to `from "@flow-state-dev/react/voice"` for these names. `AudioRecorderStatus` and `AudioPlayerStatus` were `AudioRecorderState` and `AudioPlayerState` on the root.

Docs: packages/react/README.md (a `@flow-state-dev/react/voice` entry: the recorder, player and speech-recognition primitives `useVoice` drives, for an app that builds its own voice loop, with the twelve names above; `useVoice` stays on the root).
