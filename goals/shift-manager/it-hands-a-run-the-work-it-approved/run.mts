/**
 * Goal check — a coding run started from Shift Manager is handed the work a
 * person approved.
 *
 * The DevTeam tree, opened through `openLab` the way the `devteam` profile
 * opens it: the EM seat's ask raised at boot, the feature channel's door on
 * and its members addressed. A person approves the pending ask the way Shift
 * Manager's Inbox does (the engine's resume route, with the lab's verified
 * bearer), or posts `slug: what to build` on the workstream. What is graded is
 * what the coding run received or produced, never the row.
 *
 * Legs (`GOAL_LEG=a` or `GOAL_LEG=b` runs one; unset runs both):
 *
 *   0   held-out    — the fixture's goals and posted line live in no lab code
 *                     and no tree file; the seat, charter and coordinator
 *                     tokens each live in exactly the file named for them
 *   a1  BR-1 BR-3 BR-5 BR-6 BR-7 BR-8 — Approve: the stub's recorded prompt
 *                     opens on the approved goal, carries the charter and the
 *                     coder seat's own tokens, names its checkout and branch,
 *                     and carries none of the coordinator's tokens nor the
 *                     line posted on the channel before the approval
 *   a2  BR-1        — a second held-out feature, filed by a post: its run's
 *                     prompt carries that goal and not the first one
 *   a3  BR-4        — the coder removed from the channel's `members` on a tree
 *                     copy: the prompt carries the goal and no charter
 *   a4  BR-6        — with acceptance required, the run's terms say the
 *                     acceptance check decides; without, they do not
 *   b   BR-1 BR-13  — a real coding harness (Claude Code through its Agent
 *                     SDK) in the slot: the commit it leaves on its branch
 *                     carries the held-out token the approved goal names
 *
 * Model-free except leg b. Leg b has no stub fallback: a model-backed leg that
 * quietly ran the stub would be reported as a model's.
 *
 * Control: `GOAL_CONTROL=drop-task` builds the lab's phase so its prompt
 * builder ignores the task the manager hands it. Leg a must FAIL on "the
 * prompt does not carry the approved goal", leg b on "the commit does not
 * carry the goal's token". `GOAL_CONTROL=list` prints it.
 *
 * Run: pnpm tsx goals/shift-manager/it-hands-a-run-the-work-it-approved/run.mts
 */

import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { inMemoryStores } from "@flow-state-dev/engine";
import { GIT_TIMEOUT_MS } from "@flow-state-dev/harness-manager/checkout";
import { harnessRunHandleSchema, harnessRunInputSchema, handler, sequencer } from "@flow-state-dev/core";
import type { HarnessBlock } from "@flow-state-dev/core/types";
import { z } from "zod";
import { loadFixture, runGoal, silentLogger, stripIntentOverrides } from "../../lib/index.mts";
import { claudeCodeHarness } from "../../devforce-lab/lab/harness.mts";
import { harnessStub, type StubRun } from "../../devforce-lab/lab/harness-stub.mts";
import { LAB_TREE, openLab, type Lab, type OpenLabOptions } from "../../devforce-lab/lab/host.mts";
import { createNotifyLog } from "../../devforce-lab/lab/notify.mts";
import { BASE_REF, commitAll, createScratchRepo } from "../../devforce-lab/lab/scratch-repo.mts";
import { seatSessionId } from "../../devforce-lab/lab/ask.mts";

stripIntentOverrides();

interface Feature {
  issue: string;
  goal: string;
}

interface Fixture {
  approved: Feature;
  posted: Feature;
  chatter: string;
  realRun: Feature & { file: string; token: string };
  coordinatorSeat: string;
  assignedSeat: string;
  seatTokens: Record<string, string>;
  coordinatorTokens: Record<string, string>;
  charterToken: Record<string, string>;
  wait: { timeoutMs: number; pollMs: number };
}

const fixture = loadFixture<Fixture>(import.meta.url);
const { wait } = fixture;

const CONTROL = process.env.GOAL_CONTROL ?? "";
const CONTROLS = ["drop-task"] as const;
if (CONTROL === "list") {
  console.log(`controls: ${CONTROLS.join(", ")}`);
  process.exit(0);
}
if (CONTROL !== "" && !(CONTROLS as readonly string[]).includes(CONTROL)) {
  console.error(`unknown GOAL_CONTROL "${CONTROL}"; known: ${CONTROLS.join(", ")}`);
  process.exit(2);
}
const LEG = process.env.GOAL_LEG ?? "";
if (LEG !== "" && LEG !== "a" && LEG !== "b") {
  console.error(`unknown GOAL_LEG "${LEG}"; known: a, b`);
  process.exit(2);
}

