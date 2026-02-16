/**
 * Lightweight flow context store used by hook wrappers when callers omit options.
 */

/**
 * Shared context value used by React-facing helpers.
 */
export type FlowContextValue = {
  flowKind?: string;
  sessionId?: string;
  userId?: string;
  baseUrl?: string;
};

let currentFlowContext: FlowContextValue = {};

/**
 * Replaces the current flow context value.
 */
export function setFlowContext(value: FlowContextValue): void {
  currentFlowContext = {
    ...value
  };
}

/**
 * Reads the current flow context snapshot.
 */
export function getFlowContext(): FlowContextValue {
  return {
    ...currentFlowContext
  };
}

/**
 * Runs a callback with a temporary flow context value.
 */
export function withFlowContext<TValue>(
  value: FlowContextValue,
  run: () => TValue
): TValue {
  const previous = currentFlowContext;
  currentFlowContext = {
    ...value
  };

  try {
    return run();
  } finally {
    currentFlowContext = previous;
  }
}
