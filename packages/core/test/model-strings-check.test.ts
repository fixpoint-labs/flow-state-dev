import { describe, expect, it } from "vitest";
// @ts-expect-error — root check script, plain .mjs with no type declarations.
import {
  isScannedPath,
  rejectionImplFiles,
  resolverWindow,
  scanSources,
} from "../../../scripts/validate-model-strings.mjs";

type Hit = { file: string; line: number; text: string; rule: string };

const scan = (text: string, path = "apps/docs/docs/fixture.md"): Hit[] =>
  (scanSources as (s: Array<{ path: string; text: string }>) => Hit[])([{ path, text }]);

const rules = (text: string): string[] => scan(text).map((h) => h.rule);

/**
 * The guard's value is entirely in where it draws the line: a quoted `preset/*`
 * is a reader being told to call removed syntax, while the same string in
 * backticks is the migration guidance correctly naming what was removed. Fire
 * on the first and stay silent on the second, or the guard either misses the
 * regression or deletes the docs that explain it.
 */
describe("preset/* model strings — quoted is a call, backticked is prose", () => {
  it("flags a quoted preset string, the shape that throws at runtime", () => {
    expect(rules(`model: "preset/small",`)).toEqual(["preset-string"]);
  });

  it("flags single quotes too — the same call in a different dialect", () => {
    expect(rules(`model: 'preset/fast',`)).toEqual(["preset-string"]);
  });

  it("ignores a backticked preset string, how the migration table names it", () => {
    expect(rules("`preset/fast` and `preset/small` now map to `intent/utility`.")).toEqual([]);
  });

  it("ignores a bare preset string in migration prose", () => {
    expect(rules("Any preset/* string throws at construction time.")).toEqual([]);
  });

  it("reports the line, so the failure names where to look", () => {
    expect(scan(`intro\nmore\nmodel: "preset/large",`)[0]?.line).toBe(3);
  });
});

/**
 * The second rule exists because a scan for `preset/` alone provably missed
 * `api/server.md`, which taught the removed `presets:` option and contains no
 * such substring. It is windowed to a resolver construction so an unrelated
 * `presets:` key in some other object is not swept up.
 */
describe("the removed 'presets' resolver option", () => {
  it("flags presets: inside a createModelResolver call", () => {
    expect(
      rules(`const r = createModelResolver({\n  presets: { fast: { models: [] } },\n});`),
    ).toEqual(["presets-option"]);
  });

  it("ignores a presets: key with no resolver construction near it", () => {
    expect(rules(`const uiConfig = {\n  presets: { compact: true },\n};`)).toEqual([]);
  });

  it("ignores intents:, the option that replaced it", () => {
    expect(
      rules(`const r = createModelResolver({\n  intents: { utility: ["openai/gpt-5.4-mini"] },\n});`),
    ).toEqual([]);
  });

  it("stops looking once the window closes, so a later block is not swept up", () => {
    const farAway = [
      "const r = createModelResolver({ defaultModel: 'openai/gpt-5.4-mini' });",
      ...Array.from({ length: resolverWindow as number }, () => "// filler"),
      "const theme = { presets: { compact: true } };",
    ].join("\n");

    expect(rules(farAway)).toEqual([]);
  });

  it("still catches presets: a few lines below the call, where it really sits", () => {
    expect(
      rules(
        `const r = createModelResolver({\n  keys: { openai: KEY },\n  retryPolicy: {},\n  presets: { fast: {} },\n});`,
      ),
    ).toEqual(["presets-option"]);
  });
});

/**
 * The surface is defined by exclusion, and these cases are why.
 *
 * An inclusion list was wrong twice — it missed `.agents`, where a skill is a
 * template an agent copies from, and then `apps/kitchen-sink`, a reference app
 * whose flows execute real model configuration. Neither miss failed anything;
 * the guard just quietly stopped covering them. Pinning representative paths
 * means the next omission fails here instead of reaching a reviewer.
 */
describe("scan surface", () => {
  const scanned = (path: string): boolean =>
    (isScannedPath as (p: string) => boolean)(path);

  it.each([
    // Executes real model configuration — a bad string here is a runtime throw.
    ["apps/kitchen-sink/fsdev.config.ts"],
    ["apps/pattern-benchmark/src/suite.ts"],
    ["examples/hello-chat/src/flows/hello-chat/flow.ts"],
    // Templates an agent copies from, which keep writing the removed syntax.
    [".agents/skills/create-block/SKILL.md"],
    // Prose a reader follows.
    ["apps/docs/docs/getting-started/quick-start.md"],
    ["docs/architecture/utility-blocks.md"],
    ["packages/core/README.md"],
    ["README.md"],
    ["labs/demo/agent.ts"],
    // Ordinary package source — executable model configuration, so a bad
    // string here throws rather than merely misleading.
    ["packages/core/src/utility/decomposer.ts"],
    ["packages/patterns/src/plan-and-execute/index.ts"],
    // A sibling of three excluded files, in the same directory: the exclusion
    // is those files, not the folder they share.
    ["packages/core/test/models/create-model-resolver-loading.test.ts"],
    // Sibling guards, in scope like anything else.
    ["scripts/validate-package-boundaries.mjs"],
  ])("scans %s", (path) => {
    expect(scanned(path)).toBe(true);
  });

  it.each([
    // Not authored here.
    ["node_modules/some-pkg/index.js"],
    ["apps/docs/build/assets/js/chunk.js"],
    ["apps/docs/.docusaurus/registry.js"],
    // A working copy of the repo would otherwise be scanned twice.
    [".claude/worktrees/agent-x/apps/docs/docs/intro.md"],
  ])("excludes %s", (path) => {
    expect(scanned(path)).toBe(false);
  });

  it("ignores files it has no rules for, whatever the tree", () => {
    expect(scanned("apps/kitchen-sink/package.json")).toBe(false);
    expect(scanned("apps/kitchen-sink/styles.css")).toBe(false);
  });

  it("attributes a hit to the file it came from", () => {
    expect(scan(`model: "preset/fast"`, "labs/demo/agent.ts")[0]?.file).toBe("labs/demo/agent.ts");
  });

  /**
   * Both halves together: package source is inside the surface, and a
   * violation written there is actually reported.
   */
  it("catches a violation in ordinary package source, not just in docs", () => {
    const path = "packages/core/src/utility/decomposer.ts";

    expect(scanned(path)).toBe(true);
    expect(scan(`const block = generator({ model: "preset/fast" });`, path)).toEqual([
      expect.objectContaining({ file: path, rule: "preset-string" }),
    ]);
  });
});

/**
 * Driven from the guard's own export rather than a second copy of the list —
 * one fact in two places is the shape of bug this exclusion just had.
 */
describe("the rejection-implementation exclusion", () => {
  const excluded = rejectionImplFiles as string[];

  it.each(excluded)("excludes %s", (path) => {
    expect((isScannedPath as (p: string) => boolean)(path)).toBe(false);
  });

  /**
   * The load-bearing one. Every entry must name a single file, so the list
   * cannot quietly grow back into the directory rule it replaced — which is
   * how a `preset/*` in ordinary package source got a green check.
   */
  it("names individual files, never a directory or a pattern", () => {
    for (const path of excluded) {
      expect(path).toMatch(/\.(ts|mjs)$/);
      expect(path).not.toMatch(/[*?]/);
    }
  });
});
