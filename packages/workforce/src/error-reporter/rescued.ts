/**
 * A failure a flow rescued into an answer still counts (FIX-1983): its
 * request completes, so the engine sends no final event for it, and the flow
 * hands it to the Error Reporter's intake itself. A leaf module, so a flow
 * can send one without importing the reporter.
 */
import { dispatchThroughSeam } from "@flow-state-dev/core/types";
import type { BlockContext } from "@flow-state-dev/core/types";
import { ERROR_REPORTER_INTAKE_FLOW, INTAKE_ENTRY, INTAKE_SESSION_ID } from "./keys";

/** What a rescued failure is reported as: the request it was rescued in, and what failed. */
export interface RescuedFailure {
  /** The flow and the action the request ran. */
  readonly flowKind: string;
  readonly actionName: string;
  /** The block whose failure was rescued. */
  readonly blockName: string;
  /** What it threw. */
  readonly error: unknown;
}

/**
 * Send a rescued failure to the Error Reporter's intake, as a request that
 * failed. Never throws: a Lab with no reporter refuses it, and a send that
 * fails is dropped, as the rescue's answer stands either way.
 *
 * @param ctx The rescuing block's context: the request, session and user are read from it.
 * @param failure The flow, action and block, and what was thrown.
 * @returns Whether the intake took it.
 */
export async function reportRescuedFailure(ctx: BlockContext, failure: RescuedFailure): Promise<boolean> {
  const userId = ctx.session.identity.userId;
  if (userId === undefined) return false;
  const code = (failure.error as { code?: unknown } | null)?.code;
  try {
    const outcome = await dispatchThroughSeam(ctx, {
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
    return outcome.ok;
  } catch {
    return false;
  }
}
