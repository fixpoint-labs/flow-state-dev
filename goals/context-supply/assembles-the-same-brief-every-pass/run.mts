/**
 * Goal check — one phase's context recipe hands the model the SAME brief on
 * every pass, and its standing half survives a change of issue (LAB-136).
 *
 * The contract, the recipe constraint, the localization rule and the anti-game
 * design live in `goal.md`. This file implements them. Two points are repeated
 * here only because getting either wrong produces a silent GREEN:
 *
 *   - The stub must be step-capable, and its legacy `generate` therefore throws.
 *     A `generate()`-only stub drives the SDK-owned path production never takes.
 *   - `localize` consults the recipe constraint FIRST. An unresolved slot means
 *     the capture is blind, and blindness is not evidence of stability.
 *
 * WHAT A GREEN HERE DOES NOT PROVE: eight passes seconds apart in one process
 * rule out per-call nondeterminism and nothing else. Not drift across restarts,
 * machines, processes or locales; not a clock read landing inside one tick; not
 * fixture mutation. Do not report this as the epic's headline claim having been
 * met. `goal.md` → "Coverage this does not have" is the full list.
 *
 * Run: pnpm tsx goals/context-supply/assembles-the-same-brief-every-pass/run.mts
 */
import { defineFlow, generator } from "@flow-state-dev/core";
import type { GeneratorModel, GeneratorModelCallOptions } from "@flow-state-dev/core";
import { createInMemoryStores, runAction } from "@flow-state-dev/engine";
import { goalSessionId, loadFixture, runGoal, silentLogger } from "../../lib/index.mts";

// --- the fixture world -----------------------------------------------------

