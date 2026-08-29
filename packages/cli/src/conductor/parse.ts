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
  "steer",
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
  "steer",
  "watch",
  "start",
  "abort",
  "find",
  "help",
  "quit",
  "refresh",
] as const;

/** Verbs that cannot run with only a name — completion leaves a trailing space. */
export const SLASH_NEEDS_ARG = new Set(["seed", "start", "answer", "steer"]);

/**
 * Verbs whose first argument is an id already on the board. `seed` /
 * `start` file a new issue — they are not completed from existing rows.
 */
export const SLASH_TAKES_ID = new Set(["status", "watch", "abort", "stop", "answer"]);

export const SLASH_HINTS: Record<(typeof SLASH_VERBS)[number], string> = {
  status: "refresh, or jump to a row",
  seed: "file an issue; more words are the brief",
  wake: "process pending rows",
  answer: "reply to a question",
  steer: "talk to the coordinator",
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

function parseWords(words: string[], options?: { slashed?: boolean; raw?: string }): ParseResult {
  const verb = (words[0] ?? "").toLowerCase();
  if (verb === "steer") {
    const message = words.slice(1).join(" ").trim();
    if (message === "") return { ok: false, message: "steer needs a message" };
    return { ok: true, command: { kind: "steer", message } };
  }
  if (!VERBS.has(verb)) {
    if (options?.slashed === true) {
      return { ok: false, message: `unknown command: ${words[0]}` };
    }
    const message = (options?.raw ?? words.join(" ")).trim();
    if (message === "") return { ok: false, message: "empty command" };
    return { ok: true, command: { kind: "steer", message } };
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
      const tail = takeSeedTail(words.slice(2));
      return {
        ok: true,
        command: {
          kind: verb,
          issue,
          ...tail,
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
 * A line that is not a verb, and did not start with `/`, is talk — the
 * coordinator turn. A slashed unknown name is still a typo.
 */
export function parseCommand(line: string): ParseResult {
  const trimmed = line.trim();
  if (trimmed === "") return { ok: false, message: "empty command" };
  const slashed = trimmed.startsWith("/");
  const body = slashed ? trimmed.slice(1).trim() : trimmed;
  if (body === "") return { ok: false, message: "empty command" };
  return parseWords(splitWords(body), { slashed, raw: body });
}

/**
 * After the issue id: `--phase` is a flag, `--` starts a literal brief,
 * and every other word is the ticket attempt 1 reads.
 */
function takeSeedTail(rest: string[]): { phase?: string; brief?: string } {
  const kept: string[] = [];
  let phase: string | undefined;
  let raw = false;
  for (let i = 0; i < rest.length; i++) {
    const word = rest[i]!;
    if (!raw && word === "--") {
      raw = true;
      continue;
    }
    if (!raw && word === "--phase") {
      const value = rest[i + 1];
      if (value !== undefined && !value.startsWith("--")) {
        phase = value;
        i += 1;
      }
      continue;
    }
    kept.push(word);
  }
  const brief = kept.join(" ").trim();
  return {
    ...(phase !== undefined ? { phase } : {}),
    ...(brief !== "" ? { brief } : {}),
  };
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
  const parsed = parseWords(words, { raw: words.join(" ") });
  if (!parsed.ok) return parsed;
  return { ...parsed, invocation: { mode: "headless", command: parsed.command, json } };
}

export const HELP_TEXT = `fsdev conductor — drive a conductor flow from the terminal

Uses the same runtime as fsdev run / fsdev chat (fsdev.config.*, stores,
drain budget). seed, wake, status, answer, and steer are flow actions; abort
stops a running request. The board is whatever status returns.

Interactive:
  fsdev conductor                 fullscreen board; type to talk, or /seed /wake
  fsdev conductor tui [issue]     same, optionally focused on one issue

Headless (scripting):
  fsdev conductor status [issue]  running rows print current action; a named issue also prints last tool, files, hunk, todo; a running row prints last-write age; --json adds now/files/hunk/todo on those same rows
  fsdev conductor seed <issue> [--phase implement] [brief…]
  fsdev conductor start <issue> [brief…]  seed, then open the TUI
  fsdev conductor wake
  fsdev conductor abort [issue]   stop the running request on those rows
  fsdev conductor answer <question-id> <reply…>
  fsdev conductor steer <message…>
  fsdev conductor watch [issue]   named issue prints the same attempt strip
  fsdev conductor help

In the TUI:
  ↑/↓          select a row (click a row)
  A long board shows eight rows around the selection so the prompt stays on screen.
  PgUp/PgDn    scroll the transcript (wheel and Ctrl-u/d too)
  [/]          previous/next question on the row
  { / }        previous / next waiting, failed, or stalled row
  s            seed a new issue
  r            poll status now
  x            stop the running request
  f / h / e    expand files, the last hunk, or the last Read / command tail
  H            older hunk
  Ctrl-T       expand or collapse the todo list on a running row
  /            slash command (same verbs)
  Tab          complete the selected slash verb or board id
  ↑/↓          slash match while / is open; lines, then prior compose
  ←/→          move in the line while composing
  Ctrl-J       new line while composing (Alt-Enter / Shift-Enter too)
  Ctrl-A / E   start / end of the current compose line
  /status id   select that row, then refresh
  /wake        process pending rows
  /refresh     poll status now
  /find [text] search the selected row's transcript
  n / N        older / newer match
  ?            board keys (any key returns; this text is the CLI form)
  /quit        leave the board (stops a run that is still going; the shell comes back without waiting for it to finish)
  Reopening the board selects the row you left, per session and epic.
  Reopening also recalls prior compose lines for that session and epic.
  The terminal tab shows running, waiting, and failed counts.
  The header names the epic and, when CONDUCTOR_REPO is set, the product checkout.

  Type anything that is not a slash verb to talk to the coordinator.
  Letters talk. r still refreshes. /quit leaves. Ctrl-C leaves when nothing is running.
  A row with an open question: type the reply. Letters are the answer, not board keys. Enter sends, Esc cancels.
  A new question rings the terminal bell and selects that row when you are not typing.
  A row that finishes rings the terminal bell and selects that row when you are not typing. A new question wins.
  The ASK band keeps that attempt's branch, files, current todo, PR URL, and token counts.
  A row that failed: the FAIL band holds the reason, that attempt's branch, and files. Talk, or /wake if it is still pending. An errored or cancelled row is spent — /wake will not take it.
  s / seed: first line is the issue id. More lines — or words after the id — are the brief attempt 1 reads, so the run does not have to ask what the ticket is.
  A running row: the RUN band holds the checkout and what the run is
  doing. Ctrl-T expands the todo list. x or Ctrl-C stops it.
  While working, type an answer; Enter queues it.
  A finished row keeps that attempt's files, todo list, and request id.
  The transcript tails that run's request stream. Thinking is a compact think · line.

Flags: --json  --phase <name>  --user <id>  --session <id>  --config <path>
       --flow-dir  --dotenv  --quiet  --log-level
  CONDUCTOR_CONFIG  config path when --config is omitted`;
