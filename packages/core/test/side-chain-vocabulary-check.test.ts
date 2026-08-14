import { describe, expect, it } from "vitest";
// @ts-expect-error — root check script, plain .mjs with no type declarations.
import {
  analyzeSources,
  carriesRetiredUmbrellaToken,
  carriesRetiredTierToken,
  identTokens,
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
 * The tokenizer is the reason the non-renames survive, so it is tested
 * directly: `Workstream` must not tokenize to a `work` token, or every rule
 * above inherits a false positive.
 */
describe("tokenisation is what separates a token from a substring", () => {
  it("splits camelCase and PascalCase", () => {
    expect(identTokens("RequestWorkPool")).toEqual(["request", "work", "pool"]);
    expect(identTokens("waitForWork")).toEqual(["wait", "for", "work"]);
  });

  it("does not split `workstream`, `framework` or `network` into a `work` token", () => {
    expect(identTokens("Workstream")).toEqual(["workstream"]);
    expect(identTokens("framework")).toEqual(["framework"]);
    expect(identTokens("network")).toEqual(["network"]);
  });

  it("`background` + `work` adjacent is the umbrella, not tier 2", () => {
    expect(carriesRetiredTierToken("onBackgroundWork")).toBe(false);
    expect(carriesRetiredUmbrellaToken("onBackgroundWork")).toBe(false);
    expect(carriesRetiredUmbrellaToken("backgroundWorkLedger")).toBe(false);
    // …but `background` alone, naming the middle tier, is retired.
    expect(carriesRetiredUmbrellaToken("forEachBackground")).toBe(true);
  });
});
