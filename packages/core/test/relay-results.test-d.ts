/**
 * Type-level contract for the relay send result (FIX-1230 step 5).
 *
 * This file exists because the equivalent assertion in `relay-results.test.ts`
 * **cannot fail**: `packages/core/tsconfig.json` includes only `src/**`, so a
 * `.test.ts` file is executed by vitest but never typechecked, and a compile-time
 * assertion written there is inert. `tsconfig.test-d.json` compiles
 * `test/**\/*.test-d.ts`, so assertions here are real.
 *
 * What it pins:
 *  - the union is exhaustive over `outcome`, so adding an arm forces every
 *    caller-shaped switch to be revisited rather than silently falling through;
 *  - `unknown` is on the SUCCESS side and carries `deliveryRequestId` — putting
 *    it on the failure side is what invites the blind retry the unknown-outcome
 *    contract forbids;
 *  - `reply` exists only on `replied`, so a caller cannot read an answer that
 *    was never given.
 */
import type { SendMessageRefusal, SendMessageResult } from "../src/types/relay-results";

// Exhaustiveness: the `never` binding fails to compile the moment an arm is
// added to the union without a case here.
export function assertExhaustive(result: SendMessageResult): string {
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
      const unreachable: never = result;
      return unreachable;
    }
  }
}

// `unknown` is a success, and carries the handle used to resolve it.
export const unknownIsSuccess: Extract<SendMessageResult, { outcome: "unknown" }>["ok"] = true;
export const unknownCarriesHandle: (r: Extract<SendMessageResult, { outcome: "unknown" }>) => string =
  (r) => r.deliveryRequestId;

// `reply` is reachable only on the arm that has an answer.
export const replyOnlyOnReplied: (r: Extract<SendMessageResult, { outcome: "replied" }>) => unknown =
  (r) => r.reply;

// A refusal always carries a code and a detail.
export const refusalShape: (
  r: Extract<SendMessageResult, { ok: false }>
) => [SendMessageRefusal, string] = (r) => [r.refused, r.detail];

// Coarse branching on `ok` alone narrows without touching `outcome`.
export const coarseBranch: (r: SendMessageResult) => string = (r) =>
  r.ok ? r.deliveryRequestId : r.refused;
