/**
 * V8, static: App Lab's source names nothing from a Lab's tree (BR-5), draws
 * no literal colour outside its token definitions, and its registry copies
 * are byte-equal to their source.
 *
 * The tree names are read from the two goal trees themselves, so a seat or
 * channel added there is checked too. Each check is shown to reach the code
 * it covers by planting a violation and seeing it caught.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readDeclaredRoster } from "@flow-state-dev/workforce/loader";

const pkg = fileURLToPath(new URL("../", import.meta.url));
const repo = join(pkg, "../..");
const src = join(pkg, "src");
const copies = join(src, "components/flow-state");
const registry = join(repo, "packages/ui/registry/components");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const sources = walk(src).filter((f) => /\.(tsx?|css)$/.test(f));

/** Every name a tree declares that a shell could be tempted to write in. */
async function treeNames(): Promise<Set<string>> {
  const names = new Set<string>();
  for (const tree of ["goals/devforce-lab/lab/workforce", "goals/multi-seat-collab/lab/workforce"]) {
    const roster = await readDeclaredRoster(join(repo, tree));
    for (const worker of roster.workers) {
      const [team, ...rest] = worker.id.split(".");
      names.add(worker.id).add(team!).add(rest.join("."));
      if (typeof worker.declared.flow === "string") names.add(worker.declared.flow);
    }
    for (const channel of roster.channels) {
      const [team, ...rest] = channel.id.split(".");
      names.add(channel.id).add(team!).add(rest.join("."));
      for (const board of (channel.declared.boards as string[] | undefined) ?? []) {
        names.add(board).add(`${channel.id}.${board}`);
      }
    }
  }
  return names;
}

/**
 * App Lab's own words that a tree happens to use too, each with why it is
 * App Lab's. An explicit list rather than a pattern, so a new collision fails
 * until someone writes down why it isn't a tree name.
 */
const APP_LAB_WORDS: Record<string, string> = {
  worker: "the Tasks screen's group-by key (State / Worker / Stream); multi-seat-collab also names a kind `worker`",
};

/** Quoted string literals in a file that equal a tree name. */
function namedIn(text: string, names: Set<string>): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(/(["'`])([^"'`\n]{1,80})\1/g)) {
    if (names.has(match[2]!) && !Object.hasOwn(APP_LAB_WORDS, match[2]!)) found.push(match[2]!);
  }
  return found;
}

const PALETTE =
  /\b(?:bg|text|border|ring|fill|stroke|from|to|via|outline|decoration|divide|shadow|accent|caret)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black)(?:-\d{2,3})?\b/;
const LITERAL = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch|color)\(/;

/** Literal colours in App Lab's own source: everything but the token definitions and the registry copies. */
function literalColours(file: string, text: string): string[] {
  if (file.startsWith(copies)) return [];
  const scanned = file.endsWith("styles.css")
    ? text.replace(/@theme \{[\s\S]*?\/\* End of token definitions\. \*\//, "")
    : text;
  return scanned
    .split("\n")
    .map((line, i) => ({ line, i }))
    .filter(({ line }) => PALETTE.test(line) || LITERAL.test(line))
    .map(({ line, i }) => `${relative(pkg, file)}:${i + 1}: ${line.trim()}`);
}

describe("V8", () => {
  it("names no seat, team, channel, board or kind from either goal tree (BR-5)", async () => {
    const names = await treeNames();
    expect(names.size).toBeGreaterThan(10);
    const hits = sources.flatMap((file) => namedIn(readFileSync(file, "utf8"), names).map((n) => `${relative(pkg, file)}: "${n}"`));
    expect(hits).toEqual([]);
    // The check reaches what it covers: a planted tree name is caught.
    const planted = [...names].find((n) => n.includes("."))!;
    expect(namedIn(`const seat = "${planted}";`, names)).toEqual([planted]);
  });

  it("draws no literal colour outside the token definitions", () => {
    expect(sources.length).toBeGreaterThan(10);
    expect(sources.flatMap((file) => literalColours(file, readFileSync(file, "utf8")))).toEqual([]);
    // Planted: a palette class, a hex value, and a colour function outside the token block.
    expect(literalColours(join(src, "x.tsx"), `<p className="text-green-600" />`)).toHaveLength(1);
    expect(literalColours(join(src, "x.tsx"), `const c = "#ff0000";`)).toHaveLength(1);
    expect(literalColours(join(src, "styles.css"), `@theme {\n--x: hsl(0 0% 0%);\n/* End of token definitions. */\n.a { color: hsl(1 1% 1%); }`)).toHaveLength(1);
  });

  it("keeps every registry copy byte-equal to its source", () => {
    const copied = walk(copies);
    expect(copied.length).toBe(8);
    for (const file of copied) {
      expect(readFileSync(file), relative(pkg, file)).toEqual(readFileSync(join(registry, relative(copies, file))));
    }
  });
});
