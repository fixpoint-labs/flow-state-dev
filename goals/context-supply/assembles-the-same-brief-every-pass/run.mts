/**
 * Goal check — one phase's context recipe hands the model the SAME brief on
 * every pass, and its standing half survives a change of issue (LAB-136).
 *
 * Model-free (`Model: n/a`), real assembly path, out of CI. See goal.md for the
 * contract; this header covers only what a reader needs to follow the code.
 *
 * What makes this a goal check rather than a dressed-up unit test:
 *   - It measures the brief the FRAMEWORK hands a model, not a string a helper
 *     in this file built. The recipe is a real `generator`, run through the real
 *     `runAction`, and the capture point is `options.messages` as the resolved
 *     model receives it. Nothing here calls `assembleMessages` directly.
 *   - The stub is step-capable (`generateStep` / `streamStep`) and its legacy
 *     `generate` THROWS. A `generate()`-only stub drives a compatibility path
 *     production never takes, and it fails GREEN — so the throw is the guard
 *     that keeps this check on the mechanism it claims to measure.
 *   - Every fact graded is pulled from the fixture world; no brief text is
 *     hardcoded here. Swap the world for another valid one and a correct recipe
 *     still passes.
 *
 * Run: pnpm tsx goals/context-supply/assembles-the-same-brief-every-pass/run.mts
 */
import { defineFlow, generator } from "@flow-state-dev/core";
import type { GeneratorModel, GeneratorModelCallOptions } from "@flow-state-dev/core";
import { createInMemoryStores, runAction } from "@flow-state-dev/engine";
import { loadFixture, runGoal, silentLogger } from "../../lib/index.mts";

// ---------------------------------------------------------------------------
// The fixture world — hand-built, no database, no event feed.
// ---------------------------------------------------------------------------

interface PullRequest {
  number: number;
  filesChanged: number;
  linesAdded: number;
  linesRemoved: number;
  diff: string;
  /**
   * What the author ran, and what they did not. Added after the first human read
   * of the assembled brief: the standards the brief carries ask a reviewer to
   * check that every claim has a re-runnable evidence path, and the brief gave
   * them nothing to check that against. The gap was in the recipe's world, not in
   * the framework's assembly — which is the human gate working as intended.
   */
  verification: string;
}
interface Issue {
  id: string;
  title: string;
  body: string;
  pullRequest: PullRequest;
}
interface World {
  phase: { instructions: string };
  grounding: { project: string; standards: string };
  objective: { id: string; title: string; summary: string };
  issues: Issue[];
}

const WORLD = loadFixture<World>(import.meta.url, "world.json");

/** A fresh copy per pass, so nothing a pass does can reach the next one. */
const freshWorld = (): World => structuredClone(WORLD);

const issueOf = (world: World, id: string): Issue => {
  const found = world.issues.find((i) => i.id === id);
  if (found === undefined) throw new Error(`fixture has no issue "${id}"`);
  return found;
};

// ---------------------------------------------------------------------------
// The recipe — one generator, three slots.
//
//   instructions ← what a reviewer is for            ] never varies →
//   grounding    ← how we build; what a review covers] the standing half
//   message      ← this issue, this PR, this diff      varies → the changing half
//
// RECIPE CONSTRAINT (load-bearing, not stylistic — see goal.md): every dynamic
// contribution is a TOP-LEVEL slot function. No functions may survive inside a
// slot's returned value. `resolveSlotValues` calls top-level slot functions and
// stops; a function nested inside object-form context is resolved LATER, by
// `aggregateContextEntries`, and so never appears in this capture. Such a
// formatter would drift the assembled bytes while the capture reported the slot
// stable — and the localization step below would blame the framework for our own
// recipe's nondeterminism. `slotsFullyResolved` enforces the constraint; the
// nested-drift variant at the bottom proves that guard fires.
// ---------------------------------------------------------------------------

type SlotName = "instructions" | "grounding" | "tail";

/** What one pass observed: the brief the model got, and what each slot returned. */
interface Capture {
  messages: unknown[];
  slots: Partial<Record<SlotName, unknown>>;
}

