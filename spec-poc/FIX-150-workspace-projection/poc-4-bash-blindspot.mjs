/**
 * THROWAWAY POC 4 — FIX-150. NOT PRODUCTION.
 *
 * QUESTION: change detection — hooks, diffing, or both?
 *
 * `PostToolUse` observes every SDK tool call, but a shell write is one opaque
 * `Bash` command: the hook sees a command string, not a file path. If that
 * blind spot is real, hooks alone cannot drive flush and a content diff is
 * mandatory. If a `FileChanged` hook fires for shell writes too, the blind
 * spot closes and hooks alone might be enough.
 *
 * The run writes one file with `Write` and one with a `Bash` heredoc, and we
 * compare what each detector saw.
 */
import { query } from "@anthropic-ai/claude-agent-sdk";
import { makeWorkspace, snapshot, diff, report, verdict, drain, allowAll } from "./lib.mjs";

const ws = makeWorkspace("blindspot", { "artifacts/.keep": "" });
const before = snapshot(ws);

const postToolUse = [];
const fileChanged = [];

const hooks = {
  PostToolUse: [
    {
      hooks: [
        async (input) => {
          postToolUse.push({
            tool: input.tool_name,
            // What a flush driven by hooks alone would have to work from:
            input: JSON.stringify(input.tool_input ?? {}).slice(0, 160),
          });
          return {};
        },
      ],
    },
  ],
  FileChanged: [
    {
      hooks: [
        async (input) => {
          fileChanged.push(JSON.stringify(input).slice(0, 200));
          return {};
        },
      ],
    },
  ],
};

console.log("POC 4 — does `PostToolUse` see a shell write?");
report("workspace", ws);

const { toolCalls, result } = await drain(
  query({
    prompt:
      `Your working directory is ${ws}. Do exactly two things, in order.\n` +
      `1. Use the Write tool to create ${ws}/artifacts/via-write.md containing the line: written by tool\n` +
      "2. Use the Bash tool with a heredoc to create artifacts/via-bash.md containing the line: written by shell. " +
      "   Use `cat > artifacts/via-bash.md <<'EOF'` ... `EOF`. Do not use the Write tool for this one.\n" +
      "Then stop.",
    options: {
      cwd: ws,
      tools: ["Write", "Bash"],
      canUseTool: allowAll,
      settingSources: [],
      hooks,
      maxTurns: 10,
    },
  }),
);

const after = snapshot(ws);
const d = diff(before, after);

/** What a hooks-only flush could name: only paths a tool input actually carried. */
const pathsVisibleToHooks = postToolUse
  .map((e) => {
    const m = /"file_path"\s*:\s*"([^"]+)"/.exec(e.input);
    return m ? m[1] : null;
  })
  .filter(Boolean);

report("result", result?.subtype ?? "none");
report("tools the model used", toolCalls.map((t) => t.name));
report("PostToolUse events", postToolUse);
report("FileChanged events", fileChanged.length ? fileChanged : "none fired");
report("paths a hooks-only flush could name", pathsVisibleToHooks);
report("paths a content diff found", d.added);

const wroteBothWays =
  toolCalls.some((t) => t.name === "Write") && toolCalls.some((t) => t.name === "Bash");
const hooksSawWrite = pathsVisibleToHooks.some((p) => p.includes("via-write"));
const hooksMissedBash = !pathsVisibleToHooks.some((p) => p.includes("via-bash"));
const diffCaughtBoth =
  d.added.some((p) => p.includes("via-write")) && d.added.some((p) => p.includes("via-bash"));

verdict(
  wroteBothWays && hooksSawWrite && hooksMissedBash && diffCaughtBoth
    ? "CONFIRMED"
    : wroteBothWays
      ? "REFUTED"
      : "INCONCLUSIVE",
  !wroteBothWays
    ? "the run did not exercise both write paths, so nothing was measured — rerun."
    : hooksSawWrite && hooksMissedBash && diffCaughtBoth
      ? "the blind spot is real: PostToolUse carried a file path for the Write call and only an opaque " +
        `command string for the Bash call${fileChanged.length ? "" : ", and FileChanged never fired"}. ` +
        "A content diff found both. Hooks alone cannot drive flush; diffing is the floor."
      : `hooks saw write=${hooksSawWrite}, missed bash=${hooksMissedBash}, diff caught both=${diffCaughtBoth} — read the events above.`,
);