interface PullRequest {
  number: number;
  filesChanged: number;
  linesAdded: number;
  linesRemoved: number;
  diff: string;
  /** What the author ran, and what they did not. Added after the first human
   *  read: the standards the brief carries ask a reviewer to check that every
   *  claim has a re-runnable evidence path, and the brief gave them nothing to
   *  check it against. See the verdict log's first row. */
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

// --- the recipe: one generator, three slots --------------------------------
//
// RECIPE CONSTRAINT — every dynamic contribution is a TOP-LEVEL slot function,
// and no function may survive inside a slot's returned value. This is
// load-bearing for localization's attribution, not stylistic; `goal.md` carries
// the reasoning. `unresolvedSlots` enforces it and the nested variant below
// proves that guard fires.

type SlotName = "instructions" | "grounding" | "tail";

/** What one pass observed: the brief the model got, and what each slot returned. */
interface Capture {
  messages: unknown[];
  slots: Partial<Record<SlotName, unknown>>;
  /** Step-method invocations this pass. Must be exactly 1 — see `assemble`. */
  calls: number;
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
 * `grounding` is a parameter only so the anti-game variants can swap that one
 * slot; everything else is identical between the real recipe and the variants,
 * which is what makes the variants evidence about this recipe.
 */
async function assemble(
  world: World,
  issueId: string,
  grounding: (w: World) => unknown,
  passLabel: string,
): Promise<Capture> {
  const capture: Capture = { messages: [], slots: {}, calls: 0 };
  const record = <T,>(slot: SlotName, value: T): T => {
    capture.slots[slot] = value;
    return value;
  };

  const model: GeneratorModel = {
    modelId: "stub/recorder",
    async generate() {
      throw new Error(
        "legacy generate() was called — this check would have measured the SDK-owned " +
          "compatibility path, which production never takes. The capture is void.",
      );
    },
    // `generateStep` only. `streamStep` is optional on `GeneratorModel` and this
    // recipe is tool-free and identity-less, so `canStream` is false and the
    // streaming branch is unreachable — a `streamStep` here would be dead
    // surface. Adding tools or `itemVisibility` later cannot silently reroute to
    // a legacy path either: `canStream` also requires `stream` or `streamStep` to
    // exist, and neither does.
    async generateStep(options: GeneratorModelCallOptions) {
      capture.calls += 1;
      capture.messages = options.messages;
      return { text: "", finishReason: "stop" };
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
    // Per-pass slug is load-bearing, not decorative: `goalSessionId`'s stamp is
    // per-PROCESS, so a bare slug would hand all eight passes one session, and
    // the accumulated history would make pass 2 legitimately differ from pass 1.
    sessionId: goalSessionId(`lab136-${passLabel}`),
    stores: createInMemoryStores(),
    runtimeConfig: {
      modelResolver: Object.assign(() => model, { resolveId: (id: string) => id }),
      logger: silentLogger,
    } as never,
  });
  if (result.error) throw new Error(`assembly run failed: ${result.error.message}`);
  // Exactly one, not "at least one". Each invocation OVERWRITES `capture.messages`,
  // so on a second call every earlier handoff is silently discarded and the checks
  // below grade only the last one — a malformed or pass-dependent first brief would
  // be invisible. This recipe is tool-free and terminal at step 0, so a second call
  // is a regression by definition: asserting it is both the guard and the canary.
  if (capture.calls !== 1) {
    throw new Error(
      `the model stub was called ${capture.calls} time(s), expected exactly 1. The capture keeps ` +
        `only the last handoff, so every brief graded below would be the final call rather than ` +
        `the one the recipe assembled. The capture is void.`,
    );
  }
  return capture;
}

// --- one named comparator, used by every check -----------------------------

const renderBrief = (messages: unknown[]): string => JSON.stringify(messages);

function briefsAgree(captures: Capture[]): boolean {
  // An empty set must not "agree" — `[].every()` is true, and a vacuous green is
  // the failure mode this whole goal exists to avoid.
  if (captures.length === 0) return false;
  const first = renderBrief(captures[0]!.messages);
  return captures.every((c) => renderBrief(c.messages) === first);
}

// --- the standing / changing boundary --------------------------------------
//
// The leading system run IS the standing half — exactly, for this recipe's
// shape, not as a heuristic. Asserted rather than assumed; `goal.md` has the
// derivation.

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

/** Byte views — for the identity claims. */
const standingHalf = (c: Capture): string => renderBrief(c.messages.slice(0, 1));
const changingHalf = (c: Capture): string => renderBrief(c.messages.slice(1));

/** Text views — what the model actually reads; for the content assertions. */
const textOf = (messages: unknown[]): string =>
  messages.map((m) => String((m as { content?: unknown }).content ?? "")).join("\n");
const standingText = (c: Capture): string => textOf(c.messages.slice(0, 1));
const changingText = (c: Capture): string => textOf(c.messages.slice(1));

// --- what the brief must actually carry ------------------------------------
//
// Derived by walking the fixture, never hand-listed, so the graded set cannot
// drift from what the brief promises. Without it the shape stays stable while
// the content drains away and every other signal stays green.

interface Leaf {
  path: string;
  text: string;
}

function leaves(value: unknown, path: string): Leaf[] {
  if (value === null || value === undefined) return [];
  if (typeof value === "string" || typeof value === "number") {
    return [{ path, text: String(value) }];
  }
  if (Array.isArray(value)) return value.flatMap((v, i) => leaves(v, `${path}[${i}]`));
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
      leaves(v, path === "" ? k : `${path}.${k}`),
    );
  }
  return [];
}

/** Contributions the standing half claims to carry. */
const standingContributions = (): Leaf[] => [
  ...leaves(WORLD.phase, "phase"),
  ...leaves(WORLD.grounding, "grounding"),
  ...leaves(WORLD.objective, "objective"),
];

/** Contributions one issue's changing half claims to carry. */
const changingContributions = (id: string): Leaf[] => leaves(issueOf(WORLD, id), `issue(${id})`);

/**
 * How a field is PLACED in the brief, for the fields whose bare value cannot
 * identify them. Mirrors the labels in `renderTail` — keep the two together.
 *
 * Presence alone grades the wrong thing here: swap `linesAdded` and
 * `linesRemoved` and every leaf is still somewhere in the tail, so a brief
 * reporting the wrong metrics passes. A held-out world with two equal numbers
 * hides an omitted field the same way. Grading the labelled fragment ties each
 * value to the field it was rendered for. Leaves absent from this list are
 * distinctive prose and are graded on their text.
 */
