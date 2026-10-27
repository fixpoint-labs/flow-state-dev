/**
 * Goal check, FIX-2134: every stop for a person is one Inbox item. The closure of epic FIX-2058,
 * run on one `main` commit with every other child merged. See goal.md.
 *
 * Run:      pnpm tsx goals/shift-manager/every-stop-is-one-inbox-item/run.mts
 * The sweep, the children's checks and the gap sweep run beside this, as goal.md says.
 * Legs:     GOAL_LEGS=a,b,c,d,j1,j2,j3 (default all; b answers a's stops)
 * Harness:  GOAL_HARNESS=claude-code (default) | stub, the coding run's
 * Controls: GOAL_CONTROL=public-resume | new-attempt | cancel-keeps-item | steer-ignores-mark | default-deadline
 */
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { probeClaudeAccount } from "@flow-state-dev/claude-code/sdk";
import { REPO_ROOT, RUN_STAMP, goalTmpDir, keysServing, loadFixture, runGoal } from "../../lib/index.mts";
import { assertPatched, describePatches, modulePatchEnv } from "../../lib/module-patch.mts";
import { buildShiftManagerPages, type ServedShiftManager } from "../../lib/shift-manager.mts";
import { loadShipped } from "../workers-message-each-other/legs.mts";
import { claudeCodeEnv } from "../../../packages/shift-manager/teams/devteam/harness.mts";
import { pickWords, REAL_MODEL } from "./cast.mts";
import { CONTROLS, type Control } from "./controls.mts";
import { legA, legB, legC, legD, type Context } from "./legs.mts";
import { journeyFiles, journeyDeadlines, journeyRestart } from "./journeys.mts";
import { aliceIn, labFiles, serveLab, show, type Serving } from "./world.mts";

const SCRATCH = goalTmpDir("every-stop");
const say = (s: string) => console.error(`[every-stop ${new Date().toISOString().slice(11, 19)}] ${s}`);
/** The sweeper's interval on the walk's Lab: seconds, so "past the sweeper" is seconds. Fakes time, not behaviour. */
const SWEEP_MS = 3_000;

const fixture = loadFixture<{ coding: Context["coding"] }>(import.meta.url);

// ---- D1: every assertion's kind ---------------------------------------------------------------

type Kind = "structural" | "judgment";
/** Each assertion and its kind. A structural FAIL is a finding on any attempt; only a judgment FAIL may be retried. */
export const TAGS: Record<string, Kind> = {
  "a:held-filed": "judgment",
  "j1:filer-files": "judgment",
  "j1:filer-calls": "judgment",
};
const kindOf = (failure: string): Kind => TAGS[failure.split(" — ")[0]!] ?? "structural";

// ---- controls ---------------------------------------------------------------------------------

const controlName = process.env.GOAL_CONTROL ?? "";
if (controlName !== "" && CONTROLS[controlName] === undefined) {
  console.error(`unknown GOAL_CONTROL "${controlName}"; known: ${Object.keys(CONTROLS).join(", ")}`);
  process.exit(2);
}
const control: Control | undefined = controlName === "" ? undefined : CONTROLS[controlName];
const ALL_LEGS = ["a", "b", "c", "d", "j1", "j2", "j3"];
const legs = new Set((process.env.GOAL_LEGS ?? (control?.legs ?? ALL_LEGS).join(",")).split(",").map((s) => s.trim()).filter(Boolean));
for (const leg of legs) if (!ALL_LEGS.includes(leg)) throw new Error(`unknown leg "${leg}"`);
const harness: "claude-code" | "stub" = (process.env.GOAL_HARNESS ?? "claude-code") === "stub" ? "stub" : "claude-code";

