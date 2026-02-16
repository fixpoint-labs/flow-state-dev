/**
 * Public React-facing wrappers, render helpers, registry helpers, and context utilities.
 */
export type { CoreItemImportProof, CoreTypeImportProof } from "./_core-import-smoke";
export { coreItemImportProof } from "./_core-import-smoke";

export {
  useFlowAgent,
  type UseFlowAgentOptions,
  type UseFlowAgentResult
} from "./hooks/useFlowAgent";

export {
  useSession,
  type UseSessionOptions,
  type UseSessionResult
} from "./hooks/useSession";

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
  useTypedFlowClient,
  type UseTypedFlowClientOptions
} from "./hooks/useTypedFlowClient";

export {
  ItemRenderer,
  type ItemRendererProps
} from "./components/ItemRenderer";

export {
  ItemsRenderer,
  type ItemsRendererProps
} from "./components/ItemsRenderer";

export {
  MessagesRenderer,
  type MessagesRendererProps
} from "./components/MessagesRenderer";

export {
  BlockRenderer,
  type BlockRendererComponentProps
} from "./components/BlockRenderer";

export {
  clearBlockRenderers,
  getBlockRenderer,
  listBlockRendererKeys,
  registerBlockRenderer,
  type BlockComponentType,
  type BlockRendererProps
} from "./registry/block-renderers";

export {
  getFlowContext,
  setFlowContext,
  withFlowContext,
  type FlowContextValue
} from "./context/FlowContext";

export const reactPackageMarker = "@flow-state-dev/react";
