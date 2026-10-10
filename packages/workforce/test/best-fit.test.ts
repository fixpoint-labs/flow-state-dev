/**
 * Best fit's ladder on its own: where each answer of the one evaluator call
 * puts a post, given who can be reached, the choices, the holder, the
 * fallback, the coordinator's own choice and its floor.
 *
 * The ladder is the one place best fit decides, shared by the coordinator
 * and the mailbox's route. A caller that names no coordinator and no floor
 * (the mailbox) must place exactly as before; one that names them gets the
 * coordinator as an answer, not a miss, and a delegate pick it can't trust
 * sent down the ladder like any other miss.
 *
 * Checks, by the spec's ids (`specs/issues/FIX-1833/BUSINESS-RULES.md`, V1):
 *   BR-2   a coordinator offered with no delegate to pick is no choice: no call, today's misses;
 *   BR-6   a delegate pick at or above the floor is used;
 *   BR-7   a pick of the coordinator places it, even with a fallback set and reachable;
 *   BR-8   a delegate pick below the floor is a miss, `below-floor`, with the pick, its confidence and the floor;
 *   BR-9   under a floor, a pick with no reported confidence is a miss, `no-confidence`;
 *   BR-10  with no floor, any delegate pick is used, whatever its confidence or none;
 *   BR-11  a pick of the coordinator is used at any confidence, under a floor;
 *   BR-12  a failed call, or an answer that isn't a choice, goes down the ladder as today;
 *   BR-13  a holder takes the post with no call, whatever else the case names.
 */
import { describe, expect, it } from "vitest";
import { needsBestFitCall, placeBestFit, type BestFitCase } from "../src/best-fit";

const delegates = { "eng.em": "Files features.", "eng.lead": "Leads engineering." };

/** A case with the coordinator `chief` offered beside two delegates, and a floor of 0.7. */
const withSelf = (over: Partial<BestFitCase> = {}): BestFitCase => ({
  reachable: ["eng.em", "eng.lead"],
  options: { ...delegates, chief: "Hires and fires workers." },
  coordinator: "chief",
  minConfidence: 0.7,
  ...over
});

/** What the evaluator step leaves when the call answered. */
const answered = (choice: unknown, confidence?: number) => ({
  answers: { member: { type: "choice", choice, ...(confidence === undefined ? {} : { confidence }) } }
});