/** The changing half: this issue, this pull request, this diff. */
function renderTail(world: World, issueId: string): string {
  const issue = issueOf(world, issueId);
  const pr = issue.pullRequest;
  return [
    `Issue ${issue.id} — ${issue.title}`,
    issue.body,
    "",
    `PR #${pr.number} — ${pr.filesChanged} files, +${pr.linesAdded} −${pr.linesRemoved}`,
    pr.diff,
    "",
    `Verification: ${pr.verification}`,
  ].join("\n");
}

/** The standing grounding contribution the real recipe uses. */
function reviewGrounding(world: World): unknown {
  return {
    project: world.grounding.project,
    standards: world.grounding.standards,
    objective: `${world.objective.id} — ${world.objective.title}\n${world.objective.summary}`,
  };
}

/**
 * Run the recipe once and capture what the framework handed the model.
 *
 * `grounding` is a parameter only so the two anti-game variants can swap that
 * one slot; everything else is identical between the real recipe and the
 * variants, which is what makes the variants evidence about this recipe.
 */
async function assemble(
  world: World,
  issueId: string,
  grounding: (w: World) => unknown,
): Promise<Capture> {
  const capture: Capture = { messages: [], slots: {} };
  const record = <T,>(slot: SlotName, value: T): T => {
    capture.slots[slot] = value;
    return value;
  };

  // The recording stub. Step-capable, exactly as every real model is; the
  // legacy multi-step entry point throws rather than quietly measuring a path
  // production never executes.
  const model: GeneratorModel = {
    modelId: "stub/recorder",
    async generate() {
      throw new Error(
        "legacy generate() was called — this check would have measured the SDK-owned " +
          "compatibility path, which production never takes. The capture is void.",
      );
    },
    async generateStep(options: GeneratorModelCallOptions) {
      capture.messages = options.messages;
      return { text: "", finishReason: "stop" };
    },
    async *streamStep(options: GeneratorModelCallOptions) {
      capture.messages = options.messages;
      yield {
        type: "finish" as const,
        finishReason: "stop",
        fullResult: { text: "", finishReason: "stop" },
      };
    },
  };

  const recipe = generator({
    name: "review-brief",
    model: "stub/recorder",
    prompt: () => record("instructions", world.phase.instructions),
    context: () => record("grounding", grounding(world)),
    user: () => record("tail", renderTail(world, issueId)),
  });

  const flow = defineFlow({
    kind: "lab-136-review-brief",
    requireUser: true,
    actions: { review: { block: recipe as never } },
  })({ id: "default" });

  const result = await runAction({
    flow,
    actionName: "review" as never,
    input: {},
    userId: "goal-user",
    // A fresh session per pass: a shared one would accumulate history and make
    // pass 2 legitimately differ from pass 1, which is not the drift we're after.
    sessionId: `lab136_${Math.random().toString(16).slice(2)}`,
    stores: createInMemoryStores(),
    runtimeConfig: {
      modelResolver: Object.assign(() => model, { resolveId: (id: string) => id }),
      logger: silentLogger,
    } as never,
  });
  if (result.error) throw new Error(`assembly run failed: ${result.error.message}`);
  if (capture.messages.length === 0) throw new Error("the model stub was never called");
  return capture;
}

// ---------------------------------------------------------------------------
// One named comparator, used by the signal checks AND by the anti-game checks.
// A canary that compared strings its own way would prove nothing about the
// comparator the real check runs on.
// ---------------------------------------------------------------------------

const renderBrief = (messages: unknown[]): string => JSON.stringify(messages);

function briefsAgree(captures: Capture[]): boolean {
  // An empty set must not "agree" — `[].every()` is true, and a vacuous green
  // is the failure mode this whole goal exists to avoid.
  if (captures.length === 0) return false;
  const first = renderBrief(captures[0]!.messages);
  return captures.every((c) => renderBrief(c.messages) === first);
}

// ---------------------------------------------------------------------------
// The standing / changing boundary, derived from the leading system-role run.
//
// `assembleMessages` returns `[...systemPrefix, ...history, ...user]`. This
// recipe declares no history and its message slot yields user-role messages, so
// the leading system run IS the standing half — exactly, not heuristically. That
// exactness is a property of THIS recipe's shape, so it is asserted rather than
// assumed; if the assertion fails the derivation is void, which is correct.
// ---------------------------------------------------------------------------

