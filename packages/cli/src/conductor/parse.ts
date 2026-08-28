/**
 * Parse an operator line — slash command in the TUI, or a headless argv.
 *
 * Two doors, one vocabulary. A command the TUI cannot name is a command the
 * headless path cannot run, and the other way around.
 */
import type { OperatorCommand } from "./types";

export type ParseOk = { ok: true; command: OperatorCommand };
export type ParseErr = { ok: false; message: string };
export type ParseResult = ParseOk | ParseErr;

const VERBS = new Set([
  "status",
  "seed",
  "wake",
  "answer",
  "watch",
  "start",
  "abort",
  "stop",
  "help",
  "quit",
  "q",
  "refresh",
  "find",
]);

/**
 * Verbs the TUI slash menu offers. Aliases (`q`, `stop`) stay parseable
 * but are not listed — one name per action.
 */
export const SLASH_VERBS = [
  "status",
  "seed",
  "wake",
  "answer",
  "watch",
  "start",
  "abort",
  "find",
  "help",
  "quit",
  "refresh",
] as const;

/** Verbs that cannot run with only a name — completion leaves a trailing space. */
export const SLASH_NEEDS_ARG = new Set(["seed", "start", "answer"]);

/**
 * Verbs whose first argument is an id already on the board. `seed` /
 * `start` file a new issue — they are not completed from existing rows.
 */
export const SLASH_TAKES_ID = new Set(["status", "watch", "abort", "stop", "answer"]);

export const SLASH_HINTS: Record<(typeof SLASH_VERBS)[number], string> = {
  status: "refresh, or jump to a row",
  seed: "file and start an issue",
  wake: "process pending rows",
  answer: "reply to a question",
  watch: "refresh; headless waits until waiting or done",
  start: "seed, then stay on the board",
  abort: "stop a running request",
  find: "search this row's transcript",
  help: "this help",
  quit: "leave the board",
  refresh: "poll status now",
};

/**
 * Prefix of an in-progress slash verb, or `null` once a space starts the
 * arguments. `/sta` → `"sta"`; `/status FIX` → `null`.
 */
export function slashPrefix(input: string): string | null {
  if (!input.startsWith("/")) return null;
  const body = input.slice(1);
  if (body.includes(" ") || body.includes("\t")) return null;
  return body.toLowerCase();
}

/** Slash verbs whose names start with the in-progress prefix, registry order. */
export function slashMatches(input: string): string[] {
  const prefix = slashPrefix(input);
  if (prefix === null) return [];
  return SLASH_VERBS.filter((verb) => verb.startsWith(prefix));
}

/**
 * First-argument completion. `/status FIX` → `{ verb: "status", prefix: "fix" }`.
 * `null` while the verb is still being typed, after a second argument, or
 * for a verb that does not take a board id.
 */
export function slashArgPrefix(input: string): { verb: string; prefix: string } | null {
  if (!input.startsWith("/")) return null;
  const match = /^\/(\S+)(\s+)(.*)$/.exec(input);
  if (match === null) return null;
  const verb = match[1]!.toLowerCase();
  if (!SLASH_TAKES_ID.has(verb)) return null;
  const rest = match[3]!;
  if (/\s/.test(rest)) return null;
  return { verb, prefix: rest.toLowerCase() };
}

function splitWords(line: string): string[] {
  const words: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  for (const ch of line) {
    if (quote !== null) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }
    if ((ch === '"' || ch === "'") && current === "") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current !== "") {
        words.push(current);
        current = "";
      }
      continue;
    }
    current += ch;
  }
  if (current !== "") words.push(current);
  return words;
}

/** Pull CLI flags off an already-tokenized argv. `--` ends flag eating. */
function takeCliFlags(argv: string[]): { json: boolean; words: string[] } {
  const words: string[] = [];
  let json = false;
  let raw = false;
  for (const w of argv) {
    if (!raw && w === "--") {
      raw = true;
      continue;
    }
    if (!raw && w === "--json") {
      json = true;
      continue;
    }
    words.push(w);
  }
  return { json, words };
}

function parseWords(words: string[]): ParseResult {
  const verb = (words[0] ?? "").toLowerCase();
  if (!VERBS.has(verb)) {
    return { ok: false, message: `unknown command: ${words[0]}` };
  }

  switch (verb) {
    case "help":
      return { ok: true, command: { kind: "help" } };
    case "quit":
    case "q":
      return { ok: true, command: { kind: "quit" } };
    case "refresh":
      return { ok: true, command: { kind: "refresh" } };
    case "find": {
      const query = words.slice(1).join(" ").trim();
      return { ok: true, command: { kind: "find", ...(query !== "" ? { query } : {}) } };
    }
    case "wake":
      return { ok: true, command: { kind: "wake" } };
    case "status":
      return { ok: true, command: { kind: "status", ...(words[1] !== undefined ? { issue: words[1] } : {}) } };
    case "watch":
      return { ok: true, command: { kind: "watch", ...(words[1] !== undefined ? { issue: words[1] } : {}) } };
    case "abort":
    case "stop":
      return {
        ok: true,
        command: { kind: "abort", ...(words[1] !== undefined ? { issue: words[1] } : {}) },
      };
    case "seed":
    case "start": {
      const issue = words[1];
      if (issue === undefined || issue === "") {
        return { ok: false, message: `${verb} needs an issue id` };
      }
      const phaseFlag = flagValue(words, "--phase");
      return {
        ok: true,
        command: {
          kind: verb,
          issue,
          ...(phaseFlag !== undefined ? { phase: phaseFlag } : {}),
        },
      };
    }
    case "answer": {
      const question = words[1];
      const rest = words.slice(2);
      const textWords = rest[0] === "--" ? rest.slice(1) : rest;
      const text = textWords.join(" ").trim();
      if (question === undefined || question === "") {
        return { ok: false, message: "answer needs a question id" };
      }
      if (text === "") {
        return { ok: false, message: "answer needs a reply" };
      }
      return { ok: true, command: { kind: "answer", question, text } };
    }
    default:
      return { ok: false, message: `unknown command: ${verb}` };
  }
}

