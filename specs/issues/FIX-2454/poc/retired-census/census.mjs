#!/usr/bin/env node
/**
 * The retired-name census: the factual base of this spec, re-derived.
 *
 * Throwaway design evidence, not production code. It answers one question per
 * retired name the source still refuses or reads: did a published version of
 * the package accept or write the old name? A name one did is kept, through
 * the one refusal helper, with a removal version. A name none did is deleted.
 *
 * 1. Census. Every entry's probe runs over the `dist/` of every published
 *    version of its package (downloaded with `npm pack`), skipping lines that
 *    are the refusal itself. The verdict (published / never) must equal the
 *    entry's `expect`.
 * 2. Totality. Every line under `packages/<pkg>/src` that is refusal-shaped
 *    (REFUSAL_SHAPE) belongs to an entry (file + needle) or to EXCLUDED with a
 *    reason. A line in neither fails the census: an unlisted site is the one
 *    nobody looked at.
 * 3. Control (`--control`). A planted refusal-shaped line no entry owns, and
 *    one entry with its expectation flipped, must each be reported. If the
 *    control passes, the census proves nothing.
 * 4. After (`--after [ref]`), the spec's goal check (2): the end state in source,
 *    read from the working tree or a git ref, with no npm. Every refusal-shaped
 *    line under `packages/<pkg>/src`, and every line naming either helper, fails
 *    unless EXCLUDED (not a retired name) or KEPT (a line of a refusal the owner
 *    kept, by file and exact text). Each KEPT row must match exactly one line:
 *    two is the exemption widening, none is a kept line gone or changed and the
 *    row stale. Its control is
 *    `--after ebec5326`, the epic's start, which must FAIL on every listed site.
 *
 * Run from the repository root:
 *   node specs/issues/FIX-2454/poc/retired-census/census.mjs [--control] [--cache <dir>]
 *   node specs/issues/FIX-2454/poc/retired-census/census.mjs --after [ref]
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const CONTROL = args.includes("--control");
const afterAt = args.indexOf("--after");
const AFTER = afterAt >= 0;
const AFTER_REF = AFTER && args[afterAt + 1] && !args[afterAt + 1].startsWith("--") ? args[afterAt + 1] : null;
const cacheAt = args.indexOf("--cache");
const CACHE = cacheAt >= 0 ? args[cacheAt + 1] : join(tmpdir(), "retired-census-tarballs");

/** A line that announces itself as a refusal or a legacy read. */
const REFUSAL_SHAPE = /retired-name-refusal|\bwas removed\b|uses the removed\b|the removed `|was renamed\b|is now `|RESUMED_UNDER_FORMER_NAME|refuseRetired/;

/** A published file that is the legacy reader itself: its lines name the old shapes by design. */
const READER_FILE = /retired-shapes\.(js|d\.ts)$/;

/** A published line that is the refusal or the reader itself, not a live use. */
const NOT_LIVE = /removed|renamed|is now|retired|RETIRED|refus|was stored|before FIX|legacy|former/i;

/**
 * One entry per retired name. `pkg` is whose published versions are probed;
 * `live` matches a live use in them (in `ext` files); `sites` are the source
 * lines (file, needle) the entry owns.
 */
