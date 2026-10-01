/**
 * V8, static: Shift Manager's source names nothing from a Lab's tree (BR-5), draws
 * no literal colour outside its token definitions, and its registry copies
 * are byte-equal to their source. Its copies are exactly what its install list
 * (`pnpm ui:add`) ships, its token definitions are the registry's `tokens`
 * item unedited, and its look is the design-system package's one import.
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
/** The shadcn primitives the registry copies import, installed with them. */
const primitives = join(src, "components/ui");
const registry = join(repo, "packages/ui/registry/components");
const styles = readFileSync(join(src, "styles.css"), "utf8");

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
 * Shift Manager's own words that a tree happens to use too, each with why it is
 * Shift Manager's. An explicit list rather than a pattern, so a new collision fails
 * until someone writes down why it isn't a tree name.
 */
const SHIFT_MANAGER_WORDS: Record<string, string> = {
  worker: "the Tasks screen's group-by key (State / Worker / Stream); multi-seat-collab also names a kind `worker`",
};

/** Quoted string literals in a file that equal a tree name. */
function namedIn(text: string, names: Set<string>): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(/(["'`])([^"'`\n]{1,80})\1/g)) {
    if (names.has(match[2]!) && !Object.hasOwn(SHIFT_MANAGER_WORDS, match[2]!)) found.push(match[2]!);
  }
  return found;
}

const PALETTE =
  /\b(?:bg|text|border|ring|fill|stroke|from|to|via|outline|decoration|divide|shadow|accent|caret)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black)(?:-\d{2,3})?\b/;
