/**
 * Public React-facing wrappers, render helpers, and context utilities.
 */
export type {
  CoreItemImportProof,
  CoreTypeImportProof
} from "./_core-import-smoke";
export { coreItemImportProof } from "./_core-import-smoke";

export {
  useFlow,
  type UseFlowOptions,
  type UseFlowResult
} from "./hooks/useFlow";

export {
  useSession,
  type SessionItemsOptions,
  type SessionView,
  type UseSessionHookOptions
} from "./hooks/useSession";

export {
  useClientData,
  type ClientDataScopeSubscribeOptions,
  type ClientDataSubscribeOptions,
  type ClientDataValues,
  type ZodSchemaLike
} from "./hooks/useClientData";

export {
  useAction,
  type UseActionOptions,
  type UseActionResult
} from "./hooks/useAction";

export {
  useRequestStream,
  type RequestStreamFilter,
  type UseRequestStreamOptions,
  type UseRequestStreamResult
} from "./hooks/useRequestStream";

export {
  ItemRenderer,
  type ItemRendererProps
} from "./components/ItemRenderer";

export {
  ItemsRenderer,
  type ItemsRendererProps
} from "./components/ItemsRenderer";

export type {
  BlockComponentType,
  RendererRegistry
} from "./registry/block-renderers";

export {
  FlowProvider,
  useFlowContext,
  getFlowContext,
  setFlowContext,
  withFlowContext,
  type FlowContextValue,
  type FlowProviderProps
} from "./context/FlowContext";

export {
  useVoice,
  createAudioRecorder,
  createAudioPlayer,
  createSpeechRecognition,
  isSpeechRecognitionAvailable,
  createVAD,
  type AudioPlayer,
  type AudioPlayerCallbacks,
  type AudioPlayerState,
  type AudioRecorder,
  type AudioRecorderOptions,
  type AudioRecorderState,
  type SpeechRecognitionCallbacks,
  type SpeechRecognitionHandle,
  type UseVoiceOptions,
  type VADCallbacks,
  type VADHandle,
  type VADOptions,
  type VoiceMode,
  type VoiceState
} from "./voice";

export const reactPackageMarker = "@flow-state-dev/react";
