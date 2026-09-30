/**
 * Raising the EM seat's ask — the one step a host calls to put an approval in
 * front of a person, before anyone has done anything.
 *
 * Its own module, beside `notify.mts`, because two kinds of host call it:
 * `openLab` (the goal checks) and a host that builds its own flow state rather
 * than opening through the lab, such as an `fsdev` config App Lab serves. The
 * host keeps one option and one call; the rule for when to ask lives here.
 *
 * What it does, and nothing else: in the EM seat's own session (`s_<seat id>`,
 * the one `file` and `drain` run in, and which a session listing returns), run
 * the asking door as the given person until it suspends on a stock
 * `human_approval`. The answer is not this module's business: it arrives
 * through the engine's resume route, the one App Lab's Inbox uses.
 *
 * **Once per feature, per store.** A second call finds the earlier ask in the
 * seat's session, pending or answered, or a row another door already filed,
 * and raises nothing. A denied feature stays denied until the store is fresh:
 * asking again on every restart would put back in a person's Inbox an ask they
 * already declined. The guard reads the request history the engine keeps, so a
 * Deny needs no record of its own.
 *
 * **It throws rather than reporting.** A host that asked for the ask and got
 * none would show an empty Inbox, which the closure could not tell from a shell
 * that failed to read one. Every refusal names this step.
 */

import { runAction, type FlowState } from "@flow-state-dev/engine";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { harnessTaskId } from "@flow-state-dev/harness-manager/checkout";
import { LEDGER_ID } from "./board.mts";
import { PHASE } from "./phase.mts";
import { ASK_ENTRY } from "./seat-config.mts";

/** The step's name, as every refusal spells it. */
export const RAISE_ASK_STEP = "raiseAsk";

/** The feature a person is asked to approve. */
export interface AskFeature {
  /** The row's identity: the issue slug the row id is derived from. */
  issue: string;
  /** What the feature is, in one line. */
  goal: string;
}

export interface RaiseAskOptions {
  /** The flow state the seats are registered in. Must have durable execution on. */
  state: FlowState;
  /** The hired EM seat, whose own session the ask is raised in. */
  emSeat: FlowInstance;
  /** What to ask about. */
  feature: AskFeature;
  /** The person the ask runs as, and whose Inbox lists it. */
  principal: { userId: string; orgId: string };
}

/** What the step did. */
export type RaiseAskResult =
  | { raised: true; requestId: string; sessionId: string }
  | { raised: false; reason: string; sessionId: string };

/**
 * The session a seat's own actions run in — one per seat, stable across runs.
 *
 * Top-level, not a dispatch run: nothing has to post first for it to exist.
 */
export function seatSessionId(seatId: string): string {
  return `s_${seatId.replace(/\./g, "_")}`;
}

/**
 * Raise the ask once, in the EM seat's own session, and return once it is
 * pending.
 *
 * @param options The flow state, the EM seat, the feature and the person.
 * @returns `raised: true` with the request id, or `raised: false` naming the
 *   earlier ask or row that made a second one wrong.
 * @throws If durable execution is off, the seat has no asking door, or the
 *   request ended in anything but a pending suspension. Every message starts
 *   with {@link RAISE_ASK_STEP}.
 */
export async function raiseAsk(options: RaiseAskOptions): Promise<RaiseAskResult> {
  const { state, emSeat, feature, principal } = options;
  const sessionId = seatSessionId(emSeat.id);
  const refuse = (why: string): never => {
    throw new Error(`${RAISE_ASK_STEP}: the ask for "${feature.issue}" was not raised — ${why}`);
  };

  const runtime = await state.getRuntime();
  if (runtime.runtimeConfig.durabilityProvider === undefined) {
    refuse("the flow state has no durable execution, so there is nothing for the answer to resume");
  }
  if ((emSeat as { actions?: Record<string, unknown> }).actions?.[ASK_ENTRY] === undefined) {
    refuse(`seat "${emSeat.id}" has no "${ASK_ENTRY}" action`);
  }

  // Once per feature. Any ask for this issue that is not a failed run counts,
  // whatever its answer: pending, approved or denied.
  const earlier = await runtime.stores.request.list({ sessionId, userId: principal.userId });
  const asked = earlier.find(
    (request) =>
      request.actionName === ASK_ENTRY &&
      (request.input as { issue?: unknown } | undefined)?.issue === feature.issue &&
      request.status !== "failed",
  );
  if (asked !== undefined) {
    return {
      raised: false,
      sessionId,
      reason: `request ${asked.id} already asked about "${feature.issue}" (${asked.status})`,
    };
  }
  const taskId = harnessTaskId(feature.issue, PHASE);
  const row = await runtime.stores.resourceState.get("user", principal.userId, `${LEDGER_ID}/${taskId}`);
  if (row !== undefined) {
    return { raised: false, sessionId, reason: `row ${taskId} is already on the board` };
  }

  let result: { requestId?: string; error?: unknown };
  try {
    // `runAction`, the entry the action route dispatches into, rather than the
    // route itself: the route answers 202 before the run reaches its gate, and
    // this step's promise is that the ask is pending when it returns.
    result = (await runAction({
      flow: emSeat,
      actionName: ASK_ENTRY,
      input: { issue: feature.issue, goal: feature.goal },
      userId: principal.userId,
      orgId: principal.orgId,
      sessionId,
      stores: runtime.stores,
      runtimeConfig: { ...runtime.runtimeConfig },
    } as never)) as { requestId?: string; error?: unknown };
  } catch (error) {
    return refuse(error instanceof Error ? error.message : String(error));
  }
  if (result.error !== undefined) {
    refuse(
      typeof result.error === "object" && result.error !== null && "message" in result.error
        ? String((result.error as { message: unknown }).message)
        : String(result.error),
    );
  }

  // Graded on what the store recorded rather than on what came back: a
  // pending ask is a fact about the request a person's Inbox reads.
  const request =
    result.requestId === undefined ? undefined : await runtime.stores.request.get(result.requestId);
  if (request === undefined) return refuse("no request was recorded in the seat's session");
  if (request.status !== "suspended") {
    return refuse(`the request ended "${request.status}" instead of waiting on a person`);
  }
  return { raised: true, requestId: request.id, sessionId };
}
