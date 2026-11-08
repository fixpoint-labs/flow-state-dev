/**
 * Low-level action execution hook with loading/error state tracking.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ExecuteActionResponse, RequestResult } from "@flow-state-dev/client";
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
  /**
   * When `true`, `execute` resolves to what the action answered
   * (`request.result()`: `status`, plus `output`, `outputNotRecorded` or
   * `error`), and `loading` holds until the request settles. An unmount stops
   * the wait, never the run. Without it, `execute` resolves when the server
   * accepts the send.
   */
  result?: boolean;
};

/**
 * Return type for useAction. `TResolved` is what `execute` resolves to: the
 * send's acceptance, or with `result: true` the request's result.
 */
export type UseActionResult<TResolved = ExecuteActionResponse> = {
  execute: (input: unknown, sessionId?: string) => Promise<TResolved>;
  readonly loading: boolean;
  readonly error?: Error;
};

/**
 * Low-level escape-hatch hook for executing a single named action. With
 * `result: true`, `execute` resolves to what the action answered.
 */
export function useAction(options: UseActionOptions & { result: true }): UseActionResult<RequestResult>;
export function useAction(options: UseActionOptions & { result?: false }): UseActionResult<ExecuteActionResponse>;
export function useAction(
  options: UseActionOptions
): UseActionResult<ExecuteActionResponse> | UseActionResult<RequestResult>;
export function useAction(
  options: UseActionOptions
): UseActionResult<ExecuteActionResponse> | UseActionResult<RequestResult> {
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
  const readResult = options.result === true;

  // Each execution's own controller, while it runs. An unmount aborts every one
  // of them, so no wait outlives the component, a layout effect's included; a
  // controller is never reused, so an execution after a (StrictMode) remount
  // starts unaborted.
  const running = useRef(new Set<AbortController>());
  useEffect(() => {
    const live = running.current;
    return () => {
      for (const controller of live) controller.abort();
      live.clear();
    };
  }, []);

  const execute = useCallback(
    async (input: unknown, sessionId?: string): Promise<ExecuteActionResponse | RequestResult> => {
      const controller = new AbortController();
      running.current.add(controller);
      setLoading(true);
      setError(undefined);

      try {
        const sent = await flow.send(options.action, input, { sessionId });
        return readResult ? await sent.result({ signal: controller.signal }) : sent.response;
      } catch (cause) {
        const normalized =
          cause instanceof Error ? cause : new Error(String(cause));
        if (!controller.signal.aborted) setError(normalized);
        throw normalized;
      } finally {
        running.current.delete(controller);
        // Loading while any execution still runs, an aborted one included in settling it.
        setLoading(running.current.size > 0);
      }
    },
    [flow, options.action, readResult]
  );

  return { execute, loading, error } as UseActionResult<ExecuteActionResponse> | UseActionResult<RequestResult>;
}