const PLACED: Array<[string, (v: string) => string]> = [
  ["pullRequest.number", (v) => `#${v}`],
  ["pullRequest.filesChanged", (v) => `${v} files`],
  ["pullRequest.linesAdded", (v) => `+${v}`],
  ["pullRequest.linesRemoved", (v) => `−${v}`],
];

const expectedFragment = (leaf: Leaf): string => {
  const placed = PLACED.find(([suffix]) => leaf.path.endsWith(suffix));
  return placed === undefined ? leaf.text : placed[1](leaf.text);
};

/** Context values are XML-escaped on the way into the system message; prompt and
 *  user values are not. Accept either form so the check works for both slots. */
const escapeXml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const carries = (haystack: string, fragment: string): boolean =>
  haystack.includes(fragment) || haystack.includes(escapeXml(fragment));

const missingFrom = (haystack: string, expected: Leaf[]): string[] =>
  expected
    .filter((l) => !carries(haystack, expectedFragment(l)))
    .map((l) => {
      const fragment = expectedFragment(l);
      return fragment === l.text ? l.path : `${l.path} (expected ${JSON.stringify(fragment)})`;
    });

// --- identity, for the leak check and the setup guard ----------------------

const identifyingFacts = (id: string): string[] => {
  const issue = issueOf(WORLD, id);
  return [issue.id, issue.title, `#${issue.pullRequest.number}`];
};

/** Substring, not equality: the leak check uses `includes`, so `ISSUE-1` against a
 *  world also holding `ISSUE-10` would report a leak that is really an overlap. */
const collides = (x: string, y: string): boolean => x.includes(y) || y.includes(x);

// --- the recipe constraint, enforced rather than documented ----------------

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

// --- localization (decision 3) ---------------------------------------------
//
// Reads slot outputs captured DURING the same runs; there is no code path that
// re-runs to localize, because a fresh run is a different sample.

/** Raw signal, deliberately NOT an attribution — see `localize`. */
function slotOutputsAgree(captures: Capture[]): { agree: boolean; drifted: SlotName[] } {
  const names = [...new Set(captures.flatMap((c) => Object.keys(c.slots) as SlotName[]))];
  const drifted = names.filter((name) => {
    const first = JSON.stringify(captures[0]?.slots[name]);
    return captures.some((c) => JSON.stringify(c.slots[name]) !== first);
  });
  return { agree: drifted.length === 0, drifted };
}

interface Attribution {
  /** `recipe` — ours to fix here. `seam` — a framework finding, filed not repaired. */
  verdict: "recipe" | "seam";
  detail: string;
}

