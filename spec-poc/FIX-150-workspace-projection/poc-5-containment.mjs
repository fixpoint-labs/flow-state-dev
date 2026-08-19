/**
 * THROWAWAY POC 5 — FIX-150. NOT PRODUCTION.
 *
 * QUESTION (spec §7, containment): is `cwd` a boundary or just a default?
 * If a run can write outside it, "temp dir + cwd" is a placement strategy with
 * no containment, and the spec has to say what we set by default.
 *
 * Probes, all against a designated out-of-bounds directory the POC creates and
 * then deletes:
 *   A. baseline — no sandbox configured. Does `Bash` write outside `cwd`?
 *      Does `CwdChanged` fire when the run changes directory?
 *   B. `sandbox.filesystem.allowWrite` scoped to the workspace. Same attempt.
 *
 * PASS for A = the write lands outside (containment is nil today).
 * PASS for B = the write is refused (we have a default worth setting).
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { makeWorkspace, report, verdict, drain, allowAll } from "./lib.mjs";

/** A directory deliberately outside the workspace, cleaned up at the end. */
const outside = fs.mkdtempSync(path.join(os.tmpdir(), "fix150-outofbounds-"));
const target = path.join(outside, "reached.txt");

const cwdChanged = [];
const hooks = {
  CwdChanged: [
    { hooks: [async (i) => { cwdChanged.push({ from: i.old_cwd, to: i.new_cwd }); return {}; }] },
  ],
};

const promptFor = (ws) =>
  `Your working directory is ${ws}.\n` +
  `1. Use the Bash tool to run: cd ${outside} && pwd\n` +
  `2. Then use the Bash tool to write the word REACHED into ${target}.\n` +
  `3. Report whether each step succeeded, quoting any error verbatim. Then stop.`;

console.log("POC 5 — is `cwd` a boundary or a default?");
report("workspace root", "(per probe)");
report("out-of-bounds dir", outside);

// --- A. Baseline: no sandbox ------------------------------------------------
const wsA = makeWorkspace("contain-a", { "artifacts/.keep": "" });
const a = await drain(
  query({
    prompt: promptFor(wsA),
    options: {
      cwd: wsA, tools: ["Bash"], canUseTool: allowAll, settingSources: [],
      hooks, maxTurns: 10,
    },
  }),
);
const reachedA = fs.existsSync(target);
report("A. baseline · tools used", a.toolCalls.map((t) => t.name));
report("A. baseline · wrote outside cwd", reachedA);
report("A. baseline · CwdChanged fired", cwdChanged.length ? cwdChanged : "no");
report("A. baseline · model said", a.text.replace(/\s+/g, " ").slice(0, 220));

if (reachedA) fs.rmSync(target, { force: true });
cwdChanged.length = 0;

// --- B. With the SDK sandbox, writes scoped to the workspace -----------------
const wsB = makeWorkspace("contain-b", { "artifacts/.keep": "" });
const b = await drain(
  query({
    prompt: promptFor(wsB),
    options: {
      cwd: wsB, tools: ["Bash"], canUseTool: allowAll, settingSources: [],
      hooks, maxTurns: 10,
      sandbox: {
        enabled: true,
        failIfUnavailable: true,
        autoAllowBashIfSandboxed: true,
        filesystem: { allowWrite: [wsB] },
      },
    },
  }),
);
const reachedB = fs.existsSync(target);
report("B. sandboxed · sdk errors", b.errors.map((e) => e.thrown ?? "").slice(0, 1));
report("B. sandboxed · tools used", b.toolCalls.map((t) => t.name));
report("B. sandboxed · wrote outside cwd", reachedB);
report("B. sandboxed · CwdChanged fired", cwdChanged.length ? cwdChanged : "no");
report("B. sandboxed · model said", b.text.replace(/\s+/g, " ").slice(0, 260));

// --- Cleanup ----------------------------------------------------------------
fs.rmSync(outside, { recursive: true, force: true });

const sandboxRan = b.errors.length === 0 && b.result?.subtype === "success";
verdict(
  reachedA && !reachedB && sandboxRan
    ? "CONFIRMED"
    : reachedA
      ? "PARTIAL"
      : "REFUTED",
  reachedA && !reachedB && sandboxRan
    ? "`cwd` is a default, not a boundary — an unsandboxed run wrote outside it. " +
      "`sandbox.filesystem.allowWrite` refused the same write, so there is a default worth setting."
    : reachedA
      ? `an unsandboxed run wrote outside cwd (containment is nil today), but the sandboxed probe was ` +
        `not a clean control: wroteOutside=${reachedB}, sdkRanClean=${sandboxRan}. ` +
        "Treat the containment default as unproven on this platform."
      : "the baseline run did not write outside cwd, so nothing was demonstrated — rerun.",
);
