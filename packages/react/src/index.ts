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
  useResource,
  type UseResourceResult
} from "./hooks/useResource";

export {
  useResourceContent,
  type UseResourceContentResult
} from "./hooks/useResourceContent";

export {
  useResourceCollection,
  type CollectionActions,
  type CollectionItem,
  type CollectionListOptions,
  type UseResourceCollectionResult
} from "./hooks/useResourceCollection";

export {
  useResourceCollectionList,
  type UseResourceCollectionListResult
} from "./hooks/useResourceCollectionList";

export {
  useResourceCollectionItem,
  type UseResourceCollectionItemResult
} from "./hooks/useResourceCollectionItem";

export {
  useResourceManifest,
  type UseResourceManifestResult
} from "./hooks/useResourceManifest";

export {
  useAction,
  type UseActionOptions,
  type UseActionResult
} from "./hooks/useAction";

export {
  useContainerItems,
  type ContainerItemsResult
} from "./hooks/useContainerItems";

export {
  useSuspensions,
  deriveSuspensions,
  resolveSuspension,
  type ResolveSuspensionArgs,
  type SuspensionView,
  type UseSuspensionsOptions,
  type UseSuspensionsResult
} from "./hooks/useSuspensions";

export {
  ApprovalRenderer,
  type ApprovalRendererProps
} from "./components/ApprovalRenderer";

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
  buildItemRenderStream,
  type BuildItemRenderStreamOptions,
  type ItemRenderSegment,
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
  SuspensionResolverProvider,
  useSuspensionResolver,
  type SuspensionResolver,
  type SuspensionResolverProviderProps
} from "./context/SuspensionResolver";

export {
  useVoice,
  createAudioRecorder,
  createAudioPlayer,
  createSpeechRecognition,
  isSpeechRecognitionAvailable,
  type AudioPlayer,
  type AudioPlayerCallbacks,
  type AudioPlayerState,
  type AudioRecorder,
  type AudioRecorderOptions,
  type AudioRecorderState,
  type SpeechRecognitionCallbacks,
  type SpeechRecognitionHandle,
  type UseVoiceOptions,
  type VoiceState
} from "./voice";

export {
  AuditAnnotation,
  type AuditAnnotationProps,
  type AuditAnnotationData
} from "./components/AuditAnnotation";

export {
  AuditAnnotationProgress,
  type AuditAnnotationProgressProps
} from "./components/AuditAnnotationProgress";

export {
  ModelBadge,
  type ModelBadgeProps
} from "./components/ModelBadge";

export const reactPackageMarker = "@flow-state-dev/react";
