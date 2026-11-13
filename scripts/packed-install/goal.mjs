/**
 * The adopter-goal judge: how many of the epic's six "Not done if" rows, and
 * the closure's row, hold for someone who installs FSD from npm, read off one
 * run of `run.mjs --goal`.
 *
 * `goal-manifest.json`, beside this file, lists the rows, the assertion ids
 * under each, and one expectation per assertion (`pass` or `fail`). `run.mjs`
 * runs every assertion as a goal `CHECKS` entry through `runChecks`, which
 * reports one outcome per assertion: `pass`, `fail`, `pending` (its check does
 * not exist yet) or `error` (it could not run). This module turns those
 * outcomes into a verdict:
 *
 *   - an outcome that differs from its expectation is red, in either direction,
 *     and `pending` counts as `fail`;
 *   - any `error` is red, whatever the expectation, so a broken leg cannot pass
 *     as an expected fail;
 *   - an assertion the manifest lists with no outcome, or an outcome the
 *     manifest does not list, is red;
 *   - a row's outcome is derived, never written: it passes only when it has at
 *     least one assertion and every one of them passes.
 *
 * Green means outcomes agree with the manifest, not that the epic is done.
 *
 * Under the control (`run.mjs --control=adopter-goal`) the rule is different:
 * every admitted assertion must report `fail`. A `pending` ratchet cell is
 * listed, not red: its owner runs the control when the check lands, and that
 * is when the cell is seen to fail.
 *
 * Also here: the ratchet strict-run protocol and the never-published probe,
 * which read files rather than run fixtures, so a test can pin them on
 * throwaway directories.
 *
 * Unit tests: `node --test scripts/packed-install/goal.test.mjs`.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** The manifest's path, beside this file. */
export const MANIFEST_PATH = fileURLToPath(new URL("./goal-manifest.json", import.meta.url));

/** The four outcomes an assertion can report. */
export const OUTCOMES = ["pass", "fail", "pending", "error"];

/** Read and validate the manifest. Throws naming the first problem. */
export function readManifest(path = MANIFEST_PATH) {
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  const problems = validateManifest(manifest);
  if (problems.length > 0) throw new Error(`goal manifest: ${problems.join("; ")}`);
  return manifest;
}

/**
 * Structural rules for the manifest: every row lists assertion ids, each id
 * sits in exactly one row and has an expectation of `pass` or `fail`, every
 * expectation belongs to a listed id, and no id carries a tracker id (BP-006).
 *
 * @returns {string[]} problems; empty when the manifest is well formed.
 */
export function validateManifest(manifest) {
  const problems = [];
  const rows = manifest?.rows;
  if (!Array.isArray(rows) || rows.length === 0) return ["`rows` must be a non-empty list"];
  const expect = manifest.expect ?? {};
  const seen = new Map();
  for (const row of rows) {
    if (typeof row?.id !== "string" || !Array.isArray(row.assertions)) {
      problems.push(`row ${JSON.stringify(row?.id)} needs an id and an assertions list`);
      continue;
    }
    for (const id of row.assertions) {
      if (seen.has(id)) problems.push(`${id} is listed under ${seen.get(id)} and ${row.id}`);
      seen.set(id, row.id);
      if (!id.startsWith(`${row.id}.`)) problems.push(`${id} does not carry its row's prefix ${row.id}.`);
      if (/\b[A-Z]{2,}-\d+\b/.test(id)) problems.push(`${id} carries a tracker id`);
      if (expect[id] !== "pass" && expect[id] !== "fail")
        problems.push(`${id} expects ${JSON.stringify(expect[id])}, not "pass" or "fail"`);
    }
  }
  for (const id of Object.keys(expect))
    if (!seen.has(id)) problems.push(`expect.${id} names no listed assertion`);
  return problems;
}

/**
 * Judge one goal run.
 *
 * @param {{ rows: { id: string, title?: string, assertions: string[] }[], expect: Record<string, "pass" | "fail"> }} manifest
 * @param {Map<string, { outcome: string, detail?: string[] }>} outcomes — by assertion id
 * @returns {{
 *   ok: boolean,
 *   rows: { id: string, title: string, passing: boolean, cells: number }[],
 *   rowsPassing: number,
 *   mismatches: { id: string, expect: string, outcome: string }[],
 *   errors: { id: string, detail: string[] }[],
 *   missing: string[],
 *   unlisted: string[],
 * }}
 */
