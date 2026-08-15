import { describe, expect, it } from "vitest";
// @ts-expect-error — root check script, plain .mjs with no type declarations.
import {
  analyzeSources,
  exemptFiles,
  mayContainRetiredName,
  retiredNames,
} from "../../../scripts/validate-side-chain-vocabulary.mjs";

type Finding = { file: string; line: number; encoding: string; detail: string };

const scan = (text: string, path = "packages/core/src/fixture.ts"): Finding[] =>
  (analyzeSources as (s: Array<{ path: string; text: string }>) => Finding[])([{ path, text }]);

const encodings = (text: string, path?: string): string[] =>
  scan(text, path).map((f) => f.encoding);

/**
 * Scope for this rename was corrected seven times, and almost every correction
 * was the same shape: the guard was green because a whole ENCODING of the
 * concept sat outside its rules. So the fixtures are organised by encoding, and
 * each one has to be shown firing — a guard that cannot fail is not a guard.
 */
describe("the four encodings each fire", () => {
  it("E1 — an identifier carrying the `work` token", () => {
    expect(encodings("export type WorkConfig = { a: 1 };")).toContain("E1");
  });

  it("E2 — a `\"work\"` union member NOT bound to `phase`, i.e. FlowErrorScope", () => {
    expect(
      encodings(`export type FlowErrorScope = "request" | "work" | "resource" | "block";`)
    ).toContain("E2");
  });

  it("E3 — `background` naming tier 2", () => {
    expect(encodings("export function composeBackgroundSignal() {}")).toContain("E3");
  });

  it("E4 — a runtime literal that becomes a block-path segment", () => {
    expect(
      encodings(
        `const p = childBlockPath(ctx, runtime, "work", stepIndex);`,
        "packages/core/src/blocks/sequencer.ts"
      )
    ).toContain("E4");
  });

  /**
   * Each path builder is mapped to ITS OWN op-argument index. A single shared
   * constant was right for `childBlockPath` (op at 2) and wrong for
   * `blockPathSegment` (op at 0), so the direct helper call produced nothing —
   * while the builder was named in the guarded list. Naming a builder as
   * covered is a claim; the index is what makes it true.
   */
  it("E4 — the direct helper call, whose op is the FIRST argument", () => {
    expect(encodings(`const seg = blockPathSegment("work", i);`)).toContain("E4");
  });

  it("E4 — does not fire on the op in the wrong position for that builder", () => {
    // `blockPathSegment(op, index)` takes no op at index 1, so a `"work"` there
    // is not a path segment. Proves the index is consulted, not ignored.
    expect(encodings(`const seg = blockPathSegment(op, "work");`)).not.toContain("E4");
  });

  /**
   * The route that skips the builders entirely: a segment that was already
   * formatted, handed to `extendBlockPath`. `op[index]` is the segment's exact
   * shape, so a literal of that shape IS a persisted path segment. This rule
   * found two stale `"work[0]"` arguments the rename had left in
   * `sequencer-kernel.test.ts` on the day it was added.
   */
  it("E4 — an already-built segment passed as a literal", () => {
    expect(encodings(`const p = extendBlockPath(parent, "work[0]");`)).toContain("E4");
    expect(encodings(`await runSideChain(ctx, rt, cfg, "work[0]", 5, "t");`)).toContain("E4");
  });

  it("E4 — leaves an unrelated segment literal alone", () => {
    expect(encodings(`const p = extendBlockPath(parent, "step[0]");`)).toEqual([]);
  });

  /**
   * The path segment is the only part of this rename with a runtime
   * consequence, so the shapes that encode it get over-covered. This one was
   * found by a red suite, not by the check: a regex is neither an identifier
   * nor a string literal, so every other rule was blind to it.
   */
  it("E4 — a block path asserted as a regex", () => {
    expect(encodings(String.raw`const ok = /\/work\[\d+\]$/.test(path);`)).toContain("E4");
  });

  it("E4 — leaves an unrelated regex alone", () => {
    expect(encodings(String.raw`const ok = /\/step\[\d+\]$/.test(path);`)).toEqual([]);
  });
});

/**
 * The rule that shipped broken. The guard went green on a repo where
 * `executeBlock.ts` still wrote `phase: … ? "work" : "main"`, because the
 * literal's parent is the conditional rather than the property. `pnpm
 * typecheck` caught it; the guard did not. This pins the hole shut.
 */