/**
 * Parse a slash command or a bare verb line.
 *
 * `/seed FIX-1`, `seed FIX-1`, `/answer QID the text` are the same command.
 * A line that is not a verb is not a command — the key reducer decides
 * whether that means "compose an answer" or "unknown".
 */
export function parseCommand(line: string): ParseResult {
  const trimmed = line.trim();
  if (trimmed === "") return { ok: false, message: "empty command" };
  const body = trimmed.startsWith("/") ? trimmed.slice(1).trim() : trimmed;
  if (body === "") return { ok: false, message: "empty command" };
  return parseWords(splitWords(body));
}

function flagValue(words: string[], flag: string): string | undefined {
  const at = words.indexOf(flag);
  if (at < 0) return undefined;
  const value = words[at + 1];
  return value === undefined || value.startsWith("--") ? undefined : value;
}

/** How the process was invoked. */
export type Invocation =
  | { mode: "tui"; issue?: string }
  | { mode: "headless"; command: OperatorCommand; json: boolean };

/**
 * Parse process argv after the binary name.
 *
 * No verb (or `tui`) opens the fullscreen surface. Any other verb runs
 * headless and prints, then exits — the scripting door Grok Build calls `-p`.
 */
export function parseArgv(argv: string[]): ParseResult & { invocation?: Invocation } {
  const { json, words } = takeCliFlags(argv);
  if (words.length === 0 || words[0] === "tui") {
    const issue = words[0] === "tui" ? words[1] : undefined;
    return {
      ok: true,
      command: { kind: "status", ...(issue !== undefined ? { issue } : {}) },
      invocation: { mode: "tui", ...(issue !== undefined ? { issue } : {}) },
    };
  }
  if (words[0] === "--help" || words[0] === "-h") {
    return { ok: true, command: { kind: "help" }, invocation: { mode: "headless", command: { kind: "help" }, json } };
  }
  const parsed = parseWords(words);
  if (!parsed.ok) return parsed;
  return { ...parsed, invocation: { mode: "headless", command: parsed.command, json } };
}

export const HELP_TEXT = `fsdev conductor — drive a conductor flow from the terminal

Uses the same runtime as fsdev run / fsdev chat (fsdev.config.*, stores,
drain budget). seed, wake, status, and answer are flow actions; abort
stops a running request. The board is whatever status returns.

Interactive:
  fsdev conductor                 fullscreen board, live poll, slash commands
  fsdev conductor tui [issue]     same, optionally focused on one issue

Headless (scripting):
  fsdev conductor status [issue]
  fsdev conductor seed <issue> [--phase implement]
  fsdev conductor start <issue>   seed, then open the TUI
  fsdev conductor wake
  fsdev conductor abort [issue]   stop the running request on those rows
  fsdev conductor answer <question-id> <reply…>
  fsdev conductor watch [issue]   poll status until waiting or terminal
  fsdev conductor help

In the TUI:
  j/k or ↑/↓   select a row (click a row)
  PgUp/PgDn    scroll the transcript (wheel and Ctrl-u/d too)
  [/]          previous/next question on the row
  a            answer the selected question
  s            seed a new issue
  w            wake
  r            refresh now (runs status)
  t            expand or collapse the todo list on a running row
  f            expand or collapse the file list on the selected row
  h            expand or collapse the last Write / Edit hunk
  H            older Write / Edit hunk on the same run
  /            slash command (same verbs)
  Tab          complete the selected slash verb or board id
  ↑/↓          choose a slash match while / is open
  /status id   select that row, then refresh
  /find [text] search the selected row's transcript
  n / N        older / newer match
  ?            this help
  q            quit

  A row with an open question: just type. Enter sends, Esc cancels.
  The ASK band keeps that attempt's files, current todo, PR URL, and token counts.
  A row that failed: the FAIL band holds the reason and that attempt's files. w runs wake again.
  A running row: the RUN band holds the checkout and what the run is
  doing. t expands the todo list. h expands the last hunk. H steps to an older hunk. x or Ctrl-C stops it.
  While working, type an answer; Enter queues it.
  A finished row keeps that attempt's files, todo list, and request id.
  The transcript tails that run's request stream.

Flags: --json  --phase <name>  --user <id>  --session <id>  --config <path>
       --flow-dir  --dotenv  --quiet  --log-level`;
