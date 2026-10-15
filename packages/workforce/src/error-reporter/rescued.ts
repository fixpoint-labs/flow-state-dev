/**
 * Send a failure a flow rescued into an answer. The request completes, so the
 * engine sends no final event. A leaf, so the flow does not import the
 * reporter. Never throws.
 */
import { dispatchThroughSeam } from "@flow-state-dev/core/types";
import type { BlockContext } from "@flow-state-dev/core/types";
import { ERROR_REPORTER_INTAKE_FLOW, INTAKE_ENTRY, INTAKE_SESSION_ID } from "./keys";

export async function reportRescuedFailure(
  ctx: BlockContext,
  failure: {
    readonly flowKind: string;
    readonly actionName: string;
    readonly blockName: string;
    readonly error: unknown;
  }
): Promise<void> {
  const userId = ctx.session.identity.userId;
  if (userId === undefined) return;
  const code = (failure.error as { code?: unknown } | null)?.code;
  try {
    await dispatchThroughSeam(ctx, {
      type: "internal",
      action: INTAKE_ENTRY,
      flowKind: ERROR_REPORTER_INTAKE_FLOW,
      session: { key: INTAKE_SESSION_ID },
      payload: {
        occurrence: {
          kind: "request",
          at: Date.now(),
          requestId: ctx.request.identity.id,
          sessionId: ctx.session.identity.id,
          userId,
          ...(ctx.session.identity.orgId === undefined ? {} : { orgId: ctx.session.identity.orgId }),
          flowKind: failure.flowKind,
          actionName: failure.actionName,
          blockName: failure.blockName,
          ...(typeof code === "string" ? { code } : {}),
          message: failure.error instanceof Error ? failure.error.message : String(failure.error)
        }
      },
      from: `${failure.blockName}-report`
    });
  } catch {
    return;
  }
}