export function judge(manifest, outcomes) {
  const mismatches = [];
  const errors = [];
  const missing = [];
  const listed = new Set(manifest.rows.flatMap((r) => r.assertions));
  const unlisted = [...outcomes.keys()].filter((id) => !listed.has(id));
  for (const id of listed) {
    const got = outcomes.get(id);
    if (!got) {
      missing.push(id);
      continue;
    }
    if (!OUTCOMES.includes(got.outcome) || got.outcome === "error") {
      errors.push({ id, detail: got.detail ?? [`outcome ${JSON.stringify(got.outcome)}`] });
      continue;
    }
    const effective = got.outcome === "pending" ? "fail" : got.outcome;
    if (effective !== manifest.expect[id]) mismatches.push({ id, expect: manifest.expect[id], outcome: got.outcome });
  }
  const rows = manifest.rows.map((row) => ({
    id: row.id,
    title: row.title ?? row.id,
    cells: row.assertions.length,
    passing: row.assertions.length > 0 && row.assertions.every((id) => outcomes.get(id)?.outcome === "pass"),
  }));
  return {
    ok: mismatches.length === 0 && errors.length === 0 && missing.length === 0 && unlisted.length === 0,
    rows,
    rowsPassing: rows.filter((r) => r.passing).length,
    mismatches,
    errors,
    missing,
    unlisted,
  };
}

/**
 * Judge one control run: every admitted assertion must report `fail`. A
 * `pass`, an `error`, a missing or an unlisted outcome is red. `pending` is
 * listed, not red.
 *
 * @returns {{ ok: boolean, failedAsTheyMust: string[], passed: string[], errors: { id: string, detail: string[] }[], pending: string[], missing: string[], unlisted: string[] }}
 */
export function judgeControl(manifest, outcomes) {
  const listed = new Set(manifest.rows.flatMap((r) => r.assertions));
  const out = { failedAsTheyMust: [], passed: [], errors: [], pending: [], missing: [], unlisted: [] };
  out.unlisted = [...outcomes.keys()].filter((id) => !listed.has(id));
  for (const id of listed) {
    const got = outcomes.get(id);
    if (!got) out.missing.push(id);
    else if (got.outcome === "fail") out.failedAsTheyMust.push(id);
    else if (got.outcome === "pending") out.pending.push(id);
    else if (got.outcome === "pass") out.passed.push(id);
    else out.errors.push({ id, detail: got.detail ?? [`outcome ${JSON.stringify(got.outcome)}`] });
  }
  const ok = out.passed.length === 0 && out.errors.length === 0 && out.missing.length === 0 && out.unlisted.length === 0;
  return { ok, ...out };
}

/** Lines for the log and the job summary: the row count, then what made it red. */
export function formatVerdict(verdict) {
  const lines = [`${verdict.rowsPassing} of ${verdict.rows.length} rows`];
  for (const row of verdict.rows)
    lines.push(`  ${row.passing ? "✓" : "✗"} ${row.title} (${row.cells} cell${row.cells === 1 ? "" : "s"})`);
  for (const m of verdict.mismatches) lines.push(`  mismatch: ${m.id} reported ${m.outcome}, the manifest expects ${m.expect}`);
  for (const e of verdict.errors) lines.push(`  error: ${e.id}: ${e.detail.join(" | ")}`);
  for (const id of verdict.missing) lines.push(`  error: ${id} is in the manifest and reported no outcome`);
  for (const id of verdict.unlisted) lines.push(`  error: ${id} reported an outcome the manifest does not list`);
  return lines;
}

// ── The moved list's later renames ─────────────────────────────────────────

/**
 * Moved core names a later change renamed, old → new. The export census's
 * `moved.tsv` is frozen at the spec's census, so its readers (the
 * `surface.core-installed-dts` leg and `goals/core/root-is-for-app-authors`)
 * look for a renamed row under its new name in its new home, and under both
 * names on the entries it left. A rename belongs here only with the reason.
 */
