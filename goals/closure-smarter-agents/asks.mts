/**
 * The closure's seven asks as graders, and the rules that turn graded runs
 * into verdicts: 3 of 3 to pass in an app, a per-ask control, and the cut or
 * the wrap (the ask passes in every app it counts in, FIX-2541 D1).
 *
 * Each grader reads one recorded turn: what the worker answered, the tools
 * its turn called, and the records an app keeps beside it (the run record's
 * `checks`, a fold, a held skill). It never reads a layer's own output or
 * prompt text (epic ER-7, anti-game). The drivers that record a turn are the
 * four `<app>/run.mts`; `graders/run.mts` proves each grader refuses a hollow turn.
 *
 * Moved from the spec's POC (`specs/issues/FIX-2541/poc/closure-asks/`)
 * unchanged in shape, with three additions: checks are normalized once
 * ({@link checksFrom}), Kitchen Sink's multi-file ask grades pages read
 * ({@link gradePagesRead}), and which cells a pass grades is one table
 * ({@link cellsFor}).
 */
import { checkoutCommandPassed, type CheckoutCommandResult } from "@flow-state-dev/workspace";

/** One worker turn, as a driver records it from an app's public API. */
export interface Turn {
  /** The worker's reply text for this ask, every assistant message after the ask joined. */
  reply: string;
  /** Tool calls the turn made, in order, with their arguments, what each returned (as text), and whether it failed (`ok: false`). */
  tools: { name: string; input?: string; output?: string; ok?: boolean }[];
  /** How many requests the person sent to get this answer. One is "in one turn". */
  requests: number;
  /** Wall clock at the ask and at the last reply, read by the driver at run time. */
  askedAt: Date;
  answeredAt: Date;
  /** The coder leg only: the run record's `checks`, or the turn's when the app uses `verify`, through {@link checksFrom}. `null` is no record. */
  checks?: { command: string; ok: boolean }[] | null;
  /** The fold leg only: whether the session holds a summary fold before the last ask. */
  folded?: boolean;
  /** The skill leg only: the skill names the worker holds. */
  held?: string[];
}

/**
 * A run record's checks as the coder grader reads them: each command, and
 * whether it passed by the workspace's own rule (`checkoutCommandPassed`: not
 * skipped, not timed out, exit 0). Normalized once here, so no driver decides
 * what "passed" means. Anything that is not a list is no record.
 */
export function checksFrom(recorded: unknown): Turn["checks"] {
  if (!Array.isArray(recorded)) return null;
  return (recorded as CheckoutCommandResult[])
    .filter((check) => typeof check?.command === "string")
    .map((check) => ({ command: check.command, ok: checkoutCommandPassed(check) }));
}

/**
 * The tool calls a turn made that succeeded. Every grader that reads tool
 * calls reads them through this: a failed fetch, lookup or load is not a page
 * read, a source looked at or a skill loaded. A call with no `ok` is not
 * known to have succeeded, so it does not count either.
 */
function succeeded(turn: Turn): Turn["tools"] {
  return turn.tools.filter((t) => t.ok === true);
}

/** A grader's result for one run: empty is pass; each line is one named failure. */
export type Graded = string[];

/** What each ask's fixture hands its grader. Held out: another valid fixture must pass a correct app. */
export interface Fixtures {
  multiFile: { values: string[] };
  /** Kitchen Sink's multi-file ask: published doc pages that must each be fetched in the turn, and the facts they hold. */
  pages: { pages: string[]; facts: RegExp[] };
  knowledge: { minLookups: number };
  sizing: { answer: RegExp; maxWords: number };
  skill: { name: string; loadTool: RegExp; marker: string; asked: string };
  fold: { decision: string; rejected: string };
}