const LAB_ROOT = fileURLToPath(new URL("../../devforce-lab/lab", import.meta.url));
const CHARTER_TOKEN = Object.keys(fixture.charterToken)[0]!;
const REAL_RUN_TIMEOUT_MS = 10 * 60_000;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Every file under a directory, recursively, as [relative path, contents]. */
function filesUnder(root: string, prefix = ""): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const entry of readdirSync(root)) {
    const full = join(root, entry);
    const rel = prefix === "" ? entry : `${prefix}/${entry}`;
    if (statSync(full).isDirectory()) out.push(...filesUnder(full, rel));
    else out.push([rel, readFileSync(full, "utf8")]);
  }
  return out;
}

/** A recorded stub run, plus the branch its checkout was on. */
interface SeenRun extends StubRun {
  branch: string;
}

/** What the stub's run "did": record its branch, write a file, commit. */
function stubFor(seen: SeenRun[]) {
  return harnessStub({
    duringRun: (run: StubRun) => {
      const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
        cwd: run.cwd,
        encoding: "utf8",
        timeout: GIT_TIMEOUT_MS,
      }).trim();
      seen.push({ ...run, branch });
      writeFileSync(join(run.cwd, "WORK.md"), "work\n");
      commitAll(run.cwd, "work");
    },
  });
}

/** Open the DevTeam tree as the `devteam` profile does, for `ask`. */
async function open(
  label: string,
  harness: OpenLabOptions["harness"],
  ask: Feature,
  over: Partial<OpenLabOptions> = {},
): Promise<{ lab: Lab; sourceRepo: string }> {
  const dirs = createScratchRepo(label);
  const lab = await openLab({
    stores: inMemoryStores(),
    harness,
    workspace: { root: dirs.root, sourceRepo: dirs.sourceRepo, baseRef: BASE_REF },
    coderSeatId: fixture.assignedSeat,
    logger: silentLogger,
    channels: {
      addresses: { [fixture.coordinatorSeat]: fixture.coordinatorSeat },
      log: createNotifyLog(),
    },
    inventory: true,
    ask,
    ...(CONTROL === "drop-task" ? { dropTask: true } : {}),
    ...over,
  } as OpenLabOptions);
  return { lab, sourceRepo: dirs.sourceRepo };
}

/** Find the pending approval where Inbox finds it, and approve it as Shift Manager does. */
async function approve(lab: Lab): Promise<string | undefined> {
  const session = seatSessionId(fixture.coordinatorSeat);
  const found = await lab.door("GET", `sessions/${session}/requests?include_items=true`);
  if (found.status !== 200) return `the EM session's requests answered ${found.status}`;
  const request = (found.body.requests as any[]).find((r) => r.status === "suspended");
  const suspension = (request?.items ?? []).filter((i: any) => i.type === "suspension").at(-1);
  if (suspension === undefined) return "no pending approval in the EM seat's session";
  const approved = await lab.door("POST", `${fixture.coordinatorSeat}/requests/${request.id}/resume`, {
    body: { suspensionId: suspension.suspensionId, action: "approve" },
  });
  return approved.status === 202 ? undefined : `approve answered ${approved.status}`;
}

/** Wait until `count` runs have reached the harness. */
async function runsReach(seen: readonly unknown[], count: number, poke?: () => Promise<unknown>): Promise<void> {
  for (let waited = 0; seen.length < count && waited < wait.timeoutMs; waited += wait.pollMs) {
    await poke?.();
    await sleep(wait.pollMs);
  }
}

/** The paragraph of the prompt that names the run's checkout: the run's terms. */
function termsOf(prompt: string, cwd: string): string {
  return prompt.split(/\n\s*\n/).find((paragraph) => paragraph.includes(cwd)) ?? "";
}

/** Grade one prompt for the task it should open on. */
function gradeTask(
  leg: string,
  prompt: string,
  goal: string,
  how: "approved" | "posted",
  note: (leg: string, why: string) => void,
): void {
  if (!prompt.includes(goal)) {
    note(leg, `the prompt does not carry the ${how} goal`);
    return;
  }
  const firstSeatToken = Math.min(
    ...Object.keys(fixture.seatTokens).map((t) => prompt.indexOf(t)).filter((i) => i >= 0),
  );
  if (prompt.indexOf(goal) > firstSeatToken) {
    note(leg, "the prompt does not open on the goal: the seat's own files come before it");
  }
}