export const MOVED_RENAMES = {
  // Renamed so it no longer collides with react's public `SessionView`.
  SessionView: "PeerSessionView",
  // Renamed so a stored thing is a resource, not a row.
  planRowsPrefix: "planResourcesPrefix",
  // Renamed because it addresses a task, not a row.
  WaitRow: "TaskAddress",
};

// ── The ratchet strict-run protocol ────────────────────────────────────────

/**
 * A ratchet cell (`surface.root.*`, `surface.collisions`, `leakage.tracker-ids`)
 * reads a workspace check's strict run: the check with its baseline, allow-list
 * or suppressions set aside. Until the check exists, the manifest's `ratchets`
 * entry for it is `null` and the cell reports `pending`. Its owner, landing the
 * check, sets the entry to the script's repo-relative path. That line is
 * wiring, not an assertion, and is the one manifest edit besides a flipped
 * expectation that a child may make.
 *
 * The protocol a wired script implements:
 *
 *   node <script> --strict --json --root <tree>
 *
 * reads the repository tree at `<tree>` (the checkout under test, or the
 * control's checkout of the pinned commit), ignores its baseline, and prints,
 * as its last stdout line, `{ "violations": [{ "package": "@flow-state-dev/x",
 * "name"?: "...", "detail": "..." }] }`. Its exit code is not read: a strict run
 * with violations may exit non-zero. Output that does not parse is an `error`.
 *
 * @returns {{ violations: { package: string, name?: string, detail?: string }[] }}
 */