// ---------------------------------------------------------------------------
// The seven asks
// ---------------------------------------------------------------------------

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** Every calendar date a reply names, as y-m-d with the year when stated (0 when not). */
function datesIn(text: string): { y: number; m: number; d: number }[] {
  const found: { y: number; m: number; d: number }[] = [];
  for (const m of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) found.push({ y: +m[1]!, m: +m[2]!, d: +m[3]! });
  const month = `(${MONTHS.map((n) => `${n}|${n.slice(0, 3)}\\.?`).join("|")})`;
  // "November 4, 2026", "Nov 4", "4 November 2026"
  for (const m of text.matchAll(new RegExp(`\\b${month}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?`, "gi")))
    found.push({ y: m[3] ? +m[3] : 0, m: monthIndex(m[1]!), d: +m[2]! });
  for (const m of text.matchAll(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${month}(?:,?\\s+(\\d{4}))?`, "gi")))
    found.push({ y: m[3] ? +m[3] : 0, m: monthIndex(m[2]!), d: +m[1]! });
  return found;
}
const monthIndex = (name: string) => MONTHS.findIndex((n) => n.startsWith(name.toLowerCase().replace(".", "").slice(0, 3))) + 1;

/**
 * Date: the reply names today's date, read off the run's own wall clock (never
 * a seeded value), and names no other date as today. A turn that straddles
 * midnight may name either day.
 */
export function gradeDate(turn: Turn): Graded {
  const today = [turn.askedAt, turn.answeredAt].map((t) => ({ y: t.getFullYear(), m: t.getMonth() + 1, d: t.getDate() }));
  const named = datesIn(turn.reply);
  if (named.length === 0) return [`date: the reply names no date: ${clip(turn.reply)}`];
  const isToday = (x: { y: number; m: number; d: number }) => today.some((t) => t.m === x.m && t.d === x.d && (x.y === 0 || x.y === t.y));
  if (!named.some(isToday)) return [`date: the reply names ${fmt(named[0]!)}, not today (${fmt(today[0]!)})`];
  const other = named.find((x) => !isToday(x));
  return other === undefined ? [] : [`date: the reply also names ${fmt(other)}`];
}

/** Multi-file: one request, and every value the fixture planted across several files is in the reply. */
export function gradeMultiFile(turn: Turn, fx: Fixtures["multiFile"]): Graded {
  const out: Graded = [];
  if (turn.requests !== 1) out.push(`multi-file: took ${turn.requests} requests, not one turn`);
  const missing = fx.values.filter((v) => !turn.reply.includes(v));
  if (missing.length > 0) out.push(`multi-file: the reply lacks ${missing.join(", ")} (of ${fx.values.length} values in separate files)`);
  return out;
}

/** The path a fetch call's `url` argument names, without a trailing slash; `undefined` when it names none. */
function fetchedPath(input: string | undefined): string | undefined {
  try {
    const url = (JSON.parse(input ?? "") as { url?: unknown }).url;
    return typeof url === "string" ? new URL(url).pathname.replace(/\/+$/, "") : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Multi-file, where no fresh value can be planted (Kitchen Sink's published
 * docs): one request, every page the answer needs was fetched in this turn,
 * and the reply states each fact. A page counts as read only when a call of
 * `fetchTool` (the app's page-fetch tool, named by its driver) succeeded with
 * that page as its `url`; a search that mentions the page reads nothing. A
 * fact the worker knew without reading fails on the fetch.
 */
export function gradePagesRead(turn: Turn, fx: Fixtures["pages"], fetchTool: string): Graded {
  const out: Graded = [];
  if (turn.requests !== 1) out.push(`multi-file: took ${turn.requests} requests, not one turn`);
  const fetched = new Set(
    succeeded(turn)
      .filter((t) => t.name === fetchTool)
      .map((t) => fetchedPath(t.input)),
  );
  const unread = fx.pages.filter((page) => !fetched.has(page));
  if (unread.length > 0) out.push(`multi-file: the turn never fetched ${unread.join(", ")} (of ${fx.pages.length} pages)`);
  const unsaid = fx.facts.filter((fact) => !fact.test(turn.reply));
  if (unsaid.length > 0) out.push(`multi-file: the reply lacks ${unsaid.map(String).join(", ")}: ${clip(turn.reply)}`);
  return out;
}

/** Code spans in a report that read as a command (`pnpm …`, `node …`, …): the only way a report can name a check the record lacks. */
function commandSpans(report: string): string[] {
  const runner = /^(?:pnpm|npm|npx|yarn|node|tsc|vitest|make|pytest|cargo|go)\b/;
  return [...new Set([...report.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]!.trim()).filter((c) => runner.test(c)))];
}
const norm = (c: string) => c.replace(/\s+/g, " ").trim();

/**
 * Coder, graded from the record outward, and only against a false success:
 *
 * - The report names at least one check the run recorded, and every command
 *   it names in a code span is one the run recorded.
 * - A recorded check that passed never fails on the report's wording.
 * - A recorded check that failed is acknowledged: the report names it in a
 *   sentence with a failure word that is not negated ("failed", not "no
 *   errors"), or the report makes no claim that it passed.
 *
 * Prose is never parsed into a command. A `null` record fails.
 */
export function gradeCoder(turn: Turn): Graded {
  if (turn.checks == null) return ["coder: the run recorded no checks (null)"];
  const report = norm(turn.reply);
  const out: Graded = [];
  for (const span of commandSpans(turn.reply)) {
    if (!turn.checks.some((c) => norm(c.command) === norm(span) || norm(c.command).endsWith(norm(span)))) out.push(`coder: the report names \`${span}\`, which did not run`);
  }
  const named = turn.checks.filter((c) => report.includes(norm(c.command)));
  for (const failed of turn.checks.filter((c) => !c.ok)) {
    const owned = sentencesNaming(turn.reply, norm(failed.command)).some(saysFailed);
    if (!owned && CLAIMS_PASS.test(turn.reply)) out.push(`coder: \`${failed.command}\` failed, and the report claims a pass without saying so`);
  }
  if (named.length === 0 && out.length === 0) out.push(`coder: the report names no check the run recorded: ${clip(turn.reply)}`);
  return out;
}

