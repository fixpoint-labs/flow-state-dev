/**
 * `@flow-state-dev/react/voice`: the recorder, player and speech-recognition
 * primitives, for an app that builds its own voice loop.
 *
 * `useVoice` drives all three and is what most apps want, so it stays on the
 * package root; these are the parts underneath it.
 */
export {
  createAudioRecorder,
  type AudioRecorder,
  type AudioRecorderOptions,
  type AudioRecorderStatus
} from "./audio-recorder";

export {
  createAudioPlayer,
  type AudioPlayer,
  type AudioPlayerCallbacks,
  type AudioPlayerStatus
} from "./audio-player";

export {
  createSpeechRecognition,
  isSpeechRecognitionAvailable,
  type SpeechRecognitionCallbacks,
  type SpeechRecognitionHandle
} from "./speech-recognition";
