/**
 * Shared UI metadata contract for framework adapters.
 */
export interface FlowUIState {
  isStreaming: boolean;
  canSubmit: boolean;
}

/**
 * Normalizes optional booleans for UI rendering.
 */
export function useFlowUIState(state?: Partial<FlowUIState>): FlowUIState {
  return {
    canSubmit: state?.canSubmit ?? true,
    isStreaming: state?.isStreaming ?? false,
  };
}