/** Wording that claims a check passed. Read only to catch a false success, never to fail a true one. */
const CLAIMS_PASS = /\b(?:pass(?:es|ed|ing)?|green|succeed(?:s|ed)?|all good)\b|✓/i;

/** The report's sentences that name `command`, whitespace normalized. */
function sentencesNaming(report: string, command: string): string[] {
  return report
    .split(/(?<=[.!?\n])\s+/)
    .map(norm)
    .filter((s) => s.includes(command));
}

/** Whether a sentence says a check failed: a failure word not negated ("2 errors", not "no errors"). */
function saysFailed(sentence: string): boolean {
  for (const m of sentence.matchAll(/\b(?:fail(?:s|ed|ing|ure)?|errors?|broke|red|did(?: not|n't) pass)\b/gi)) {
    if (!/\b(?:no|without|zero|0)\s+$/i.test(sentence.slice(0, m.index))) return true;
  }
  return false;
}

/**
 * Knowledge: the turn looked several things up, and the reply cites a source
 * (a URL or a path) that one of its lookups returned. A source the worker
 * never looked at does not count, and neither does one a failed lookup asked
 * for: only a lookup that succeeded (its address, or what it returned) counts.
 */
export function gradeKnowledge(turn: Turn, fx: Fixtures["knowledge"]): Graded {
  const out: Graded = [];
  const lookups = succeeded(turn);
  if (lookups.length < fx.minLookups) out.push(`knowledge: ${lookups.length} lookups that succeeded, the ask needs ${fx.minLookups}`);
  const cited = [...turn.reply.matchAll(/https?:\/\/[^\s)>\]]+|(?:\/|\b)[\w.-]+(?:\/[\w.-]+)+\.(?:md|mdx|ts|tsx|txt)\b/g)].map((m) => m[0].replace(/[.,]$/, ""));
  if (cited.length === 0) return [...out, `knowledge: the reply cites no source: ${clip(turn.reply)}`];
  const seen = lookups.map((t) => `${t.input ?? ""}\n${t.output ?? ""}`).join("\n");
  if (!cited.some((c) => seen.includes(c))) out.push(`knowledge: the reply cites ${cited.slice(0, 3).join(", ")}, none of which a lookup returned`);
  return out;
}

/** Sizing: a one-line question gets the right answer in at most `maxWords` words. */
export function gradeSizing(turn: Turn, fx: Fixtures["sizing"]): Graded {
  const out: Graded = [];
  const words = turn.reply.trim().split(/\s+/).filter(Boolean).length;
  if (!fx.answer.test(turn.reply)) out.push(`sizing: the reply lacks the answer: ${clip(turn.reply)}`);
  if (words > fx.maxWords) out.push(`sizing: ${words} words, over ${fx.maxWords}`);
  return out;
}

/**
 * Skill: precondition first, the worker holds the fitting skill. Then the
 * ask names no slash, the turn called the load tool for that skill, and the
 * reply carries the marker only the skill's body holds.
 */
export function gradeSkill(turn: Turn, fx: Fixtures["skill"]): Graded {
  if (!(turn.held ?? []).includes(fx.name)) return [`skill: precondition: the worker does not hold ${fx.name}`];
  const out: Graded = [];
  if (/(^|\s)\//.test(fx.asked)) out.push("skill: the ask has a slash; the fixture is wrong");
  if (!succeeded(turn).some((t) => fx.loadTool.test(t.name) && (t.input ?? "").includes(fx.name))) out.push(`skill: no load of ${fx.name}`);
  if (!turn.reply.includes(fx.marker)) out.push(`skill: the reply lacks the skill's marker`);
  return out;
}

/** Fold: precondition first, a summary fold ran before the last ask. Then the reply follows the decision, not the one it replaced. */
export function gradeFold(turn: Turn, fx: Fixtures["fold"]): Graded {
  if (turn.folded !== true) return ["fold: precondition: no summary fold in the run record"];
  const out: Graded = [];
  if (!turn.reply.includes(fx.decision)) out.push(`fold: the reply does not use the decision (${fx.decision})`);
  if (turn.reply.includes(fx.rejected)) out.push(`fold: the reply uses the rejected option (${fx.rejected})`);
  return out;
}

// ---------------------------------------------------------------------------
// From runs to verdicts
// ---------------------------------------------------------------------------

export type Ask = "date" | "multiFile" | "coder" | "knowledge" | "sizing" | "skill" | "fold";
export type App = "claude-code-style" | "teammates" | "kitchen-sink" | "shift-manager";
export const ALL_APPS: readonly App[] = ["claude-code-style", "teammates", "kitchen-sink", "shift-manager"];
export const ASKS: readonly Ask[] = ["date", "multiFile", "coder", "knowledge", "sizing", "skill", "fold"];
/** The three passes the same scripts run: the control (pre-bug main), the cut run (after the bugs), the wrap (after every child). */
export type Pass = "control" | "cut" | "wrap";
export const RUNS = 3;

/**
 * Where each ask runs, and so which cells a pass grades, in one table. The
 * fold runs in the two labs only (epic Q1). The Claude Code-style lab has no
 * fold to switch on, so on the control and the cut run the fold counts on
 * Teammates alone; that lab runs it at the wrap, where the default must carry
 * it (the open fork in FIX-2541's DECISIONS, as the owner decided it).
 */
export function cellsFor(pass: Pass, ask: Ask): readonly App[] {
  if (ask !== "fold") return ALL_APPS;
  return pass === "wrap" ? ["claude-code-style", "teammates"] : ["teammates"];
}

/** Each run's graded failures, by ask and app. A missing cell is a run that never happened. */
export type Sheet = Partial<Record<Ask, Partial<Record<App, Graded[]>>>>;

/** An ask passes in an app only on 3 of 3 runs. Fewer than 3 recorded runs is not a pass. */
export function passesIn(sheet: Sheet, ask: Ask, app: App): boolean {
  const runs = sheet[ask]?.[app] ?? [];
  return runs.length === RUNS && runs.every((r) => r.length === 0);
}

/** The control holds for an ask when at least one run fails in at least one app it counts in (ER-7). */
export function controlFails(sheet: Sheet, ask: Ask): boolean {
  return cellsFor("control", ask).some((app) => (sheet[ask]?.[app] ?? []).some((r) => r.length > 0));
}

/** The cut (on the cut run) and the pass (at the wrap): the ask passes 3 of 3 in every app it counts in (D1). */
export function passesEverywhere(sheet: Sheet, ask: Ask, pass: Exclude<Pass, "control">): boolean {
  return cellsFor(pass, ask).every((app) => passesIn(sheet, ask, app));
}

/**
 * Why a pass's sheet does not cover the pass: each cell it counts
 * ({@link cellsFor}) that is missing, or holds other than {@link RUNS} runs.
 * Read before any pass's own rule, so no verdict stands on a short pass (a
 * `GOAL_RUNS=1` control, an app never run). Empty when every cell is whole.
 */
export function coverageProblems(sheet: Sheet, pass: Pass): string[] {
  const out: string[] = [];
  for (const ask of ASKS) {
    for (const app of cellsFor(pass, ask)) {
      const runs = sheet[ask]?.[app];
      if (runs === undefined) out.push(`${ask} in ${app}: no runs`);
      else if (runs.length !== RUNS) out.push(`${ask} in ${app}: ${runs.length} runs, the pass needs ${RUNS}`);
    }
  }
  return out;
}

/** Each graded result's app, ask, and the commit and models it ran on, as a sheet file records them. */
export type SheetStamp = { app: App; ask: Ask; commit?: string; model?: string };

/**
 * Why a pass's sheets can't be read as one pass on one model: a result with
 * no model recorded, or results on more than one (`model.mts` →
 * `ClosureModel`). Empty when every result ran on the same model.
 */
export function sheetModelProblems(stamps: readonly SheetStamp[]): string[] {
  const out: string[] = [];
  const models = new Set(stamps.map((s) => s.model ?? "(none)"));
  if (models.size > 1) out.push(`the sheets mix ${models.size} models: ${[...models].join(", ")}`);
  for (const s of stamps) if (s.model === undefined) out.push(`${s.app} ${s.ask}: no model recorded`);
  return out;
}

/**
 * Why a pass's sheets can't be read as one pass: a result with no commit, a
 * result from another commit than the pass's (`expected`, a resolved SHA),
 * or results from more than one commit. Empty when every result ran on
 * `expected`.
 */
export function sheetCommitProblems(stamps: readonly SheetStamp[], expected: string): string[] {
  const out: string[] = [];
  const commits = new Set(stamps.map((s) => s.commit ?? "(none)"));
  if (commits.size > 1) out.push(`the sheets mix ${commits.size} commits: ${[...commits].map((c) => c.slice(0, 9)).join(", ")}`);
  for (const s of stamps) {
    if (s.commit === undefined) out.push(`${s.app} ${s.ask}: no commit recorded`);
    else if (s.commit !== expected) out.push(`${s.app} ${s.ask}: ran on ${s.commit.slice(0, 9)}, not the pass's ${expected.slice(0, 9)}`);
  }
  return out;
}

const clip = (s: string) => JSON.stringify(s.slice(0, 160));
const fmt = (x: { y: number; m: number; d: number }) => `${x.y || "????"}-${String(x.m).padStart(2, "0")}-${String(x.d).padStart(2, "0")}`;

// ---------------------------------------------------------------------------
// The sweep
// ---------------------------------------------------------------------------

/**
 * Guidance an app must not write for itself once the defaults carry it (epic
 * ER-3): today's date and "check before done". How long to answer is not
 * swept: FIX-2498's behaviour section was cut, so no default replaces an
 * app's own length line. Matched on a WORKER.md's text with its line breaks
 * folded, so a phrase split across lines is still found.
 */
const APP_GUIDANCE: readonly [kind: string, pattern: RegExp][] = [
  ["date", /\b(?:today'?s date|the current date|the date (?:is|today))\b/i],
  ["done", /\b(?:before (?:you )?(?:say|report|call)(?: it)?(?: is)? done|run the (?:checks|tests) before)\b/i],
];

/** Each app-written guidance line found in `files` (path → WORKER.md text), as `path: kind ("phrase")`. */
export function sweepGuidance(files: Record<string, string>): string[] {
  const found: string[] = [];
  for (const [path, text] of Object.entries(files)) {
    const folded = text.replace(/\s+/g, " ");
    for (const [kind, pattern] of APP_GUIDANCE) {
      const hit = pattern.exec(folded);
      if (hit !== null) found.push(`${path}: ${kind} ("${hit[0]}")`);
    }
  }
  return found;
}
