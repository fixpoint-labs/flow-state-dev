/**
 * THROWAWAY POC 3 — FIX-150. NOT PRODUCTION.
 *
 * QUESTION: can the framework register in-process hook callbacks (no shelling
 * out to a hook command), do `PostToolUse` and `Stop` actually fire, and does
 * `Stop` have room to run a real flush — a directory walk plus N resource
 * writes — before the run is torn down?
 *
 * This decides the flush boundary (spec §6): flush at `Stop` versus an
 * explicit post-run call by the caller.
 *
 * Also probes `SessionEnd`, which prior research put at ~1.5s — too tight to
 * flush — to see whether that holds.
 */
import fs from "node:fs";
import path from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { makeWorkspace, snapshot, report, verdict, drain, allowAll } from "./lib.mjs";

const ws = makeWorkspace("hooks", { "artifacts/.keep": "" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const fired = [];
/** Stands in for "walk the workspace and upsert every changed file into resources". */
async function simulatedFlush(label) {
  const t0 = Date.now();
  const snap = snapshot(ws);
  for (const rel of Object.keys(snap)) {
    await sleep(150); // stand-in for one resource-store round trip per file
  }
  await sleep(3000); // stand-in for a slow store (Postgres over the network)
  const elapsed = Date.now() - t0;
  fired.push([label, { files: Object.keys(snap).length, elapsedMs: elapsed, completed: true }]);
  return elapsed;
}

const hooks = {
  PostToolUse: [
    {
      hooks: [
        async (input) => {
          fired.push(["PostToolUse", { tool: input.tool_name, at: Date.now() }]);
          return {};
        },
      ],
    },
  ],
  Stop: [
    {
      hooks: [
        async (input) => {
          fired.push(["Stop:enter", { at: Date.now() }]);
          const ms = await simulatedFlush("Stop:flush");
          fired.push(["Stop:exit", { flushMs: ms }]);
          return {};
        },
      ],
    },
  ],
  SessionEnd: [
    {
      hooks: [
        async () => {
          const t0 = Date.now();
          fired.push(["SessionEnd:enter", { at: t0 }]);
          await sleep(3000);
          fired.push(["SessionEnd:exit", { elapsedMs: Date.now() - t0 }]);
          return {};
        },
      ],
    },
  ],
};

console.log("POC 3 — do in-process hooks fire, and does `Stop` have room to flush?");
report("workspace", ws);

const t0 = Date.now();
const { toolCalls, result } = await drain(
  query({
    prompt:
      "Write three files under artifacts/: a.md, b.md and c.md, each containing one " +
      "sentence about a different colour. Use the Write tool. Then stop.",
    options: {
      cwd: ws,
      tools: ["Write"],
      canUseTool: allowAll,
      settingSources: [],
      hooks,
      maxTurns: 10,
    },
  }),
);
const wallMs = Date.now() - t0;
// The SDK tears the subprocess down after the iterator drains; give any
// trailing SessionEnd callback a moment to land so we measure it honestly.
await sleep(6000);

const names = fired.map(([n]) => n);
const stopEntry = fired.find(([n]) => n === "Stop:flush")?.[1];

report("result", result?.subtype ?? "none");
report("tool calls", toolCalls.map((t) => t.name));
report("hook events, in order", names);
report("PostToolUse count", names.filter((n) => n === "PostToolUse").length);
report("Stop flush", stopEntry ?? "did not complete");
report("SessionEnd completed", names.includes("SessionEnd:exit"));
report("workspace after", Object.keys(snapshot(ws)));
report("total wall time ms", wallMs);

const stopFired = names.includes("Stop:enter");
const stopFlushCompleted = names.includes("Stop:exit");
const postToolUseFired = names.filter((n) => n === "PostToolUse").length >= 3;

verdict(
  stopFired && stopFlushCompleted && postToolUseFired ? "CONFIRMED" : "REFUTED",
  stopFired && stopFlushCompleted && postToolUseFired
    ? `in-process callbacks fire with no hook command: PostToolUse ran per tool call, and a ${stopEntry?.elapsedMs}ms flush inside Stop ran to completion before the run finished. ` +
      `SessionEnd ${names.includes("SessionEnd:exit") ? "also completed" : "did NOT complete a 3s callback — too tight to flush in"}.`
    : `hooks did not behave as needed: Stop fired=${stopFired}, Stop flush completed=${stopFlushCompleted}, PostToolUse>=3=${postToolUseFired}.`,
);
