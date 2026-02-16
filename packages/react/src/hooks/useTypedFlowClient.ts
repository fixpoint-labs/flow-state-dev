/**
 * Typed flow client hook wrapper built on `@flow-state-dev/client`.
 */
import { createFlowClient } from "@flow-state-dev/client";
import type { FlowClient, FlowLike } from "@flow-state-dev/client";
import { getFlowContext } from "../context/FlowContext";

/**
 * Options for creating a typed flow-bound client from React package helpers.
 */
export type UseTypedFlowClientOptions<TFlow extends FlowLike> = {
  flow: TFlow;
  userId?: string;
  baseUrl?: string;
};

/**
 * Returns a typed flow-bound client using explicit options or shared flow context defaults.
 */
export function useTypedFlowClient<TFlow extends FlowLike>(
  options: UseTypedFlowClientOptions<TFlow>
): FlowClient<TFlow> {
  const context = getFlowContext();
  const userId = options.userId ?? context.userId;

  if (userId === undefined || userId.trim().length === 0) {
    throw new Error(
      "useTypedFlowClient requires userId (option or FlowContext)"
    );
  }

  return createFlowClient({
    flow: options.flow,
    userId,
    baseUrl: options.baseUrl ?? context.baseUrl
  });
}
