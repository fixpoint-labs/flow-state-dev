/**
 * A feature run on a project is done only when the project's checks pass.
 *
 * The Lab's coder runs in a checkout of the project's repository, and the
 * project entry names the commands (`checks`). The repository carries a check
 * that is red until `state.txt` says "ok". The coder is a stub that commits
 * `state.txt`: "broken" on its first attempt, "ok" on its second. So the
 * first attempt is not done, and its brief is how the second attempt learns
 * why; the second completes. A project that names no checks completes on the
 * same broken commit, which is the control that the checks are what held it.
 *
 * `setup` runs in each fresh checkout before the run: here it writes a marker
 * the check also requires, so a green check also proves setup ran first.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { inMemoryStores } from "@flow-state-dev/engine";
import { harnessStub } from "@flow-state-dev/harness-manager";
import { openLab, type Lab } from "../teams/devteam/host.mts";
import { createBareRemote } from "../teams/devteam/scratch-repo.mts";

const CODER = "eng.coder";

/** Red unless `state.txt` says "ok", and unless setup left its marker. */
const CHECK = [
  `import { existsSync, readFileSync } from "node:fs";`,
  `if (!existsSync(".set-up")) { console.error("SETUP-MARKER missing"); process.exit(5); }`,
  `const state = existsSync("state.txt") ? readFileSync("state.txt", "utf8").trim() : "";`,
  `if (state !== "ok") { console.error("CHECK-MARKER: state is " + JSON.stringify(state)); process.exit(3); }`,
  `console.log("all good");`,
].join("\n");

let opened: Lab | undefined;
afterEach(async () => {
  await opened?.dispose();
  opened = undefined;
});

const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, stdio: "pipe" });

/** A Lab whose one project names `checks`, and a coder that commits `state.txt` per attempt. */
async function open(checks: string[]) {
  const remote = createBareRemote("project-checks", { seed: { "README.md": "storefront\n", "check.mjs": `${CHECK}\n`, ".gitignore": "**/.fsdev/\n.set-up\n" } });
  const states = ["broken", "ok"];
  const stub = harnessStub({
    duringRun: (run) => {
      writeFileSync(join(run.cwd, "state.txt"), `${states.shift() ?? "ok"}\n`);
      git(run.cwd, "add", "state.txt");
      git(run.cwd, "commit", "--quiet", "-m", "scripted: write state");
    },
    finalMessage: "Wrote state.txt.",
  });
  opened = await openLab({
    stores: inMemoryStores(),
    harness: stub.slot,
    runTimeoutMs: 30_000,
    workspace: {
      root: mkdtempSync(join(tmpdir(), "sm-project-checks-")),
      remotes: { allow: ["file"] },
      setup: { command: [process.execPath, "-e", `require("node:fs").writeFileSync(".set-up", "")`] },
    },
    coderWorkerId: CODER,
    withoutJudge: true,
    projects: [{ id: "storefront", title: "Storefront", repository: remote.url, checks }],
  });
  return { lab: opened, stub };
}

/** File one feature task on Storefront and drain until it ends. */
async function runFeature(lab: Lab, issue: string) {
  const filed = await lab.file("eng.em", {
    issue,
    goal: "Make the storefront check pass.",
    maxAttempts: 2,
    project: { visibility: "shared", id: "storefront" },
  });
  expect(filed.error).toBeUndefined();
  let row = await lab.featureRow(issue);
  for (let i = 0; i < 200 && (row === undefined || row.status === "pending" || row.status === "in_progress"); i += 1) {
    await lab.drain("eng.em");
    row = await lab.featureRow(issue);
  }
  return row;
}

describe("a feature run on a project with checks", () => {
  it("is not done while a check is red, and its next attempt is told which command and why", async () => {
    const { lab, stub } = await open(["node check.mjs"]);
    const row = await runFeature(lab, "FIX-1");
    expect(row?.status, JSON.stringify(row?.error ?? null)).toBe("completed");
    expect(row?.attempts).toBe(2);
    expect(stub.runs).toHaveLength(2);
    // The second brief names the red command and the end of its output.
    expect(stub.runs[1]!.prompt).toContain("node check.mjs");
    expect(stub.runs[1]!.prompt).toContain('CHECK-MARKER: state is "broken"');
    expect(stub.runs[0]!.prompt).not.toContain("CHECK-MARKER");
  }, 120_000);

  it("completes on the broken commit when the project names no checks", async () => {
    const { lab, stub } = await open([]);
    const row = await runFeature(lab, "FIX-2");
    expect(row?.status, JSON.stringify(row?.error ?? null)).toBe("completed");
    expect(row?.attempts).toBe(1);
    expect(stub.runs).toHaveLength(1);
  }, 120_000);
});
