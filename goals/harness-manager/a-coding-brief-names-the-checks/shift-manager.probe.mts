/**
 * Shift Manager's half of the coding-brief goal: one feature task on a
 * project whose checks are `GOAL_CHECK`, filed by the EM and run by the coder
 * through Shift Manager's own host, with the harness slot swapped for
 * harness-manager's stub, which records the prompt each attempt was handed.
 * Prints `{ "prompts": [...] }` on stdout.
 *
 * Run by `run.mts` from inside the tree it grades (this checkout or a commit's
 * own), so every import below resolves to that tree.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inMemoryStores } from "@flow-state-dev/engine";
import { harnessStub } from "@flow-state-dev/harness-manager";
import { openLab } from "../../../packages/shift-manager/teams/devteam/host.mts";
import { createBareRemote } from "../../../packages/shift-manager/teams/devteam/scratch-repo.mts";
import { readyHarness } from "../../../packages/shift-manager/teams/devteam/harness.mts";

const check = process.env.GOAL_CHECK;
const script = process.env.GOAL_CHECK_FILE;
if (check === undefined || script === undefined) throw new Error("GOAL_CHECK and GOAL_CHECK_FILE are set by run.mts");

const remote = createBareRemote("coding-brief", {
  seed: { "README.md": "storefront\n", [script]: "console.log('ok');\n", ".gitignore": "**/.fsdev/\n" },
});
const stub = harnessStub({
  duringRun: (run) => {
    writeFileSync(join(run.cwd, "NOTE.md"), "a change\n");
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "add", "NOTE.md"], { cwd: run.cwd });
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "--quiet", "-m", "goal: a change"], { cwd: run.cwd });
  },
  finalMessage: "Changed NOTE.md.",
});
const lab = await openLab({
  stores: inMemoryStores(),
  harnesses: [readyHarness(stub.slot)],
  runTimeoutMs: 30_000,
  workspace: { root: mkdtempSync(join(tmpdir(), "coding-brief-sm-")), remotes: { allow: ["file"] } },
  coderWorkerId: "eng.coder",
  withoutJudge: true,
  projects: [{ id: "storefront", title: "Storefront", repository: remote.url, checks: [check] }],
} as never);
try {
  const filed = await lab.file("eng.em", { issue: "FIX-1", goal: "Add a note to the storefront.", maxAttempts: 1, project: { visibility: "shared", id: "storefront" } });
  if (filed.error !== undefined) throw new Error(`filing: ${filed.error}`);
  for (let i = 0; i < 200 && stub.runs.length === 0; i += 1) await lab.drain("eng.em");
  process.stdout.write(`${JSON.stringify({ prompts: stub.runs.map((run) => run.prompt), error: null })}\n`);
} finally {
  await lab.dispose();
}
process.exit(0);