const LITERAL = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch|color)\(/;

/**
 * Literal colours in Shift Manager's own source: everything but the token
 * definitions, the registry copies and the primitives they import. Those two
 * are installed, not written here; the registry's palette census covers the
 * copies.
 */
function literalColours(file: string, text: string): string[] {
  if (file.startsWith(copies) || file.startsWith(primitives + "/")) return [];
  const scanned = file.endsWith("styles.css")
    ? text.replace(/\/\* Token definitions[\s\S]*?\/\* End of token definitions\. \*\//, "")
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
    expect(literalColours(join(src, "styles.css"), `/* Token definitions */\n--x: hsl(0 0% 0%);\n/* End of token definitions. */\n.a { color: hsl(1 1% 1%); }`)).toHaveLength(1);
  });

  it("sends a person's line only through the one send path, to the door the inventory names (V7, ER-15)", () => {
    const code = sources.filter((f) => /\.tsx?$/.test(f) && !relative(src, f).startsWith("components/flow-state/"));
    // An action is the only way Shift Manager can put an item in a session (the
    // client has no item write), so the sites that send one are the list.
    const SEND = /\bsendAction(Stream)?\(/;
    const sites = (files: string[], read: (f: string) => string) =>
      files.filter((f) => read(f).split("\n").some((line) => SEND.test(line))).map((f) => relative(src, f)).sort();
    const read = (f: string) => readFileSync(f, "utf8");
    expect(sites(code, read)).toEqual(["lib/send.ts", "lib/transcript.ts"]);
    // The door is the one the inventory names, never an action name of Shift Manager's own.
    const sendLines = read(join(src, "lib/send.ts")).split("\n").filter((line) => SEND.test(line));
    expect(sendLines).toHaveLength(1);
    expect(sendLines[0]).toContain("sendAction(target.door,");
    // Every composer that talks to a worker sends through it.
    for (const file of ["surfaces/TaskFrame.tsx", "surfaces/Stream.tsx", "surfaces/Inbox.tsx"]) {
      expect(read(join(src, file)), file).toContain("sendTurn(clients,");
    }
    // Planted: a composer that sends to a named action is caught.
    const planted = join(src, "surfaces/Planted.tsx");
    expect(sites([...code, planted], (f) => (f === planted ? `await actions.sendAction("message", { message });` : read(f)))).toContain(
      "surfaces/Planted.tsx",
    );
  });

  it("reads what became of a line in one place, the shared send state (BR-4, BR-5)", () => {
    const code = sources.filter((f) => /\.tsx?$/.test(f) && !relative(src, f).startsWith("components/flow-state/"));
    // Telling refused from not sent from unconfirmed is the send state's: a
    // second copy is where Retry comes back for a line that may have arrived.
    const CLASSIFIES = /instanceof TurnNotDelivered/;
    const sites = (files: string[], read: (f: string) => string) =>
      files.filter((f) => read(f).split("\n").some((line) => CLASSIFIES.test(line))).map((f) => relative(src, f)).sort();
    const read = (f: string) => readFileSync(f, "utf8");
    expect(sites(code, read)).toEqual(["components/TurnComposer.tsx"]);
    for (const file of ["surfaces/Stream.tsx", "components/TurnComposer.tsx"]) {
      expect(read(join(src, file)), file).toContain("useTurnSend()");
    }
    // Planted: a composer that classifies a failure itself is caught.
    const planted = join(src, "surfaces/Planted.tsx");
    expect(sites([...code, planted], (f) => (f === planted ? `const retry = err instanceof TurnNotDelivered && err.kind === "not-sent";` : read(f)))).toContain(
      "surfaces/Planted.tsx",
    );
  });

  it("makes no write from the task screen but the abort and the one send path (ER-15, D2)", () => {
    const taskFiles = ["lib/run.ts", "lib/task.tsx", "surfaces/TaskFrame.tsx", "surfaces/TaskSession.tsx", "surfaces/TaskInspector.tsx"];
    const WRITES = /\b(sendAction|sendActionStream|resumeSuspension|postLine|createCollectionItem|updateCollectionItem|deleteCollectionItem|deleteSession|createSession|retryRequest|continueRequest)\b|method:\s*"(POST|PUT|PATCH|DELETE)"/;
    const writes = (text: string) => text.split("\n").filter((line) => WRITES.test(line) || (/abortRequest\(/.test(line) && !/await actions\.abortRequest\(run\.requestId\)/.test(line)));
    for (const file of taskFiles) expect(writes(readFileSync(join(src, file), "utf8")), file).toEqual([]);
    expect(readFileSync(join(src, "lib/run.ts"), "utf8")).toContain("await actions.abortRequest(run.requestId)");
    // Planted: a second write is caught.
    expect(writes(`await clients.actions(f).sendAction("run", {});`)).toHaveLength(1);
  });

  it("keeps every registry copy byte-equal to its source, and holds exactly what its install list ships", () => {
    const shipped = installedFiles();
    expect(shipped.size).toBeGreaterThan(8);
    expect(walk(copies).map((file) => relative(copies, file)).sort()).toEqual([...shipped.keys()].sort());
    for (const [copy, source] of shipped) {
      expect(readFileSync(join(copies, copy)), copy).toEqual(readFileSync(join(repo, "packages/ui", source)));
    }
    // The list reaches what it covers: an item it doesn't name ships nothing here.
    expect(installedFiles(["approval"]).has("message.tsx")).toBe(false);
  });

  it("defines its tokens as the registry's tokens item, unedited", () => {
    const tokens = registryItems().get("tokens")!;
    const base = tokens.css!["@layer base"]!;
    for (const [selector, values] of Object.entries(base)) {
      for (const [name, value] of Object.entries(values)) {
        expect(styles, `${selector} ${name}`).toMatch(new RegExp(`${selector.replace(".", "\\.")} \\{[^}]*${name}: ${value.replace(/[()%.]/g, "\\$&")};`));
      }
    }
    for (const [name, value] of Object.entries(tokens.cssVars!.theme!)) expect(styles).toContain(`--${name}: ${value};`);
  });

  it("takes its look from the design-system package's one import (FIX-1688)", () => {
    const pkgJson = JSON.parse(readFileSync(join(pkg, "package.json"), "utf8")) as { dependencies: Record<string, string> };
    expect(pkgJson.dependencies["@flow-state-dev/design-system"]).toBe("workspace:*");
    expect(styles.match(/^@import "@flow-state-dev\/design-system\/shift-manager\.css";$/gm)).toHaveLength(1);
  });
});

type RegistryItem = {
  name: string;
  registryDependencies?: string[];
  files?: Array<{ path: string; target: string }>;
  cssVars?: { theme?: Record<string, string> };
  css?: { "@layer base"?: Record<string, Record<string, string>> };
};

function registryItems(): Map<string, RegistryItem> {
  const manifest = JSON.parse(readFileSync(join(repo, "packages/ui/registry.json"), "utf8")) as { items: RegistryItem[] };
  return new Map(manifest.items.map((item) => [item.name, item]));
}

/** The items `pnpm ui:add` installs, as its script names them. */
function installList(): string[] {
  const script = (JSON.parse(readFileSync(join(pkg, "package.json"), "utf8")) as { scripts: Record<string, string> }).scripts["ui:add"];
  return /^fsdev ui add ((?:[a-z-]+ ?)+)$/.exec(script ?? "")?.[1]!.trim().split(" ") ?? [];
}

/** Every registry file the listed items ship into `components/flow-state/`, through their registry dependencies, as copy → source. */
function installedFiles(items = installList()): Map<string, string> {
  const byName = registryItems();
  const out = new Map<string, string>();
  const seen = new Set<string>();
  const visit = (name: string) => {
    if (seen.has(name)) return;
    seen.add(name);
    const item = byName.get(name);
    for (const file of item?.files ?? []) out.set(relative("components/flow-state", file.target), file.path);
    for (const dep of item?.registryDependencies ?? []) visit(dep);
  };
  for (const item of items) visit(item);
  return out;
}
