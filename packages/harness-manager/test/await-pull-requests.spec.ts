/**
 * A coding task whose run opened a pull request is done when that pull
 * request merges (FIX-2578), with `awaitPullRequests` on.
 *
 * Driven through the claim gate on a board read from the claim (`./claim-host`):
 * a real board, real fenced settlement and a real git checkout. The harness is
 * the host's scripted stub, and `gh` is a stub on `PATH` that answers from a
 * state the test sets: the branch check finds pull request 7 on the run's
 * branch, so it lands on the session's record stamped with the run's request,
 * and a read of `repos/acme/app/pulls/7` says what the test says its state is.
 *
 * What a person relies on: while the pull request is open the task stays
 * open, waiting on it, and takes their line as one more run on the same
 * session; once it merges a wake completes the task without a run; once it is
 * closed unmerged a wake cancels it; and while GitHub can't be read nothing
 * settles it either way.
 */
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { pullRequestKey } from "@flow-state-dev/core/harness";
import { untakenSteers } from "@flow-state-dev/orchestration/internal";
import { openHolds, type Task } from "@flow-state-dev/orchestration/tasks";
import { CLOSED_WITHOUT_MERGING, pullRequestWait } from "../src";
import { CONVERSATIONS, claimHost, cleanUpHosts, messageOf } from "./claim-host";

const PR_7 = pullRequestKey({ host: "github.com", owner: "acme", name: "app", number: 7 });

/** What the stub `gh` answers: which pull requests the branch has, each one's state, and whether reads fail. */
interface GhState {
  listed: number[];
  states: Record<number, "open" | "merged" | "closed">;
  fail?: boolean;
}

const PATH = process.env.PATH;
let bin: string;
let ghState: string;
let ghLog: string;

const setGh = (state: GhState) => writeFileSync(ghState, JSON.stringify(state));
/** The reads of one pull request the stub answered (not the branch listings). */
const prReads = () =>
  readFileSync(ghLog, "utf8")
    .split("\n")
    .filter((line) => /\/pulls\/\d+$/.test(line));

beforeAll(() => {
  bin = mkdtempSync(join(tmpdir(), "harness-manager-await-prs-"));
  ghState = join(bin, "state.json");
  ghLog = join(bin, "calls.log");
  writeFileSync(ghLog, "");
  writeFileSync(
    join(bin, "gh"),
    `#!/usr/bin/env node
const fs = require("node:fs");
const path = process.argv[process.argv.length - 1];
fs.appendFileSync(${JSON.stringify(ghLog)}, path + "\\n");
const state = JSON.parse(fs.readFileSync(${JSON.stringify(ghState)}, "utf8"));
const url = (n) => "https://github.com/acme/app/pull/" + n;
if (path.includes("/pulls?")) {
  process.stdout.write(JSON.stringify(state.listed.map((n) => ({
    number: n, html_url: url(n), title: "Pull request " + n, state: "open", draft: false, merged_at: null,
    created_at: new Date().toISOString(), head: { ref: "b" },
  }))));
  process.exit(0);
}
const read = /pulls\\/(\\d+)$/.exec(path);
if (read !== null) {
  if (state.fail) { process.stderr.write("gh: not logged in\\n"); process.exit(1); }
  const n = Number(read[1]);
  const s = state.states[n] ?? "open";
  process.stdout.write(JSON.stringify({
    number: n, html_url: url(n), title: "Pull request " + n,
    state: s === "open" ? "open" : "closed", merged: s === "merged",
    merged_at: s === "merged" ? "2026-11-07T00:00:00Z" : null,
    head: { ref: "b", sha: "abc", repo: { full_name: "acme/app" } }, base: { repo: { full_name: "acme/app" } },
  }));
  process.exit(0);
}
process.stderr.write("unexpected gh call: " + path + "\\n");
process.exit(1);
`,
  );
  chmodSync(join(bin, "gh"), 0o755);
  process.env.PATH = `${bin}${delimiter}${PATH ?? ""}`;
});

afterEach(() => writeFileSync(ghLog, ""));

afterAll(() => {
  process.env.PATH = PATH;
  rmSync(bin, { recursive: true, force: true });
  cleanUpHosts();
});

const AT = { ledgerId: CONVERSATIONS, partition: "conv-a" } as const;

type Lab = ReturnType<typeof claimHost>;

/** A host whose manager waits on pull requests, with task t1 filed. */
async function waitingLab(options: { manager?: Record<string, unknown> } = {}): Promise<Lab> {
  const lab = claimHost({ mode: "claim", manager: { awaitPullRequests: true, ...options.manager } });
  await lab.seed({ ...AT, id: "t1", goal: "fix the bug", input: {} });
  return lab;
}

