/**
 * The second fact the completion check is handed, and the three rules that
 * keep it honest.
 *
 * A run reports two things when it ends: whether it ended cleanly, and HOW it
 * stopped. Only the first used to reach a decision, so a run that exhausted its
 * budget, committed the half it managed and said `stopped-at-limit` settled its
 * row done — the done-condition answered from the branch alone, because the
 * branch was all it could see.
 *
 * ## Why parts of this read the source
 *
 * The seam is inside `decide`, which needs a board, a claim and a dispatched
 * child session to reach — `labs/conductor` drives that whole loop and is where
 * the settle behaviour is staged. But conductor's suite runs the Claude Code
 * SDK harness, and that harness ties `status` to `outcome === "finished"`, so it
 * cannot produce the one combination this file is about. The shape checks below
 * guard the invariants at the place they actually live, the way
 * `fences.spec.ts` does for the same reason.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { harnessRunHandleSchema } from "@flow-state-dev/core";
import type { CompletionRunContext, PromptRunContext } from "../src";

const MANAGER = readFileSync(join(__dirname, "..", "src", "manager.ts"), "utf8");

describe("the contract permits the combination this exists for", () => {
  it("parses a handle that ended cleanly AND stopped at its limit", () => {
    // The premise of the whole change, and the reason it is not dead code:
    // `status` and `outcome` are independent fields, so a conforming harness
    // may honestly report "my stream ended cleanly, and the reason I stopped
    // was my turn limit". No harness shipped in this repo reports that pairing
    // today — all three derive `status` from `outcome === "finished"` — but the
    // slot exists precisely so a harness this package never sees can be driven,
    // and the DevForce lab's own fake harness reports it.
    //
    // If the contract is ever tightened to couple the two, this goes red and
    // the completion-side field should be re-examined rather than left behind.
    const handle = harnessRunHandleSchema.parse({
      source: "fake/test",
      status: "completed",
      sessionId: "sess",
      url: null,
      dispatchedAt: 0,
      outcome: "stopped-at-limit",
    });

    expect(handle.status).toBe("completed");
    expect(handle.outcome).toBe("stopped-at-limit");
  });
});

describe("the stop report crosses as reported", () => {
  it("is handed to the completion check as the handle's own value", () => {
    // Not narrowed to a boolean, not defaulted, not re-read from the row. A
    // vendor subtype this version does not define has to arrive intact, because
    // quietly reading it as `finished` is the same silent partial success one
    // layer down — and `null` has to stay `null`, since "reported nothing" is
    // a different fact from "reported finished".
    expect(MANAGER).toContain("stopReport: handle.outcome,");

    // Nothing between the handle and the check. `??`, a cast, a ternary or a
    // comparison here would all be the manager deciding something about a word
    // whose meaning belongs to the phase.
    expect(MANAGER).not.toMatch(/stopReport:\s*handle\.outcome\s*(\?\?|\|\||===|!==)/);
  });

  it("is read in exactly three places, and only one of them is a comparison", () => {
    // The authority rule, as a check rather than a comment. The manager may say
    // WHICH kind of clean end a phase refused — that text becomes the next
    // attempt's feedback — but it may not decide anything on it. So every read
    // of the field is classified, rather than one operator being pattern-
    // matched: an inversion written with `!==`, a `switch`, or an `includes`
    // is the same defect as one written with `===`, and the first draft of this
    // check caught only the last of those.
    const reads = [...MANAGER.matchAll(/handle\.outcome/g)];

    // Found the sites at all, or everything below examined nothing.
    expect(reads.length).toBe(3);

    for (const read of reads) {
      const site = MANAGER.slice(Math.max(0, read.index - 260), read.index + 260);
      const isPassThrough = /stopReport: handle\.outcome,/.test(site);
      const isFailureText = site.includes("HarnessAttemptFailed");

      expect(
        isPassThrough || isFailureText,
        `a read of the run's stop report that is neither the pass-through to the ` +
          `completion check nor a failure message: ...${site.slice(200, 320)}...`,
      ).toBe(true);
    }

    // And the one comparison that exists says which word it is phrasing for.
    const comparisons = [...MANAGER.matchAll(/handle\.outcome\s*(===|!==|==|!=)\s*"([a-z_-]+)"/g)];
    expect(comparisons.length).toBe(1);
    expect(comparisons[0]![2]).toBe("stopped-at-limit");
  });
});

describe("the prompt side and the completion side stay apart", () => {
  it("puts the stop report on the completion context and nowhere else", () => {
    // `feedback` describes the attempt BEFORE this one; `stopReport` describes
    // THIS one. A single field meaning both, depending on which hook reads it,
    // lies by position — which is the argument that split `PromptRunContext`
    // off the base to begin with.
    const completion: Pick<CompletionRunContext, "stopReport"> = {
      stopReport: "stopped-at-limit",
    };
    expect(completion.stopReport).toBe("stopped-at-limit");

    // @ts-expect-error a prompt builder is not handed this attempt's stop report
    const leaked: PromptRunContext["stopReport"] = null;
    expect(leaked).toBeNull();
  });

  it("accepts a word this framework version does not define, and the absent case", () => {
    // Both at the type level, which is where a narrowing would be introduced.
    const unknown: Pick<CompletionRunContext, "stopReport"> = {
      stopReport: "error_context_window_exhausted",
    };
    const absent: Pick<CompletionRunContext, "stopReport"> = { stopReport: null };

    expect(unknown.stopReport).toBe("error_context_window_exhausted");
    expect(absent.stopReport).toBeNull();
  });
});