await runGoal(async () => {
  const failures: string[] = [];
  const evidence: string[] = [];
  const note = (leg: string, why: string): void => {
    failures.push(`leg ${leg}: ${CONTROL === "" ? "" : `[control ${CONTROL}] `}${why}`);
  };

  // ---- 0 · held-out --------------------------------------------------------
  {
    const tree = filesUnder(LAB_TREE);
    const code = filesUnder(LAB_ROOT).filter(([path]) => path.endsWith(".mts"));
    const heldOut = [
      fixture.approved.goal,
      fixture.posted.goal,
      fixture.chatter,
      fixture.realRun.token,
      fixture.realRun.file,
    ];
    for (const text of heldOut) {
      const carriers = [...tree, ...code].filter(([, body]) => body.includes(text)).map(([p]) => p);
      if (carriers.length > 0) note("0", `the held-out "${text}" is spelled in ${carriers.join(", ")}`);
    }
    const homes = { ...fixture.seatTokens, ...fixture.coordinatorTokens, ...fixture.charterToken };
    for (const [token, home] of Object.entries(homes)) {
      const carriers = tree.filter(([, body]) => body.includes(token)).map(([p]) => p);
      if (carriers.length !== 1 || carriers[0] !== home) {
        note("0", `token ${token} should live only in ${home}; found in [${carriers.join(", ")}]`);
      }
      if (code.some(([, body]) => body.includes(token))) note("0", `token ${token} is in the lab's code`);
    }
    if (failures.length > 0) return { failures, evidence: "" };
    evidence.push("held-out goals and the posted line live in no lab code or tree file; every graded token lives in its one file");
  }

  // ---- a · model-free, the stub records the prompt -------------------------
  if (LEG !== "b") {
    // a1, a2: the devteam boot, an Approve, then a post.
    {
      const seen: SeenRun[] = [];
      const stub = stubFor(seen);
      const { lab } = await open("handed-a1", stub.slot, fixture.approved);
      try {
        const chatter = await lab.post!(fixture.chatter);
        if (chatter.error !== undefined) note("a1", `the channel refused a line — ${chatter.error}`);
        const refused = await approve(lab);
        if (refused !== undefined) note("a1", refused);
        await runsReach(seen, 1);
        const run = seen[0];
        if (run === undefined) {
          note("a1", "the coder seat was never reached after Approve");
        } else {
          const prompt = run.prompt;
          gradeTask("a1", prompt, fixture.approved.goal, "approved", note);
          if (!prompt.includes(CHARTER_TOKEN)) note("a1", "the prompt does not carry the shared channel's charter");
          for (const token of Object.keys(fixture.seatTokens)) {
            if (!prompt.includes(token)) note("a1", `the prompt lost the coder seat's own ${token}`);
          }
          for (const token of Object.keys(fixture.coordinatorTokens)) {
            if (prompt.includes(token)) note("a1", `the prompt carries the coordinator seat's ${token}`);
          }
          if (prompt.includes(fixture.chatter)) note("a1", "the prompt carries a line posted on the channel");
          const terms = termsOf(prompt, run.cwd);
          if (terms === "") note("a1", `the prompt does not name the run's checkout ${run.cwd}`);
          else if (!terms.includes(run.branch)) note("a1", `the run's terms do not name its branch ${run.branch}`);
          else if (/acceptance/i.test(terms)) note("a1", "without acceptance required, the terms still name an acceptance check");
          evidence.push(
            `Approve: the prompt opened on the approved goal, carried the charter and the coder's ${Object.keys(fixture.seatTokens).length} tokens, named checkout and branch, and carried no coordinator token or channel line`,
          );
        }

        const posted = await lab.post!(`${fixture.posted.issue}: ${fixture.posted.goal}`);
        if (posted.error !== undefined) note("a2", `the post was refused — ${posted.error}`);
        await runsReach(seen, 2, () => lab.drain(fixture.coordinatorSeat));
        const second = seen[1];
        if (second === undefined) {
          note("a2", "the posted feature never reached the coder seat");
        } else {
          gradeTask("a2", second.prompt, fixture.posted.goal, "posted", note);
          if (second.prompt.includes(fixture.approved.goal)) note("a2", "the posted run's prompt carries the other task's goal");
          evidence.push("a post: its run's prompt carried the posted goal, and not the approved one");
        }
      } finally {
        await lab.dispose();
      }
    }

    // a3: the coder is not a member of the channel holding the task.
    {
      const root = mkdtempSync(join(tmpdir(), "devteam-tree-no-coder-member-"));
      cpSync(LAB_TREE, root, { recursive: true });
      const charterFile = join(root, fixture.charterToken[CHARTER_TOKEN]!);
      const before = readFileSync(charterFile, "utf8");
      const after = before.replace(new RegExp(`\\s*${fixture.assignedSeat.replace(".", "\\.")},?`), "");
      if (after === before) note("a3", "could not remove the coder from the channel's members");
      writeFileSync(charterFile, after);
      const seen: SeenRun[] = [];
      const stub = stubFor(seen);
      const { lab } = await open("handed-a3", stub.slot, fixture.approved, { root });
      try {
        const members = (lab.roster.channels.find((c) => c.id === lab.channelId)?.declared.members as string[] | undefined) ?? [];
        if (members.includes(fixture.assignedSeat)) note("a3", "the tree copy still lists the coder as a member");
        const refused = await approve(lab);
        if (refused !== undefined) note("a3", refused);
        await runsReach(seen, 1);
        const run = seen[0];
        if (run === undefined) {
          note("a3", "the coder seat was never reached after Approve");
        } else {
          gradeTask("a3", run.prompt, fixture.approved.goal, "approved", note);
          if (run.prompt.includes(CHARTER_TOKEN)) note("a3", "a seat that is not a member was handed the charter");
          evidence.push("a coder that is not a member got the goal and no charter");
        }
      } finally {
        await lab.dispose();
      }
    }

    // a4: with acceptance required, the terms say the acceptance check decides.
    {
      const seen: SeenRun[] = [];
      const stub = stubFor(seen);
      const { lab } = await open("handed-a4", stub.slot, fixture.approved, { requireAcceptance: true });
      try {
        const refused = await approve(lab);
        if (refused !== undefined) note("a4", refused);
        await runsReach(seen, 1);
        const run = seen[0];
        if (run === undefined) {
          note("a4", "the coder seat was never reached after Approve");
        } else if (!/acceptance check/i.test(termsOf(run.prompt, run.cwd))) {
          note("a4", "with acceptance required, the run's terms do not say the acceptance check decides");
        } else {
          evidence.push("with acceptance required, the terms named the acceptance check");
        }
      } finally {
        await lab.dispose();
      }
    }
  }

  // ---- b · a real coding harness -------------------------------------------
  if (LEG !== "a") {
    const prompts: string[] = [];
    const recordPrompt = handler({
      name: "handed-record-prompt",
      inputSchema: harnessRunInputSchema,
      outputSchema: z.object({ recorded: z.number() }),
      execute: (input: { prompt: string }) => ({ recorded: prompts.push(input.prompt) }),
    });
    const { lab, sourceRepo } = await open(
      "handed-b",
      ({ cwd, resume, onSession }) =>
        sequencer({
          name: "handed-recorded-harness",
          inputSchema: harnessRunInputSchema,
          outputSchema: harnessRunHandleSchema,
        })
          .tap(recordPrompt)
          .step(claudeCodeHarness({ cwd, resume, onSession }) as never) as unknown as HarnessBlock,
      fixture.realRun,
      { runTimeoutMs: REAL_RUN_TIMEOUT_MS },
    );
    const git = (...args: string[]): string =>
      execFileSync("git", args, { cwd: sourceRepo, encoding: "utf8", timeout: GIT_TIMEOUT_MS });
    try {
      const refused = await approve(lab);
      if (refused !== undefined) note("b", refused);
      // Wait for the run to end: its row leaves in_progress, or the bound runs out.
      const deadline = Date.now() + REAL_RUN_TIMEOUT_MS + 60_000;
      while (Date.now() < deadline) {
        const rows = Object.values(await lab.rows());
        if (prompts.length > 0 && rows.every((r) => r.status !== "in_progress" && r.status !== "pending")) break;
        await sleep(1_000);
      }
      if (prompts.length === 0) note("b", "the real harness was never reached");
      const branches = git("branch", "--list", "conductor/*", "--format=%(refname:short)")
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      const work = branches.map((branch) => git("log", "-p", `${BASE_REF}..${branch}`)).join("\n");
      if (!work.includes(fixture.realRun.token)) {
        note("b", `the commit does not carry the goal's token (${branches.length} branch(es) under conductor/)`);
      } else {
        evidence.push(`a real coding run's commit on ${branches.join(", ")} carried the approved goal's token`);
      }
    } finally {
      await lab.dispose();
    }
  }

  return { failures, evidence: evidence.join("; ") };
});