// A control runs the walk in a child that loads its patches; the Labs it serves inherit them, since
// Shift Manager's command passes the environment on. This process grades the child's output.
if (control !== undefined && process.env.GOAL_MODULE_PATCH === undefined) {
  console.error(describePatches(control.patches, REPO_ROOT));
  const mark = join(SCRATCH, `patched-${RUN_STAMP}`);
  mkdirSync(SCRATCH, { recursive: true });
  const child = spawnSync(process.execPath, [...process.execArgv, fileURLToPath(import.meta.url)], {
    stdio: ["inherit", "pipe", "pipe"],
    env: { ...process.env, ...modulePatchEnv(control.patches, REPO_ROOT, mark) },
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  process.stdout.write(child.stdout ?? "");
  process.stderr.write(child.stderr ?? "");
  assertPatched(control.patches, REPO_ROOT, mark);
  process.exit(controlVerdict(`${child.stdout ?? ""}${child.stderr ?? ""}`, control));
}

/** A control passes only when every assertion it must fail failed: exit 0 then, 1 when one stayed green. */
function controlVerdict(out: string, c: Control): number {
  const red = c.mustFail.filter((tag) => out.split("\n").some((line) => line.includes(`${tag} —`)));
  const green = c.mustFail.filter((tag) => !red.includes(tag));
  console.log(
    green.length === 0
      ? `control ${c.name}: failed ${red.join(", ")}, as it must`
      : `control:broken — control ${c.name} left ${green.join(", ")} green, so the check can't see what it removes`,
  );
  return green.length === 0 ? 0 : 1;
}

await runGoal(async (failures, tell) => {
  const evidence: string[] = [];
  const notes: string[] = [];
  const fail = (tag: string, what: string) => {
    failures.push(`${tag} — ${what}`);
    say(`FAIL ${tag} — ${what.slice(0, 300)}`);
  };

  if (!keysServing(REAL_MODEL).some((key) => (process.env[key] ?? "") !== "")) {
    return { failures: [`blocked: no key here serves ${REAL_MODEL}; set one of ${keysServing(REAL_MODEL).join(", ")}`], evidence: "" };
  }
  if (harness === "claude-code") {
    // A cold Claude Code start on a busy machine can take past the probe's 10 s default.
    const probe = await probeClaudeAccount({ env: claudeCodeEnv(), timeoutMs: 60_000 } as never);
    if (probe.status !== "account") return { failures: [`blocked: no Claude Code account for the coding run (${show(probe)})`], evidence: "" };
  }
  mkdirSync(SCRATCH, { recursive: true });
  say("building Shift Manager's pages");
  const pages = await buildShiftManagerPages(join(SCRATCH, "pages"));
  const shipped = await loadShipped(REPO_ROOT);
  const words = pickWords();
  const fact = harness === "claude-code" ? `FSD-${RUN_STAMP.replace(/_/g, "")}-${randomBytes(4).toString("hex")}` : "";
  say(`held out: ${show(words)}; coding run on ${harness}`);

  const context = (alice: Context["alice"], files: { proof: string; store: string }): Context => ({
    alice,
    words,
    proof: files.proof,
    store: files.store,
    coding: fixture.coding,
    fact,
    harness,
    sweepMs: SWEEP_MS,
    fail,
    note: (line) => {
      notes.push(line);
      say(line);
    },
    say,
  });

  // ---- legs a to d, on one Lab ----
  if (["a", "b", "c", "d", "j1"].some((leg) => legs.has(leg))) {
    const serving: Serving = { scratch: SCRATCH, pages, files: labFiles(SCRATCH, "walk", words), harness, fact, sweepMs: SWEEP_MS };
    let served: ServedShiftManager | undefined;
    try {
      served = await serveLab(serving, "walk");
      say(`the Lab at ${served.origin}`);
      const c = context(await aliceIn(shipped, served.origin), serving.files);
      if (legs.has("a") || legs.has("b")) {
        say("leg a: six stops at once");
        const filed = await legA(c);
        tell.over("a · the six tasks filed", Object.values(filed.ids));
        if (legs.has("b")) {
          say("leg b: each answered once in the Inbox");
          await legB(c, filed);
        }
      }
      if (legs.has("c")) {
        say("leg c: cancelled while they wait");
        await legC(c);
      }
      if (legs.has("d")) {
        say("leg d: steered while they wait");
        await legD(c);
      }
      if (legs.has("j1")) {
        say("j1: a filer's steer");
        await journeyFiles(c);
      }
    } finally {
      if (served !== undefined) {
        if (failures.length > 0) say(`Lab log tail:\n${served.log().slice(-4000)}`);
        await served.stop();
      }
    }
  }

  // ---- j2: deadlines and a stop, on a host of their own ----
  if (legs.has("j2")) {
    say("j2: deadlines and a user's stop");
    const serving: Serving = { scratch: SCRATCH, pages, files: labFiles(SCRATCH, "j2", words), harness: "stub", fact: "", sweepMs: 1_000, userDeadlineMs: 15_000 };
    await journeyDeadlines(serving, shipped, context);
  }

  // ---- j3: the host restarts while six wait ----
  if (legs.has("j3")) {
    say("j3: the host restarts while six wait");
    const serving: Serving = { scratch: SCRATCH, pages, files: labFiles(SCRATCH, "j3", words), harness, fact, sweepMs: SWEEP_MS };
    await journeyRestart(serving, shipped, context);
  }

  for (const failure of failures) say(`${kindOf(failure)}: ${failure.slice(0, 200)}`);
  if (notes.length > 0) evidence.push(`notes: ${notes.join(" · ")}`);
  return { failures, evidence: evidence.join(" · ") };
});
