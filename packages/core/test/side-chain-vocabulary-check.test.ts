import { describe, expect, it } from "vitest";
// @ts-expect-error — root check script, plain .mjs with no type declarations.
import {
  analyzeSources,
  exemptFiles,
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

  it("still refuses the retired DSL verb in member position", () => {
    expect(encodings(`pipeline.work(block);`)).toContain("E1");
    expect(encodings(`pipeline.workIf(cond, block);`)).toContain("E1");
  });

  it("still refuses the retired published types anywhere", () => {
    expect(encodings(`import type { RequestWorkPool } from "x";`)).toContain("E1");
    expect(encodings(`export function composeBackgroundSignal() {}`)).toContain("E3");
  });

  it("allows a plain variable named `work` — a variable is not the DSL verb", () => {
    expect(scan(`const work = 3; return work + 1;`)).toEqual([]);
  });

  /**
   * `work.id` reads a property OFF something called `work`; `pipeline.work(b)`
   * calls a property NAMED work. Only the second is the retired verb, and a
   * member rule that does not check which side of the dot it is on flags every
   * local holding a row — which is how the kitchen-sink Workstream panel got
   * caught by an earlier sweep.
   */
  it("allows `work` as the OBJECT of an access, not just as a bare variable", () => {
    expect(scan(`const id = work.id; const t = work.topic ?? "";`)).toEqual([]);
  });

  it("allows a `\"work\"` union with no named declaration holding it", () => {
    expect(scan(`const s: "idle" | "work" = "idle";`)).toEqual([]);
    expect(scan(`function f(): "idle" | "work" { return "idle"; }`)).toEqual([]);
  });

  it("refuses `work` as a declared member, which IS the DSL verb", () => {
    expect(encodings(`interface Seq { work(b: B): Seq; }`)).toContain("E1");
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
  it("holds exactly one entry, so it cannot be broadened into a no-op", () => {
    expect(exemptFiles).toEqual(["packages/devtool/test/legacy-phase-record.test.ts"]);
  });
});
