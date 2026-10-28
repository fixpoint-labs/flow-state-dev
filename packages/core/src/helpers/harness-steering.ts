/**
 * Steering a harness turn from its own session: a line sent while a coding
 * turn runs is handed into that turn, when its harness can take one.
 *
 * A harness whose run can take a line mid-turn offers a `steer` through its
 * `onSteerable` hook, and withdraws it when the turn ends. {@link harnessSteering}
 * keeps each session's offer and builds the action a flow declares beside its
 * turn action, so any app that runs a harness turn in a session gets the same
 * behaviour. A host that runs its harness through a task board steers through
 * the board instead (`@flow-state-dev/harness-manager`).
 *
 * Offers live in this server process. A line sent to another process finds no
 * offer and answers `{ live: false }`, and the sender sends it as the next turn.
 */
import { z } from "zod";
import { handler } from "../blocks/handler";
import type { ActionCore } from "../types/flow";
import type { HarnessCallbackContext, HarnessSteer, HarnessSteerHook } from "../types/harness";

/** What became of a line handed to the running turn. */
export interface HarnessSteerAnswer {
  /** The running turn offered to take a line. */
  readonly live: boolean;
  /** The turn took it. `false` means nothing was sent: send it as the next turn. */
  readonly taken: boolean;
}

/** Options for {@link HarnessSteering.action}. */
export interface HarnessSteerActionOptions {
  /**
   * Called once the running turn took a line, with that turn's request id, so
   * the flow can record it on the turn. Not called for a line the turn refused.
   */
  onTaken?: (ctx: HarnessCallbackContext, turnRequestId: string, text: string) => void | Promise<void>;
}

/** One flow's steering: the hook its harness is handed, and the action that hands a line in. */
export interface HarnessSteering {
  /** Hand this to the harness block's `onSteerable`. */
  readonly onSteerable: HarnessSteerHook;
  /**
   * Hand `text` to the turn running in the calling session.
   *
   * @returns The answer, and the running turn's request id when it offered one.
   */
  steer(ctx: HarnessCallbackContext, text: string): Promise<HarnessSteerAnswer & { readonly turnRequestId: string | null }>;
  /**
   * The action to declare beside the turn action: input `{ prompt }`, output
   * {@link HarnessSteerAnswer}. Allowed beside a running turn, and never the
   * session's auto-resume target, so a client that reloads still reattaches
   * to the turn.
   */
  action(options?: HarnessSteerActionOptions): ActionCore;
}

/**
 * The key a session's offer is kept under: the framework's session identity,
 * never anything the caller sent. Encoded as a tuple, so no tenant and session
 * pair can spell another's.
 */
function offerKeyOf(ctx: HarnessCallbackContext): string {
  const identity = ctx.session.identity;
  return JSON.stringify([identity.tenantId ?? null, identity.id]);
}

/**
 * Create one flow's steering.
 *
 * ```ts
 * const steering = harnessSteering();
 * const agent = cursorAgent({ cwd, resume, onSession, onSteerable: steering.onSteerable });
 * defineFlow({
 *   kind: "coder",
 *   actions: {
 *     turn: { block: turn(agent), concurrency: "defer" },
 *     steer: steering.action(),
 *   },
 * });
 * ```
 */
export function harnessSteering(): HarnessSteering {
  const offers = new Map<string, { readonly steer: HarnessSteer; readonly requestId: string }>();

  const onSteerable: HarnessSteerHook = (steer, ctx) => {
    const key = offerKeyOf(ctx);
    const requestId = ctx.request.identity.id;
    if (steer !== null) {
      offers.set(key, { steer, requestId });
      return;
    }
    // A turn withdraws only its own offer, never a later turn's.
    if (offers.get(key)?.requestId === requestId) offers.delete(key);
  };

  const steer: HarnessSteering["steer"] = async (ctx, text) => {
    const offer = offers.get(offerKeyOf(ctx));
    if (offer === undefined) return { live: false, taken: false, turnRequestId: null };
    const taken = (await offer.steer(text)) === "delivered";
    return { live: true, taken, turnRequestId: offer.requestId };
  };

  const action = (options: HarnessSteerActionOptions = {}): ActionCore => ({
    block: handler({
      name: "steer-running-turn",
      inputSchema: z.object({ prompt: z.string().min(1) }),
      outputSchema: z.object({ taken: z.boolean(), live: z.boolean() }),
      execute: async (input, ctx) => {
        const answer = await steer(ctx as HarnessCallbackContext, input.prompt);
        if (answer.taken && answer.turnRequestId !== null) {
          await options.onTaken?.(ctx as HarnessCallbackContext, answer.turnRequestId, input.prompt);
        }
        return { taken: answer.taken, live: answer.live };
      },
    }),
    concurrency: "allow",
    autoResume: false,
  });

  return { onSteerable, steer, action };
}
