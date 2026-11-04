/**
 * Pure helpers that name a tool call: what it did in a few words.
 *
 * `toolSubject` reads a call's name and args, and its result once it has one,
 * into one short line ("Read src/a.ts", `Search "x" · 3 matches`, "Calling MCP
 * tool Linear Get Issue", the shell command it ran); `toolIntent` reads the
 * description a call states about itself; `toolOutcome` says whether a call's
 * result reports that it failed. Free of DOM and component imports, so any UI
 * layer can use them.
 */

const SHELL_TOOLS = new Set(["shell", "bash", "command_execution", "run_command", "terminal"]);

/** A `description` on any other tool can be a payload, not an intent. */
const TOOL_INTENT_ARG: Record<string, string> = {
  Bash: "description",
  bash: "description",
  Task: "description",
  Agent: "description",
};

/** Trimmed allowlisted intent, or undefined when the call left it empty. */
export function toolIntent(toolName: string, args: unknown): string | undefined {
  const key = SHELL_TOOLS.has(toolName.toLowerCase()) ? "description" : TOOL_INTENT_ARG[toolName];
  if (key === undefined || args === null || typeof args !== "object") return undefined;
  const value = (args as Record<string, unknown>)[key];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Args that name what a call acted on, most specific first: a search term beats the directory it ran in. */
const SUBJECT_ARGS = ["query", "pattern", "glob_pattern", "globPattern", "url", "file_path", "path", "target_file", "target_directory", "dir"];

/** Tools whose verb is not their name. */
const VERBS: Record<string, string> = { ls: "List", multiedit: "Edit" };

function titleCase(text: string): string {
  const words = text.replace(/([a-z])([A-Z])/g, "$1 $2").split(/[_\s-]+/).filter((w) => w !== "");
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

/** `web_fetch` → "Fetch", `read_file` → "Read", `ls` → "List". */
function verbFor(toolName: string): string {
  const lower = toolName.toLowerCase();
  return VERBS[lower] ?? titleCase(lower.replace(/^web_/, "").replace(/_file$/, ""));
}

/** `mcp__linear__get_issue` → ["linear", "get_issue"]; undefined for any other tool. */
function mcpParts(toolName: string): [string, string] | undefined {
  const [prefix, server, ...tool] = toolName.split("__");
  return prefix === "mcp" && server !== undefined && tool.length > 0 ? [server, tool.join("__")] : undefined;
}

const SUBJECT_MAX = 80;

/** One or more `cd <dir> &&` (or `;`) at the front of a command line. */
const LEADING_CD = /^(?:cd\s+(?:"[^"]*"|'[^']*'|\S+)\s*(?:&&|;|$)\s*)+/;

/**
 * A path as its last three segments, so a deep one still fits on a line;
 * fewer when a long segment (a worktree's hashed folder) would push the
 * file's own name past the line's end.
 */
function shortPath(path: string): string {
  const parts = path.split("/").filter((part) => part !== "");
  if (parts.length <= 3 && path.length <= SUBJECT_MAX / 2) return path;
  for (const keep of [3, 2]) {
    const shown = `…/${parts.slice(-keep).join("/")}`;
    if (parts.length > keep && shown.length <= SUBJECT_MAX / 2) return shown;
  }
  return parts.length > 1 ? `…/${parts[parts.length - 1]}` : path;
}

function clip(text: string): string {
  return text.length > SUBJECT_MAX ? `${text.slice(0, SUBJECT_MAX - 1)}…` : text;
}

/** What one call acted on, read off its args. `code` marks a shell command, shown in mono. */
export type ToolSubject = { text: string; code: boolean };

type Fields = Record<string, unknown>;

const asFields = (value: unknown): Fields =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Fields) : {};

/** A trimmed, non-blank string field, else undefined. */
function textOf(record: Fields, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

/** `1 match`, `3 matches`, `no matches`; `50+ matches` when the result was cut. */
function counted(n: number, one: string, many: string, cut: boolean): string {
  if (n === 0 && !cut) return `no ${many}`;
  return `${n}${cut ? "+" : ""} ${n === 1 && !cut ? one : many}`;
}

/** The lines a read asked for: `lines 3-9`, `line 3`, `from line 3`. */
function lineRange(args: Fields): string | undefined {
  const start = typeof args.startLine === "number" ? args.startLine : undefined;
  const end = typeof args.endLine === "number" ? args.endLine : undefined;
  if (end === undefined) return start === undefined ? undefined : `from line ${start}`;
  if (start === end) return `line ${end}`;
  return `lines ${start ?? 1}-${end}`;
}

/**
 * How a workforce or task tool says what it did, from its args and, once the
 * call is done, its result. Never an id: a task or message id means nothing to
 * the person reading, so a task is named by its title, else its goal.
 */
const WORK_TOOLS: Record<string, (args: Fields, output: Fields | undefined) => string> = {
  readProjectSource: (args, output) => {
    const path = textOf(args, "path") ?? (output === undefined ? undefined : textOf(output, "path"));
    if (path === undefined) return "Read a project file";
    const range = lineRange(args);
    return `Read ${shortPath(path)}${range === undefined ? "" : `, ${range}`}`;
  },
  grepProjectSource: (args, output) => {
    const pattern = textOf(args, "pattern");
    const prefix = textOf(args, "prefix");
    let line = pattern === undefined ? "Search the project" : `Search "${pattern}"`;
    if (prefix !== undefined) line += ` in ${shortPath(prefix)}`;
    if (output?.kind === "grep" && Array.isArray(output.matches)) {
      line += ` · ${counted(output.matches.length, "match", "matches", output.cut != null)}`;
    }
    return line;
  },
  globProjectSource: (args, output) => {
    const pattern = textOf(args, "pattern");
    let line = pattern === undefined ? "List the project's files" : `List ${pattern}`;
    if (output?.kind === "glob" && Array.isArray(output.paths)) {
      line += ` · ${counted(output.paths.length, "file", "files", output.cut != null)}`;
    }
    return line;
  },
  createTask: (args) => {
    const named = textOf(args, "title") ?? textOf(args, "goal");
    return named === undefined ? "Start a task" : `Start a task: ${named}`;
  },
  getTask: (_args, output) => {
    const task = asFields(output?.task);
    const named = textOf(task, "title") ?? textOf(task, "goal");
    return named === undefined ? "Check on a task" : `Check on "${named}"`;
  },
  updateTask: () => "Update a task",
  listTasks: () => "Look over the tasks",
  holdTaskForUser: () => "Ask you a question",
  suspendForUser: (args) => {
    const kind = textOf(args, "kind");
    const asks = kind === "approval" ? "Ask for your approval" : kind === "review" ? "Ask for your review" : "Ask for your answer";
    const title = textOf(args, "title");
    return title === undefined ? asks : `${asks}: ${title}`;
  },
  sendMessage: (args) => {
    const to = args.to;
    if (typeof to === "string" && to.trim() !== "") return `Message ${to.trim()}`;
    const target = asFields(to);
    if (typeof target.task === "string") return "Message the worker on a task";
    if (typeof target.session === "string") return "Message a conversation";
    return "Send a message";
  },
  reportProgress: (args) => {
    const note = textOf(args, "statusNote");
    return note === undefined ? "Note progress" : `Note progress: ${note}`;
  },
  consultSessionHistory: () => "Read a conversation",
};

/**
 * The tool a name stands for. A board-qualified task tool
 * (`createTask_<board>`, when two boards share a block) is its base tool. The
 * suffix is orchestration's `taskToolSuffix`, the one place it is built; this
 * file can't import orchestration, so it only strips it, and only when the
 * base is a tool named here, so `read_file` stays `read_file`.
 */
export function toolBaseName(toolName: string): string {
  if (Object.hasOwn(WORK_TOOLS, toolName)) return toolName;
  const cut = toolName.indexOf("_");
  if (cut <= 0) return toolName;
  const base = toolName.slice(0, cut);
  return Object.hasOwn(WORK_TOOLS, base) ? base : toolName;
}

/** Whether a call worked, as its result reports it. */
export type ToolOutcome = "ok" | "failed";

/**
 * Whether a call's result says it failed. A tool that refuses answers with a
 * result, not a throw, in one of four shapes: `{ ok: false, error }`,
 * `{ kind: "refused", reason, message }`, `{ status: "failed", error }` (a
 * send that waited on a reply its message never got to give), and a project
 * read whose `status` isn't `ok` (`missing`, `binary`, ...), the one rule tied
 * to a tool. Any other `status` (a task filed `held`, a fetched task that
 * failed) says nothing about the call, and a search that found nothing worked.
 * A thrown call is its item's status, not this.
 */
export function toolOutcome(toolName: string, output: unknown): ToolOutcome {
  const record = asFields(output);
  if (record.ok === false) return "failed";
  if (record.kind === "refused") return "failed";
  if (record.status === "failed" && record.error !== undefined) return "failed";
  if (toolBaseName(toolName) === "readProjectSource" && record.kind === "read" && record.status !== "ok") return "failed";
  return "ok";
}

/**
 * Names what a call did, so a run of calls to one tool reads as distinct steps:
 * the command a shell ran, the file a read opened, the pattern a grep sought.
 * The verb is the tool's name, title-cased; the subject is the first of a
 * short list of common args the call carries. Undefined when it carries none,
 * which keeps the tool's name. A workforce or task tool has words of its own,
 * and says more once `output`, the call's result, is given: a search's match
 * count, a task's title. Without one (a call still running) it says what its
 * args say.
 */
export function toolSubject(toolName: string, args: unknown, output?: unknown): ToolSubject | undefined {
  const base = toolBaseName(toolName);
  const work = Object.hasOwn(WORK_TOOLS, base) ? WORK_TOOLS[base] : undefined;
  if (work !== undefined) {
    const result = output === undefined || output === null ? undefined : asFields(output);
    return { text: clip(work(asFields(args), result)), code: false };
  }
  if (args === null || typeof args !== "object") return undefined;
  const record = args as Record<string, unknown>;
  const lower = toolName.toLowerCase();

  const mcp = mcpParts(toolName);
  if (mcp !== undefined) return { text: `Calling MCP tool ${titleCase(mcp[0])} ${titleCase(mcp[1])}`, code: false };

  if (SHELL_TOOLS.has(lower)) {
    const raw = record.command;
    const command = Array.isArray(raw) ? raw.join(" ") : raw;
    if (typeof command !== "string") return undefined;
    const lines = command.split("\n").map((l) => l.trim()).filter((l) => l !== "");
    // Agents prefix `cd <dir> &&` to every command; the work is what follows.
    const worked = lines.map((l) => l.replace(LEADING_CD, "")).filter((l) => l !== "");
    const line = (worked[0] ?? lines[0])?.replace(/\s+/g, " ");
    return line === undefined ? undefined : { text: clip(line), code: true };
  }

  // Codex reports a file change as the list of files it touched: an edit, as the other harnesses name theirs.
  if (lower === "file_change" && Array.isArray(record.changes)) {
    const paths = record.changes.map((c: { path?: unknown }) => c?.path).filter((p): p is string => typeof p === "string" && p !== "");
    if (paths.length === 0) return undefined;
    const more = paths.length > 1 ? ` and ${paths.length - 1} more` : "";
    return { text: clip(`Edit ${shortPath(paths[0]!)}${more}`), code: false };
  }

  const key = SUBJECT_ARGS.find((k) => typeof record[k] === "string" && (record[k] as string).trim() !== "");
  if (key === undefined) return undefined;
  const value = (record[key] as string).trim();
  const shown = key === "query" || key === "pattern" ? `"${value}"` : key === "url" ? value : shortPath(value);
  return { text: clip(`${verbFor(toolName)} ${shown}`), code: false };
}