describe("best fit's ladder (V1)", () => {
  it.each([
    ["a delegate at the floor is used (BR-6)", withSelf(), answered("eng.em", 0.7), { by: "evaluated", member: "eng.em" }],
    ["a delegate above the floor is used (BR-6)", withSelf(), answered("eng.lead", 0.95), { by: "evaluated", member: "eng.lead" }],
    [
      "a delegate below the floor is a miss, with the pick, its confidence and the floor (BR-8)",
      withSelf(),
      answered("eng.em", 0.36),
      { by: "none", miss: { kind: "below-floor", choice: "eng.em", confidence: 0.36, minConfidence: 0.7 }, fallbackUnreachable: false }
    ],
    [
      "under a floor, a delegate pick with no confidence is a miss (BR-9)",
      withSelf(),
      answered("eng.em"),
      { by: "none", miss: { kind: "no-confidence", choice: "eng.em", minConfidence: 0.7 }, fallbackUnreachable: false }
    ],
    [
      "under a floor, a confidence outside 0 to 1 counts as none reported (BR-9)",
      withSelf(),
      answered("eng.em", 1.5),
      { by: "none", miss: { kind: "no-confidence", choice: "eng.em", minConfidence: 0.7 }, fallbackUnreachable: false }
    ],
    [
      "under a floor, a negative confidence counts as none reported (BR-9)",
      withSelf(),
      answered("eng.em", -0.2),
      { by: "none", miss: { kind: "no-confidence", choice: "eng.em", minConfidence: 0.7 }, fallbackUnreachable: false }
    ],
    [
      "a below-floor miss goes to the fallback when it can be reached (BR-8)",
      withSelf({ fallback: "eng.lead" }),
      answered("eng.em", 0.2),
      { by: "fallback", member: "eng.lead", miss: { kind: "below-floor", choice: "eng.em", confidence: 0.2, minConfidence: 0.7 } }
    ],
    [
      "the coordinator's pick places it, and skips a reachable fallback (BR-7)",
      withSelf({ fallback: "eng.lead" }),
      answered("chief", 0.9),
      { by: "coordinator", member: "chief", confidence: 0.9 }
    ],
    [
      "the coordinator's pick is used below the floor (BR-11)",
      withSelf(),
      answered("chief", 0.12),
      { by: "coordinator", member: "chief", confidence: 0.12 }
    ],
    ["the coordinator's pick is used with no confidence (BR-11)", withSelf(), answered("chief"), { by: "coordinator", member: "chief" }],
    [
      "with no floor, a delegate pick is used at any confidence (BR-10)",
      withSelf({ minConfidence: undefined }),
      answered("eng.em", 0.01),
      { by: "evaluated", member: "eng.em" }
    ],
    [
      "with no floor, a delegate pick with no confidence is used (BR-10)",
      withSelf({ minConfidence: undefined }),
      answered("eng.em"),
      { by: "evaluated", member: "eng.em" }
    ],
    [
      "a failed call goes down the ladder as today (BR-12)",
      withSelf({ fallback: "eng.lead" }),
      { failed: "gateway down" },
      { by: "fallback", member: "eng.lead", miss: { kind: "evaluation-failed", message: "gateway down" } }
    ],
    [
      "an answer that isn't a choice goes down the ladder as today (BR-12)",
      withSelf(),
      answered("eng.nobody", 0.99),
      { by: "none", miss: { kind: "not-an-option", choice: "eng.nobody" }, fallbackUnreachable: false }
    ],
    [
      "a coordinator answer it wasn't offered is not a choice",
      withSelf({ options: delegates }),
      answered("chief", 0.99),
      { by: "none", miss: { kind: "not-an-option", choice: "chief" }, fallbackUnreachable: false }
    ],
    [
      "a holder takes the post, whatever the coordinator and the floor (BR-13)",
      withSelf({ held: "eng.lead" }),
      undefined,
      { by: "held", member: "eng.lead" }
    ]
  ])("%s", (_name, bestFit, answer, placed) => {
    expect(placeBestFit(bestFit, answer)).toEqual(placed);
  });

  it("calls with one delegate and the coordinator offered: two choices, never one (BR-5)", () => {
    const bestFit = withSelf({ reachable: ["eng.em"], options: { "eng.em": "Files features.", chief: "Hires." } });
    expect(needsBestFitCall(bestFit)).toBe(true);
  });

  it("makes no call, and misses as today, when the coordinator is the only choice (BR-2)", () => {
    const described = withSelf({ reachable: ["eng.em"], options: { chief: "Hires." }, fallback: "eng.em" });
    expect(needsBestFitCall(described)).toBe(false);
    expect(placeBestFit(described, undefined)).toEqual({ by: "fallback", member: "eng.em", miss: { kind: "none-described" } });

    const nobody = withSelf({ reachable: [], options: { chief: "Hires." } });
    expect(needsBestFitCall(nobody)).toBe(false);
    expect(placeBestFit(nobody, undefined)).toEqual({ by: "none", miss: { kind: "none-reachable" }, fallbackUnreachable: false });
  });

  it("places exactly as before for a caller that names no coordinator and no floor (the mailbox's route)", () => {
    const mailbox: BestFitCase = { reachable: ["a", "b"], options: { a: "A.", b: "B." }, fallback: "b" };
    expect(placeBestFit(mailbox, answered("a", 0.01))).toEqual({ by: "evaluated", member: "a" });
    expect(placeBestFit(mailbox, answered("a"))).toEqual({ by: "evaluated", member: "a" });
    expect(placeBestFit(mailbox, answered("z"))).toEqual({ by: "fallback", member: "b", miss: { kind: "not-an-option", choice: "z" } });
    expect(placeBestFit(mailbox, { failed: "x" })).toEqual({ by: "fallback", member: "b", miss: { kind: "evaluation-failed", message: "x" } });
  });
});
