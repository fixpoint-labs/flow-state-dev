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
 * product pipe is spelled that way too. So survivors are English phrases, each
 * pinned to the files whose lines it covers ({@link PHRASE_SURVIVORS}), since a
 * stale sentence about the pipe can share a phrase; only a subsystem's own name
 * applies everywhere ({@link SURVIVOR_LINE}). The few other meanings spelled in
 * code (Redis pub/sub, Postgres `LISTEN`, a colour channel) are pinned to their
 * one file in {@link FILE_SURVIVORS}. Never widen any of them to go green:
 * rename the line.
 *
 * ## What is allowlisted, by path
 *
 * The old words have to live somewhere until 1.0, so a stale tree or store is
 * refused by name rather than misread: the one legacy module, its test, the
 * goal that proves the refusal, this guard and its test, and this rename's own
 * changeset. Plus the upgrade section of the README and of the mailboxes docs
 * page, by heading, and a few exact lines that point at it: the docs page's
 * `pre-rename-record` row and the redirect from the old page's address.
 * Nothing else, and never a whole page.
 *
 * ## Scope
 *
 * The docs site (`apps/docs/`, `docs/` outside `internal/`) is in scope like
 * the code. History (retained specs, CHANGELOGs, `docs/internal/`) and process
 * tooling (`.agents/`, `.github/`, …) keep the old word by design and are never
 * in scope.
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
const LEGACY_SECTIONS = [
  { path: "packages/workforce/README.md", heading: /^#+ Upgrading from channels$/ },
  { path: "apps/docs/docs/workforce/mailboxes.md", heading: /^#+ Upgrading from channels$/ },
];

/**
 * Single lines outside such a section that must name the old words, by file and
 * the whole line, compared after trimming. Any other line in the file still
 * counts, and so does an edit to one of these.
 */
const LEGACY_LINES = [
  {
    path: "apps/docs/docs/workforce/mailboxes.md",
    line: "| `pre-rename-record` | A `CHANNEL.md`, or a team's `channels/` folder, from before mailboxes were renamed. One entry per old file, or one for a folder holding none, and the message names where it belongs now. Nothing in it is read. See [Upgrading from channels](#upgrading-from-channels). |",
  },
  { path: "apps/docs/docusaurus.config.ts", line: 'from: "/docs/workforce/channels",' },
];

const isLegacyLine = (path, line) => LEGACY_LINES.some((entry) => entry.path === path && entry.line === line.trim());

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
    ["history", (p) => /^specs\/|^\.designs\/|^docs\/internal\/|(^|\/)CHANGELOG\.md$|^\.changeset\/|^pnpm-lock\.yaml$/.test(p)],
    ["process", (p) => /^\.agents\/|^\.omp\/|^\.github\/|^\.claude\/|^CLAUDE\.md$|^AGENTS\.md$|^knip\.json$/.test(p)],
    ["tests", (p) => /^(packages|labs|apps)\/.*(\/(test|tests|e2e)\/|\.(test|spec)(-d)?\.[cm]?tsx?$)/.test(p)],
    ["goals", (p) => /^goals\//.test(p)],
    ["readmes", (p) => /^(packages|labs)\/[^/]+\/README\.md$|^apps\/kitchen-sink\/README\.md$|^labs\/README\.md$|^README\.md$/.test(p)],
    ["site", (p) => /^apps\/docs\/|^docs\//.test(p)],
    ["ui", (p) => /^labs\/|^apps\/kitchen-sink\/|^packages\/(devtool|ui)\/|^packages\/shift-manager\/teams\//.test(p)],
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
export function inScopeGroups() {
  return new Set(["api", "ui", "goals", "tests", "changesets", "readmes", "site"]);
}

/** A path whose own name uses the word for something else. */
const PATH_SURVIVOR = /(^|\/)trace-channel\.md$/;

/**
 * The ordinary English word, not the pipe, in every file. Only a phrase that
 * names another subsystem by its own name earns a place here: one that a
 * sentence about the mailbox could not contain. Everything else is pinned to
 * the files it covers in {@link PHRASE_SURVIVORS}.
 */
export const SURVIVOR_LINE = /trace[- ]channel/i;

/**
 * The ordinary English word, not the pipe, pinned to the files that use it:
 * `[phrase, files]`, matched case-insensitively. English phrases ONLY — nothing
 * here may match an identifier, a field or a string literal. A phrase is pinned
 * because a stale sentence about the pipe can share it ("either channel", "a
 * separate channel"); pinned, that sentence still counts in every other file.
 * Add a file to a phrase only for a line the phrase must cover today.
 */
export const PHRASE_SURVIVORS = [
  [
    "side[- ]?channel",
    [
      "apps/docs/docs/advanced/durable-execution.md",
      "apps/docs/docs/sequencers/control-flow.md",
      "docs/architecture/items.md",
      "docs/atlas/framework.html",
      "docs/atlas/workforce.html",
      "packages/core/README.md",
      "packages/orchestration/src/task-board/blocks/claim-task.ts",
      "packages/react/README.md",
      "packages/react/src/hooks/useResourceCollection.ts",
    ],
  ],
  ["pub/sub", ["packages/bullmq/README.md", "packages/bullmq/src/flowstate-adapter.ts"]],
  ["channel pair", ["packages/bullmq/README.md", "packages/bullmq/src/stream-bridge.ts"]],
  ["a Slack channel", ["apps/docs/docs/server/webhooks.md"]],
  [
    "question channel",
    [
      "docs/atlas/conductor.html",
      "docs/atlas/framework.html",
      "packages/harness-manager/package.json",
    ],
  ],
  ["label channel", ["docs/contributing/orchestration.md"]],
  ["approval channel", ["docs/contributing/orchestration.md"]],
  ["exec channel", ["packages/tools/src/bash/sandbox-place.ts"]],
  [
    "write channel",
    [
      "packages/workspace/README.md",
      "packages/workspace/src/projection.ts",
      "packages/workspace/test/projection.spec.ts",
    ],
  ],
  ["intent channel", ["packages/tools/src/search/providers/parallel.ts"]],
  ["notice channel", ["packages/react/src/hooks/useResourceCollection.ts", "packages/react/src/hooks/useSession.ts"]],
  ["recovery channel", ["packages/engine/src/routes/stream-routes.ts"]],
  ["trusted channel", ["packages/core/src/types/harness.ts"]],
  [
    "structured channel",
    [
      "goals/delegation/synthesizes-fanned-out-worker-results/goal.md",
      "goals/delegation/synthesizes-fanned-out-worker-results/run.mts",
      "packages/engine/src/stores/index.ts",
      "packages/engine/src/stores/types.ts",
    ],
  ],
  [
    "background channel",
    [
      "packages/orchestration/src/tasks/helpers/dispatch-and-execute.ts",
      "packages/orchestration/test/helpers/dispatch-and-execute.test.ts",
    ],
  ],
  ["failure channel", ["packages/engine/src/errors/store-subscription-error.ts"]],
  [
    "error channels?",
    [
      "apps/kitchen-sink/workforce/hire.ts",
      "packages/engine/src/stores/filesystem/trace-store.ts",
      "packages/workforce/src/loader/read-declared-roster.ts",
      "packages/workforce/test/read-declared-roster.test.ts",
    ],
  ],
  [
    "separate channels?",
    [
      "apps/docs/docs/cli/agent-dev-loop.md",
      "docs/atlas/conductor.html",
      "packages/bullmq/src/stream-bridge.ts",
      "packages/engine/test/context/request-host-provenance.test.ts",
    ],
  ],
  ["content\\.delta` channel", ["packages/contracts/src/items/types.ts"]],
  ["two channels, two meanings", ["packages/harness-manager/src/manager.ts"]],
  ["third channel beside", ["packages/harness-manager/src/manager.ts"]],
  [
    "through a channel (the|a) ",
    [
      "packages/claude-code/src/sdk/capability.ts",
      "packages/claude-code/test/sdk/capability.spec.ts",
    ],
  ],
  ["point of the channel", ["packages/core/src/types/harness.ts", "packages/harness-manager/src/manager.ts"]],
  ["its own channel rather", ["packages/core/src/types/block.ts"]],
  ["channel a cancellation", ["packages/engine/src/execution/abort-registry.ts"]],
  ["either channel", ["packages/engine/src/execution/runAction.ts"]],
  ["the channel does not matter", ["packages/orchestration/test/task-board/task-board-hand-off-config.test.ts"]],
  ["a channel that does not require", ["packages/orchestration/test/skills/initial-skills-resolver.test.ts"]],
  ["the two channels are fed", ["packages/orchestration/src/tasks/helpers/dispatch-and-execute.ts"]],
  ["the channel\\)\\.", ["goals/workforce-mailboxes/a-routed-post-gets-one-answer/goal.md"]],
  ["alternative channel", ["packages/harness-manager/src/ask.ts"]],
  ["provenance` — a channel whose", ["packages/engine/src/context/create-request-host.ts"]],
  ["channel is used when available", ["packages/engine/src/context/createExecutionContext.ts"]],
  ["channel a hand-off refusal", ["packages/codex/src/capability.ts"]],
  ["self-bias channel", ["apps/docs/docs/patterns/debate.md"]],
  ["SSE channel", ["apps/docs/docs/streaming/overview.md"]],
  ["opens two channels", ["apps/docs/docs/resources/client-access.md"]],
  ["Four channels", ["docs/architecture/state-and-scopes.md"]],
  ["outbound channel", ["docs/architecture/webhook-transport.md"]],
  ["no channel for a per-seat", ["docs/architecture/workforce-default-worker-kind.md"]],
  ["runtime channel", ["docs/architecture/capabilities.md"]],
  ["public-channel item", ["docs/architecture/items.md"]],
  [
    "within 3 per channel",
    [
      "goals/lib/colour.mts",
      "goals/shift-manager/it-takes-its-look-from-the-design-system/goal.md",
      "labs/design-system/test/shift-manager.test.ts",
    ],
  ],
  ["0 to 255 per channel", ["goals/lib/colour.mts", "labs/design-system/test/theme.ts"]],
  ["channel, so no value sits", ["labs/design-system/shift-manager.css"]],
  [
    "`sessionStateSchema` through a channel",
    [
      "packages/claude-code/src/sdk/capability.ts",
      "packages/claude-code/test/sdk/capability.spec.ts",
      "packages/cursor/src/capability.ts",
    ],
  ],
  ["Telegram-style channels", ["apps/kitchen-sink/skills/check-news/reference/world-events.md"]],
  ["two channels never carry each other", ["labs/conductor/src/answer.ts"]],
  ["two channels carry each other", ["labs/conductor/test/ask-and-answer.spec.ts"]],
  ["The other channel, and it never carries", ["labs/conductor/src/implement.ts"]],
  ["that channel still works", ["labs/conductor/test/ask-and-answer.spec.ts"]],
  ["one channel for the visit", ["packages/devtool/src/react/hooks/use-continue-request.ts"]],
  ["ONE channel\\. `error`", ["packages/devtool/src/react/hooks/use-dispatch-runs.ts"]],
  ["were two channels", ["packages/devtool/src/react/hooks/use-dispatch-runs.ts"]],
  ["a second channel carrying it", ["packages/devtool/src/react/hooks/use-request-stream.ts"]],
  ["the channel by which one worker", ["goals/delegation/synthesizes-fanned-out-worker-results/run.mts"]],
  ["payload channel", ["goals/delegation/synthesizes-fanned-out-worker-results/run.mts"]],
  ["third channel: a dep", ["goals/delegation/synthesizes-fanned-out-worker-results/run.mts"]],
  ["a back channel", ["goals/workforce-conventions/durable-hire-survives-redeploy/run.mts"]],
  ["the channel a manager hands", ["packages/core/test/harness-resolver.test-d.ts"]],
  ["split-channel bug", ["packages/devtool/test/use-dispatch-runs.test.ts"]],
  ["the only channel a caller has", ["packages/engine/test/principal-org-spoofing.test.ts"]],
  ["framework's standard channel", ["packages/harness-manager/test/slot.spec.ts"]],
  ["the channel `readWorkforce` itself fills", ["packages/workforce/test/team-instructions-seam.test.ts"]],
  ["loader's own channel", ["packages/workforce/test/team-instructions-seam.test.ts"]],
  ["within 1 per channel", ["goals/design-system/skins-reused-components-from-one-token-set/goal.md"]],
  ["leak through a third channel", ["goals/delegation/synthesizes-fanned-out-worker-results/goal.md"]],
  ["either alone leaves a channel", ["packages/shift-manager/teams/devteam/acceptance-check.mjs"]],
  ["Their own channel (rather|for the reason)", ["packages/workforce/src/loader/read-workforce.ts"]],
  ["five channels are one list", ["packages/workforce/src/loader/read-declared-roster.ts"]],
];

/** {@link PHRASE_SURVIVORS}, one pattern per file. */
const PHRASES_BY_FILE = (() => {
  const byFile = new Map();
  for (const [phrase, files] of PHRASE_SURVIVORS) {
    for (const file of files) byFile.set(file, [...(byFile.get(file) ?? []), phrase]);
  }
  return new Map([...byFile].map(([file, phrases]) => [file, new RegExp(phrases.join("|"), "i")]));
})();

/**
 * Another meaning spelled in code, or a phrase only one page uses, pinned to
 * its one file and kept narrow: a product line planted into any of these files
 * still counts, and so does the same phrase anywhere else.
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
  // A Slack channel, in the guide whose subject is Slack's Events API.
  "apps/docs/guides/webhooks-slack-events.md":
    /posts in a channel our bot is in|^reply channel; the webhook transport|^\s*channel\?: string;$|channel: e\.payload\.event\.channel,|`channel-\$\{e\.payload\.event\.channel\}`|`message\.channels`|out, keyed per channel\.$/,
  // The atlas's "Questions, in and out" section, its anchor and its prose: a run's question path.
  "docs/atlas/conductor.html":
    /^\s*<a href="#channel">06 &middot; Questions, in and out<\/a>$|^<section id="channel">$|a channel back in\.|travels the channel a mutation|any of three channels in any order|The reverse channel is one entry|cross-worker wake channel|No channel to steer a background run/,
  // The trace/production split of the stream.
  "apps/docs/docs/streaming/trace-channel.md": /^\| Channel \| Item types \| Who sees them \|$/,
  // Cache and the ledger as two ways information travels.
  "docs/contributing/best-practices/resources.md": /Cache is the cost channel/,
  // The ways an approval, an event or a message reaches the process.
  "docs/contributing/orchestration.md":
    /this channel never lets an agent approve|approval is a human channel|channel off, or giving agents a second GitHub identity|the channel is a board of handle PRs|the \*\*event\*\* channel/,
  "docs/contributing/spec-figures.md": /or to the comment channel/,
};

/** Whether a line says the word about something other than the pipe. */
export function isSurvivor(path, line) {
  return (
    SURVIVOR_LINE.test(line) || (FILE_SURVIVORS[path]?.test(line) ?? false) || (PHRASES_BY_FILE.get(path)?.test(line) ?? false)
  );
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
    if (inLegacySection || isLegacyLine(path, raw)) return;
    if (/channel/i.test(raw) && !isSurvivor(path, raw)) hits.push({ line: index + 1, text: raw.trim() });
  });
  return hits;
}

/**
 * Scan a tree. Pure over its inputs, so a test can hand it a fixture.
 * @param {{ files: Map<string, string>; paths: string[]; published: Set<string> }} tree
 */
export function scanTree({ files, paths, published }) {
  const groups = groupsFor(published);
  const groupOf = (p) => groups.find(([, test]) => test(p))?.[0] ?? "UNCLASSIFIED";
  const scope = inScopeGroups();
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