describe("E2 reaches a literal behind a conditional", () => {
  it("fires on `phase: cond ? \"work\" : \"main\"`", () => {
    expect(encodings(`const s = { phase: x === "sideChain" ? "work" : "main" };`)).toContain("E2");
  });

  it("fires on a plain `{ phase: \"work\" }`", () => {
    expect(encodings(`const s = { phase: "work" };`)).toContain("E2");
  });

  it("does NOT reach past the nearest property — `{ phase: f({ other: \"work\" }) }`", () => {
    expect(encodings(`const s = { phase: f({ other: "work" }) };`)).not.toContain("E2");
  });

  /**
   * The seventh hole, found in the rule written to close the second one.
   *
   * `getArguments()` returns the nodes the call actually holds, so for
   * `makeProvenance(id, "work" as const)` that is the AsExpression — an
   * identity check against the bare literal misses. It defeated the rule in
   * exactly the case the rule exists for: a wrapped literal in a fixture that
   * `pnpm typecheck` never looks at, because several packages compile only
   * `src/**`.
   */
  it("reaches a builder argument wrapped in `as const`", () => {
    expect(encodings(`const p = makeProvenance("b", "i", "work" as const);`)).toContain("E2");
  });

  it("reaches the same argument unwrapped", () => {
    expect(encodings(`const p = makeProvenance("b", "i", "work");`)).toContain("E2");
  });
});

/**
 * The control, and the half of this check that matters most.
 *
 * These names carry the same substrings and are CORRECT as they stand. An
 * over-eager sweep catching one of them is a worse outcome than missing a
 * rename: a miss fails `pnpm typecheck` loudly, while a false positive tells
 * the next person to rename working code to get a green build.
 */
describe("the deliberate non-renames report nothing", () => {
  it("spares `Workstream*` — tier 3, and the word it should keep", () => {
    expect(
      scan(`
        export type WorkstreamSummary = { id: string };
        export function listWorkstreams(): WorkstreamSummary[] { return []; }
        const workstreams = listWorkstreams();
      `)
    ).toEqual([]);
  });

  it("spares `priorWork` / `TaskPriorWork` / `formatPriorWork` — a different concept", () => {
    expect(
      scan(`
        export type TaskPriorWork = { done: string[] };
        export function formatPriorWork(priorWork: TaskPriorWork): string { return ""; }
        const toPriorWork = (x: TaskPriorWork) => x;
      `)
    ).toEqual([]);
  });

  it("spares `onBackgroundWork` — the umbrella over all three tiers", () => {
    expect(
      scan(`
        export type RuntimeConfig = { onBackgroundWork?: (p: Promise<void>) => void };
        const registerBackgroundWork = (p: Promise<void>) => {};
      `)
    ).toEqual([]);
  });

  it("spares `framework` / `network` / `teamwork` — substring, not token", () => {
    expect(scan(`const framework = 1, network = 2, teamwork = 3;`)).toEqual([]);
  });

  it("spares CSS `background*` properties", () => {
    expect(
      scan(`const style = { backgroundColor: "red", backgroundImage: "none" };`)
    ).toEqual([]);
  });

  it("spares the generic 'anything left to do' predicates", () => {
    expect(scan(`const hasEdgeWork = true, hasInlineWork = false;`)).toEqual([]);
  });
});

/**
 * The half of this check that decides whether it is safe to leave wired into
 * `pnpm typecheck` forever.
 *
 * An earlier version banned the `work` TOKEN, so any future identifier
 * containing the ordinary English word failed CI. These pin the property that
 * replaced it: the denylist is a closed set of retired names, so new code using
 * the word is fine and only the retired API is refused.
 */
