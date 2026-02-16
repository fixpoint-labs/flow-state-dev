/**
 * Action execution hook wrapper over the client action transport.
 */
import { createActionClient, type ExecuteActionResponse } from "@flow-state-dev/client";
import { getFlowContext } from "../context/FlowContext";

/**
 * Options for creating an action executor wrapper.
 */
export type UseActionOptions = {
  flowKind?: string;
  action: string;
  userId?: string;
  baseUrl?: string;
};

/**
 * State and API returned from `useAction` wrappers.
 */
export type UseActionResult = {
  execute: (
    input: unknown,
    sessionId?: string
  ) => Promise<ExecuteActionResponse>;
  readonly loading: boolean;
  readonly error?: Error;
};

/**
 * Returns action execution helpers with simple loading/error state.
 */
export function useAction(options: UseActionOptions): UseActionResult {
  const context = getFlowContext();
  const flowKind = options.flowKind ?? context.flowKind;
  const userId = options.userId ?? context.userId;

  if (flowKind === undefined || flowKind.trim().length === 0) {
    throw new Error("useAction requires flowKind (option or FlowContext)");
  }

  if (userId === undefined || userId.trim().length === 0) {
    throw new Error("useAction requires userId (option or FlowContext)");
  }

  const client = createActionClient({
    flowKind,
    userId,
    baseUrl: options.baseUrl ?? context.baseUrl
  });

  let loading = false;
  let error: Error | undefined;

  const execute = async (
    input: unknown,
    sessionId?: string
  ): Promise<ExecuteActionResponse> => {
    loading = true;
    error = undefined;

    try {
      return await client.sendAction(options.action, input, {
        sessionId
      });
    } catch (cause) {
      error = normalizeError(cause);
      throw error;
    } finally {
      loading = false;
    }
  };

  return {
    execute,
    get loading() {
      return loading;
    },
    get error() {
      return error;
    }
  };
}

function normalizeError(value: unknown): Error {
  if (value instanceof Error) {
    return value;
  }

  if (typeof value === "string" && value.length > 0) {
    return new Error(value);
  }

  return new Error("Unknown useAction error");
}
