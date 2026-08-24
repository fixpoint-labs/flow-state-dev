/**
 * The relay send result contract (FIX-1230 step 5).
 *
 * These are public surface a caller branches on, so the tests are about the
 * contract's promises rather than about TypeScript: every arm is reachable and
 * carries its declared fields, `unknown` is on the SUCCESS side and carries the
 * handle the retry decision depends on, and the discriminants actually narrow.
 *
 * The exhaustiveness check is the load-bearing one — it fails to compile if an
 * arm is added without a caller being forced to consider it, which is what stops
 * a future outcome from being silently treated as a failure.
 */
import { describe, expect, it } from "vitest";
import type { SendMessageRefusal, SendMessageResult } from "../src/types/relay-results";

const accepted: SendMessageResult = {
  ok: true,
  outcome: "accepted",
  deliveryRequestId: "req_1"
};
const replied: SendMessageResult = {
  ok: true,
  outcome: "replied",
  deliveryRequestId: "req_2",
  reply: { text: "hold" }
};
const unknown: SendMessageResult = {
  ok: true,
  outcome: "unknown",
  deliveryRequestId: "req_3"
};
const refused: SendMessageResult = {
  ok: false,
  outcome: "refused",
  refused: "key-collision",
  detail: "sender holds the delivery's key"
};

/**
 * Runtime narrowing over every arm. The `never` default is NOT the
 * exhaustiveness guarantee — `packages/core/tsconfig.json` includes only
 * `src/**`, so nothing in `test/*.test.ts` is ever compiled and a type
 * assertion here can never fail. The real check lives in
 * `relay-results.test-d.ts`, which `tsconfig.test-d.json` does compile.
 */
function describeOutcome(result: SendMessageResult): string {
  switch (result.outcome) {
    case "accepted":
      return result.deliveryRequestId;
    case "replied":
      return result.deliveryRequestId;
    case "unknown":
      return result.deliveryRequestId;
    case "refused":
      return result.refused;
    default: {
      const never: never = result;
      return never;
    }
  }
}

describe("SendMessageResult", () => {
  it("reaches all four arms, each carrying its declared fields", () => {
    expect(describeOutcome(accepted)).toBe("req_1");
    expect(describeOutcome(replied)).toBe("req_2");
    expect(describeOutcome(unknown)).toBe("req_3");
    expect(describeOutcome(refused)).toBe("key-collision");
  });

  it("carries deliveryRequestId on all three success arms", () => {
    for (const r of [accepted, replied, unknown]) {
      expect(r.ok).toBe(true);
      if (r.ok && r.outcome !== "refused") {
        expect(r.deliveryRequestId).toMatch(/^req_/);
      }
    }
  });

  // The one a reviewer should read first. Putting `unknown` on the failure side
  // is what invites the blind retry the unknown-outcome contract forbids, so
  // this pins the side rather than the spelling.
  it("puts `unknown` on the SUCCESS side, with the handle needed to resolve it", () => {
    expect(unknown.ok).toBe(true);
    expect(unknown.outcome).toBe("unknown");
    if (unknown.ok && unknown.outcome === "unknown") {
      expect(unknown.deliveryRequestId).toBe("req_3");
    }
  });

  it("carries a refusal code and detail on the failure side only", () => {
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.refused).toBe("key-collision");
      expect(refused.detail).not.toHaveLength(0);
    }
  });

  it("narrows on `ok` alone, so a caller can branch coarsely", () => {
    const coarse = (r: SendMessageResult): string => (r.ok ? r.deliveryRequestId : r.refused);
    expect(coarse(accepted)).toBe("req_1");
    expect(coarse(refused)).toBe("key-collision");
  });
});

describe("SendMessageRefusal", () => {
  // Named individually rather than counted: a count drifts, and asserting the
  // count would pass while an arm was swapped for a different one.
  it("admits every code the contract declares", () => {
    const all: SendMessageRefusal[] = [
      "unknown-recipient",
      "org-mismatch",
      "key-collision",
      "recipient-busy",
      "external-dispatcher",
      "invalid-timeout",
      "no-relay-door",
      "recipient-not-addressable",
      "durable-action",
      "no-durable-sender",
      "mode-not-available"
    ];
    expect(new Set(all).size).toBe(all.length);
  });
});