describe("the denylist is closed, so ordinary use of the word stays legal", () => {
  it("allows a NEW identifier containing `work` — the thing the token rule taxed", () => {
    expect(
      scan(`
        const scheduleWork = () => {};
        const workQueue: string[] = [];
        function doWork(unitOfWork: string) { return unitOfWork; }
      `)
    ).toEqual([]);
  });

  it("allows an ordinary status union with a `\"work\"` member", () => {
    expect(scan(`export type Status = "idle" | "work" | "done";`)).toEqual([]);
  });

  /**
   * The four shapes review named, and the reason the earlier rule was wrong.
   *
   * "Is it in member position" is not the distinction that matters — it
   * red-lighted `interface Job { work: string }` and
   * `const dashboard = { backgroundTasks: 3 }`, taxing ordinary domain models
   * repo-wide inside `pnpm typecheck`. What matters is what the name BELONGS
   * to: a `work` that is called is the DSL verb; a `work` that holds a string
   * is a word.
   */
  it("allows an ordinary domain model to use these as FIELD names", () => {
    expect(scan(`interface Job { work: string; }`, "apps/kitchen-sink/x.ts")).toEqual([]);
    expect(scan(`const dashboard = { backgroundTasks: 3 };`, "apps/kitchen-sink/x.ts")).toEqual([]);
    expect(scan(`type Row = { workResults: number };`, "apps/kitchen-sink/x.ts")).toEqual([]);
  });

  it("refuses the DSL verb when it is CALLED", () => {
    expect(encodings(`pipeline.work(block);`)).toContain("E1");
  });

  it("refuses the DSL verb when it is DECLARED as a method", () => {
    expect(encodings(`interface Seq { work(b: B): Seq; }`)).toContain("E1");
  });

  it("refuses a contract field where the contract is declared", () => {
    const inContract = "packages/contracts/src/items/types.ts";
    expect(scan(`export type StatusItem = { backgroundTasks?: number };`, inContract)).not.toEqual([]);
    expect(scan(`export type P = { workGroupId?: string };`, inContract)).not.toEqual([]);
  });

  it("allows the same field name declared outside the contract packages", () => {
    expect(scan(`export type Panel = { backgroundTasks?: number };`, "apps/kitchen-sink/x.ts")).toEqual([]);
  });

  /**
   * Callability is the whole discriminator for `work`, so the un-called read has
   * to be pinned too — otherwise the rule quietly degrades to "any property
   * named work", which is the over-reach it was written to remove.
   *
   * Under-reach this accepts, stated: `const m = pipeline.work` (referencing the
   * DSL method without calling it) is not flagged. It is vanishingly rare, and
   * in `src` it fails `pnpm typecheck` once the method is gone.
   */
  it("allows reading a FIELD named `work` off an object", () => {
    expect(scan(`const label = job.work; const n = row.work + 1;`)).toEqual([]);
  });

  it("allows a `\"work\"` union with no named declaration holding it", () => {
    expect(scan(`const s: "idle" | "work" = "idle";`)).toEqual([]);
    expect(scan(`function f(): "idle" | "work" { return "idle"; }`)).toEqual([]);
  });

  it("still refuses the retired published types anywhere", () => {
    expect(encodings(`import type { RequestWorkPool } from "x";`)).toContain("E1");
    expect(encodings(`export function composeBackgroundSignal() {}`)).toContain("E3");
    expect(encodings(`const x = waitForWork;`)).toContain("E1");
  });

  it("keeps sparing the deliberate non-renames", () => {
    expect(
      scan(`
        export type WorkstreamSummary = { id: string };
        export function formatPriorWork(priorWork: TaskPriorWork): string { return ""; }
        export type RuntimeConfig = { onBackgroundWork?: () => void };
        const style = { backgroundColor: "red" };
        const framework = 1, network = 2, teamwork = 3;
      `)
    ).toEqual([]);
  });

  /**
   * The denylist's failure mode is the quiet one: a retired name left off the
   * list is never mentioned again. This audits the list against the surfaces
   * the rename actually moved, so a gap shows up here rather than as a silent
   * pass three months from now.
   */
  it("covers every retired name that lived in framework source", () => {
    for (const name of [
      "waitForWork",
      "forEachBackground",
      "WorkConfig",
      "RequestWorkPool",
      "createRequestWorkPool",
      "composeBackgroundSignal",
      "WorkTrace",
      "dispatchWorkTask",
      "runBackground",
      "backgroundTaskCtx",
      "backgroundController",
      "DEFAULT_BACKGROUND_CONCURRENCY",
      "BackgroundBadge",
      "work",
      "workGroupId",
      "backgroundTasks",
    ]) {
      expect(retiredNames).toContain(name);
    }
  });

  it("deliberately omits test locals and umbrella-ish names", () => {
    for (const name of ["slowWork", "bgWork", "failingWork", "isBackground", "backgroundTask"]) {
      expect(retiredNames).not.toContain(name);
    }
  });

  it("pins the closed set, so a name cannot be dropped from it unnoticed", () => {
    expect(retiredNames).toContain("waitForWork");
    expect(retiredNames).toContain("WorkConfig");
    expect(retiredNames).toContain("composeBackgroundSignal");
    expect(retiredNames).toContain("work");
    expect(retiredNames).not.toContain("scheduleWork");
  });
});

