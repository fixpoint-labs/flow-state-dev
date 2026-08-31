/**
 * How a relay delivery is arbitrated (FIX-1230).
 *
 * A message obeys the recipient's declared concurrency policy — it is not exempt
 * from it — with two adjustments the door form and the delivery's nature force:
 *
 *  - **Policy follows the DOOR FORM.** A declared `relay.on[kind]` binding carries
 *    a provenance-only name against `flow.actions`, exactly as an event or a
 *    detached dispatch does, so it takes the flow default; letting it inherit a
 *    same-named public action's policy would let an unrelated action's
 *    back-pressure decide whether messages run. A `flow.actions[kind]`
 *    fallthrough is that action addressed as itself, so its own override applies.
 *  - **Admission is unbounded.** A queued delivery waits as long as the key is
 *    held rather than being dropped at the default budget. Nobody is holding a
 *    connection at the other end, and dropping a message to protect a timer
 *    nobody is watching is the wrong trade.
 */
import { describe, expect, it } from "vitest";
import { createConcurrencyArbiter } from "../../src/transports/concurrency/arbiter";
import type { ConcurrencyFlowView } from "../../src/transports/concurrency/arbiter";
import type { DispatchEnvelope } from "../../src/transports/dispatcher";
import { RELAY_SOURCE } from "../../src/execution/transport-sources";

/** A flow whose public `question` action declares its own reject policy. */
const flow: ConcurrencyFlowView = {
  actions: { question: { concurrency: { policy: "reject", key: "user" } } },
  request: { concurrency: { policy: "queue", key: "session" } }
};

function envelope(overrides: Partial<DispatchEnvelope> = {}): DispatchEnvelope {
  return {
    requestId: "req_1",
    flowKind: "f",
    actionName: "question",
    input: {},
    userId: "u_alice",
    sessionId: "s_r",
    source: RELAY_SOURCE,
    metadata: {
      relay: {
        kind: "question",
        door: "declared",
        from: "s_s",
        fromLineageId: "lin_s",
        recipientLineageId: "lin_r"
      }
    },
    ...overrides
  };
}

describe("relay arbitration", () => {
  it("a DECLARED binding takes the flow default, not a same-named public action's override", () => {
    const decision = createConcurrencyArbiter().resolve(flow, "question", envelope());

    // The flow default, not the action's `reject`/`user`.
    expect(decision).toMatchObject({ policy: "queue", key: "s_r" });
  });

  it("a FALLTHROUGH takes the public action's own override", () => {
    // The negative of the case above, and the reason it is not vacuous: if the
    // door form were ignored, both cases would resolve the same policy and one
    // of the two assertions would be wrong.
    const decision = createConcurrencyArbiter().resolve(
      flow,
      "question",
      envelope({
        metadata: {
          relay: {
            kind: "question",
            door: "action",
            from: "s_s",
            fromLineageId: "lin_s",
            recipientLineageId: "lin_r"
          }
        }
      })
    );

    expect(decision).toMatchObject({ policy: "reject", key: "u_alice" });
  });

  it("asks for unbounded admission, so a queued delivery is never dropped at the default budget", () => {
    const decision = createConcurrencyArbiter().resolve(flow, "question", envelope());

    expect(decision.waitTimeoutMs).toBe(Number.POSITIVE_INFINITY);
  });

  it("ignores a relay coordinate presented on a NON-relay source — the source is the gate", () => {
    // `metadata` is the caller's own bag, spread verbatim by the HTTP action
    // route. A caller who POSTs `{ metadata: { relay: { door: "declared" } } }`
    // must not thereby skip a public action's reject policy — which is exactly
    // the bypass this file's sibling rule already closes for `metadata.webhook`.
    const decision = createConcurrencyArbiter().resolve(
      flow,
      "question",
      envelope({ source: "http" })
    );

    expect(decision).toMatchObject({ policy: "reject", key: "u_alice" });
    expect(decision.waitTimeoutMs).toBeUndefined();
  });

  it("invokes a CUSTOM key function exactly once per dispatch", async () => {
    // A stateful or time-varying key called twice would pass a check on one
    // value and gate on another, which is worse than not checking. Counted on a
    // real key rather than asserted about the code path.
    let calls = 0;
    const customFlow: ConcurrencyFlowView = {
      actions: {},
      request: {
        concurrency: {
          policy: "queue",
          key: () => {
            calls += 1;
            return `k_${calls}`;
          }
        }
      }
    };
    const arbiter = createConcurrencyArbiter();

    const decision = arbiter.resolve(customFlow, "question", envelope());
    await arbiter.gate(decision, "req_1")(async () => undefined);

    expect(calls).toBe(1);
    // And the key the gate used is the one the resolution produced, rather than
    // a second evaluation that happened to look the same.
    expect(decision.key).toBe("k_1");
  });

  it("still honours the default budget for a non-relay queued dispatch", () => {
    // The off state (BP-035): widening admission for relay must not quietly
    // remove the bound from every other queued dispatch.
    const decision = createConcurrencyArbiter().resolve(
      { actions: {}, request: { concurrency: { policy: "queue", key: "session" } } },
      "anything",
      envelope({ source: "http", metadata: {} })
    );

    expect(decision.waitTimeoutMs).toBeUndefined();
  });
});
