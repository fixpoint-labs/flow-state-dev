#!/usr/bin/env node
/**
 * Guard: the one-conversation pipe Workforce ships is called a mailbox, and
 * nothing in the renamed surfaces still calls it a channel.
 *
 * Every tracked file is read, not a remembered list of the ones that used to
 * say the word. A file that says "channel" lands in exactly one group, or the
 * run fails naming it (totality): a new surface nobody classified is the hole a
 * list-driven guard cannot see. Then every line of an in-scope file that says
 * the word is either a **survivor** — the ordinary English word for something
 * else (a trace channel, Redis pub/sub, a colour channel) — or a product hit,
 * and any product hit fails the run. So does any in-scope PATH that still says
 * channel (`CHANNEL.md`, a `channels/` folder, `channel-*.ts`), since a record
 * left under its old name can be silent in its text.
 *
 * ## Survivors are phrases, never code
 *
 * Twice a survivor rule absorbed a product line: once a planted one, once
 * wire-shaped fields (`channels: z.array`, `input.channels`), because the
 * product pipe is spelled that way too. So {@link SURVIVOR_LINE} holds English
 * phrases only, and the few other meanings spelled in code (Redis pub/sub,
 * Postgres `LISTEN`, a colour channel) are pinned to their one file in
 * {@link FILE_SURVIVORS}. Never widen either to go green: rename the line.
 *
 * ## What is allowlisted, by path
 *
 * The old words have to live somewhere until 1.0, so a stale tree or store is
 * refused by name rather than misread: the one legacy module, its test, the
 * goal that proves the refusal, this guard and its test, and this rename's own
 * changeset. Plus the README's upgrade section, by heading. Nothing else.
 *
 * ## Scope
 *
 * The docs site (`apps/docs/`, `docs/` outside `internal/`) is classified but
 * not yet in scope: its swap lands with the docs half of the rename, which
 * flips {@link SITE_IN_SCOPE} and drops {@link PAGE_NOT_YET_MOVED}. History
 * (retained specs, CHANGELOGs, `docs/internal/`) and process tooling (`.agents/`,
 * `.github/`, …) keep the old word by design and are never in scope.
 *
 * Run: node scripts/check-mailbox-rename.mjs [--json]
 *      PLANT=product  plants a product line into a survivor-only file; the run
 *                     must fail on it (the control the vitest suite ties to a
 *                     green-tree fixture)
 * Exits 1 on an unclassified file, a product line or a path in scope.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/** Whether the docs site is renamed yet. Flipped by the docs half of the rename. */
export const SITE_IN_SCOPE = false;

/**
 * The docs page the docs half moves (`workforce/channels.md` → `mailboxes.md`).
 * Until it moves, a reference to it by path is a reference to a real file, so
 * the path token is stripped before a line is judged; the words around it still
 * count. Deleted with the move.
 */