const roleOf = (m: unknown): string | undefined =>
  typeof m === "object" && m !== null ? (m as { role?: string }).role : undefined;

function preconditionFailure(messages: unknown[]): string | undefined {
  let lead = 0;
  while (lead < messages.length && roleOf(messages[lead]) === "system") lead += 1;
  if (lead !== 1) {
    return `expected exactly 1 leading system message, saw ${lead} (roles: ${messages.map(roleOf).join(", ")})`;
  }
  if (messages.slice(lead).some((m) => roleOf(m) === "system")) {
    return `a system message appears after the leading run (roles: ${messages.map(roleOf).join(", ")})`;
  }
  return undefined;
}

const standingHalf = (c: Capture): string => renderBrief(c.messages.slice(0, 1));
const changingHalf = (c: Capture): string => renderBrief(c.messages.slice(1));

// ---------------------------------------------------------------------------
// The recipe constraint, enforced rather than documented.
// ---------------------------------------------------------------------------

function containsFunction(value: unknown): boolean {
  if (typeof value === "function") return true;
  if (value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(containsFunction);
  return Object.values(value as Record<string, unknown>).some(containsFunction);
}

/** Slot names whose captured value still holds an unresolved function. */
function unresolvedSlots(c: Capture): SlotName[] {
  return (Object.keys(c.slots) as SlotName[]).filter((k) => containsFunction(c.slots[k]));
}

// ---------------------------------------------------------------------------
// Localization (decision 3). Reads the slot outputs captured DURING the same
// runs — there is no code path here that re-runs the recipe to localize, because
// a fresh run is a different sample and can report "slots were stable" for drift
// the slots themselves caused.
// ---------------------------------------------------------------------------

interface Attribution {
  /** `recipe` — ours to fix here. `seam` — a framework finding, filed not repaired. */
  verdict: "recipe" | "seam";
  detail: string;
}

/**
 * The RAW signal: did the captured slot outputs agree across passes? Deliberately
 * not an attribution — "they agreed" only means something once we know the
 * capture could see every dynamic contribution. `localize` decides that first.
 */
function slotOutputsAgree(captures: Capture[]): { agree: boolean; drifted: SlotName[] } {
  const names = [...new Set(captures.flatMap((c) => Object.keys(c.slots) as SlotName[]))];
  const drifted = names.filter((name) => {
    const first = JSON.stringify(captures[0]?.slots[name]);
    return captures.some((c) => JSON.stringify(c.slots[name]) !== first);
  });
  return { agree: drifted.length === 0, drifted };
}

/**
 * Attribute a red byte-comparison to the recipe or to the assembly seam.
 *
 * The constraint check comes FIRST, and that ordering is the whole soundness
 * argument. Spelled the obvious way — "slots differ → recipe, else → seam" — this
 * step emits a confident `seam` verdict for a recipe whose nested formatter the
 * capture never saw: a false framework finding, which under decision 3 pauses the
 * epic. An unresolved slot is therefore not evidence of stability; it is evidence
 * that the capture is blind, and blindness is never grounds for escalating.
 */
function localize(captures: Capture[]): Attribution {
  const unresolved = [...new Set(captures.flatMap(unresolvedSlots))];
  if (unresolved.length > 0) {
    return {
      verdict: "recipe",
      detail:
        `slot(s) [${unresolved.join(", ")}] returned an unresolved function, so their per-call values ` +
        `never entered the capture. Attribution to the seam is unavailable — fix the recipe first`,
    };
  }
  const { agree, drifted } = slotOutputsAgree(captures);
  return agree
    ? { verdict: "seam", detail: "every slot returned the same value on every pass" }
    : { verdict: "recipe", detail: `slot output varies between passes: ${drifted.join(", ")}` };
}

// ---------------------------------------------------------------------------
// The checks.
// ---------------------------------------------------------------------------

const PASSES = 8;
const [ISSUE_A, ISSUE_B] = WORLD.issues.map((i) => i.id) as [string, string];

/** Facts a correctly-assembled tail must carry, pulled from the fixture. */
const factsOf = (id: string): string[] => {
  const issue = issueOf(WORLD, id);
  return [issue.id, issue.title, `#${issue.pullRequest.number}`];
};

await runGoal(async () => {
  const failures: string[] = [];

  // S0 — setup honesty guard. The two issues must be distinguishable in the
  // fixture, or "each tail carries its own facts" could pass on a coincidence.
  const overlap = factsOf(ISSUE_A).filter((f) => factsOf(ISSUE_B).includes(f));
  if (overlap.length > 0) {
    return {
      failures: [`setup invalid: the two fixture issues share identifying facts: ${overlap.join(", ")}`],
      evidence: "",
    };
  }

  // S1 — eight passes over the same issue, each on a fresh copy of the world.
  const eight: Capture[] = [];
  for (let i = 0; i < PASSES; i += 1) {
    eight.push(await assemble(freshWorld(), ISSUE_A, reviewGrounding));
  }
  if (!briefsAgree(eight)) {
    const where = localize(eight);
    failures.push(
      `the ${PASSES} passes were NOT byte-identical. Localized to the ${where.verdict}: ${where.detail}. ` +
        (where.verdict === "recipe"
          ? "That is this recipe's own formatter drifting — ours to fix here, NOT a framework finding."
          : "Slot outputs were stable across the same runs, so the drift is in the assembly seam — " +
            "report and stop (decision 3); do not repair it here."),
    );
  }

  // S2 — the precondition the standing/changing derivation depends on.
  const preFail = preconditionFailure(eight[0]!.messages);
  if (preFail !== undefined) {
    failures.push(`standing/changing boundary is not derivable: ${preFail}`);
  }

  // G1 — the recipe constraint that makes localization's attribution sound.
  const unresolved = eight.flatMap(unresolvedSlots);
  if (unresolved.length > 0) {
    failures.push(
      `recipe constraint broken: slot(s) [${[...new Set(unresolved)].join(", ")}] returned a value ` +
        `containing a function. Nested formatters resolve after the capture, so localization would ` +
        `read them as stable and blame the assembly seam for this recipe's own drift.`,
    );
  }

  // S3 — two DIFFERENT issues. The standing half must hold; the changing half
  // must actually change and carry its own issue's facts. Without the last two,
  // a recipe that silently assembled issue A twice would pass every other signal.
  const a = eight[0]!;
  const b = await assemble(freshWorld(), ISSUE_B, reviewGrounding);
  // Gated on the precondition: with the boundary void, every conclusion below is
  // drawn from a split that does not mean what it claims, and reporting them
  // alongside the real cause just buries it.
  if (preFail !== undefined) {
    failures.push("the two-issue signals were not evaluated — the boundary precondition failed above");
  } else {
    if (standingHalf(a) !== standingHalf(b)) {
      failures.push("the standing half changed between two different issues — the split does not hold");
    }
    if (changingHalf(a) === changingHalf(b)) {
      failures.push(
        "the changing half is IDENTICAL for two different issues — issue B was never really assembled, " +
          "so the standing-half comparison above compared a brief with itself",
      );
    }
    for (const [id, capture, other] of [
      [ISSUE_A, a, ISSUE_B],
      [ISSUE_B, b, ISSUE_A],
    ] as const) {
      const tail = changingHalf(capture);
      const missing = factsOf(id).filter((f) => !tail.includes(f));
      if (missing.length > 0) {
        failures.push(`${id}'s changing half is missing its own fixture's facts: ${missing.join(", ")}`);
      }
      const leaked = factsOf(other).filter((f) => tail.includes(f));
      if (leaked.length > 0) {
        failures.push(`${id}'s changing half carries ${other}'s facts: ${leaked.join(", ")}`);
      }
    }
  }

  // A1/A2 — anti-game. A variant whose grounding appends a PER-CALL COUNTER
  // (never the clock: eight in-process assemblies can land in one tick). The
  // same named comparator must return false, and localization — reading the slot
  // outputs captured on these same runs — must attribute it to the recipe.
  let calls = 0;
  const countingGrounding = (w: World): unknown => ({
    ...(reviewGrounding(w) as Record<string, unknown>),
    drift: `call ${(calls += 1)}`,
  });
  const canary: Capture[] = [];
  for (let i = 0; i < PASSES; i += 1) {
    canary.push(await assemble(freshWorld(), ISSUE_A, countingGrounding));
  }
  if (briefsAgree(canary)) {
    failures.push(
      "the drift canary went GREEN: the comparator could not detect a per-call counter in the " +
        "grounding, so every other signal above is decoration",
    );
  }
  const canaryWhere = localize(canary);
  if (canaryWhere.verdict !== "recipe") {
    failures.push(
      `localization misattributed the drift canary to the ${canaryWhere.verdict} (${canaryWhere.detail}). ` +
        `The canary's drift is a recipe formatter; calling it a framework finding is the expensive ` +
        `direction of decision 3's failure mode.`,
    );
  }

  // A3/A4 — the constraint's own anti-game, and the reason it is load-bearing.
  // A nested context function drifts the brief while its top-level slot value
  // looks unchanged. Three things must hold, and the middle one is the hazard
  // this issue found: the RAW slot signal says "stable" (deceptive), the guard
  // sees the unresolved function, and `localize` therefore refuses to blame the
  // seam. Remove the guard from `localize` and this same input yields a
  // confident false framework finding.
  let nested = 0;
  const nestedGrounding = (w: World): unknown => ({
    ...(reviewGrounding(w) as Record<string, unknown>),
    drift: () => `call ${(nested += 1)}`,
  });
  const nestedRuns = [
    await assemble(freshWorld(), ISSUE_A, nestedGrounding),
    await assemble(freshWorld(), ISSUE_A, nestedGrounding),
  ];
  if (briefsAgree(nestedRuns)) {
    failures.push("setup invalid: the nested-drift variant did not actually drift the brief");
  }
  if (!slotOutputsAgree(nestedRuns).agree) {
    failures.push(
      "characterization drifted: the RAW slot signal was expected to look stable for a nested " +
        "formatter (that is the hazard the constraint exists for), but it detected the drift. " +
        "If the capture now sees nested values, the constraint may be relaxable — re-derive it.",
    );
  }
  if (nestedRuns.flatMap(unresolvedSlots).length === 0) {
    failures.push(
      "the recipe constraint guard did NOT fire on a nested context function — the guard is " +
        "decoration, and nothing stands between localization and a false framework finding",
    );
  }
  const nestedWhere = localize(nestedRuns);
  if (nestedWhere.verdict !== "recipe") {
    failures.push(
      `localization blamed the ${nestedWhere.verdict} for a nested RECIPE formatter — the false ` +
        `framework finding decision 3 must never emit. The constraint check has come loose from the ` +
        `attribution; it has to run inside localize(), not beside it.`,
    );
  }

  // The brief itself is the product of this issue. Put it in front of the human.
  const brief = (c: Capture): string =>
    c.messages
      .map((m) => `[${roleOf(m)}]\n${String((m as { content?: unknown }).content ?? "")}`)
      .join("\n\n");
  console.log(`\n===== the brief, issue ${ISSUE_A} =====\n${brief(a)}\n`);
  console.log(`===== the brief, issue ${ISSUE_B} (standing half elided) =====\n${changingHalf(b)}\n`);

  return {
    failures,
    evidence:
      `${PASSES} passes of the review recipe, each over a fresh copy of the fixture world, handed the ` +
      `model a byte-identical brief (${renderBrief(eight[0]!.messages).length} bytes, ` +
      `standing half ${standingHalf(a).length}); the boundary precondition held (exactly one leading ` +
      `system message); assembling ${ISSUE_B} instead left the standing half unchanged while the ` +
      `changing half differed and carried its own fixture's facts and none of ${ISSUE_A}'s. ` +
      `The comparator is proved able to fire: the same ${PASSES}-pass check over a grounding that ` +
      `appends a per-call counter returned false, and localization attributed it to the recipe ` +
      `(${canaryWhere.detail}) rather than the assembly seam. The recipe constraint is proved able to ` +
      `fire too: for a nested context formatter the raw slot signal looks stable — the hazard — the ` +
      `guard sees the unresolved function, and localization consequently refuses to blame the seam. ` +
      `Model n/a throughout — the stub records what it was handed and its legacy generate() throws, ` +
      `so the assembly measured is the framework's own.`,
  };
});
