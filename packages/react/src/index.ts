/**
 * Public React-facing wrappers, render helpers, and context utilities.
 */
export {
  useFlow,
  type UseFlowOptions,
  type UseFlowResult
} from "./hooks/useFlow";

export {
  useSession,
  type SessionItemsOptions,
  type SessionChildSessionsOptions,
  type FollowedRequest,
  type SessionRefreshOptions,
  type SessionView,
  type UseSessionHookOptions
} from "./hooks/useSession";

export {
  useHarnessLines,
  type HarnessLinesView,
  type UseHarnessLinesOptions
} from "./hooks/useHarnessLines";

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
  useApproval,
  resolveApprovalOutcome,
  approveOptionsOf,
  type ApprovalOption,
  type UseApprovalOptions,
  type UseApprovalResult,
  type ApprovalOutcome
} from "./hooks/useApproval";
export {
  useSuspensionForm,
  suspensionShape,
  type UseSuspensionFormOptions,
  type UseSuspensionFormResult,
  type SchemaField,
  type SuspensionValueKind,
  type SuspensionShape
} from "./hooks/useSuspensionForm";
export { QuestionRenderer } from "./components/QuestionRenderer";
export { SelectionRenderer } from "./components/SelectionRenderer";
export { SchemaFormRenderer } from "./components/SchemaFormRenderer";
export { type SuspensionFormRendererProps } from "./components/suspensionFormShared";

export {
  useRequestStream,
  type RequestStreamFilter,
  type RequestStreamSource,
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
  type ActivityItem,
  type ItemRenderSegment,
  type ItemsRendererProps
} from "./components/ItemsRenderer";

export {
  FlowNavigator,
  type FlowCardinality,
  type FlowNavigatorLeaf,
  type FlowNavigatorLeafState,
  type FlowNavigatorProps,
  type FlowNavigatorRow,
  type FlowNavigatorSection,
  type FlowNavigatorSlots,
  sessionLabel,
  sessionRowState,
  sessionAge,
  type SessionRowState
} from "./components/flow-navigator";

export {
  useJumpToLatest,
  type JumpToLatest,
  type JumpToLatestOptions,
  type SentLineMark
} from "./hooks/useJumpToLatest";

export { useDraft, clearDraft, readDraft, saveDraft } from "./hooks/useDraft";

export { useSubscription, type UseSubscriptionOptions } from "./hooks/useSubscription";
export {
  useSessionList,
  type SessionList,
  type SessionListClient,
  type UseSessionListOptions
} from "./hooks/useSessionList";

export {
  useSubmit,
  type Submit
} from "./hooks/useSubmit";

export {
  isSendKey,
  isTypingTarget,
  type SendKeyEvent,
  type SendKeyOptions
} from "./send-key";

export {
  createInterruptKeys,
  interruptChordLabel,
  useInterruptKeys,
  type InterruptKeyEvent,
  type InterruptKeyResult,
  type InterruptKeysOptions,
  type UseInterruptKeysOptions
} from "./interrupt-keys";

export type {
  BlockComponentType,
  RendererRegistry
} from "./registry/block-renderers";

export {
  FlowProvider,
  useFlowContext,
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
  type UseVoiceOptions,
  type VoiceState
} from "./voice";
