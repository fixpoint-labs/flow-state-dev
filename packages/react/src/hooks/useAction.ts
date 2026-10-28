/**
 * Low-level action execution hook with loading/error state tracking.
 */
import { useCallback, useMemo, useState } from "react";
import type { ExecuteActionResponse } from "@flow-state-dev/client";
import { useFlowContext } from "../context/FlowContext";
import { useClient } from "../internal/useClient";

/**
 * Options for useAction.
 */
export type UseActionOptions = {
  flowKind?: string;
  action: string;
  userId?: string;
  baseUrl?: string;
};

/**
 * Return type for useAction.
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
 * Low-level escape-hatch hook for executing a single named action.
 */
export function useAction(options: UseActionOptions): UseActionResult {
  const context = useFlowContext();
  const flowKind = options.flowKind ?? context.flowKind;
  const userId = options.userId ?? context.userId;

  if (!flowKind?.trim()) {
    throw new Error("useAction requires flowKind (option or FlowProvider)");
  }

  if (!userId?.trim()) {
    throw new Error("useAction requires userId (option or FlowProvider)");
  }

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | undefined>();

  const fsd = useClient({ userId, baseUrl: options.baseUrl });
  const flow = useMemo(() => fsd.flow(flowKind!), [fsd, flowKind]);

  const execute = useCallback(
    async (
      input: unknown,
      sessionId?: string
    ): Promise<ExecuteActionResponse> => {
      setLoading(true);
      setError(undefined);

      try {
        const sent = await flow.send(options.action, input, { sessionId });
        return sent.response;
      } catch (cause) {
        const normalized =
          cause instanceof Error ? cause : new Error(String(cause));
        setError(normalized);
        throw normalized;
      } finally {
        setLoading(false);
      }
    },
    [flow, options.action]
  );

  return { execute, loading, error };
}
