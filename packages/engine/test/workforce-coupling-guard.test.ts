/**
 * Guard: Engine's source is not coupled to Workforce.
 *
 * Hiring, rosters and seats are Workforce's concepts, one layer up. Engine
 * carries generic primitives Workforce opts into (the owner-private
 * collection, the instance pin) and knows none of Workforce's names or key
 * shapes. This fails on concrete coupling anywhere under `src/`:
 *
 *   1. an import or re-export from `@flow-state-dev/workforce`;
 *   2. a roster symbol: `HIRED_ROSTER_*`, `*HiredRosterPrivateCollection`,
 *      `assertRosterCollectionIsNotDeep`, or Engine's deleted roster helpers
 *      (`privateRosterAdmits`, `scopePrivateRosterToCaller`,
 *      `assertFlowRosterPatterns`);
 *   3. the `workforce/roster` key;
 *   4. the `"roster-owner"` pin reason;
 *   5. a module path naming `hire-plane`, as a source file or an import.
 *
 * It is not a word ban. Ordinary English ("an operator's seat"), task-board
 * vocabulary and the trace store's `_roster.json` are not coupling, and prose
 * is left to review. The last block proves each rule can fire and that none
 * fires on those words.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(here, "..", "src");

/** Every source file under a directory, as paths relative to `src/`. */
function collectSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectSourceFiles(full, acc);
    else if (entry.isFile() && /\.[cm]?[jt]sx?$/.test(entry.name)) acc.push(path.relative(srcDir, full));
  }
  return acc;
}

/** One kind of coupling, matched against each source file's full text. */
interface Rule {
  name: string;
  pattern: RegExp;
  /** A line the rule must catch. */
  sample: string;
}

const RULES: Rule[] = [
  {
    name: "an import from @flow-state-dev/workforce",
    pattern: /["'`]@flow-state-dev\/workforce(?:\/[^"'`]*)?["'`]/,
    sample: 'import { hireWorkforce } from "@flow-state-dev/workforce";',
  },
  {
    name: "a roster symbol",
    pattern:
      /\bHIRED_ROSTER_\w*|\w*HiredRosterPrivateCollection\b|\b(?:assertRosterCollectionIsNotDeep|privateRosterAdmits|scopePrivateRosterToCaller|assertFlowRosterPatterns)\b/,
    sample: 'import { HIRED_ROSTER_PRIVATE_PATTERN } from "@flow-state-dev/core";',
  },
  {
    name: "the workforce/roster key",
    pattern: /workforce\/roster/,
    sample: 'const prefix = "workforce/roster/";',
  },
  {
    name: 'the "roster-owner" pin reason',
    pattern: /["'`]roster-owner["'`]/,
    sample: 'if (reason === "roster-owner") return;',
  },
  {
    name: "an import of a hire-plane module",
    pattern: /\b(?:from|import)\s*\(?\s*["'`][^"'`\n]*hire-plane[^"'`\n]*["'`]/,
    sample: 'import { pinRejectsCaller } from "../context/hire-plane";',
  },
];

/** Lines that name roster or seat words without coupling to Workforce. */
const NOT_COUPLING = [
  'const ROSTER_FILE = "_roster.json";',
  "private readonly roster = new Map<string, number>();",
  "// Both are the same situation from an operator's seat.",
  "// a seat another board holds would claim a row",
  "// Workforce pins each hired seat this way.",
];

describe("Engine source is not coupled to Workforce", () => {
  const files = collectSourceFiles(srcDir);

  it("walks every directory under src", () => {
    expect(files).toEqual(
      expect.arrayContaining(["index.ts", path.join("stores", "scope-keys.ts"), path.join("resources", "owner-private.ts")])
    );
  });

  it.each(RULES)("names $name nowhere", ({ pattern }) => {
    const offenders = files.filter((file) => pattern.test(readFileSync(path.join(srcDir, file), "utf8")));
    expect(offenders).toEqual([]);
  });

  it("has no module whose path names hire-plane", () => {
    expect(files.filter((file) => file.includes("hire-plane"))).toEqual([]);
  });

  describe("each rule can fire, and none fires on ordinary words", () => {
    it.each(RULES)("$name catches its sample", ({ pattern, sample }) => {
      expect(pattern.test(sample)).toBe(true);
    });

    it.each(NOT_COUPLING)("no rule fires on %s", (line) => {
      expect(RULES.filter(({ pattern }) => pattern.test(line)).map(({ name }) => name)).toEqual([]);
    });
  });
});