function localize(captures: Capture[]): Attribution {
  // The constraint FIRST. Spelled the obvious way — slots differ → recipe, else
  // → seam — this step emits a confident `seam` for a recipe whose nested
  // formatter the capture never saw: a false framework finding, which under
  // decision 3 pauses the epic.
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

// --- the checks ------------------------------------------------------------

const PASSES = 8;
const [ISSUE_A, ISSUE_B] = WORLD.issues.map((i) => i.id) as [string, string];

await runGoal(async () => {
  const failures: string[] = [];

  // S0 — setup honesty guard. The two issues must be distinguishable, or the
  // leak check could pass (or fail) on an overlap rather than on a real leak.
  const overlaps = identifyingFacts(ISSUE_A).flatMap((x) =>
    identifyingFacts(ISSUE_B).filter((y) => collides(x, y)).map((y) => `${x} ~ ${y}`),
  );
  if (overlaps.length > 0) {
    return {
      failures: [
        `setup invalid: the two fixture issues have overlapping identifying facts, so the ` +
          `leak check cannot distinguish them: ${overlaps.join("; ")}`,
      ],
      evidence: "",
    };
  }

  // S1 — eight passes over the same issue, each on a fresh copy of the world.
  const eight: Capture[] = [];
  for (let i = 0; i < PASSES; i += 1) {
    eight.push(await assemble(freshWorld(), ISSUE_A, reviewGrounding, `pass-${i}`));
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

  const a = eight[0]!;
  const b = await assemble(freshWorld(), ISSUE_B, reviewGrounding, "issue-b");

  // S3 — the brief carries every contribution it claims to. Without this the
  // shape can stay perfectly stable while the content drains away.
  const standingMissing = missingFrom(standingText(a), standingContributions());
  if (standingMissing.length > 0) {
    failures.push(`the standing half is missing contributions it claims to carry: ${standingMissing.join(", ")}`);
  }
  for (const [id, capture] of [
    [ISSUE_A, a],
    [ISSUE_B, b],
  ] as const) {
    const tailMissing = missingFrom(changingText(capture), changingContributions(id));
    if (tailMissing.length > 0) {
      failures.push(`${id}'s changing half is missing contributions it claims to carry: ${tailMissing.join(", ")}`);
    }
  }

  // S4 — two DIFFERENT issues. Standing half holds; the changing half actually
  // changes and carries its own identity, not the other's. Without the last two,
  // a recipe that silently assembled issue A twice passes every other signal.
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
      const leaked = identifyingFacts(other).filter((f) => changingText(capture).includes(f));
      if (leaked.length > 0) {
        failures.push(`${id}'s changing half carries ${other}'s facts: ${leaked.join(", ")}`);
      }
    }
  }

  // A1/A2 — anti-game: a per-call COUNTER in the grounding (never the clock —
  // in-process assemblies can share a tick). The same named comparator must
  // return false, and localization must attribute it to the recipe. Two
  // assemblies suffice: a per-call counter differs on the second. The primary
  // loop runs eight because that is the claim's language; the canary has no such
  // obligation.
  let calls = 0;
  const countingGrounding = (w: World): unknown => ({
    ...(reviewGrounding(w) as Record<string, unknown>),
    drift: `call ${(calls += 1)}`,
  });
  const canary: Capture[] = [];
  for (let i = 0; i < 2; i += 1) {
    canary.push(await assemble(freshWorld(), ISSUE_A, countingGrounding, `canary-${i}`));
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

  // A3/A4 — the constraint's own anti-game. A nested context function drifts the
  // brief while its top-level slot value looks unchanged: the raw slot signal
  // says "stable" (the hazard), the guard sees the unresolved function, and
  // localization therefore refuses to blame the seam.
  let nested = 0;
  const nestedGrounding = (w: World): unknown => ({
    ...(reviewGrounding(w) as Record<string, unknown>),
    drift: () => `call ${(nested += 1)}`,
  });
  const nestedRuns = [
    await assemble(freshWorld(), ISSUE_A, nestedGrounding, "nested-0"),
    await assemble(freshWorld(), ISSUE_A, nestedGrounding, "nested-1"),
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
  console.log(`\n===== the brief, issue ${ISSUE_A} =====\n${textOf(a.messages)}\n`);
  console.log(`===== the brief, issue ${ISSUE_B} (standing half elided) =====\n${changingText(b)}\n`);

  const graded = standingContributions().length + changingContributions(ISSUE_A).length;
  return {
    failures,
    evidence:
      `${PASSES} passes of the review recipe, each over a fresh copy of the fixture world, handed the ` +
      `model a byte-identical brief (${renderBrief(a.messages).length} bytes, standing half ` +
      `${standingHalf(a).length}); the boundary precondition held (exactly one leading system ` +
      `message); each pass called the model exactly once, so no handoff was overwritten; all ` +
      `${graded} contributions the brief claims to carry were present, derived by walking the ` +
      `fixture rather than hand-listed and graded on their rendered placement, not bare presence, ` +
      `so a value under the wrong label fails; assembling ${ISSUE_B} instead left the standing ` +
      `half unchanged while the changing half differed, carried its own contributions and none of ` +
      `${ISSUE_A}'s identity. The comparator is proved able to fire: the same named comparator over ` +
      `a grounding that appends a per-call counter returned false, and localization attributed ` +
      `it to the recipe (${canaryWhere.detail}) rather than the assembly seam. The recipe constraint ` +
      `is proved able to fire too: for a nested context formatter the raw slot signal looks stable — ` +
      `the hazard — the guard sees the unresolved function, and localization consequently refuses to ` +
      `blame the seam. Model n/a throughout — the stub records what it was handed and its legacy ` +
      `generate() throws, so the assembly measured is the framework's own.`,
  };
});