const run = async (lab: Lab) => {
  const attempt = await lab.runAttempt(CONVERSATIONS, "t1", "conv-a");
  expect(attempt.result.error, messageOf(attempt.result.error)).toBeUndefined();
  return attempt.result as { output?: unknown; items?: Array<{ type?: string; content?: unknown; message?: unknown }> };
};
const row = (lab: Lab) => lab.row(CONVERSATIONS, "t1", "conv-a");
/** A person's line typed in the task's session. */
const line = (lab: Lab, message: string) => lab.act("line", { ...AT, id: "t1", message });
const statusText = (result: { items?: unknown[] }) => JSON.stringify(result.items ?? []);
/** The wait's pull requests, as a screen reads them. */
const waitedOn = (task: Task) => pullRequestWait(task)?.pullRequests.map((pr) => pr.number);

describe("a coding task whose run opened a pull request", () => {
  it("waits on the pull request instead of completing, on one external hold naming it", async () => {
    setGh({ listed: [7], states: { 7: "open" } });
    const lab = claimHost({ mode: "claim", manager: { awaitPullRequests: true } });
    await lab.seed({ ...AT, id: "t1", goal: "fix the bug", input: {} });

    const first = await lab.runAttempt(CONVERSATIONS, "t1", "conv-a");
    expect(first.result.error, messageOf(first.result.error)).toBeUndefined();

    const row = await lab.row(CONVERSATIONS, "t1", "conv-a");
    // Not done: the work is a pull request nobody merged yet.
    expect(row.status).toBe("in_progress");
    expect(row.leaseUntil ?? undefined).toBeUndefined();
    const holds = openHolds(row);
    expect(holds).toHaveLength(1);
    expect(holds[0]).toMatchObject({
      actor: "system",
      ask: { kind: "external" },
      source: { kind: "row", closedBy: [{ by: "event", event: "pull-request", key: PR_7 }] },
    });
    expect(holds[0]).not.toHaveProperty("midway");
    // A screen reads the wait back as one line: the pull request it waits on.
    expect(waitedOn(row)).toEqual([7]);
  }, 60_000);

  it("with the option off, completes as it does today: the control", async () => {
    setGh({ listed: [7], states: { 7: "open" } });
    const lab = claimHost({ mode: "claim" });
    await lab.seed({ ...AT, id: "t1", goal: "fix the bug", input: {} });
    await run(lab);
    const done = await row(lab);
    expect(done.status).toBe("completed");
    expect(openHolds(done)).toEqual([]);
    // Nothing asked GitHub about the pull request itself.
    expect(prReads()).toEqual([]);
  }, 60_000);

  it("a run that opened no pull request settles as today, with the option on", async () => {
    setGh({ listed: [], states: {} });
    const lab = await waitingLab();
    await run(lab);
    expect((await row(lab)).status).toBe("completed");
    expect(prReads()).toEqual([]);
  }, 60_000);

  it("a line while the pull request is open is one more run on the same attempt and session, and the task waits again", async () => {
    setGh({ listed: [7], states: { 7: "open" } });
    const lab = await waitingLab();
    await run(lab);

    expect(await line(lab, "fix the lint")).toMatchObject({ output: null });
    const woken = await row(lab);
    // The line ended the wait and owes the same attempt a turn: nothing else moved.
    expect(openHolds(woken)).toEqual([]);
    expect(woken).toMatchObject({ status: "in_progress", attempts: 1, turnOwed: true });

    await run(lab);
    expect(lab.seen).toHaveLength(2);
    // The same coding session and checkout, the line reaching the run as news on its pull request.
    expect(lab.seen[1]!.resume).toBe("sess_1");
    expect(lab.seen[1]!.cwd).toBe(lab.seen[0]!.cwd);
    expect(lab.seen[1]!.prompt).toContain("News on your pull request");
    expect(lab.seen[1]!.prompt).toContain("fix the lint");
    // Not shown as a question answered: nothing asked it.
    expect(lab.seen[1]!.prompt).not.toContain("ANSWERED:");
    const again = await row(lab);
    expect(again).toMatchObject({ status: "in_progress", attempts: 1 });
    expect(openHolds(again).map((hold) => hold.ask.kind)).toEqual(["external"]);
    expect(waitedOn(again)).toEqual([7]);
    expect(untakenSteers(again)).toEqual([]);
  }, 60_000);

  it("merged: a line completes the task with the pull request on its output, and no harness run", async () => {
    setGh({ listed: [7], states: { 7: "open" } });
    const lab = await waitingLab();
    await run(lab);

    setGh({ listed: [7], states: { 7: "merged" } });
    await line(lab, "merged it, thanks");
    const result = await run(lab);

    expect(lab.seen).toHaveLength(1);
    const done = await row(lab);
    expect(done.status).toBe("completed");
    expect(done.attempts).toBe(1);
    expect(done.output).toMatchObject({
      sessionId: "sess_1",
      answer: "done",
      pullRequests: [{ number: 7, state: "merged", url: "https://github.com/acme/app/pull/7" }],
    });
    expect(result.output).toMatchObject({ pullRequests: [{ number: 7, state: "merged" }] });
    // The wake's line is taken with it: nothing is left owed on the finished task.
    expect(untakenSteers(done)).toEqual([]);
  }, 60_000);

  it("closed without merging: a line cancels the task with the reason, and no harness run", async () => {
    setGh({ listed: [7], states: { 7: "open" } });
    const lab = await waitingLab();
    await run(lab);

    setGh({ listed: [7], states: { 7: "closed" } });
    await line(lab, "closed it");
    await run(lab);

    expect(lab.seen).toHaveLength(1);
    const ended = await row(lab);
    // Not completed: the filer would read that as the work delivered (D2).
    expect(ended.status).toBe("cancelled");
    expect(JSON.stringify(ended)).toContain(CLOSED_WITHOUT_MERGING);
    expect(openHolds(ended)).toEqual([]);
  }, 60_000);

  it("one merged and one closed: completes, the closed one noted on the output", async () => {
    setGh({ listed: [7, 8], states: { 7: "open", 8: "open" } });
    const lab = await waitingLab();
    await run(lab);
    expect(waitedOn(await row(lab))).toEqual([7, 8]);

    setGh({ listed: [7, 8], states: { 7: "merged", 8: "closed" } });
    await line(lab, "merged one, dropped the other");
    await run(lab);

    expect(lab.seen).toHaveLength(1);
    const done = await row(lab);
    // Some work landed, so it is done; the dropped one is said, not hidden.
    expect(done.status).toBe("completed");
    expect((done.output as { pullRequests: unknown[] }).pullRequests).toEqual([
      expect.objectContaining({ number: 7, state: "merged" }),
      expect.objectContaining({ number: 8, state: "closed" }),
    ]);
  }, 60_000);

  it("one still open beside a merged one: the line runs, and the task waits again", async () => {
    setGh({ listed: [7, 8], states: { 7: "open", 8: "open" } });
    const lab = await waitingLab();
    await run(lab);
    setGh({ listed: [7, 8], states: { 7: "merged", 8: "open" } });
    await line(lab, "one is in");
    await run(lab);
    expect(lab.seen).toHaveLength(2);
    expect((await row(lab)).status).toBe("in_progress");
    expect(openHolds(await row(lab)).map((hold) => hold.ask.kind)).toEqual(["external"]);
  }, 60_000);

  it("unreadable (gh signed out): the line runs, the task waits again with a status note, and nothing settles it", async () => {
    setGh({ listed: [7], states: { 7: "open" } });
    const lab = await waitingLab();
    await run(lab);

    setGh({ listed: [7], states: { 7: "merged" }, fail: true });
    await line(lab, "is it in?");
    const result = await run(lab);

    // Neither merged nor closed is believed without a read.
    expect(lab.seen).toHaveLength(2);
    const still = await row(lab);
    expect(still.status).toBe("in_progress");
    expect(openHolds(still).map((hold) => hold.ask.kind)).toEqual(["external"]);
    expect(statusText(result)).toContain("couldn't be read from GitHub");
    expect(statusText(result)).toContain("not logged in");
  }, 60_000);

  it("the first settle decides over the task's closed pull requests too: all closed before the run ended cancels it", async () => {
    setGh({ listed: [7], states: { 7: "closed" } });
    const lab = await waitingLab();
    await run(lab);
    const ended = await row(lab);
    expect(ended.status).toBe("cancelled");
    expect(JSON.stringify(ended)).toContain(CLOSED_WITHOUT_MERGING);
  }, 60_000);

  it("the first settle completes a task whose pull request already merged, with it on the output", async () => {
    setGh({ listed: [7], states: { 7: "merged" } });
    const lab = await waitingLab();
    await run(lab);
    const done = await row(lab);
    expect(done.status).toBe("completed");
    expect(done.output).toMatchObject({ pullRequests: [{ number: 7, state: "merged" }] });
  }, 60_000);

  it("survives a restart: the wait and its pull request are persisted, and a merge then completes it on the new host", async () => {
    setGh({ listed: [7], states: { 7: "open" } });
    const before = await waitingLab();
    await run(before);

    // A new engine and manager over the same stores and checkouts: nothing in memory carries over.
    const after = claimHost({ mode: "claim", manager: { awaitPullRequests: true }, restartOf: { dir: before.dir, stores: before.stores } });
    const kept = await row(after);
    expect(openHolds(kept).map((hold) => [hold.actor, hold.ask.kind])).toEqual([["system", "external"]]);
    expect(waitedOn(kept)).toEqual([7]);

    setGh({ listed: [7], states: { 7: "merged" } });
    await line(after, "merged");
    await run(after);
    expect(after.seen).toHaveLength(0);
    expect((await row(after)).status).toBe("completed");
  }, 60_000);

  it("a cancel while it waits leaves nothing open, and no run starts", async () => {
    setGh({ listed: [7], states: { 7: "open" } });
    const lab = await waitingLab();
    await run(lab);
    await lab.act("cancel", { ...AT, id: "t1" });
    const cancelled = await row(lab);
    expect(cancelled.status).toBe("cancelled");
    expect(openHolds(cancelled)).toEqual([]);
    expect(pullRequestWait(cancelled)).toBeNull();
    await expect(lab.runAttempt(CONVERSATIONS, "t1", "conv-a")).rejects.toThrow(/not claimable/);
    expect(lab.seen).toHaveLength(1);
  }, 60_000);
});
