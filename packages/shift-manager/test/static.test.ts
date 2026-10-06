/**
 * V8, static: Shift Manager's source names nothing from a Lab's tree (BR-5), draws
 * no literal colour of its own, and its registry copies are byte-equal to
 * their source. Its copies are exactly what its install list (`pnpm ui:add`)
 * ships, its token definitions are the registry's `tokens` item unedited, kept
 * as that item's own installed file beside the copies, and its look is the
 * design-system package's one import.
 *
 * The tree names are read from the two goal trees themselves, so a seat or
 * mailbox added there is checked too. Each check is shown to reach the code
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
/** Where the install writes the registry's `tokens` item: the stylesheet `components.json` names. */
const TOKENS = "tokens.css";

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
  for (const tree of ["packages/shift-manager/teams/devteam/workforce", "packages/shift-manager/test/fixtures/multi-seat-collab/workforce"]) {
    const roster = await readDeclaredRoster(join(repo, tree));
    for (const worker of roster.workers) {
      const [team, ...rest] = worker.id.split(".");
      names.add(worker.id).add(team!).add(rest.join("."));
      if (typeof worker.declared.flow === "string") names.add(worker.declared.flow);
    }
    for (const mailbox of roster.mailboxes) {
      const [team, ...rest] = mailbox.id.split(".");
      names.add(mailbox.id).add(team!).add(rest.join("."));
      for (const board of (mailbox.declared.boards as string[] | undefined) ?? []) {
        names.add(board).add(`${mailbox.id}.${board}`);
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
  "chief-of-staff":
    "the seat id the Chief of Staff screen finds its seat by; DevTeam declares an org seat under it so it has one",
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
 * Literal colours in Shift Manager's own source: everything but the registry
 * copies (the `tokens` item's file among them) and the primitives they import.
 * Those are installed, not written here; the registry's palette census covers
 * the copies, and the test below holds the tokens file to its item.
 */
function literalColours(file: string, text: string): string[] {
  if (file.startsWith(copies + "/") || file.startsWith(primitives + "/")) return [];
  return text
    .split("\n")
    .map((line, i) => ({ line, i }))
    .filter(({ line }) => PALETTE.test(line) || LITERAL.test(line))
    .map(({ line, i }) => `${relative(pkg, file)}:${i + 1}: ${line.trim()}`);
}

describe("V8", () => {
  it("names no seat, team, mailbox, board or kind from either goal tree (BR-5)", async () => {
    const names = await treeNames();
    expect(names.size).toBeGreaterThan(10);
    const hits = sources.flatMap((file) => namedIn(readFileSync(file, "utf8"), names).map((n) => `${relative(pkg, file)}: "${n}"`));
    expect(hits).toEqual([]);
    // The check reaches what it covers: a planted tree name is caught.
    const planted = [...names].find((n) => n.includes("."))!;
    expect(namedIn(`const seat = "${planted}";`, names)).toEqual([planted]);
  });

  it("reaches project rooms on workforce's built-in mailbox kind", async () => {
    const { MAILBOX_KIND } = await import("@flow-state-dev/workforce");
    const { ROOM_KIND } = await import("../src/lib/talk");
    expect(ROOM_KIND).toBe(MAILBOX_KIND);
  });

  it("finds a room's end with the page size workforce's `read` answers in", async () => {
    const { ROOM_PAGE_SIZE } = await import("@flow-state-dev/workforce");
    const { ROOM_PAGE } = await import("../src/lib/talk");
    expect(ROOM_PAGE).toBe(ROOM_PAGE_SIZE);
  });

  it("draws no literal colour of its own", () => {
    expect(sources.length).toBeGreaterThan(10);
    expect(sources.flatMap((file) => literalColours(file, readFileSync(file, "utf8")))).toEqual([]);
    // Planted: a palette class, a hex value, and token values pasted back into the stylesheet.
    expect(literalColours(join(src, "x.tsx"), `<p className="text-green-600" />`)).toHaveLength(1);
    expect(literalColours(join(src, "x.tsx"), `const c = "#ff0000";`)).toHaveLength(1);
    expect(literalColours(join(src, "styles.css"), `:root {\n  --background: hsl(0 0% 100%);\n}`)).toHaveLength(1);
  });

  it("sends a person's line only through the one send path, to the door the inventory names (V7, ER-15)", () => {
    const code = sources.filter((f) => /\.tsx?$/.test(f) && !relative(src, f).startsWith("components/flow-state/"));
    // An action is the only way Shift Manager can put an item in a session (the
    // client has no item write), so the sites that send one are the list.
    const SEND = /\bsendAction(Stream)?\(/;
    const sites = (files: string[], read: (f: string) => string) =>
      files.filter((f) => read(f).split("\n").some((line) => SEND.test(line))).map((f) => relative(src, f)).sort();
    const read = (f: string) => readFileSync(f, "utf8");
    // A workstream post (`transcript.ts`) and a project room's talk entries
    // (`talk.ts`) are the two mailbox actions; a line to a worker goes through `send.ts`.
    expect(sites(code, read)).toEqual(["lib/send.ts", "lib/talk.ts", "lib/transcript.ts"]);
    // The door is the one the inventory names, never an action name of Shift Manager's own.
    const sendLines = read(join(src, "lib/send.ts")).split("\n").filter((line) => SEND.test(line));
    expect(sendLines).toHaveLength(1);
    expect(sendLines[0]).toContain("sendAction(target.door,");
    // Every composer that talks to a worker sends through it.
    for (const file of ["surfaces/TaskFrame.tsx", "surfaces/Stream.tsx", "surfaces/Inbox.tsx", "lib/cos.ts"]) {
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
    const shipped = installSet();
    expect(shipped.files.size).toBeGreaterThan(8);
    // `tokens` ships no copied file. The list still has to reach it; its values live in tokens.css.
    expect(shipped.names.has("tokens")).toBe(true);
    expect(walk(copies).map((file) => relative(copies, file)).sort()).toEqual([...shipped.files.keys(), TOKENS].sort());
    for (const [copy, source] of shipped.files) {
      expect(readFileSync(join(copies, copy)), copy).toEqual(readFileSync(join(repo, "packages/ui", source)));
    }
    // The list reaches what it covers: an item it doesn't name ships nothing here.
    expect(installSet(["approval"]).files.has("message.tsx")).toBe(false);
  });

  it("keeps its tokens as the registry's tokens item, unedited, in the file the install writes it to", () => {
    // `fsdev ui add` writes a theme item's values into the stylesheet `components.json` names.
    const components = JSON.parse(readFileSync(join(pkg, "components.json"), "utf8")) as { tailwind: { css: string } };
    expect(components.tailwind.css).toBe(relative(pkg, join(copies, TOKENS)));
    const css = readFileSync(join(copies, TOKENS), "utf8");
    const tokens = registryItems().get("tokens")!;
    const base = tokens.css!["@layer base"]!;
    for (const [selector, values] of Object.entries(base)) {
      for (const [name, value] of Object.entries(values)) {
        expect(css, `${selector} ${name}`).toMatch(new RegExp(`${selector.replace(".", "\\.")} \\{[^}]*${name}: ${value.replace(/[()%.]/g, "\\$&")};`));
      }
    }
    for (const [name, value] of Object.entries(tokens.cssVars!.theme!)) expect(css).toContain(`--${name}: ${value};`);
    // Nothing but the item: every value it declares is one the item names.
    const declared = [...css.matchAll(/(--[a-z-]+):/g)].map((m) => m[1]!);
    const named = new Set([...Object.keys(tokens.cssVars!.theme!).map((n) => `--${n}`), ...Object.values(base).flatMap((v) => Object.keys(v))]);
    expect(declared.filter((name) => !named.has(name))).toEqual([]);
    // The stylesheet takes it by one import, and restates none of the item's names.
    const tokensImport = `@import "./${relative(src, join(copies, TOKENS))}";`;
    expect(styles.split("\n").filter((line) => line === tokensImport)).toHaveLength(1);
    expect([...named].filter((name) => new RegExp(`${name}\\s*:`).test(styles))).toEqual([]);
  });

  it("takes its look from the design-system package's one import (FIX-1688)", () => {
    // A build-time dependency: the look is bundled into the built pages, and
    // the design-system package itself is never published.
    const pkgJson = JSON.parse(readFileSync(join(pkg, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(pkgJson.devDependencies["@flow-state-dev/design-system"]).toBe("workspace:*");
    expect(pkgJson.dependencies["@flow-state-dev/design-system"]).toBeUndefined();
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

/**
 * The install list's closure: item names it reaches, and the files those items
 * copy into `components/flow-state/`, as copy → source.
 */
function installSet(items = installList()): { files: Map<string, string>; names: Set<string> } {
  const byName = registryItems();
  const files = new Map<string, string>();
  const names = new Set<string>();
  const visit = (name: string) => {
    if (names.has(name)) return;
    names.add(name);
    const item = byName.get(name);
    for (const file of item?.files ?? []) files.set(relative("components/flow-state", file.target), file.path);
    for (const dep of item?.registryDependencies ?? []) visit(dep);
  };
  for (const item of items) visit(item);
  return { files, names };
}
