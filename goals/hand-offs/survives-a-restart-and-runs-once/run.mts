/**
 * Goal check: the epic's one goal fixture (FIX-1815, closed by FIX-1820). On
 * one `main` commit, a worker can ask a colleague and continue the same turn
 * with its real answer, or assign a task whose own session parks on a
 * question, carries on when answered, and still answers and takes a follow-up
 * once finished; a server restart during either wait loses nothing, and the
 * work runs once. See goal.md.
 *
 * A thin runner over checks it does not own, plus the one journey none of
 * them walks:
 *
 * - P1.a, leg a: `goals/hand-offs/ask-survives-a-restart/run.mts`, plain, then
 *   under `no-run-once` and `no-waker`.
 * - P1.b, leg b: `goals/coordinators/task-session-stays-open/run.mts`, plain,
 *   then under `new-session` and `drop-answer`.
 * - P1.c and P1.d, the neighbouring checks on the same board, plain.
 * - J4: `legs/parked.mts`, plain, then under `fresh-store`.
 *
 * It refuses a dirty tree, records `HEAD`, re-checks both before each check,
 * and runs each check as its own process with its own `GOAL_CONTROL`, one
 * after another. A plain check passes on exit 0; a control passes only when it
 * printed "<assertion> failed, as it must" for every assertion it names and
 * nothing failed at setup. A check that cannot start (blocked) stops the run.
 * It writes nothing to any store, and each check's full output is kept in a
 * log file it names.
 *
 * Run: pnpm tsx goals/hand-offs/survives-a-restart-and-runs-once/run.mts
 */
import { execFileSync, spawn } from "node:child_process";
import { createWriteStream, mkdirSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT, RUN_STAMP, goalTmpDir, runGoal } from "../../lib/index.mts";

interface Check {
  id: string;
  script: string;
  control?: string;
  /** For a control: the assertions it must fail, by name. */
  mustFail?: string[];
}

const CHECKS: Check[] = [
  { id: "P1.a", script: "goals/hand-offs/ask-survives-a-restart/run.mts" },
  { id: "P1.a", script: "goals/hand-offs/ask-survives-a-restart/run.mts", control: "no-run-once", mustFail: ["one-row"] },
  { id: "P1.a", script: "goals/hand-offs/ask-survives-a-restart/run.mts", control: "no-waker", mustFail: ["a:completed"] },
  { id: "P1.b", script: "goals/coordinators/task-session-stays-open/run.mts" },
  { id: "P1.b", script: "goals/coordinators/task-session-stays-open/run.mts", control: "new-session", mustFail: ["a:names-ticket", "c:names-ticket"] },
  { id: "P1.b", script: "goals/coordinators/task-session-stays-open/run.mts", control: "drop-answer", mustFail: ["a:names-region"] },
  { id: "P1.c", script: "goals/coordinators/files-tasks-down-the-owners-chain/run.mts" },
  { id: "P1.d", script: "goals/coordinators/hands-each-post-to-its-delegates/run.mts" },
  { id: "P1.d", script: "goals/coordinators/routes-a-follow-up-by-its-conversation/run.mts" },
  { id: "J4", script: "goals/hand-offs/survives-a-restart-and-runs-once/legs/parked.mts" },
  { id: "J4", script: "goals/hand-offs/survives-a-restart-and-runs-once/legs/parked.mts", control: "fresh-store", mustFail: ["j:answered"] },
];

const LOGS = join(goalTmpDir("survives-a-restart-and-runs-once"), "logs", RUN_STAMP);
const say = (s: string) => console.error(`[closure ${new Date().toISOString().slice(11, 19)}] ${s}`);
const git = (...args: string[]) => execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" }).trim();

/** The commit every check runs on, or why there is none: a dirty tree has no one commit. */
function cleanHead(): string {
  const dirty = git("status", "--porcelain");
  if (dirty !== "") throw new Error(`the tree is dirty, so no one commit is under test:\n${dirty}`);
  return git("rev-parse", "HEAD");
}

/** Run one check as its own process; its output goes to the terminal and to its log. */
function run(check: Check, log: string): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    const file = createWriteStream(log);
    let output = "";
    const child = spawn(join(REPO_ROOT, "node_modules", ".bin", "tsx"), [join(REPO_ROOT, check.script)], {
      cwd: REPO_ROOT,
      env: { ...process.env, GOAL_CONTROL: check.control ?? "" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const take = (chunk: Buffer) => {
      output += String(chunk);
      file.write(chunk);
      process.stderr.write(chunk);
    };
    child.stdout.on("data", take);
    child.stderr.on("data", take);
    child.on("exit", (code) => file.end(() => resolve({ code: code ?? 1, output })));
  });
}

/** The tags a FAIL verdict lists, in order: `- one-row — …` gives `one-row`. */
function failedTags(output: string): string[] {
  const verdict = output.slice(output.lastIndexOf("FAIL —"));
  return [...new Set([...verdict.matchAll(/^\s+- (\S+) —/gm)].map((m) => m[1]!))];
}

await runGoal(async (failures) => {
  const sha = cleanHead();
  mkdirSync(LOGS, { recursive: true });
  say(`one commit for every check: ${sha}; logs in ${LOGS}`);
  const rows: string[] = [];
  for (const [index, check] of CHECKS.entries()) {
    const name = `${check.id} ${check.script.split("/").slice(-2).join("/")}${check.control ? ` GOAL_CONTROL=${check.control}` : ""}`;
    const now = cleanHead();
    if (now !== sha) throw new Error(`HEAD moved from ${sha} to ${now} before ${name}; the checks would not share a commit`);
    const log = join(LOGS, `${String(index + 1).padStart(2, "0")}-${check.id}${check.control ? `-${check.control}` : ""}.log`);
    say(`${sha.slice(0, 9)} · ${name} · starting`);
    const { code, output } = await run(check, log);
    if (/^\s+- blocked:/m.test(output)) {
      rows.push(`${sha.slice(0, 9)} · ${name} · BLOCKED · ${log}`);
      failures.push(`${name}: blocked, so the run stops here (${log})`);
      break;
    }
    let verdict: string;
    if (check.control === undefined) {
      verdict = code === 0 ? "PASS" : `FAIL (${failedTags(output).join(", ")})`;
      if (code !== 0) failures.push(`${name}: FAIL — a finding (${log})`);
    } else {
      const missed = (check.mustFail ?? []).filter((tag) => !output.includes(`${tag} failed, as it must`));
      const atSetup = /^\s+- setup —/m.test(output);
      verdict =
        code !== 0 && missed.length === 0 && !atSetup
          ? `FAIL as it must at ${check.mustFail!.join(", ")} (all red: ${failedTags(output).join(", ")})`
          : `control did not fail as it must${missed.length > 0 ? `: ${missed.join(", ")} stayed green` : ""}${atSetup ? ": it failed at setup" : ""}${code === 0 ? ": it passed" : ""}`;
      if (verdict.startsWith("control did not")) failures.push(`${name}: ${verdict} — a finding against the control (${log})`);
    }
    rows.push(`${sha.slice(0, 9)} · ${name} · ${verdict} · ${log}`);
    say(rows.at(-1)!);
  }
  console.error(`\nverdicts on ${sha}:\n${rows.map((r) => `  ${r}`).join("\n")}`);
  return { failures, evidence: `every check on ${sha}:\n${rows.map((r) => `  ${r}`).join("\n")}` };
});
