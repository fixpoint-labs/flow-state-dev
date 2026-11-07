/**
 * The vocabulary glossary (`docs/contributing/glossary.mjs`) is the one place a
 * word is retired or kept, and three checks read it. A bad entry must fail when
 * the module loads, in every check at once, not quietly match nothing in one of
 * them. These tests load a copy of the glossary with one entry broken and
 * require the load to throw, and check that one bare retirement reaches both
 * text checks.
 */
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const GLOSSARY = fileURLToPath(new URL("../../../docs/contributing/glossary.mjs", import.meta.url));
const SOURCE = readFileSync(GLOSSARY, "utf8");
const ENTRIES_OPEN = "export const ENTRIES = [\n";

type Rule = { id: string; term: string; files?: RegExp; pattern?: RegExp; re?: RegExp };
type Glossary = {
  ENTRIES: Array<{ term: string; means: string; retires: object[] }>;
  SWEEP_RULES: Rule[];
  GUARD_TERMS: Rule[];
  SWEEP_EXEMPTIONS: Array<{ rules?: string[] }>;
  GUARD_EXEMPTIONS: Array<{ terms?: string[]; where?: (path: string) => boolean; strip?: (path: string, line: string) => string }>;
  PUBLISHED_TERMS: string[];
};

/** Load the glossary with `edit` applied to its text, from a fresh file so no module cache is shared. */
async function load(edit: (text: string) => string = (t) => t): Promise<Glossary> {
  const dir = mkdtempSync(join(tmpdir(), "glossary-"));
  const file = join(dir, "glossary.mjs");
  writeFileSync(file, edit(SOURCE));
  return (await import(pathToFileURL(file).href)) as Glossary;
}

/** Insert an entry as the first one, the way an owner adds a term. */
const withEntry = (entry: string) => (text: string) => {
  if (!text.includes(ENTRIES_OPEN)) throw new Error("the glossary no longer opens its entries with `export const ENTRIES = [`");
  return text.replace(ENTRIES_OPEN, `${ENTRIES_OPEN}  ${entry},\n`);
};

