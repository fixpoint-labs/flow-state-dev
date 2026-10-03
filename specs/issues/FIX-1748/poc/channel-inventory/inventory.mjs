#!/usr/bin/env node
/**
 * FIX-1748 · the channel inventory, re-derived from the tree instead of counted by hand.
 *
 * Every number in the spec's PLAN.md → "Inventory" comes from this script run
 * against `origin/main`. It answers three questions:
 *
 *   1. Content: which tracked files say "channel" about the PRODUCT pipe, grouped
 *      by surface (published API · UI · goals · docs · tests), with line counts.
 *      Lines that use the ordinary English word (a trace channel, a Redis pub/sub
 *      channel, a Slack channel, a side channel) are survivors and are counted
 *      apart, never as blast radius.
 *   2. Wire: the persisted keys, item components, kinds, tool and action names
 *      that carry the word, each with its occurrence count.
 *   3. Paths: every tracked path whose own name says channel (CHANNEL.md files,
 *      `channels/` folders, files named channel-*), grouped the same way.
 *
 * Totality, not spot checks: every tracked file with a hit lands in exactly one
 * group, or the script exits 1 naming it. History (specs, CHANGELOGs, pending
 * changesets, docs/internal) and process tooling (.agents, .omp, .github) are
 * groups too — deliberately out of the rename, but classified, never skipped.
 *
 * Guard mode (`--guard`) is the shape the implementation's grep guard takes: it
 * exits 1 when any in-scope surface still carries a product hit. On today's main
 * it MUST fail; that red state is the evidence the guard reaches the code.
 *
 * Negative controls (run them; a check never seen red proves nothing):
 *   PLANT=unclassified  plants a hit at a path no group owns → must exit 1 (totality)
 *   PLANT=product       plants a product line inside a survivor-only file → must be
 *                       counted as product, not absorbed by the survivor rules
 *   PLANT=wire          plants a wire-shaped field (`channels: z.array`, `input.channels`)
 *                       the same way → must count as product too
 *
 * Run:   node specs/issues/FIX-1748/poc/channel-inventory/inventory.mjs [--json] [--guard]
 *        LIST=<group> prints every product line in that group, for review
 * Throwaway evidence for the spec. Reads only; writes nothing.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";

const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const args = new Set(process.argv.slice(2));
const PLANT = process.env.PLANT ?? "";
const LIST = process.env.LIST ?? ""; // LIST=<group> prints that group's product lines

// ── The groups. First match wins; order is the precedence. ───────────────────
const published = new Set();
for (const f of execFileSync("git", ["ls-files", "packages/*/package.json"], { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean)) {
  const pkg = JSON.parse(readFileSync(`${ROOT}/${f}`, "utf8"));
  if (pkg.private !== true) published.add(f.split("/")[1]);
}