export const PAGE_NOT_YET_MOVED = /workforce(?:\/|", ")channels\.md(?:#[a-z0-9-]+)?/g;

/** Paths that must spell the old words: the refusals, their proofs, this guard. */
const LEGACY_PATHS = [
  "packages/workforce/src/mailbox/pre-rename.ts",
  "packages/workforce/test/pre-rename.test.ts",
  "packages/workforce/test/mailbox-rename-check.test.ts",
  "goals/workforce-mailboxes/a-pre-rename-lab-is-refused-by-name/",
  "scripts/check-mailbox-rename.mjs",
  ".changeset/mailboxes-everywhere.md",
];

/** Sections that tell a reader what the old names were, by file and heading. */
const LEGACY_SECTIONS = [{ path: "packages/workforce/README.md", heading: /^#+ Upgrading from channels$/ }];

const isLegacyPath = (p) => LEGACY_PATHS.some((entry) => (entry.endsWith("/") ? p.startsWith(entry) : p === entry));

/**
 * The groups, first match wins. A file with a hit in no group fails the run.
 * @param {Set<string>} published names of the packages that publish
 */
export function groupsFor(published) {
  return [
    ["legacy", isLegacyPath],
    // Pending fragments are unreleased notes, so they are in scope.
    ["changesets", (p) => /^\.changeset\/[^/]+\.md$/.test(p) && p !== ".changeset/README.md"],
    ["history", (p) => /^specs\/|^docs\/internal\/|(^|\/)CHANGELOG\.md$|^\.changeset\/|^pnpm-lock\.yaml$/.test(p)],
    ["process", (p) => /^\.agents\/|^\.omp\/|^\.github\/|^\.claude\/|^CLAUDE\.md$|^AGENTS\.md$|^knip\.json$/.test(p)],
    ["tests", (p) => /^(packages|labs|apps)\/.*(\/(test|tests|e2e)\/|\.(test|spec)(-d)?\.[cm]?tsx?$)/.test(p)],
    ["goals", (p) => /^goals\//.test(p)],
    ["readmes", (p) => /^(packages|labs)\/[^/]+\/README\.md$|^apps\/kitchen-sink\/README\.md$|^labs\/README\.md$|^README\.md$/.test(p)],
    ["site", (p) => /^apps\/docs\/|^docs\//.test(p)],
    ["ui", (p) => /^labs\/|^apps\/kitchen-sink\/|^packages\/(devtool|ui)\//.test(p)],
    [
      "api",
      (p) => {
        const m = /^packages\/([^/]+)\/(src\/|package\.json$)/.exec(p);
        return m !== null && published.has(m[1]);
      },
    ],
  ];
}

/** Groups the rename covers. History, process and the allowlist are classified but kept. */
export function inScopeGroups(site = SITE_IN_SCOPE) {
  return new Set(["api", "ui", "goals", "tests", "changesets", "readmes", ...(site ? ["site"] : [])]);
}

/** A path whose own name uses the word for something else. */
const PATH_SURVIVOR = /(^|\/)trace-channel\.md$/;

/**
 * The ordinary English word, not the pipe. Line-level, because files mix the
 * two. English phrases ONLY — nothing here may match an identifier, a field or
 * a string literal.
 */
export const SURVIVOR_LINE = new RegExp(
  [
    "trace[- ]channel", "side[- ]?channel", "pub/sub", "channel pair", "slack",
    "question channel", "label channel", "approval channel", "review channel", "scan channel",
    "exec channel", "write channel", "intent channel", "notice channel", "recovery channel",
    "trusted channel", "structured channel", "background channel", "failure channel",
    "error channels?", "separate channels?", "content\\.delta` channel", "two channels, two meanings",
    "third channel beside", "through a channel (the|a) ", "point of the channel", "its own channel rather",
    "channel a cancellation", "either channel", "the channel does not matter", "a channel that does not require",
    "the two channels are fed", "for the channel\\)", "Linear access\" for the channel",
    "the channel\\)\\.", "cheaper channel", "live channel\\. Use", "has no channel to receive",
    "alternative channel", "provenance` — a channel whose", "channel is used when available",
    "channel a hand-off refusal", "self-bias channel", "SSE channel", "opens two channels",
    "Four channels", "outbound channel", "no channel for a per-seat", "runtime channel", "public-channel item",
    // Colour channels: a painted value compared component by component.
    "within 3 per channel", "0 to 255 per channel", "channel, so no value sits",
    // A way a value or a signal travels, in prose about one code path.
    "`sessionStateSchema` through a channel", "Telegram-style channels",
    "two channels never carry each other", "two channels carry each other", "The other channel, and it never carries",
    "that channel still works", "one channel for the visit", "ONE channel\\. `error`", "were two channels",
    "a second channel carrying it", "the channel by which one worker", "payload channel", "third channel: a dep",
    "a back channel", "the channel a manager hands", "split-channel bug", "the only channel a caller has",
    "framework's standard channel", "the channel `readWorkforce` itself fills", "loader's own channel",
    "within 1 per channel", "leak through a third channel", "either alone leaves a channel",
    "Their own channel (rather|for the reason)", "five channels are one list",
  ].join("|"),
  "i",
);

/**
 * Another meaning spelled in code, pinned to its one file and kept narrow: a
 * product line planted into any of these files still counts.
 */
export const FILE_SURVIVORS = {
  "packages/bullmq/src/stream-bridge.ts":
    /eventChannel|abortChannel|channelPrefix|CHANNEL_PREFIX|events to a channel|Redis channel|const channel = |^\s*channel,$|(un)?subscribe\(channel|publish\(channel/,
  "packages/bullmq/src/flowstate-adapter.ts": /channelPrefix/,
  "packages/bullmq/test/flowstate-adapter.test.ts": /channelPrefix/,
  "packages/bullmq/README.md": /channelPrefix/,
  "packages/store-postgres/src/request-store.ts": /NOTIFY_CHANNEL|msg\.channel|channel: string/,
  "packages/ui/test/token-contrast.test.ts": /channel\(|const channel = \(n/,
  "labs/design-system/test/theme.ts": /const channel = \(t|channel\(h/,
  "apps/docs/guides/human-in-the-loop.md": /Which channels should this post to|channels: z\.array\(z\.enum\(\["blog"/,
  "apps/docs/docs/advanced/sequencer-side-chains.md": /input\.channels\.map\(\(ch\) => \(\{ channel: ch/,
  "docs/architecture/sequencer-dsl.md": /\(input\) => input\.channels,/,
  "docs/architecture/dispatched-work.md": /^\s*channel\.$/,
};

/** Whether a line says the word about something other than the pipe. */
export function isSurvivor(path, line) {
  return SURVIVOR_LINE.test(line) || (FILE_SURVIVORS[path]?.test(line) ?? false);
}

/**
 * The lines of one file that still name the pipe.
 * @returns {{ line: number; text: string }[]}
 */
export function productLines(path, text) {
  const section = LEGACY_SECTIONS.find((entry) => entry.path === path);
  const hits = [];
  let inLegacySection = false;
  text.split("\n").forEach((raw, index) => {
    if (section !== undefined && /^#+ /.test(raw)) inLegacySection = section.heading.test(raw);
    if (inLegacySection) return;
    const line = raw.replace(PAGE_NOT_YET_MOVED, "");
    if (/channel/i.test(line) && !isSurvivor(path, line)) hits.push({ line: index + 1, text: raw.trim() });
  });
  return hits;
}

/**
 * Scan a tree. Pure over its inputs, so a test can hand it a fixture.
 * @param {{ files: Map<string, string>; paths: string[]; published: Set<string>; site?: boolean }} tree
 */
export function scanTree({ files, paths, published, site = SITE_IN_SCOPE }) {
  const groups = groupsFor(published);
  const groupOf = (p) => groups.find(([, test]) => test(p))?.[0] ?? "UNCLASSIFIED";
  const scope = inScopeGroups(site);
  const unclassified = [];
  const productHits = [];
  for (const [p, text] of files) {
    const g = groupOf(p);
    if (g === "UNCLASSIFIED") {
      unclassified.push(p);
      continue;
    }
    if (!scope.has(g)) continue;
    for (const hit of productLines(p, text)) productHits.push({ path: p, ...hit });
  }
  const pathHits = paths.filter((p) => scope.has(groupOf(p)) && !PATH_SURVIVOR.test(p) && /channel/i.test(p));
  return { unclassified, productHits, pathHits, ok: unclassified.length + productHits.length + pathHits.length === 0 };
}

/** Every tracked file that says the word, by path or in its text. */
export function readTrackedTree(root = ROOT) {
  const published = new Set();
  for (const f of execFileSync("git", ["ls-files", "packages/*/package.json"], { cwd: root, encoding: "utf8" })
    .split("\n")
    .filter(Boolean)) {
    if (JSON.parse(readFileSync(`${root}/${f}`, "utf8")).private !== true) published.add(f.split("/")[1]);
  }
  const paths = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean);
  const files = new Map();
  for (const p of paths) {
    if (!existsSync(`${root}/${p}`)) continue;
    let text;
    try {
      text = readFileSync(`${root}/${p}`, "utf8");
    } catch {
      continue;
    }
    if (text.includes("\0")) continue;
    if (/channel/i.test(text) || /channel/i.test(p)) files.set(p, text);
  }
  return { files, paths, published };
}

function main() {
  const tree = readTrackedTree();
  if (process.env.PLANT === "product") {
    const p = "packages/bullmq/src/stream-bridge.ts";
    tree.files.set(p, `${tree.files.get(p) ?? ""}\n// a post on the support channel wakes its member seats\n`);
  }
  const result = scanTree(tree);
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    if (result.unclassified.length > 0) {
      console.error(`Totality: ${result.unclassified.length} file(s) say "channel" and belong to no group:`);
      for (const p of result.unclassified) console.error(`  ${p}`);
    }
    if (result.productHits.length > 0) {
      console.error(`${result.productHits.length} line(s) still call the mailbox a channel:`);
      for (const hit of result.productHits) console.error(`  ${hit.path}:${hit.line}: ${hit.text.slice(0, 160)}`);
    }
    if (result.pathHits.length > 0) {
      console.error(`${result.pathHits.length} path(s) still named channel:`);
      for (const p of result.pathHits) console.error(`  ${p}`);
    }
    if (result.ok) console.log("check-mailbox-rename: every surface in scope says mailbox.");
  }
  process.exitCode = result.ok ? 0 : 1;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) main();