const ENTRIES = [
  // ── Published: a version on npm accepted or wrote the old name. Kept, through the helper.
  // The silent case: an open-string value, accepted through core 0.2.0.
  { id: "human-reasons", pkg: "core", ext: ".js", live: /"human_(approval|input)"/, expect: "published", sites: [] },
  // orchestration 0.3.0 stored the `blocked` status.
  { id: "row-blocked", pkg: "orchestration", ext: ".js", live: /status: "blocked"|"blocked"/, expect: "published",
    sites: [["orchestration/src/tasks/schema/retired-shapes.ts", "RETIRED_SHAPES"]] },
  { id: "engine-dispatcher", pkg: "engine", ext: ".d.ts", live: /\bdispatcher\?: /, expect: "published",
    sites: [["engine/src/transports/runner.ts", "dispatcher"], ["engine/src/transports/runner.ts", "refuseRetired"], ["engine/src/flowstate/createFlowState.ts", "refuseRetired"], ["engine/src/routes/createFlowApiRouter.ts", "refuseRetired"], ["engine/src/routes/http-handlers.ts", "refuseRetired"], ["engine/src/transports/host/createInboundTransportHost.ts", "refuseRetired"]] },
  { id: "gateway-model-form", pkg: "core", ext: ".js", live: /gateway\/provider\/model/, expect: "published",
    sites: [["core/src/models/providerDetection.ts", "gateway/provider/model"]] },
  { id: "scheduled-idempotency", pkg: "scheduled", ext: ".d.ts", live: /idempotency(WindowMs|Options)\?:/, expect: "published",
    sites: [["scheduled/src/createScheduledTransportAdapter.ts", "idempotency"], ["scheduled/src/routes.ts", "the removed key"]] },
  { id: "hm-announce", pkg: "harness-manager", ext: ".d.ts", live: /\bannounce\?:/, expect: "published",
    sites: [["harness-manager/src/manager.ts", "announce"]] },
  { id: "board-on-review", pkg: "orchestration", ext: ".d.ts", live: /onReview: "exit"/, expect: "published",
    sites: [["orchestration/src/task-board/index.ts", "onReview"]] },
  { id: "collection-backing", pkg: "orchestration", ext: ".js", live: /backing === "sequencer"/, expect: "published",
    sites: [["orchestration/src/tasks/collection/get-or-create.ts", "backing"], ["orchestration/src/tasks/collection/get-or-create.ts", "spellings"]] },
  { id: "skill-md-team", pkg: "orchestration", ext: ".js", live: /`agents:` must be a mapping/, expect: "published",
    sites: [["orchestration/src/skills/skill-md.ts", "was removed from skills"]] },
  { id: "wf-agents-catalog", pkg: "workforce", ext: ".d.ts", live: /agents: Agent|catalog\?: ToolCatalog/, expect: "published",
    sites: [["workforce/src/workforce-capability.ts", "was removed"]] },

  // ── Never published: no version on npm accepted or wrote it. Deleted.
  // Task-row shapes made and retired between orchestration 0.3.0 and 0.4.0.
  { id: "row-questions", pkg: "orchestration", ext: ".d.ts", live: /TaskQuestion\b/, expect: "never",
    sites: [["orchestration/src/tasks/schema/retired-shapes.ts", "questions"]] },
  { id: "row-kept-open-wait", pkg: "orchestration", ext: ".d.ts", live: /keptOpenBy.*"wait"/, expect: "never",
    sites: [["orchestration/src/tasks/schema/retired-shapes.ts", "suspendedWait"]] },
  { id: "row-kept-open-queued", pkg: "orchestration", ext: ".d.ts", live: /keptOpenBy.*"queued"/, expect: "never",
    sites: [["orchestration/src/tasks/schema/retired-shapes.ts", "queued"]] },
  { id: "row-recorded", pkg: "orchestration", ext: ".js", live: /undispatched/, expect: "never",
    sites: [["orchestration/src/tasks/schema/retired-shapes.ts", "a legacy reader"]] },
  { id: "row-reopened", pkg: "orchestration", ext: ".js", live: /reopened: true|\.reopened\b/, expect: "never",
    sites: [["orchestration/src/tasks/schema/retired-shapes.ts", "the reopened shape"]] },
  { id: "row-post", pkg: "orchestration", ext: ".js", live: /kind: "post"/, expect: "never", sites: [] },
  // core 0.3.0 shipped the model's tool as `suspendForUser` already; only the resume map names `waitForUser`.
  { id: "tool-wait-for-user", pkg: "core", ext: ".js", live: /waitForUser/, expect: "never",
    sites: [["core/src/blocks/generator.ts", "RESUMED_UNDER_FORMER_NAME"], ["core/src/blocks/generator.ts", "waitForUser"]] },
  // Refused already in the first published version: no adopter could have written them.
  { id: "engine-drain-timeout", pkg: "engine", ext: ".d.ts", live: /detachedDrainTimeoutMs\?:/, expect: "never",
    sites: [["engine/src/flowstate/createFlowState.ts", "detachedDrainTimeoutMs"]] },
  { id: "engine-list-limit", pkg: "engine", ext: ".d.ts", live: /maxWorkstreamListLimit\?:/, expect: "never",
    sites: [["engine/src/flowstate/createFlowState.ts", "maxWorkstreamListLimit"]] },
  { id: "middleware", pkg: "core", ext: ".d.ts", live: /\bmiddleware\??:/, expect: "never",
    sites: [["core/src/flow/defineFlow.ts", "middleware"], ["core/src/blocks/internal/build-block.ts", "middleware"], ["engine/src/flowstate/createFlowState.ts", "middleware"]] },
  { id: "flow-work", pkg: "core", ext: ".d.ts", live: /\bwork\??: \{/, expect: "never",
    sites: [["core/src/flow/defineFlow.ts", "work"]] },
  { id: "expect-attempt", pkg: "orchestration", ext: ".d.ts", live: /expectAttempt\?:/, expect: "never",
    sites: [["orchestration/src/tasks/collection/internal.ts", "expectAttempt"]] },
  { id: "dispatch-mode", pkg: "orchestration", ext: ".d.ts", live: /dispatch\?: \{[^}]*mode/, expect: "never",
    sites: [["orchestration/src/task-board/dispatch-assignee.ts", "the removed"]] },
  { id: "skill-md-context", pkg: "orchestration", ext: ".d.ts", live: /context\?: "(fork|pattern)"/, expect: "never",
    sites: [["orchestration/src/skills/skill-md.ts", "` was removed"], ["orchestration/src/skills/skill-md.ts", "`pattern:` was removed"], ["orchestration/src/skills/run-skill-tool.ts", "was removed"]] },
  { id: "task-wait-fields", pkg: "orchestration", ext: ".d.ts", live: /waitForResponse\?:/, expect: "never",
    sites: [["orchestration/src/skills/task-tools-capability.ts", "waitForResponse"], ["orchestration/src/skills/task-tools-capability.ts", "retired-name-refusal: question"]] },
  { id: "wf-hop-limit", pkg: "workforce", ext: ".d.ts", live: /hopLimit\??:/, expect: "never",
    sites: [["workforce/src/messages/message-limits.ts", "hopLimit"]] },
  { id: "wf-hand-off-tool", pkg: "workforce", ext: ".js", live: /"handOff"/, expect: "never",
    sites: [["workforce/src/agent-worker-flow.ts", "RETIRED_HAND_OFF"]] },
  { id: "wf-hand-offs-state", pkg: "workforce", ext: ".d.ts", live: /handOffs\??:/, expect: "never",
    sites: [["workforce/src/coordinator/coordinator-flow.ts", "handOffs"]] },
  { id: "wf-deliveries-state", pkg: "workforce", ext: ".js", live: /state\.deliveries|deliveries: \[\]/, expect: "never",
    sites: [["workforce/src/coordinator/coordinator-state.ts", "deliver"], ["workforce/src/coordinator/coordinator-state.ts", "RETIRED_DELIVERIES"]] },
];

/** Refusal-shaped source lines that are not a retired name, with the reason. */
const EXCLUDED = [
  ["core/src/tools/resource-tools.ts", "listResources", "history in a comment: no refusal, nothing reads the old tool"],
  ["engine/src/routes/route-utils.ts", "includeInternal", "history in a comment: nothing reads the old flag"],
  ["orchestration/src/task-board/blocks/worker-step.ts", "BlockDefinition.run", "history in a comment"],
  ["orchestration/src/task-board/task-entry.ts", "removed or renamed", "a runtime assignee that disappeared, not a retired name"],
  ["workforce/src/manifest-sources.ts", "was removed", "history in a comment"],
  ["harness-manager/src/session-flow.ts", "removed", "a worktree that was deleted at run time, not a retired name"],
  ["workspace/src/", "removed", "a checkout or branch removed at run time, not a retired name"],
];

/**
 * The retired-name refusals the owner kept: one row per line, as [file, the line's text with its
 * whitespace collapsed]. Epic D4's amendment (PR #4830, as merged) keeps the refusals whose
 * absence would fail silently: the `human_*` reasons and the `dispatcher` option. `--after`
 * exempts these exact lines and no others, so a new refusal cannot stand in for a kept line that
 * was reworded. The kept stored-`blocked` reader (`retired-shapes.ts`) has no refusal-shaped
 * line, so it needs no row.
 */
const KEPT = [
  // A `human_*` stop core 0.2.0 stored, read as its `user_*` reason.
  ["contracts/src/types/suspension.ts", "if (reason === \"human_approval\") return \"user_approval\"; // retired-name-refusal: a stop core 0.2.0 stored"],
  ["contracts/src/types/suspension.ts", "if (reason === \"human_input\") return \"user_input\"; // retired-name-refusal: a stop core 0.2.0 stored"],
  ["core/src/errors/resolve-allowed-actions.ts", "return reason === \"user_input\" || reason === \"human_input\" ? [\"submit\"] : [\"approve\", \"reject\"]; // retired-name-refusal: a stop core 0.2.0 stored"],
  ["react/src/hooks/useSuspensionForm.ts", "if (item.reason !== \"user_input\" && item.reason !== \"human_input\") return \"approval\"; // retired-name-refusal: a stop core 0.2.0 stored"],
  // A new `human_*` reason refused, naming its `user_*` reason.
  ["engine/src/context/createExecutionContext.ts", "if (suspendOpts.reason === \"human_approval\" || suspendOpts.reason === \"human_input\") { // retired-name-refusal: the old reasons"],
  ["engine/src/context/createExecutionContext.ts", "const renamed = suspendOpts.reason === \"human_approval\" ? \"user_approval\" : \"user_input\"; // retired-name-refusal: the old reasons"],
  ["engine/src/context/createExecutionContext.ts", "throw new Error(`ctx.suspend: reason \"${suspendOpts.reason}\" was renamed. Use \"${renamed}\".`);"],
  ["react/src/hooks/useSuspensions.ts", "/** The `user_*` reason each old `human_*` one was renamed to. */"],
  ["react/src/hooks/useSuspensions.ts", "human_approval: \"user_approval\", // retired-name-refusal: the old reason, refused or read as its new one"],
  ["react/src/hooks/useSuspensions.ts", "human_input: \"user_input\" // retired-name-refusal: the old reason, refused or read as its new one"],
  ["react/src/hooks/useSuspensions.ts", "if (renamed !== undefined) throw new Error(`useSuspensions: reason \"${reason}\" was renamed. Use \"${renamed}\".`);"],
  // The `dispatcher` option refused, naming `runner`: the helper, and its four callers' import and call.
  ["engine/src/transports/runner.ts", "* Refuse the `dispatcher` option key, which is now `runner`. A caller that is"],
  ["engine/src/transports/runner.ts", "export function refuseRetiredDispatcherOption(options: object, where: string): void {"],
  ["engine/src/flowstate/createFlowState.ts", "import { refuseRetiredDispatcherOption } from \"../transports/runner\";"],
  ["engine/src/flowstate/createFlowState.ts", "refuseRetiredDispatcherOption(options, \"createFlowState\");"],
  ["engine/src/routes/createFlowApiRouter.ts", "import { refuseRetiredDispatcherOption } from \"../transports/runner\";"],
  ["engine/src/routes/createFlowApiRouter.ts", "refuseRetiredDispatcherOption(options, \"createFlowApiRouter\");"],
  ["engine/src/routes/http-handlers.ts", "import { refuseRetiredDispatcherOption } from \"../transports/runner\";"],
  ["engine/src/routes/http-handlers.ts", "refuseRetiredDispatcherOption(options, \"createFlowRouteHandlers\");"],
  ["engine/src/transports/host/createInboundTransportHost.ts", "import { refuseRetiredDispatcherOption } from \"../runner\";"],
  ["engine/src/transports/host/createInboundTransportHost.ts", "refuseRetiredDispatcherOption(options, \"createInboundTransportHost\");"],
];

/** The two ad-hoc helpers the spec names; `--after` reads every line naming one, refusal-shaped or not. */
const HELPERS = /refuseRetiredDispatcherOption|rejectRemovedMiddleware/;

function sh(cmd, argv, cwd) {
  return execFileSync(cmd, argv, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function versionsOf(pkg) {
  return JSON.parse(sh("npm", ["view", `@flow-state-dev/${pkg}`, "versions", "--json"]));
}

function distOf(pkg, version) {
  const dir = join(CACHE, `${pkg}@${version}`);
  if (!existsSync(join(dir, "package", "dist"))) {
    mkdirSync(dir, { recursive: true });
    const file = sh("npm", ["pack", `@flow-state-dev/${pkg}@${version}`, "-q"], dir).trim().split("\n").pop();
    sh("tar", ["xzf", file], dir);
  }
  return join(dir, "package", "dist");
}

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else yield path;
  }
}

function liveIn(pkg, probe, ext) {
  const hits = [];
  for (const version of versionsOf(pkg)) {
    let found = false;
    for (const file of walk(distOf(pkg, version))) {
      if (!file.endsWith(ext) || READER_FILE.test(file)) continue;
      for (const line of readFileSync(file, "utf8").split("\n")) {
        if (probe.test(line) && !NOT_LIVE.test(line)) { found = true; break; }
      }
      if (found) break;
    }
    if (found) hits.push(version);
  }
  return hits;
}

/** Source lines under each package's `src` matching `shape`, in the working tree or at `ref`. */
function refusalLines(shape = REFUSAL_SHAPE, ref = null) {
  let out;
  try {
    out = sh("git", ["grep", "-nE", shape.source, ...(ref ? [ref] : []), "--", "packages/*/src/**"]);
  } catch (error) {
    if (error.status !== 1) throw error; // git grep exits 1 when nothing matches
    out = "";
  }
  return out.split("\n").filter(Boolean).map((line) => {
    const [file, n, ...rest] = (ref ? line.slice(ref.length + 1) : line).split(":");
    return { file: file.replace(/^packages\//, ""), n: Number(n), text: rest.join(":") };
  }).filter((l) => !/\.(test|spec)\.|\/test\//.test(l.file));
}

/** A line's text with its whitespace collapsed, as KEPT records it. */
const normalise = (text) => text.trim().split(/\s+/).join(" ");

const excluded = (l) => EXCLUDED.some(([f, needle]) => l.file.startsWith(f) && l.text.includes(needle));

/** `--after`: nothing refuses or reads a retired name in source but the KEPT rows, each exactly. */
function after(ref) {
  const seen = new Set();
  const lines = [...refusalLines(REFUSAL_SHAPE, ref), ...refusalLines(HELPERS, ref)]
    .filter((l) => !seen.has(`${l.file}:${l.n}`) && seen.add(`${l.file}:${l.n}`));
  const counts = KEPT.map(() => 0);
  let failed = 0;
  console.log(`census --after · ${ref ?? "working tree"} · ${lines.length} refusal-shaped or helper-named src lines`);
  for (const l of lines) {
    if (excluded(l)) continue;
    const kept = KEPT.findIndex(([file, text]) => l.file === file && normalise(l.text) === text);
    if (kept >= 0) { counts[kept]++; continue; }
    const owner = ENTRIES.find((e) => e.sites.some(([f, needle]) => l.file === f && l.text.includes(needle)));
    const helper = l.text.match(HELPERS)?.[0];
    failed++;
    console.log(`FAIL ${helper ?? owner?.id ?? "unowned"} ${l.file}:${l.n} ${l.text.trim().slice(0, 100)}`);
  }
  KEPT.forEach(([file, text], i) => {
    const ok = counts[i] === 1;
    if (!ok) failed++;
    console.log(`${ok ? "kept" : "FAIL"} ${file} · ${text.slice(0, 80)}${ok ? "" : counts[i] > 1 ? `  (found ${counts[i]} times: the exemption widened)` : "  (not found: the kept line is gone or changed, so the row is stale)"}`);
  });
  console.log(failed ? `\nFAIL · ${failed}` : "\nPASS");
  process.exit(failed ? 1 : 0);
}

if (AFTER) after(AFTER_REF);

const entries = CONTROL
  ? ENTRIES.map((e) => (e.id === "row-questions" ? { ...e, expect: "published" } : e))
  : ENTRIES;
const lines = refusalLines();
if (CONTROL) lines.push({ file: "core/src/planted.ts", n: 1, text: 'throw new Error("`plantedKey` was removed")' });

let failed = 0;
console.log("census · entry · verdict · published versions with a live use");
for (const e of entries) {
  const hits = liveIn(e.pkg, e.live, e.ext);
  const verdict = hits.length ? "published" : "never";
  const ok = verdict === e.expect;
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${e.id.padEnd(24)} ${verdict.padEnd(9)} ${e.pkg} ${hits.join(" ") || "-"}${ok ? "" : `  (expected ${e.expect})`}`);
}

const owned = (l) =>
  entries.some((e) => e.sites.some(([f, needle]) => l.file === f && l.text.includes(needle))) || excluded(l);
const orphans = lines.filter((l) => !owned(l));
console.log(`\ntotality · ${lines.length} refusal-shaped source lines · ${orphans.length} owned by no entry`);
for (const l of orphans) { failed++; console.log(`FAIL unowned ${l.file}:${l.n} ${l.text.trim().slice(0, 100)}`); }

const keep = entries.filter((e) => e.expect === "published").length;
/** What kind of retired name each entry is: a value, a config key, or a stored shape. */
const KIND = {
  "human-reasons": "value", "gateway-model-form": "value", "collection-backing": "value",
  "row-blocked": "shape", "row-questions": "shape", "row-kept-open-wait": "shape", "row-kept-open-queued": "shape",
  "row-recorded": "shape", "row-reopened": "shape", "row-post": "shape", "tool-wait-for-user": "shape",
  "wf-hand-offs-state": "shape", "wf-deliveries-state": "shape",
};
const tally = {};
for (const e of entries) {
  const k = `${KIND[e.id] ?? "key"} · ${e.expect}`;
  tally[k] = (tally[k] ?? 0) + 1;
}
console.log("\nby kind · " + Object.entries(tally).sort().map(([k, n]) => `${k} ${n}`).join(" · "));
console.log(`\n${entries.length} entries · ${keep} published (kept, through the helper, with a removal version) · ${entries.length - keep} never published (deleted)`);
if (CONTROL) {
  console.log(failed >= 2 ? "\nCONTROL FAILED as it must (planted line and flipped entry reported)" : "\nCONTROL PASSED: the census is blind");
  process.exit(failed >= 2 ? 1 : 0);
}
console.log(failed ? `\nFAIL · ${failed}` : "\nPASS");
process.exit(failed ? 1 : 0);
