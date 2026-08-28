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
  "help",
  "quit",
  "q",
  "refresh",
]);

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
    if (ch === '"' || ch === "'") {
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

  const words = splitWords(body);
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
    case "wake":
      return { ok: true, command: { kind: "wake" } };
    case "status":
      return { ok: true, command: { kind: "status", ...(words[1] !== undefined ? { issue: words[1] } : {}) } };
    case "watch":
      return { ok: true, command: { kind: "watch", ...(words[1] !== undefined ? { issue: words[1] } : {}) } };
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
      const text = words.slice(2).join(" ").trim();
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
  const json = argv.includes("--json");
  const words = argv.filter((w) => w !== "--json");
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
  const parsed = parseCommand(words.join(" "));
  if (!parsed.ok) return parsed;
  return { ...parsed, invocation: { mode: "headless", command: parsed.command, json } };
}

export const HELP_TEXT = `fsdev conductor — drive a conductor flow from the terminal

Uses the same runtime as fsdev run / fsdev chat (fsdev.config.*, stores,
drain budget). Every verb is a flow action. The board is whatever status
returns — that action is the authority, not this command.

Interactive:
  fsdev conductor                 fullscreen board, live poll, slash commands
  fsdev conductor tui [issue]     same, optionally focused on one issue

Headless (scripting):
  fsdev conductor status [issue]
  fsdev conductor seed <issue> [--phase implement]
  fsdev conductor start <issue>   seed, then open the TUI
  fsdev conductor wake
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
  /            slash command (same verbs)
  ?            this help
  q            quit

  A row with an open question: just type. Enter sends, Esc cancels.

Flags: --json  --user <id>  --session <id>  --config <path>
       --flow-dir  --dotenv  --quiet  --log-level`;
