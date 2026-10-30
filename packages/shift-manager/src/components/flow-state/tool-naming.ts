/**
 * Pure helpers that name a tool call: what it did in a few words.
 *
 * `toolSubject` reads a call's name and args into one short line ("Read
 * src/a.ts", "Calling MCP tool Linear Get Issue", the shell command it ran);
 * `toolIntent` reads the description a call states about itself. Free of DOM
 * and component imports, so any UI layer can use them.
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

/**
 * Names what a call did, so a run of calls to one tool reads as distinct steps:
 * the command a shell ran, the file a read opened, the pattern a grep sought.
 * The verb is the tool's name, title-cased; the subject is the first of a
 * short list of common args the call carries. Undefined when it carries none,
 * which keeps the tool's name.
 */
export function toolSubject(toolName: string, args: unknown): ToolSubject | undefined {
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