/**
 * The exemption is the one place the retired spelling may still appear, so the
 * thing that has to stay true is its SIZE. A second entry turns an audited
 * exception into a general escape hatch, and the script's own load-time
 * assertion would still pass a two-entry list into every future reader's
 * mental model. Same pin the sibling guard puts on its own exemption.
 */
describe("side-chain vocabulary check — the exemption", () => {
  it("holds exactly the two rename-boundary tests, by name", () => {
    expect(exemptFiles).toEqual([
      "packages/devtool/test/legacy-phase-record.test.ts",
      "packages/engine/test/side-chain-rename-continuation.test.ts",
    ]);
  });
});

/**
 * The pre-filter decides which files are parsed at all, so a filter narrower
 * than the rules deletes coverage without failing anything — the quietest
 * version of the failure this check has had seven times.
 *
 * The repo-level proof is `node scripts/validate-side-chain-vocabulary.mjs
 * --parity`, which re-runs the scan with the filter off and diffs. These pin
 * the property it rests on, derived from the denylist so adding a name cannot
 * leave the filter behind.
 */
describe("the pre-filter never hides a file the rules would flag", () => {
  it("admits every name on the denylist", () => {
    for (const name of retiredNames as string[]) {
      expect(
        (mayContainRetiredName as (t: string) => boolean)(`const x = ${name};`),
        `pre-filter would skip a file containing ${name}`
      ).toBe(true);
    }
  });

  it("admits the E2 literal in every quote style", () => {
    const check = mayContainRetiredName as (t: string) => boolean;
    expect(check('const p = { phase: "work" };')).toBe(true);
    expect(check("const p = { phase: 'work' };")).toBe(true);
    expect(check("const p = { phase: `work` };")).toBe(true);
  });

  it("admits the E4 forms — path argument, template head and regex", () => {
    const check = mayContainRetiredName as (t: string) => boolean;
    expect(check(`childBlockPath(ctx, runtime, "work", i)`)).toBe(true);
    expect(check("name: `work:${block.name}`")).toBe(true);
    expect(check(String.raw`/\/work\[\d+\]$/.test(path)`)).toBe(true);
  });

  it("skips files whose only match is a word that merely CONTAINS the token", () => {
    const check = mayContainRetiredName as (t: string) => boolean;
    expect(check("const framework = 1; const network = 2; const teamwork = 3;")).toBe(false);
    expect(check("// homework and paperwork are not tiers")).toBe(false);
  });
});

/**
 * A backtick string with no `${}` is a `NoSubstitutionTemplateLiteral`, not a
 * `StringLiteral` and not a `TemplateExpression` — so it fell through both of
 * the guard's literal branches and every rule underneath them. The guard
 * accepted `` { phase: `work` } `` while rejecting `{ phase: "work" }`.
 *
 * It landed on E4, where `blockPathSegment` takes any string, so `tsc` would
 * not have caught it either. Latent rather than exploited when found, which is
 * exactly the regression this check exists to stop.
 *
 * The controls are the half that makes these mean anything: the quoted forms
 * must still fire (no regression), and an unrelated backtick string must NOT —
 * this PR has undone a widening over-reach twice, and the template-literal
 * door is a new way to reintroduce it.
 */
describe("a backtick literal is a string too", () => {
  const seq = "packages/core/src/blocks/sequencer.ts";

  it("E2 — fires on a backtick tier value", () => {
    expect(encodings("const s = { phase: `work` };")).toContain("E2");
  });

  it("E4 — fires on a backtick op passed to the direct path builder", () => {
    expect(encodings("const x = blockPathSegment(`work`, i);", seq)).toContain("E4");
  });

  it("E4 — fires on a backtick already-built segment", () => {
    expect(encodings("const x = extendBlockPath(p, `work[0]`);", seq)).toContain("E4");
  });

  it("CONTROL — the double-quoted equivalents still fire", () => {
    expect(encodings(`const s = { phase: "work" };`)).toContain("E2");
    expect(encodings(`const x = blockPathSegment("work", i);`, seq)).toContain("E4");
    expect(encodings(`const x = extendBlockPath(p, "work[0]");`, seq)).toContain("E4");
  });

  it("CONTROL — an unrelated backtick string does not fire", () => {
    expect(scan("const m = `hello work`;", seq)).toEqual([]);
    expect(scan("const m = `workflow`;", seq)).toEqual([]);
    expect(scan("const x = extendBlockPath(p, `step[0]`);", seq)).toEqual([]);
  });
});