const GROUPS = [
  ["history", (p) => /^specs\/|^docs\/internal\/|(^|\/)CHANGELOG\.md$|^\.changeset\/|^pnpm-lock\.yaml$/.test(p)],
  ["process", (p) => /^\.agents\/|^\.omp\/|^\.github\/|^\.claude\/|^CLAUDE\.md$|^AGENTS\.md$|^knip\.json$/.test(p)],
  ["tests", (p) => /^(packages|labs|apps)\/.*(\/(test|tests|e2e)\/|\.(test|spec)(-d)?\.[cm]?tsx?$)/.test(p)],
  ["goals", (p) => /^goals\//.test(p)],
  ["docs", (p) => /^apps\/docs\/|^docs\/|^(packages|labs)\/[^/]+\/README\.md$|^apps\/kitchen-sink\/README\.md$|^labs\/README\.md$|^README\.md$/.test(p)],
  ["ui", (p) => /^labs\/|^apps\/kitchen-sink\/|^packages\/(devtool|ui)\//.test(p)],
  ["api", (p) => { const m = /^packages\/([^/]+)\/(src\/|package\.json$)/.exec(p); return m !== null && published.has(m[1]); }],
];
const groupOf = (p) => GROUPS.find(([, test]) => test(p))?.[0] ?? "UNCLASSIFIED";

// The rename's scope: history and process are classified but never renamed.
const IN_SCOPE = new Set(["api", "ui", "goals", "docs", "tests"]);

// ── Survivors: the ordinary English word, not the product pipe. ──────────────
// Line-level, because files mix the two (harness-manager says "question
// channel" and "a channel's board" in one file). English phrases ONLY: nothing
// here may match a code identifier, a field or a string literal, because the
// product pipe is spelled that way too (`channels: z.array(...)` is a product
// field in workforce's tests). An earlier version listed `input\.channels` and
// `channels: z\.array` and absorbed those product lines; review caught it.
const SURVIVOR_LINE = new RegExp(
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
  ].join("|"),
  "i",
);
// Another meaning of the word spelled in code (Redis pub/sub, Postgres LISTEN,
// colour channels) or in a docs example about marketing channels. Scoped to the
// one file and narrow on purpose: the first bullmq entry was /channel/i, and
// PLANT=product showed it swallowing a planted product line whole. A product
// line planted into any of these files still counts.
const FILE_SURVIVORS = {
  "packages/bullmq/src/stream-bridge.ts": /eventChannel|abortChannel|channelPrefix|CHANNEL_PREFIX|events to a channel|Redis channel|const channel = |^\s*channel,$|(un)?subscribe\(channel|publish\(channel/,
  "packages/bullmq/src/flowstate-adapter.ts": /channelPrefix/,
  "packages/bullmq/test/flowstate-adapter.test.ts": /channelPrefix/,
  "packages/bullmq/README.md": /channelPrefix/,
  "packages/store-postgres/src/request-store.ts": /NOTIFY_CHANNEL|msg\.channel|channel: string/,
  "packages/ui/test/token-contrast.test.ts": /channel\(|const channel = \(n/,
  "apps/docs/guides/human-in-the-loop.md": /Which channels should this post to|channels: z\.array\(z\.enum\(\["blog"/,
  "apps/docs/docs/advanced/sequencer-side-chains.md": /input\.channels\.map\(\(ch\) => \(\{ channel: ch/,
  "docs/architecture/sequencer-dsl.md": /\(input\) => input\.channels,/,
  "docs/architecture/dispatched-work.md": /^\s*channel\.$/,
};

const isSurvivor = (path, line) =>
  SURVIVOR_LINE.test(line) || (FILE_SURVIVORS[path]?.test(line) ?? false);

// ── Wire names: persisted keys, item components, kinds, tools, actions. ─────
// Each is a public string a store, a stream or a model already holds. The
// regex is anchored on the literal so prose about it doesn't inflate the count.
const WIRE = [
  ["flow kind `channel` (sessions' flowKind, action URLs)", /CHANNEL_KIND\b|kind: "channel"|flowKind: "channel"|\["channel"\]|"channel" as const/],
  ["item component `channel-post`", /"channel-post"|CHANNEL_POST_COMPONENT/],
  ["item component + evaluator `channel-route`", /"channel-route"|CHANNEL_ROUTE_(COMPONENT|EVALUATOR)/],
  ["inventory collection `inventory/channels/`", /inventory\/channels/],
  ["membership row field `channelId`", /\bchannelId\b/],
  ["capability key `channel-post`", /CHANNEL_POST_CAPABILITY|cap\["channel-post"\]/],
  ["tool `post-to-channel` (+ dispatch/line blocks)", /post-to-channel/],
  ["action `registerChannelInInventory`", /registerChannelInInventory|INVENTORY_REGISTER_CHANNEL/],
  ["seat state key `channelRoutedPost`", /channelRoutedPost|ROUTED_TURN_STATE/],
  ["discovery domain `channels`", /"channels"/],
  ["refusal code `talk-on-a-channel`", /talk-on-a-channel/],
  ["codegen export `channelKinds`", /\bchannelKinds\b/],
  ["block names `channel-*` (traces, DevTool)", /name: "channel-[a-z-]+"|"answer-in-channel[a-z-]*"/],
];

// ── Read the tree. ────────────────────────────────────────────────────────────
const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8" }).split("\0").filter(Boolean);
const files = new Map(); // path → text
for (const p of tracked) {
  if (!existsSync(`${ROOT}/${p}`)) continue;
  let text;
  try { text = readFileSync(`${ROOT}/${p}`, "utf8"); } catch { continue; }
  if (text.includes("\0")) continue; // binary
  if (/channel/i.test(text) || /channel/i.test(p)) files.set(p, text);
}
if (PLANT === "unclassified") files.set("zz-planted/new-surface.ts", "export const kind = \"channel\";\n");
if (PLANT === "product" || PLANT === "wire") {
  // Into a survivor file: the plant must count as product, not be absorbed.
  const p = "packages/bullmq/src/stream-bridge.ts";
  const line = PLANT === "product"
    ? "// a post on the support channel wakes its member seats"
    : "  channels: z.array(z.unknown()), // input.channels is the product roster";
  files.set(p, `${files.get(p)}\n${line}\n`);
}

// ── Content: product vs survivor lines, per group. ───────────────────────────
const content = {}; // group → { files, productLines, survivorLines, survivorOnlyFiles }
const productFiles = {}; // group → [path, lines][]
const unclassified = [];
for (const [p, text] of files) {
  const g = groupOf(p);
  if (g === "UNCLASSIFIED") unclassified.push(p);
  let product = 0;
  let survivor = 0;
  for (const line of text.split("\n")) {
    if (!/channel/i.test(line)) continue;
    if (isSurvivor(p, line)) survivor++;
    else { product++; if (LIST === g) console.log(`${p}: ${line.trim().slice(0, 160)}`); }
  }
  const c = (content[g] ??= { files: 0, productLines: 0, survivorLines: 0, survivorOnlyFiles: 0 });
  if (product > 0) { c.files++; c.productLines += product; (productFiles[g] ??= []).push([p, product]); }
  else if (survivor > 0) c.survivorOnlyFiles++;
  c.survivorLines += survivor;
}

// ── Wire: occurrences outside history/process. ───────────────────────────────
const wire = WIRE.map(([name, re]) => {
  let hits = 0;
  const where = new Set();
  for (const [p, text] of files) {
    if (!IN_SCOPE.has(groupOf(p))) continue;
    for (const line of text.split("\n")) if (re.test(line)) { hits++; where.add(groupOf(p)); }
  }
  return { name, hits, groups: [...where].sort() };
});

// ── Paths: names that say channel, in the surfaces the rename touches. ───────
const paths = { channelMd: 0, channelsDirs: new Set(), kindFiles: 0, otherNamed: {} };
for (const p of tracked) {
  if (!IN_SCOPE.has(groupOf(p))) continue; // retained specs keep their fixtures' names
  if (/(^|\/)CHANNEL\.md$/.test(p)) paths.channelMd++;
  const dirs = p.split("/").slice(0, -1);
  dirs.forEach((d, i) => { if (/^channels$/i.test(d)) paths.channelsDirs.add(dirs.slice(0, i + 1).join("/")); });
  if (/\/flows\/channels\/[^/]+\.[cm]?tsx?$/.test(p)) paths.kindFiles++;
  else if (/channel/i.test(p) && !/(^|\/)CHANNEL\.md$/.test(p)) {
    const g = groupOf(p);
    paths.otherNamed[g] = (paths.otherNamed[g] ?? 0) + 1;
  }
}

// ── Exported API symbols that carry the word (published packages). ──────────
// Identifiers named in `export` statements under published src/, de-duplicated.
const exported = new Set();
for (const [p, text] of files) {
  if (groupOf(p) !== "api" || !/\.[cm]?tsx?$/.test(p)) continue;
  for (const m of text.matchAll(/export\s+(?:declare\s+)?(?:async\s+)?(?:const|function|class|type|interface|enum)\s+([A-Za-z0-9_$]+)/g))
    if (/channel/i.test(m[1])) exported.add(m[1]);
  for (const m of text.matchAll(/export\s*(?:type\s*)?\{([^}]*)\}/g))
    for (const raw of m[1].split(",")) {
      const name = raw.replace(/\btype\b/, "").split(/\s+as\s+/).pop().trim();
      if (/channel/i.test(name)) exported.add(name);
    }
}

// ── Report. ───────────────────────────────────────────────────────────────────
const report = {
  base: execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(),
  content,
  wire,
  paths: { ...paths, channelsDirs: paths.channelsDirs.size },
  exportedSymbols: [...exported].sort(),
  unclassified,
};

if (args.has("--json")) console.log(JSON.stringify(report, null, 2));
else {
  console.log(`base ${report.base}\n\nCONTENT  group      files  product-lines  survivor-lines  survivor-only-files`);
  for (const [g] of [...GROUPS, ["UNCLASSIFIED"]]) {
    const c = content[g];
    if (c) console.log(`         ${g.padEnd(10)} ${String(c.files).padStart(5)}  ${String(c.productLines).padStart(13)}  ${String(c.survivorLines).padStart(14)}  ${String(c.survivorOnlyFiles).padStart(19)}`);
  }
  console.log(`\nWIRE     ${wire.length} names`);
  for (const w of wire) console.log(`         ${String(w.hits).padStart(4)}  ${w.name}  [${w.groups.join(" ")}]`);
  console.log(`\nPATHS    CHANNEL.md files ${paths.channelMd} · channels/ folders ${paths.channelsDirs.size} · kind files under flows/channels/ ${paths.kindFiles}`);
  console.log(`         other paths named channel: ${JSON.stringify(paths.otherNamed)}`);
  console.log(`\nAPI      ${exported.size} exported symbols in published packages carry the word`);
}

if (unclassified.length > 0) {
  console.error(`\nTOTALITY FAILED: ${unclassified.length} file(s) belong to no group:\n  ${unclassified.join("\n  ")}`);
  process.exit(1);
}
if (args.has("--guard")) {
  const left = [...IN_SCOPE].flatMap((g) => productFiles[g] ?? []);
  if (left.length > 0) {
    console.error(`\nGUARD FAILED: ${left.length} in-scope file(s) still say channel about the product pipe, e.g.\n  ${left.slice(0, 5).map(([p, n]) => `${p} (${n})`).join("\n  ")}`);
    process.exit(1);
  }
  console.log("\nGUARD PASSED");
}
