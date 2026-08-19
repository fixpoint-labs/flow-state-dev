/**
 * THROWAWAY POC 1 — FIX-150. NOT PRODUCTION.
 *
 * QUESTION: does `cwd` on the Claude Agent SDK actually relocate a run's
 * filesystem, or does the run still touch the host process's cwd?
 *
 * The FSD SDK path (`packages/claude-code/src/sdk/types.ts` →
 * `ClaudeAgentQueryOptions`) does not forward `cwd`, so every run today
 * inherits the FSD server's `process.cwd()`. The whole "temp dir + cwd"
 * placement strategy rests on this being real.
 *
 * PASS: seeded file is read from the temp dir, output lands in the temp dir,
 *       and the host cwd gains nothing.
 * FAIL: output lands next to the host process, or the seeded file is unreadable.
 */
import fs from "node:fs";
import path from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { makeWorkspace, snapshot, diff, report, verdict, drain, allowAll } from "./lib.mjs";

const ws = makeWorkspace("cwd", {
  "seed.txt": "hello from the workspace",
  "notes/keep.md": "# notes\n",
});
const hostCwd = process.cwd();
const hostBefore = snapshot(hostCwd);

console.log("POC 1 — does `cwd` relocate the run's filesystem?");
report("workspace", ws);
report("host cwd", hostCwd);

const { toolCalls, result } = await drain(
  query({
    prompt:
      "Read the file seed.txt in your current directory. Then write a new file out.txt " +
      "containing that text uppercased. Use relative paths only. Then stop.",
    options: {
      cwd: ws,
      tools: ["Read", "Write"],
      canUseTool: allowAll,
      settingSources: [],
      maxTurns: 6,
    },
  }),
);

const wsAfter = snapshot(ws);
const hostAfter = snapshot(hostCwd);
const hostDelta = diff(hostBefore, hostAfter);

const outPath = path.join(ws, "out.txt");
const wroteInWorkspace = fs.existsSync(outPath);
const outContent = wroteInWorkspace ? fs.readFileSync(outPath, "utf8").trim() : null;
const readTheSeed = toolCalls.some(
  (t) => t.name === "Read" && String(t.input?.file_path ?? "").includes("seed.txt"),
);

report("result subtype", result?.subtype ?? "none");
report("tool calls", toolCalls.map((t) => `${t.name}(${t.input?.file_path ?? ""})`));
report("workspace after", wsAfter);
report("out.txt content", outContent);
report("host cwd delta", hostDelta);

const pass =
  readTheSeed &&
  wroteInWorkspace &&
  /HELLO FROM THE WORKSPACE/.test(outContent ?? "") &&
  hostDelta.added.length === 0;

verdict(
  pass ? "CONFIRMED" : "REFUTED",
  pass
    ? "`cwd` relocates the run: the seeded file was read from the temp dir, the write landed there, and the host cwd was untouched."
    : "the run did not behave as a relocated filesystem — see the deltas above.",
);
