/** Throwaway reproduction — deleted before commit. */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { ResolvedConductor } from "../../src/config/define";
import type { Dispatcher } from "../../src/dispatch/types";
import { localObserver } from "../../src/local/observe";
import { openSubmission, submissionDir } from "../../src/local/store";
import { DEFAULT_POLICY } from "../../src/model/world";
import { openConductor, type ConductorSession } from "../../src/runtime/session";
import { fileStateStore, type StateRecord, type StateStore } from "../../src/runtime/store";
import { fakeDispatcher } from "../../src/testing/fake";
import { createTestRepo, type TestRepo } from "../local/repo";

const ENTITY = "FIX-1";
const T1 = "2026-08-02T00:00:00Z";

let repo: TestRepo;
let statePath: string;

afterEach(async () => {
  await repo?.cleanup();
  if (statePath) await fs.rm(statePath, { recursive: true, force: true });
});

function configFor(dispatcher: Dispatcher): ResolvedConductor {
  return {
    repoRoot: repo.root,
    repo: { host: "github.com", owner: "fixpoint-labs", repo: "flow-state-dev" },
    remote: "origin",
    remoteUrl: null,
    baseBranch: "main",
    token: "",
    dispatcher,
    guidance: ["docs/philosophy.md"],
    goalCheck: null,
    policy: DEFAULT_POLICY,
    origins: {
      repoRoot: "discovered",
      repo: "discovered",
      baseBranch: "discovered",
      dispatcher: "discovered",
    },
  };
}

function testClock(): () => Date {
  let millis = Date.parse("2026-08-20T12:00:00Z");
  return () => new Date((millis += 1000));
}

async function open(dispatcher: Dispatcher, store?: StateStore): Promise<ConductorSession> {
  const observer = localObserver({ repoRoot: repo.root, baseBranch: "main", git: repo.git });
  return openConductor({
    config: configFor(dispatcher),
    statePath,
    observer,
    store,
    git: repo.git,
    now: testClock(),
  });
}

function storeDyingAfter(
  inner: StateStore,
  matches: (key: string, state: StateRecord) => boolean,
): StateStore {
  let dead = false;
  return {
    ...inner,
    async write(address, key, state) {
      if (dead) throw new Error(`the process died before it could write ${key}`);
      await inner.write(address, key, state);
      if (matches(key, state)) dead = true;
    },
  };
}

async function submit(branch: string): Promise<{ number: number; head: string }> {
  await repo.run("checkout", "-q", "-b", branch, "main");
  const head = await repo.commit("operations.ts", "// work\n", `work on ${branch}`, T1);
  await repo.run("checkout", "-q", "main");
  const submission = await openSubmission(repo.root, branch, "main", T1);
  return { number: submission.number, head };
}

async function comment(number: number, name: string, body: string): Promise<void> {
  const file = path.join(submissionDir(repo.root, number), "comments", name);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, body);
}

describe("scratch", () => {
  it("re-dispatches feedback it already handled when the cursor never landed", async () => {
    repo = await createTestRepo();
    statePath = await fs.mkdtemp(path.join(os.tmpdir(), "conductor-scratch-"));
    const submission = await submit(`fix/${ENTITY}`);

    const first = fakeDispatcher({
      isolation: "remote",
      results: [{ produced: { pullNumber: submission.number } }],
    });
    const session = await open(first);
    await session.manage({
      id: ENTITY,
      kind: "issue",
      issueType: "Bug",
      phase: "IMPLEMENTATION",
      summary: "Add a `reverse` operation to the registry.",
    });
    await session.tick(ENTITY);
    await session.tick(ENTITY);
    expect(first.actionsRun()).toEqual(["implement"]);

    await comment(submission.number, "alice.1.md", "This needs a test.\n");

    const dying = fakeDispatcher({ isolation: "remote" });
    const doomed = await open(
      dying,
      storeDyingAfter(
        fileStateStore(statePath),
        (key, state) =>
          key.startsWith("dispatches/") &&
          state.action === "addressFeedback" &&
          state.outcome !== null,
      ),
    );
    await expect(doomed.tick(ENTITY)).rejects.toThrow(/the process died/);
    expect(dying.actionsRun()).toEqual(["addressFeedback"]);

    const second = fakeDispatcher({ isolation: "remote" });
    const resumed = await open(second);
    const ticked = await resumed.tick(ENTITY);

    console.log("actions after restart:", second.actionsRun());
    console.log("ledger:", ticked.ledger.map((r) => `${r.seq}:${r.signalKind}->${r.actionKind}`));
    console.log("dispatchCount:", ticked.dispatchCount);
  });
});