export function runRatchet(repoRoot, script, tree) {
  const path = join(repoRoot, script);
  if (!existsSync(path)) throw new Error(`ratchet script ${script} is wired in the manifest but does not exist`);
  const res = spawnSync(process.execPath, [path, "--strict", "--json", "--root", tree], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 300_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  const last = (res.stdout ?? "").trim().split("\n").pop() ?? "";
  let parsed;
  try {
    parsed = JSON.parse(last);
  } catch {
    throw new Error(`${script}: no JSON verdict on its last line (exit ${res.status ?? res.signal}): ${(res.stderr ?? "").trim().slice(-300)}`);
  }
  if (!Array.isArray(parsed?.violations)) throw new Error(`${script}: verdict has no violations list`);
  return parsed;
}

/**
 * The failures one ratchet cell sees in a strict run's violations. `package`
 * of `"*"` takes every violation; `names`, a pattern, keeps only violations
 * whose `name` matches (workforce's cell covers its `*_ENTRY` names only).
 */
export function ratchetFailures(violations, { package: pkg, names }) {
  return violations
    .filter((v) => pkg === "*" || v.package === pkg)
    .filter((v) => !names || names.test(v.name ?? ""))
    .map((v) => `${v.package}${v.name ? ` ${v.name}` : ""}: ${v.detail ?? "violation"}`);
}

// ── shims.never-published ───────────────────────────────────────────────────

/**
 * The 19 retired names no published version accepted or wrote, from the
 * retired-names census's `never` entries (its `retired-census/census.mjs`). Each is a name the installed packages must neither read nor
 * refuse. `pkg` is the package (or packages) whose `dist` is scanned; `file`
 * narrows the scan where the name alone is a common word.
 */
export const NEVER_PUBLISHED = [
  { id: "row-questions", pkg: "orchestration", name: /["'`]questions["'`]|\bquestions\s*[:?]|\.questions\b/ },
  { id: "row-kept-open-wait", pkg: "orchestration", name: /suspendedWait|keptOpenBy[^\n]*"wait"/ },
  { id: "row-kept-open-queued", pkg: "orchestration", name: /["'`]queued["'`]/ },
  { id: "row-recorded", pkg: "orchestration", name: /undispatched/ },
  { id: "row-reopened", pkg: "orchestration", name: /["'`]reopened["'`]|\breopened\s*[:?]|\.reopened\b/ },
  { id: "row-post", pkg: "orchestration", name: /kind: "post"|["'`]post["'`]/ },
  { id: "tool-wait-for-user", pkg: "core", name: /waitForUser|RESUMED_UNDER_FORMER_NAME/ },
  { id: "engine-drain-timeout", pkg: "engine", name: /detachedDrainTimeoutMs/ },
  { id: "engine-list-limit", pkg: "engine", name: /maxWorkstreamListLimit/ },
  { id: "middleware", pkg: ["core", "engine"], name: /\bmiddleware\b/ },
  { id: "flow-work", pkg: "core", name: /`work`|"work"|\bwork:/, file: /defineFlow/ },
  { id: "expect-attempt", pkg: "orchestration", name: /expectAttempt/ },
  { id: "dispatch-mode", pkg: "orchestration", name: /\bmode\b/, file: /dispatch-assignee/ },
  { id: "skill-md-context", pkg: "orchestration", name: /\b(context|pattern)\b/, file: /skills\/(skill-md|run-skill-tool)/ },
  { id: "task-wait-fields", pkg: "orchestration", name: /waitForResponse|retired-name-refusal: question/ },
  { id: "wf-hop-limit", pkg: "workforce", name: /hopLimit/ },
  { id: "wf-hand-off-tool", pkg: "workforce", name: /\bhandOff\b|RETIRED_HAND_OFF/ },
  { id: "wf-hand-offs-state", pkg: "workforce", name: /\bhandOffs\b/ },
  { id: "wf-deliveries-state", pkg: "workforce", name: /\bdeliveries\s*[:?]|\.deliveries\b|RETIRED_DELIVERIES/ },
];

/** A published line that refuses or legacy-reads a retired name. */
const REFUSES_OR_READS = /removed|renamed|is now|retired|RETIRED|refus|was stored|legacy|former/i;

/** A line that is only a comment: prose about a name is not a read or a refusal. */
const COMMENT_LINE = /^\s*(\/\/|\/\*|\*)/;

/** A published file that is a legacy reader: every line in it reads an old shape. */
const READER_FILE = /retired-shapes\.(js|d\.ts)$/;

/**
 * Scan the installed packages' `dist` for a line that reads or refuses one of
 * {@link NEVER_PUBLISHED}: the name, on a code line that is a refusal or in a
 * legacy reader file. Comment-only lines (prose about a name) and source maps
 * are skipped; a trailing `// retired-name-refusal` marker on code still counts. A package that is not installed is a
 * failure (the probe cannot see it), not a pass.
 *
 * @param {string} nodeModules — the consumer project's `node_modules`.
 * @returns {string[]} failures, one per entry that still reads or refuses, with its first hit.
 */
export function probeNeverPublished(nodeModules, entries = NEVER_PUBLISHED) {
  const failures = [];
  const filesOf = new Map();
  const distFiles = (pkg) => {
    if (!filesOf.has(pkg)) {
      const dist = join(nodeModules, "@flow-state-dev", pkg, "dist");
      filesOf.set(pkg, existsSync(dist) ? walk(dist).filter((f) => /\.(m?js|d\.ts)$/.test(f)) : null);
    }
    return filesOf.get(pkg);
  };
  for (const entry of entries) {
    const pkgs = [entry.pkg].flat();
    const absent = pkgs.filter((p) => distFiles(p) == null);
    if (absent.length > 0) {
      failures.push(`${entry.id}: ${absent.map((p) => `@flow-state-dev/${p}`).join(", ")} has no installed dist to probe`);
      continue;
    }
    const files = pkgs.flatMap((p) => distFiles(p));
    let hit = null;
    for (const file of files) {
      if (entry.file && !entry.file.test(file)) continue;
      const reader = READER_FILE.test(file);
      const lines = readFileSync(file, "utf8").split("\n");
      const i = lines.findIndex(
        (l) => !COMMENT_LINE.test(l) && entry.name.test(l) && (reader || REFUSES_OR_READS.test(l)),
      );
      if (i >= 0) {
        hit = `${file.slice(file.indexOf("@flow-state-dev/"))}:${i + 1}: ${lines[i].trim().slice(0, 160)}`;
        break;
      }
    }
    if (hit) failures.push(`${entry.id}: ${hit}`);
  }
  return failures;
}

// ── closure.j5:moved-name-named ─────────────────────────────────────────────

/**
 * What an adopter upgrading package `pkg` from version `since` reads as its
 * changelog: the bullet and paragraph lines of every pending changeset whose
 * frontmatter names `pkg`, and of every `## x.y.z` section of its
 * `CHANGELOG.md` newer than `since`. Headings and blank lines are dropped.
 *
 * @param {string} pkg — `@flow-state-dev/<name>`
 * @param {{ changesets: string[], changelog: string | null, since: string }} sources
 * @returns {string[]}
 */
export function changelogLines(pkg, { changesets, changelog, since }) {
  const body = (text) => text.split("\n").filter((l) => l.trim() !== "" && !/^#/.test(l.trim()));
  const lines = [];
  for (const text of changesets) {
    const front = /^---\n([\s\S]*?)\n---\n?/.exec(text);
    if (!front) continue;
    const names = front[1].split("\n").map((l) => /^\s*["']?([^"':]+)["']?\s*:/.exec(l)?.[1]);
    if (names.includes(pkg)) lines.push(...body(text.slice(front[0].length)));
  }
  if (changelog) {
    let newer = false;
    for (const line of changelog.split("\n")) {
      const heading = /^##\s+(\d+\.\d+\.\d+)\s*$/.exec(line);
      if (heading) newer = compareVersions(heading[1], since) > 0;
      else if (newer) lines.push(...body(line));
    }
  }
  return lines;
}

function compareVersions(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i += 1) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

/**
 * The summary line: a changelog line saying how many exports the package roots
 * lost, as `1,078 unused exports … removed … roots`. The release notes carry one
 * such line for the whole removal, not a line per name. Returns the count it
 * states, or null when the line is not one.
 */
function summaryCount(line) {
  const m = /\b(\d{1,3}(?:,\d{3})+|\d+)\s+(?:unused\s+)?exports\b.*\bremoved\b.*\broots?\b/i.exec(line);
  return m ? Number(m[1].replaceAll(",", "")) : null;
}

/**
 * Grade the names a package root dropped between the version an adopter is
 * on and the tarballs under test. Each must fail to compile from the root,
 * and every package that dropped one must carry the summary line (see
 * {@link summaryCount}) stating the real total: a stale count tells an
 * upgrader less broke than did. No dropped name at all is a fail: a journey
 * that walked nothing proves nothing.
 *
 * @param {{ pkg: string, name: string, failsOnNew: boolean }[]} names
 * @param {Map<string, string[]>} linesByPackage — from {@link changelogLines}
 * @returns {string[]} failures
 */
export function gradeMovedNames(names, linesByPackage) {
  if (names.length === 0) return ["no package root dropped a name between the version upgraded from and these tarballs: the journey walked no name"];
  const failures = [];
  for (const { pkg, name, failsOnNew } of names)
    if (!failsOnNew) failures.push(`${pkg} ${name}: still compiles from the root on these tarballs`);
  for (const pkg of new Set(names.map((n) => n.pkg))) {
    const counts = (linesByPackage.get(pkg) ?? []).map(summaryCount).filter((c) => c != null);
    if (counts.length === 0) failures.push(`${pkg}: no changelog line says the ${names.length} exports removed from the package roots`);
    else if (!counts.includes(names.length))
      failures.push(`${pkg}: its changelog says ${counts.join(", ")} exports removed from the package roots; ${names.length} were`);
  }
  return failures;
}

/**
 * The planted control's input: a copy of the changelog lines with every
 * summary line removed.
 *
 * @returns {Map<string, string[]>}
 */
export function plantSummaryRemoval(linesByPackage) {
  return new Map([...linesByPackage].map(([pkg, lines]) => [pkg, lines.filter((l) => summaryCount(l) == null)]));
}

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

/**
 * One check's result, as `runChecks` reports it: a list of failures (empty is
 * `pass`), `{ pending: reason }` for a check that does not exist yet, or
 * `{ error: detail }` for one that could not run. Anything else is an `error`:
 * a check that returns nothing recognisable has not judged anything.
 *
 * @returns {{ outcome: "pass" | "fail" | "pending" | "error", detail: string[] }}
 */
export function outcomeOf(result) {
  if (Array.isArray(result))
    return result.length === 0 ? { outcome: "pass", detail: [] } : { outcome: "fail", detail: result.map(String) };
  if (result && typeof result.pending === "string") return { outcome: "pending", detail: [result.pending] };
  if (result && "error" in result) return { outcome: "error", detail: [String(result.error)] };
  return { outcome: "error", detail: [`check returned ${JSON.stringify(result)}`] };
}
