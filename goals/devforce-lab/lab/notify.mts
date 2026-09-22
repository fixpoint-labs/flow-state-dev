/**
 * The lab's notify block — the `notify` slot `defineChannelFlow` takes.
 *
 * **Not a second fan-out.** `channel-flow.ts` keeps the member walk: it reads
 * the roster off the channel's own session state and runs this block once per
 * declared member per post. What is the lab's here is only the *policy* — which
 * member each post reaches — because the dispatch seam refuses a target taken
 * out of stored data, so a notify block has to declare its own addresses.
 *
 * Two rules, and they are the whole of it:
 *
 *   1. **A post with an `author` routes to nobody.** A seat's own answer is a
 *      post like any other, and `channel-flow.ts` taps the hand-off for *every*
 *      post and passes `author` straight through. Without this gate two seats
 *      that answer each other never stop — 1 → 2 → 4 → 8 detached dispatches
 *      with nothing to bound them. Nothing in this lab posts back today, so the
 *      guard is currently inert; it is written anyway because the hazard is in
 *      the primitive rather than in this lab, `author` is still on
 *      `channelNotifyInputSchema`, and ER-Collab's producer is expected to
 *      reuse this channel leg with seats that *do* reply. A cycle break that
 *      arrives with the second poster arrives too late.
 *   2. **A member with no declared address is recorded and skipped.** The other
 *      members still run, and membership is never changed by a delivery.
 *
 * Rule 2 is how BR-8 is satisfied rather than asserted. `CHANNEL.md` declares
 * three members; only the EM is in the address map, so the coder and the
 * reviewer are true no-ops in the fan-out — not "dispatched to a block that
 * happens to do nothing", but never dispatched to at all, with the skip
 * recorded so the check grades a fact rather than an absence.
 *
 * **What BR-8 forbids is the second kind of dispatch, not this one.** The
 * framework invokes a notify block once per declared member however this map is
 * written; what must never reach the reviewer is *work* — a board hand-off or a
 * harness run. That is graded on the board dispatch record by `flowId`, and the
 * two are different things (see the check's own `work-reaches-the-reviewer`
 * control).
 */

import { handler, sequencer, dispatcher } from "@flow-state-dev/core";
import { channelNotifyInputSchema, type ChannelNotifyInput } from "@flow-state-dev/workforce";
import { z } from "zod";
import { POST_ENTRY } from "./workforce/flows/workers/em.mts";

/** What the router decided about one member's delivery. */
const decisionSchema = z.object({
  /** The member to dispatch to, or null when this delivery routes to nobody. */
  target: z.string().nullable(),
  member: z.string(),
  channelId: z.string(),
  body: z.string(),
});

type Decision = z.infer<typeof decisionSchema>;

/** What the router recorded about one run — the evidence BR-6 and BR-8 are graded on. */
export interface NotifyLog {
  /**
   * Every member the fan-out actually dispatched to, in order.
   *
   * Recorded because a stray dispatch whose seat produces nothing would
   * otherwise be indistinguishable from no dispatch at all, and then "the post
   * reached the EM and nobody else" would rest on an absence.
   */
  addressed: string[];
  /** Every member the router saw with no declared address. */
  skipped: string[];
  /** Every member whose line was refused routing because it carried an author. */
  authored: string[];
  /** Every delivery the substrate refused, by message. */
  refusals: string[];
}

/** A fresh, empty log. */
export function createNotifyLog(): NotifyLog {
  return { addressed: [], skipped: [], authored: [], refusals: [] };
}

export interface LabNotifyOptions {
  /**
   * Member id → the hired seat's instance id it is delivered to.
   *
   * Every id here is a seat `hireWorkforce` minted, so a dispatcher can name
   * it. A member absent from this map is recorded and skipped.
   */
  addresses: Record<string, string>;
  /** Where the run's routing decisions are recorded. */
  log: NotifyLog;
}

/**
 * Build the notify slot.
 *
 * @param options The address map and the log to record into.
 * @returns The block to pass as `defineChannelFlow({ notify })`.
 */
export function labNotify(options: LabNotifyOptions) {
  const { addresses, log } = options;
  const members = Object.keys(addresses);

  /**
   * The one decision point. Every condition below is a pure lookup on what this
   * block returned, so the policy lives in exactly one place — a second copy of
   * it in the conditions is how a router comes to route two different ways.
   */
  const decide = handler({
    name: "devforce-notify-decide",
    inputSchema: channelNotifyInputSchema,
    outputSchema: decisionSchema,
    execute: (input: ChannelNotifyInput): Decision => {
      const nowhere: Decision = {
        target: null,
        member: input.member,
        channelId: input.channelId,
        body: input.body,
      };
      // Rule 1 — the cycle break.
      if (input.author !== undefined) {
        log.authored.push(input.member);
        return nowhere;
      }

      // Rule 2 — a declared member this lab has no address for.
      if (!Object.hasOwn(addresses, input.member)) {
        log.skipped.push(input.member);
        return nowhere;
      }
      log.addressed.push(input.member);
      return { ...nowhere, target: input.member };
    },
  });

  /** Captures why a delivery failed, at the point it fails. */
  const recordRefusal = handler({
    name: "devforce-notify-refused",
    inputSchema: z.unknown(),
    outputSchema: z.object({ delivered: z.literal(false) }),
    execute: (error: unknown) => {
      log.refusals.push(error instanceof Error ? error.message : String(error));
      return { delivered: false as const };
    },
  });

  /**
   * One dispatcher per addressed member, because `flowKind` is a static
   * instance id and not a function.
   *
   * `session: { key }`, never `{ id }`: a seat has no session until something
   * wakes it, and an exact id nothing created is refused `session-not-found` by
   * name. The `key` child is derived, created on first delivery, and inherits
   * the sender's org — which is what carries the seat's document reads.
   */
  const toSeat = (member: string) =>
    dispatcher({
      name: `devforce-notify-${member.replace(/\./g, "-")}`,
      action: POST_ENTRY,
      flowKind: addresses[member]!,
      inputSchema: decisionSchema,
      payload: (decision: Decision) => ({
        channelId: decision.channelId,
        body: decision.body,
        member: decision.member,
      }),
      session: { key: () => member },
    } as never);

  let seq: any = sequencer({
    name: "devforce-notify",
    inputSchema: channelNotifyInputSchema,
  }).step(decide);

  for (const member of members) {
    seq = seq.stepIf(
      (decision: Decision) => decision.target === member,
      // One member's refusal is absorbed here as well as by the framework's own
      // rescue, so the reason is recorded rather than only counted.
      (toSeat(member) as any).rescue([{ block: recordRefusal }]),
    );
  }

  return seq;
}
