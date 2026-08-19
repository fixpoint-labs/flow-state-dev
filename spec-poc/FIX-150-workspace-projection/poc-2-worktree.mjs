/**
 * THROWAWAY POC 2 — FIX-150. NOT PRODUCTION.
 *
 * QUESTION: `WorktreeCreate` / `WorktreeRemove` hooks exist. Is SDK worktree
 * isolation a real third placement strategy alongside "bash sandbox" and
 * "temp dir + cwd", and if so who controls it — us or the model?
 *
 * Four probes:
 *   A. host flag — `extraArgs: { worktree: null }` → the CLI's `--worktree`.
 *   B. agent tool, no hook — `EnterWorktree` in a real git repo.
 *   C. agent tool, host hook — `WorktreeCreate` returning a directory WE chose.
 *   D. same as C but the directory is plain (non-git) and pre-seeded, which is
 *      what a projected FSD workspace actually is.
 *
 * The strategy is only useful to FSD if the *host* decides the directory and
 * the directory does not have to be a git worktree. D is the decisive probe.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { makeWorkspace, snapshot, report, verdict, drain, allowAll } from "./lib.mjs";

const git = (cwd, ...args) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

/** A throwaway git repo with one commit, so worktrees are creatable. */
function makeRepo(label) {
  const dir = makeWorkspace(label, { "seed.txt": "hello", "README.md": "# repo\n" });
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "poc@example.com");
  git(dir, "config", "user.name", "poc");
  git(dir, "add", ".");
  git(dir, "commit", "-qm", "seed");
  return dir;
}

const log = [];
/** Observe-only hooks: return nothing. */
const observeOnly = {
  WorktreeCreate: [{ hooks: [async (i) => { log.push(["WorktreeCreate", i]); return {}; }] }],
  WorktreeRemove: [{ hooks: [async (i) => { log.push(["WorktreeRemove", i]); return {}; }] }],
};
/** Provisioning hooks: the HOST returns the directory the run should move into. */
function provisionInto(dir) {
  return {
    WorktreeCreate: [
      {
        hooks: [
          async (i) => {
            log.push(["WorktreeCreate", i]);
            return { hookSpecificOutput: { hookEventName: "WorktreeCreate", worktreePath: dir } };
          },
        ],
      },
    ],
    WorktreeRemove: [{ hooks: [async (i) => { log.push(["WorktreeRemove", i]); return {}; }] }],
  };
}

console.log("POC 2 — is SDK worktree provisioning a usable placement strategy?\n");

// --- A. Host flag -----------------------------------------------------------
log.length = 0;
const repoA = makeRepo("wt-a");
const a = await drain(
  query({
    prompt: "Run `pwd` and report the absolute path you are in. Nothing else.",
    options: {
      cwd: repoA, tools: ["Bash"], canUseTool: allowAll, settingSources: [],
      hooks: observeOnly, extraArgs: { worktree: null }, maxTurns: 4,
    },
  }),
);
const listA = git(repoA, "worktree", "list").trim().split("\n");
report("A. host `--worktree` · pwd reported", a.text.replace(/\s+/g, " ").slice(0, 140));
report("A. worktrees now", listA.length);
report("A. worktree path", listA[1]?.split(/\s+/)[0] ?? "none");
report("A. hooks fired", log.map(([n]) => n));

// --- B. Agent tool, observe-only hook ---------------------------------------
log.length = 0;
const repoB = makeRepo("wt-b");
const b = await drain(
  query({
    prompt: "Call EnterWorktree to make a worktree named poc-b, then run `pwd`. Then stop.",
    options: {
      cwd: repoB, tools: ["Bash", "EnterWorktree"], canUseTool: allowAll,
      settingSources: [], hooks: observeOnly, maxTurns: 8,
    },
  }),
);
report("B. observe-only hook · worktrees now", git(repoB, "worktree", "list").trim().split("\n").length);
report("B. outcome", b.text.replace(/\s+/g, " ").slice(0, 180));

// --- C. Agent tool, host-provisioning hook, git repo ------------------------
log.length = 0;
const repoC = makeRepo("wt-c");
const chosenC = makeWorkspace("wt-c-target", { "artifacts/doc.md": "# projected\n" });
const c = await drain(
  query({
    prompt:
      "Call EnterWorktree. Then run `pwd` and `ls -R` and report both outputs verbatim. Then stop.",
    options: {
      cwd: repoC, tools: ["Bash", "EnterWorktree"], canUseTool: allowAll,
      settingSources: [], hooks: provisionInto(chosenC), maxTurns: 8,
    },
  }),
);
report("C. host chose", chosenC);
report("C. agent reported", c.text.replace(/\s+/g, " ").slice(0, 240));
report("C. hooks fired", log.map(([n]) => n));

// --- D. Host-provisioning hook, PLAIN (non-git) launch dir ------------------
log.length = 0;
const plain = makeWorkspace("wt-d-launch", { "readme.txt": "launch dir\n" });
const chosenD = makeWorkspace("wt-d-target", { "artifacts/doc.md": "# projected\n" });
const d = await drain(
  query({
    prompt:
      "Call EnterWorktree. Then write a file called proof.txt containing the word ENTERED " +
      "in your current directory, then run `pwd` and report it. Then stop.",
    options: {
      cwd: plain, tools: ["Bash", "Write", "EnterWorktree"], canUseTool: allowAll,
      settingSources: [], hooks: provisionInto(chosenD), maxTurns: 10,
    },
  }),
);
const landedInTarget = fs.existsSync(path.join(chosenD, "proof.txt"));
const landedInLaunch = fs.existsSync(path.join(plain, "proof.txt"));
report("D. non-git launch dir", plain);
report("D. host chose", chosenD);
report("D. agent reported", d.text.replace(/\s+/g, " ").slice(0, 240));
report("D. target dir after", snapshot(chosenD));
report("D. proof.txt in host-chosen dir", landedInTarget);
report("D. proof.txt in launch dir", landedInLaunch);
report("D. hooks fired", log.map(([n]) => n));

// --- Verdict ----------------------------------------------------------------
const hostFlagWorks = listA.length > 1;
const hostHookControlsPlacement = landedInTarget && !landedInLaunch;

verdict(
  hostHookControlsPlacement ? "CONFIRMED" : "REFUTED",
  hostHookControlsPlacement
    ? "`WorktreeCreate` is a host-implemented PROVISIONING hook, not an observer: the host returns " +
      "`worktreePath` and the run relocates there — including a plain non-git directory. " +
      `The launch dir is a git repo only for the built-in path (host --worktree: ${hostFlagWorks ? "works" : "no"}).`
    : "the host could not steer placement through the hook — see the probes above.",
);
