/**
 * The enumeration checks — the ones that fail when a **new** member of a set is wired directly
 * instead of through the rule its siblings go through.
 *
 * Every defect this module has shipped has had the same shape. A pair exists — two env loaders,
 * two secrets, two static scans — a reviewer names one half, the fix lands on the half that was
 * named, and the other half surfaces the following round. Fixing instances does not converge,
 * because **nothing enumerates the set**: each fix is verified against the case it was written
 * for, so the sibling is never exercised.
 *
 * These tests are the convergence. They do not check that a particular secret consults both
 * loaders or that a particular scan blanks comments — the behavioural suites do that. They check
 * that **no member of either set escapes the rule**, so a seventh secret or a third scan added
 * later fails here rather than in review.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { SECRET_KEYS } from "../skills/install-fsd/detect/constants.mjs";
import { provenanceOf, resolveSecretFiles, resolveSecrets } from "../skills/install-fsd/detect/secrets.mjs";
import { buildReport } from "../skills/install-fsd/detect/report.mjs";
import { cleanupTrees, makeTree, nextManifest } from "./helpers.mjs";

const detectDir = join(import.meta.dirname, "../skills/install-fsd/detect");
const page = "export default function Page() { return null }\n";

describe("every secret is resolved from every loader that reads it", () => {
  it("accounts for all of SECRET_KEYS, with no key resolved from half its loaders", () => {
    // The demo token had its own hand-written destination branch that consulted the CLI answer
    // alone — the same defect the provider keys had a round earlier. Two call sites that agree
    // today are not one rule; they are a sibling waiting to diverge.
    const root = makeTree({
      "package.json": nextManifest({ packageManager: "pnpm@9.0.0" }),
      "app/page.tsx": page,
      ".gitignore": ".env.local\n",
    });

    // Ask for every provider key in turn, so the union covers the whole set.
    const covered = new Map();
    for (const key of SECRET_KEYS) {
      const secrets = resolveSecrets(root, "next", {});
      const files = resolveSecretFiles(root, secrets, { providerKey: key });
      for (const [name, runtimes] of Object.entries(files.coverage)) covered.set(name, runtimes);
    }

    // 1. No key in the set is missing. A seventh secret wired directly never appears here.
    expect([...covered.keys()].sort()).toEqual([...SECRET_KEYS].sort());

    // 2. On a Next host BOTH loaders decide, so every key must have been asked of both.
    for (const [name, runtimes] of covered) {
      expect(runtimes, `${name} was resolved from ${runtimes.length} runtime(s)`).toEqual([
        "your CLI",
        "next dev",
      ]);
    }
  });

  it("every secret has a declared provenance", () => {
    // Provenance is the ONE thing that differs between secrets. A key with none would fall
    // through the shared rule into whichever branch happened to be last.
    for (const key of SECRET_KEYS) {
      expect(["developer", "generated"]).toContain(provenanceOf(key));
    }
  });

  it("the report carries a resolution for every secret, not only the chosen provider", () => {
    const root = makeTree({ "package.json": nextManifest({ packageManager: "pnpm@9.0.0" }), "app/page.tsx": page });
    const report = buildReport(root);
    expect(Object.keys(report.secrets).sort()).toEqual([...SECRET_KEYS].sort());
  });
});

describe("every static read of a foreign source file goes through source-scan.mjs", () => {
  /** Regex execution against a variable holding somebody else's file contents. */
  const RAW_SCAN =
    /\b(?:exec|test|match|matchAll)\s*\(\s*source\b|\bsource\s*\.\s*(?:match|matchAll|replace|split|search|slice|indexOf)\s*\(/;

  const modules = readdirSync(detectDir).filter((name) => name.endsWith(".mjs"));

  it("has more than one module to check, so this is not vacuous", () => {
    expect(modules.length).toBeGreaterThan(5);
    expect(modules).toContain("source-scan.mjs");
  });

  it.each(modules.filter((name) => name !== "source-scan.mjs"))(
    "%s does not scan foreign source itself",
    (name) => {
      // The config-level scan was fixed to blank comments and anchor to the effective export, and
      // the imported-flow scan next door still read raw first-match. One entry point is what
      // stops there being a third one to forget — so a module that scans directly fails here,
      // whether or not anyone remembers the rule.
      const source = readFileSync(join(detectDir, name), "utf-8");
      const offenders = source
        .split("\n")
        .map((line, index) => ({ line: line.trim(), number: index + 1 }))
        .filter(({ line }) => RAW_SCAN.test(line) && !line.startsWith("*") && !line.startsWith("//"));
      expect(
        offenders,
        `${name} reads foreign source directly; route it through source-scan.mjs`,
      ).toEqual([]);
    },
  );

  it("every caller reads a setting from an accepted region, never unanchored", () => {
    // **The gap this check used to have.** `settingValue` went THROUGH source-scan.mjs and still
    // did not anchor to the effective export — so the check caught a bypass and missed an
    // incomplete rule applied through the shared entry point. Consolidating duplication into one
    // file is not the same as making the one rule complete, so the assertion is about every
    // caller's arguments rather than about the entry point existing.
    //
    // The code enforces this too — `settingValue` throws without a region — but a throw only
    // fires on a path someone runs. This fails on a path nobody has run yet.
    const callers = modules.filter((name) => name !== "source-scan.mjs");
    let checked = 0;
    for (const name of callers) {
      const source = readFileSync(join(detectDir, name), "utf-8");
      for (const call of source.matchAll(/\b(settingValue|declaredLiteral)\s*\(/g)) {
        checked++;
        const args = source.slice(call.index + call[0].length, source.indexOf(";", call.index));
        const region = splitArgs(args)[2];
        expect(
          region,
          `${name}: ${call[1]}(...) is called with no region — an unanchored read is the gap this rule closes`,
        ).toBeDefined();
        expect(
          /Region\s*\(|region\b/.test(region),
          `${name}: ${call[1]}(...) must be given a region from exportedObjectRegion() or callArgumentRegion(), got ${region.trim()}`,
        ).toBe(true);
      }
    }
    // Vacuity: there must be callers to check.
    expect(checked).toBeGreaterThan(0);
  });

  it("the detector actually detects — otherwise the rule above passes on everything", () => {
    // The vacuity guard, and it earned its place: the first version of it asserted source-scan
    // itself matched RAW_SCAN, which it does not, because it blanks comments into `code` and
    // scans that. Checking the predicate against a known offender tests the detector rather than
    // one module's idiom.
    expect(RAW_SCAN.test('const m = /kind:\\s*"(\\w+)"/.exec(source);')).toBe(true);
    expect(RAW_SCAN.test("for (const x of source.matchAll(pattern)) {}")).toBe(true);
    expect(RAW_SCAN.test("const hit = settingValue(source, \"basePath\");")).toBe(false);
  });
});

/** Split a call's argument text on top-level commas. */
function splitArgs(text) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") {
      if (depth === 0) break;
      depth--;
    } else if (ch === "," && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

describe("cleanup", () => {
  it("removes fixtures", () => {
    cleanupTrees();
    expect(true).toBe(true);
  });
});