describe("the vocabulary glossary loads only when every entry is well formed", () => {
  it("loads as it stands, and every rule it hands a check is a compiled pattern", async () => {
    const g = await load();
    expect(g.ENTRIES.length).toBeGreaterThan(0);
    for (const r of g.SWEEP_RULES) {
      expect(r.files, r.id).toBeInstanceOf(RegExp);
      expect(r.pattern, r.id).toBeInstanceOf(RegExp);
    }
    for (const r of g.GUARD_TERMS) {
      expect(r.re, r.id).toBeInstanceOf(RegExp);
      expect(r.re?.global, r.id).toBe(true);
    }
    expect(new Set(g.PUBLISHED_TERMS).size).toBe(g.PUBLISHED_TERMS.length);
  });

  it("fails to load on a pattern that does not compile", async () => {
    await expect(load(withEntry('{ term: "Zz broken", means: "x", retires: [{ id: "zz-broken", check: "sweep", files: /x/, pattern: new RegExp("(") }] }'))).rejects.toThrow();
  });

  it("fails to load on an exemption that keeps a word nothing retires", async () => {
    const edit = (text: string) => text.replace("const EXEMPTIONS = [\n", 'const EXEMPTIONS = [\n  { path: /x/, rules: ["zz-nothing-retires-this"], why: "planted" },\n');
    await expect(load(edit)).rejects.toThrow(/nothing retires/);
  });

  it("fails to load on a retirement with an unknown check, a missing meaning, or a duplicate id", async () => {
    await expect(load(withEntry('{ term: "Zz", means: "x", retires: [{ id: "zz", check: "zz-no-such-check" }] }'))).rejects.toThrow(/unknown check/);
    await expect(load(withEntry('{ term: "Zz", means: "", retires: [] }'))).rejects.toThrow(/what it means/);
    await expect(load(withEntry('{ term: "Zz", means: "x", retires: [{ name: "zzWord" }, { name: "zzWord" }] }'))).rejects.toThrow(/under both/);
  });

  it("turns a bare retired name into one rule for the sweep and one term for the guard", async () => {
    const g = await load(withEntry('{ term: "Zz term", means: "x", retires: [{ name: "zzRetiredName" }] }'));
    const sweep = g.SWEEP_RULES.find((r) => r.id === "zzRetiredName");
    const guard = g.GUARD_TERMS.find((r) => r.id === "zzRetiredName");
    expect(sweep?.term).toBe("Zz term");
    expect(guard?.term).toBe("Zz term");
    // A whole-word name match, in package source and on a published page.
    expect(sweep?.files?.test("packages/core/src/a.ts")).toBe(true);
    expect(sweep?.files?.test("apps/docs/docs/a.md")).toBe(true);
    expect(sweep?.pattern?.test("export const zzRetiredName = 1;")).toBe(true);
    expect(sweep?.pattern?.test("export const zzRetiredNames = 1;")).toBe(false);
  });

  it("gives a bare retirement's exemption to both text checks, so one word has one answer", async () => {
    const plantExemption = (text: string) =>
      text.replace("const EXEMPTIONS = [\n", 'const EXEMPTIONS = [\n  { path: /^packages\\/zz\\//, line: /^kept:/, rules: ["zzRetiredName"], why: "planted" },\n');
    const g = await load((text) => plantExemption(withEntry('{ term: "Zz term", means: "x", retires: [{ name: "zzRetiredName" }] }')(text)));
    expect(g.SWEEP_EXEMPTIONS.filter((e) => e.rules?.includes("zzRetiredName"))).toHaveLength(1);
    const guard = g.GUARD_EXEMPTIONS.filter((e) => e.terms?.includes("zzRetiredName"));
    expect(guard).toHaveLength(1);
    const [e] = guard;
    expect(e.where?.("packages/zz/a.ts")).toBe(true);
    expect(e.where?.("packages/core/a.ts")).toBe(false);
    // On a kept line the guard strips the name; on any other line it leaves it to be refused.
    expect(e.strip?.("packages/zz/a.ts", "  kept: zzRetiredName")).not.toMatch(/zzRetiredName/);
    expect(e.strip?.("packages/zz/a.ts", "const zzRetiredName = 1;")).toMatch(/zzRetiredName/);
  });

  it("fails to load on a guard-only exemption for a word the sweep reads too", async () => {
    const plantExemption = (text: string) =>
      text.replace("const EXEMPTIONS = [\n", 'const EXEMPTIONS = [\n  { id: "zz-guard-only", terms: ["zzRetiredName"], strip: /zzRetiredName/g, why: "planted" },\n');
    await expect(load((text) => plantExemption(withEntry('{ term: "Zz term", means: "x", retires: [{ name: "zzRetiredName" }] }')(text)))).rejects.toThrow(/sweep reads too/);
  });

  it("fails to load on a side-chain retirement at a position the check never reads, or with no name", async () => {
    await expect(load(withEntry('{ term: "Zz", means: "x", retires: [{ id: "zz-sc", check: "side-chain", position: "contract-fields", names: ["zzWord"] }] }'))).rejects.toThrow(/never reads/);
    await expect(load(withEntry('{ term: "Zz", means: "x", retires: [{ id: "zz-sc", check: "side-chain", position: "called" }] }'))).rejects.toThrow(/no side-chain name/);
  });

  it("fails to load when the side-chain exemption grows past the two rename-boundary tests", async () => {
    const edit = (text: string) =>
      text.replace("const EXEMPTIONS = [\n", 'const EXEMPTIONS = [\n  { rules: ["side-chain-verb"], files: ["packages/zz/test/a.test.ts"], why: "planted" },\n');
    await expect(load(edit)).rejects.toThrow(/exactly the two rename-boundary tests/);
  });
});