/**
 * E4's two remaining precision bugs, both found in review.
 *
 * The segment rule read `\[\d*\]?` with no `$`, so zero digits and a missing
 * bracket were allowed and anything could follow. `blockPathSegment(op, index)`
 * emits exactly `op[index]`, so anything else is a false positive — the
 * direction this check has already had to correct twice.
 *
 * The path-builder branch read `getParent()` instead of `effectiveParent()`,
 * which is the helper written for precisely this trap and whose own docblock
 * describes it. The earlier wrapped-argument fix reached E2 only, so E4 — the
 * encoding that reaches the persisted block path — kept the hole for four
 * rounds.
 */
describe("E4 matches the persisted segment shape, and nothing else", () => {
  const seq = "packages/core/src/blocks/sequencer.ts";

  it("does not fire on strings that merely start like a segment", () => {
    expect(scan('const x = extendBlockPath(p, "work[shop");', seq)).toEqual([]);
    expect(scan('const x = extendBlockPath(p, "work[abc]");', seq)).toEqual([]);
    expect(scan('const x = extendBlockPath(p, "work[0]suffix");', seq)).toEqual([]);
  });

  it("still fires on a complete segment", () => {
    expect(encodings('const x = extendBlockPath(p, "work[0]");', seq)).toContain("E4");
    expect(encodings('const x = extendBlockPath(p, "work[12]");', seq)).toContain("E4");
  });
});

describe("E4 sees through type-only wrappers, like E2 already did", () => {
  const seq = "packages/core/src/blocks/sequencer.ts";

  it("fires on an op argument behind `as const`", () => {
    expect(encodings('const x = blockPathSegment("work" as const, i);', seq)).toContain("E4");
    expect(encodings('const x = childBlockPath(ctx, rt, "work" as const, i);', seq)).toContain("E4");
  });

  it("fires on a wrapped default block name", () => {
    expect(encodings('const o = { name: "work" as const };', seq)).toContain("E4");
  });

  it("CONTROL — the unwrapped forms still fire", () => {
    expect(encodings('const x = blockPathSegment("work", i);', seq)).toContain("E4");
  });

  it("CONTROL — a wrapped op in the WRONG argument position still does not fire", () => {
    // Proves the wrapper fix did not cost the per-builder index check.
    expect(scan('const x = blockPathSegment(op, "work" as const);', seq)).toEqual([]);
  });

  /**
   * The template branch never consulted `getParent()`, so it never carried this
   * assumption — checked rather than assumed, since "the fix is elsewhere too"
   * is the shape of half the findings on this change.
   */
  it("the template branch was already immune, wrapped or not", () => {
    expect(encodings("const n = `work:${b.name}`;", seq)).toContain("E4");
    expect(encodings("const n = `work:${b.name}` as const;", seq)).toContain("E4");
  });
});

/**
 * The assumption was never per-rule, it was per-branch.
 *
 * Review caught E4's path builder reading `getParent()` where
 * `effectiveParent()` was required. Auditing every raw `getParent()` in the
 * check afterwards found the identifier rule doing the same thing: a
 * parenthesized callee puts a `ParenthesizedExpression` between the property
 * access and the call, so `(pipeline.work)(b)` produced nothing.
 *
 * Three branches held that assumption independently, which is why the fix is
 * "route every branch through the helper" rather than "patch the two lines
 * review named".
 */
describe("callee detection sees through wrappers too", () => {
  const seq = "packages/core/src/blocks/sequencer.ts";

  it("fires on a parenthesized callee", () => {
    expect(encodings("(pipeline.work)(b);", seq)).toContain("E1");
  });

  it("fires when the receiver is wrapped", () => {
    expect(encodings("(pipeline as Seq).work(b);", seq)).toContain("E1");
    expect(encodings("pipeline!.work(b);", seq)).toContain("E1");
  });

  it("CONTROL — a field READ still does not fire, parenthesized or not", () => {
    expect(scan("const v = job.work;", seq)).toEqual([]);
    expect(scan("const v = (job.work);", seq)).toEqual([]);
  });
});
