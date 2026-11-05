/**
 * FIX-2541 spec POC: the closure's seven asks as graders, and the rules that
 * turn graded runs into verdicts (3 of 3 to pass, a per-ask control, the cut).
 *
 * Retained design evidence, not production code. Each grader reads one
 * recorded turn: what the worker answered, the tools its turn called, and
 * the records an app keeps beside it (the run record's `checks`, a fold, a
 * held skill). It never reads a child's own output (epic ER-7, anti-game).
 *
 * The per-app drivers that record a turn are not here yet; see README.md.
 */

/** One worker turn, as a driver records it from an app's public API. */
export interface Turn {
  /** The worker's reply text for this ask, every assistant message after the ask joined. */
  reply: string;
  /** Tool calls the turn made, in order, with what each returned (as text). */
  tools: { name: string; input?: string; output?: string }[];
  /** How many requests the ask took to answer. One is "in one turn". */
  requests: number;
  /** Wall clock at the ask and at the last reply, read by the driver at run time. */
  askedAt: Date;
  answeredAt: Date;
  /** The coder leg only: the run record's `checks`, or the turn's when the app uses `verify`. `null` is no record. */
  checks?: { command: string; ok: boolean }[] | null;
  /** The fold leg only: whether the run record holds a summary fold before the last ask. */
  folded?: boolean;
  /** The skill leg only: the skill names the worker holds. */
  held?: string[];
}

/** A grader's result for one run: empty is pass; each line is one named failure. */
export type Graded = string[];

/** What each ask's fixture hands its grader. Held out: another valid fixture must pass a correct app. */
export interface Fixtures {
  multiFile: { values: string[] };
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
export function datesIn(text: string): { y: number; m: number; d: number }[] {
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

/** The commands a coder's report names: inline code spans, and bare `pnpm|npm|node|…` lines. */
export function commandsNamed(report: string): string[] {
  const spans = [...report.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]!.trim());
  const bare = [...report.matchAll(/\b((?:pnpm|npm|npx|yarn|node|tsc|vitest|make|pytest|cargo|go)\b[^\n`.,;:)]*)/g)].map((m) => m[1]!.trim());
  const runner = /^(?:pnpm|npm|npx|yarn|node|tsc|vitest|make|pytest|cargo|go)\b/;
  return [...new Set([...spans, ...bare].filter((c) => runner.test(c)))];
}
const norm = (c: string) => c.replace(/\s+/g, " ").trim();

/**
 * Coder: the report names at least one check, and each check it names is in
 * the record with the outcome the report gives it. A `null` record fails.
 */
export function gradeCoder(turn: Turn): Graded {
  if (turn.checks == null) return ["coder: the run recorded no checks (null)"];
  const named = commandsNamed(turn.reply);
  if (named.length === 0) return [`coder: the report names no check: ${clip(turn.reply)}`];
  const out: Graded = [];
  for (const command of named) {
    const ran = turn.checks.find((c) => norm(c.command) === norm(command) || norm(c.command).endsWith(norm(command)));
    if (ran === undefined) {
      out.push(`coder: the report names \`${command}\`, which did not run`);
      continue;
    }
    const said = outcomeSaid(turn.reply, command);
    if (said === undefined) out.push(`coder: the report names \`${command}\` but not its result`);
    else if (said !== ran.ok) out.push(`coder: the report says \`${command}\` ${said ? "passed" : "failed"}; it ${ran.ok ? "passed" : "failed"}`);
  }
  return out;
}
/** The outcome the sentence naming `command` gives it, if any. */
function outcomeSaid(report: string, command: string): boolean | undefined {
  const sentence = report.split(/(?<=[.!?\n])\s+/).find((s) => s.includes(command));
  if (sentence === undefined) return undefined;
  if (/\b(fail(?:s|ed|ing)?|red|error(?:s|ed)?|broke)\b/i.test(sentence)) return false;
  if (/\b(pass(?:es|ed)?|green|ok|succeed(?:s|ed)?|clean)\b|✓/i.test(sentence)) return true;
  return undefined;
}

/**
 * Knowledge: the turn looked several things up, and the reply cites a source
 * (a URL or a path) that one of its lookups returned. A source the worker
 * never looked at does not count.
 */
export function gradeKnowledge(turn: Turn, fx: Fixtures["knowledge"]): Graded {
  const out: Graded = [];
  if (turn.tools.length < fx.minLookups) out.push(`knowledge: ${turn.tools.length} lookups, the ask needs ${fx.minLookups}`);
  const cited = [...turn.reply.matchAll(/https?:\/\/[^\s)>\]]+|(?:\/|\b)[\w.-]+(?:\/[\w.-]+)+\.(?:md|mdx|ts|tsx)\b/g)].map((m) => m[0].replace(/[.,]$/, ""));
  if (cited.length === 0) return [...out, `knowledge: the reply cites no source: ${clip(turn.reply)}`];
  const seen = turn.tools.map((t) => `${t.input ?? ""}\n${t.output ?? ""}`).join("\n");
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
  if (!turn.tools.some((t) => fx.loadTool.test(t.name) && (t.input ?? "").includes(fx.name))) out.push(`skill: no load of ${fx.name}`);
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
/** Where each ask runs: the fold in the two labs only (epic Q1). */
export const RUNS_IN: Record<Ask, App[]> = {
  date: ["claude-code-style", "teammates", "kitchen-sink", "shift-manager"],
  multiFile: ["claude-code-style", "teammates", "kitchen-sink", "shift-manager"],
  coder: ["claude-code-style", "teammates", "kitchen-sink", "shift-manager"],
  knowledge: ["claude-code-style", "teammates", "kitchen-sink", "shift-manager"],
  sizing: ["claude-code-style", "teammates", "kitchen-sink", "shift-manager"],
  skill: ["claude-code-style", "teammates", "kitchen-sink", "shift-manager"],
  fold: ["claude-code-style", "teammates"],
};
export const RUNS = 3;

/** Each run's graded failures, by ask and app. A missing cell is a run that never happened. */
export type Sheet = Partial<Record<Ask, Partial<Record<App, Graded[]>>>>;

/** An ask passes in an app only on 3 of 3 runs. Fewer than 3 recorded runs is not a pass. */
export function passesIn(sheet: Sheet, ask: Ask, app: App): boolean {
  const runs = sheet[ask]?.[app] ?? [];
  return runs.length === RUNS && runs.every((r) => r.length === 0);
}

/** The control holds for an ask when at least one run fails in at least one app where it runs (ER-7). */
export function controlFails(sheet: Sheet, ask: Ask): boolean {
  return RUNS_IN[ask].some((app) => (sheet[ask]?.[app] ?? []).some((r) => r.length > 0));
}

/** The pass for the wrap, and the cut for the cut run: the ask passes in every app where it runs (D1). */
export function passesEverywhere(sheet: Sheet, ask: Ask): boolean {
  return RUNS_IN[ask].every((app) => passesIn(sheet, ask, app));
}

const clip = (s: string) => JSON.stringify(s.slice(0, 160));
const fmt = (x: { y: number; m: number; d: number }) => `${x.y || "????"}-${String(x.m).padStart(2, "0")}-${String(x.d).padStart(2, "0")}`;
