---
"@flow-state-dev/react": minor
---

**Breaking:** the `@flow-state-dev/react` root drops fifteen names that only the framework reads (FIX-2604). No deprecated aliases: an old import fails to compile with "has no exported member". The hooks they sit behind are unchanged.

- `deriveSuspensions` moves to `@flow-state-dev/react/internal`, for the framework's own packages. An app reads pending stops through `useSuspensions`.
- `analyzeResumeSchema` is no longer published. Use `useSuspensionForm`, or `suspensionShape` to classify a stop.
- `INTERRUPT_WINDOW_MS` is no longer published. `useInterruptKeys` and `createInterruptKeys` keep the same window.
- The voice primitives are no longer published: `createAudioRecorder`, `createAudioPlayer`, `createSpeechRecognition`, `isSpeechRecognitionAvailable`, and the types `AudioRecorder`, `AudioRecorderOptions`, `AudioRecorderStatus`, `AudioPlayer`, `AudioPlayerCallbacks`, `AudioPlayerStatus`, `SpeechRecognitionCallbacks` and `SpeechRecognitionHandle`. Use `useVoice`, which drives them.

Docs: none. No README or docs page names these fifteen.
