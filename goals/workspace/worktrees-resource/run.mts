/**
 * Goal check for `goal.md` beside this file — the user's list of worktrees,
 * written by the workspace host and read by every session of the user.
 *
 * Real path, no model, out of CI: harness-manager's session flow behind the
 * engine's HTTP router, its workspace the workspace package's local host over
 * a real clone of a bare remote on disk. The harness is a stub that commits.
 * Rows are read the way a page reads them, through the flow's resource route;
 * every fact about the worktree is checked against git.
 *
 * Run:      pnpm tsx goals/workspace/worktrees-resource/run.mts
 * Controls: GOAL_CONTROL=no-row      (must FAIL every leg that reads a row)
 *           GOAL_CONTROL=no-checkout (must FAIL c:snapshot, and nothing else)
 *           GOAL_CONTROL=keep-ready  (must FAIL d:removed, and nothing else)
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handler } from "@flow-state-dev/core";
import type { HarnessBlock, HarnessCallbackContext } from "@flow-state-dev/core/types";
import { createFlowApiRouter, createFlowRegistry, createInMemoryStores, type StoreRegistry } from "@flow-state-dev/engine";
import {
  harnessSessionFlow,
  resolveHarnessSessionStart,
  type HarnessSessionFeeds,
  type HarnessSessionWorkspace,
} from "@flow-state-dev/harness-manager";
import { localWorkspaceHost, type WorktreeRow } from "@flow-state-dev/workspace";
import { z } from "zod";
import { loadFixture, runGoal, silentLogger, stripIntentOverrides } from "../../lib/index.mts";

stripIntentOverrides();

const CONTROL = process.env.GOAL_CONTROL ?? "";
const EXPECTED: Record<string, string[]> = {
  "no-row": ["a:key", "a:row", "b:attached", "c:snapshot", "d:removed", "e:same-user"],
  "no-checkout": ["c:snapshot"],
  "keep-ready": ["d:removed"],
};
if (CONTROL !== "" && EXPECTED[CONTROL] === undefined) {
  throw new Error(`unknown GOAL_CONTROL "${CONTROL}"; known: ${Object.keys(EXPECTED).join(", ")}`);
}

const fixture = loadFixture<{ title: string; subject: string }>(import.meta.url);
const KIND = "goal-worktrees";
const USER = "u_goal";
const OTHER = "u_other";

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.email=goal@example.com", "-c", "user.name=goal", ...args], { cwd, encoding: "utf8", timeout: 30_000 }).trim();
const tmp = (label: string) => mkdtempSync(join(tmpdir(), `fsd-goal-worktree-rows-${label}-`));

// ---- the repository: a bare remote and the person's clone ------------------
const remote = join(tmp("remote"), "origin.git");
const seedDir = tmp("seed");
git(seedDir, "init", "-q", "-b", "main");
git(seedDir, "commit", "-q", "--allow-empty", "-m", "first");
git(seedDir, "clone", "-q", "--bare", seedDir, remote);
const repo = join(tmp("person"), "repo");
git(join(repo, ".."), "clone", "-q", remote, repo);
const root = tmp("root");

const host = localWorkspaceHost({
  root,
  remotes: { allow: [] },
  localRepositories: [repo],
  source: () => ({ kind: "refused", reason: "unused", message: "unused" }),
});

// ---- the workspace, as an app adopting the package slice wires it ---------
const sessionBranch = (sessionId: string) => `sessions/${sessionId}`;
const workspace: HarnessSessionWorkspace = {
  provision: async (place, request) => {
    const resolved = await resolveHarnessSessionStart(request?.start, { cwd: repo });
    const existing = resolved.branch !== undefined;
    const branch = existing ? resolved.branch! : sessionBranch(place.sessionId);
    // no-row: the provision is not handed the user's list, so no row is written.
    const worktrees = CONTROL === "no-row" ? undefined : request?.worktrees;
    const made = await host.provision(
      { kind: "repo", repo, ...(resolved.baseRef !== undefined ? { baseRef: resolved.baseRef } : {}) },
      { place: [place.sessionId], branch, existing, ...(worktrees !== undefined ? { worktrees } : {}) },
    );
    return { path: made.cwd, ...(made.worktree !== undefined ? { worktree: made.worktree } : {}) };
  },
  locate: (place) => host.locate({ kind: "repo", repo }, { place: [place.sessionId] }).cwd,
  branch: (place) => sessionBranch(place.sessionId),
  remove: async (place, options) => {
    if (CONTROL === "keep-ready") {
      // A second removal path, beside the host's: the row is never told.
      git(repo, "worktree", "remove", host.locate({ kind: "repo", repo }, { place: [place.sessionId] }).cwd);
      return { branchDeleted: false };
    }
    return await host.remove!({ place: [place.sessionId] }, options);
  },
  attach: async (owner, request) => await host.attach!({ place: [owner.sessionId] }, request),
  // no-checkout: the turn-end read is left out, so the row keeps what provision wrote.
  ...(CONTROL === "no-checkout"
    ? {}
    : { recordCheckout: async (place: { sessionId: string }, request: Parameters<NonNullable<HarnessSessionWorkspace["recordCheckout"]>>[1]) => await host.recordCheckout!({ place: [place.sessionId] }, request) }),
};

// ---- the stub harness: commits once a turn; "switch" commits twice, then leaves the branch
const stubAgent = (feeds: HarnessSessionFeeds) =>
  handler({
    name: "stub-harness",
    inputSchema: z.object({ prompt: z.string() }),
    execute: async (input, ctx) => {
      const c = ctx as unknown as HarnessCallbackContext;
      await feeds.resume(c);
      const cwd = await feeds.cwd(c);
      const times = input.prompt === "switch" ? 2 : 1;
      for (let n = 0; n < times; n += 1) {
        writeFileSync(join(cwd, `turn-${Date.now()}-${n}.txt`), input.prompt);
        git(cwd, "add", "-A");
        git(cwd, "commit", "-q", "-m", fixture.subject);
      }
      if (input.prompt === "switch") git(cwd, "checkout", "-q", "-b", "agent/switched");
      return { outcome: "completed" };
    },
  }) as unknown as HarnessBlock;

const stores = createInMemoryStores() as unknown as StoreRegistry;
const registry = createFlowRegistry();
registry.registerMany([harnessSessionFlow({ kind: KIND, workspace, agent: stubAgent })]);
const router = createFlowApiRouter({ registry, stores, runtimeConfig: { logger: silentLogger } } as never);

async function create(state: Record<string, unknown>, userId = USER): Promise<string> {
  const res = await router.POST(
    new Request(`http://goal/api/flows/${KIND}/sessions`, { method: "POST", body: JSON.stringify({ userId, state }) }),
    { params: { path: [KIND, "sessions"] } },
  );
  const body = (await res.json()) as { session?: { id: string } };
  if (body.session === undefined) throw new Error(`create refused (${res.status})`);
  return body.session.id;
}

/** Send an action and wait for it to settle; a 409 from the turn before it still finishing is retried. */
async function act(sessionId: string, action: string, input: unknown): Promise<string | undefined> {
  for (let attempt = 0; ; attempt += 1) {
    const res = await router.POST(
      new Request(`http://goal/api/flows/${KIND}/${sessionId}/actions/${action}`, {
        method: "POST",
        body: JSON.stringify({ userId: USER, input }),
      }),
      { params: { path: [KIND, sessionId, "actions", action] } },
    );
    const body = (await res.json()) as { request?: { id: string } };
    if (process.env.GOAL_DEBUG) console.error(action, res.status, JSON.stringify(body).slice(0, 300));
    if (res.status === 409 && attempt < 100) {
      await new Promise((r) => setTimeout(r, 50));
      continue;
    }
    const requestId = body.request?.id;
    if (requestId === undefined) return `http ${res.status}`;
    for (let i = 0; i < 400; i += 1) {
      const record = await stores.request.get(requestId);
      if (record !== undefined && record.status !== "in_progress") {
        // The request's end-of-request work (the row read, the pull request check) runs after its status settles.
        await new Promise((r) => setTimeout(r, 100));
        return record.status;
      }
      await new Promise((r) => setTimeout(r, 25));
    }
    return undefined;
  }
}

/** The rows a page in `sessionId` sees, through the flow's resource route. */
async function rows(sessionId: string, userId = USER): Promise<WorktreeRow[]> {
  const res = await router.GET(
    new Request(`http://goal/api/flows/sessions/${sessionId}/resources/worktrees?userId=${userId}`),
    { params: { path: ["sessions", sessionId, "resources", "worktrees"] } },
  );
  const body = (await res.json()) as { items?: Array<{ clientData?: WorktreeRow }> };
  if (process.env.GOAL_DEBUG) console.error("rows", res.status, JSON.stringify(body).slice(0, 400));
  return (body.items ?? []).map((item) => item.clientData).filter((row): row is WorktreeRow => row !== undefined);
}

const stateOf = async (sessionId: string) =>
  ((await stores.session.get(sessionId))?.state ?? {}) as { workspace?: { worktree: string | null } | null };

await runGoal(async (failures, tell) => {
  const legs: Record<string, boolean> = {};
  const check = (name: string, ok: boolean, why: string) => {
    legs[name] = ok;
    if (!ok) failures.push(`${name}: ${why}`);
  };
  const evidence: string[] = [];

  // ---- leg a: the first turn writes the row -------------------------------
  const sA = await create({ model: "stub" });
  const aEnded = await act(sA, "turn", { prompt: fixture.title });
  if (aEnded !== "completed") failures.push(`setup: the first turn ended ${aEnded}`);
  const aBranch = sessionBranch(sA);
  const aState = (await stateOf(sA)).workspace;
  // The session's directory, from the host, not from the row under test.
  const aPath = workspace.locate({ flowKind: KIND, sessionId: sA });
  const aRows = tell.over("a:row · the user's rows", await rows(sA));
  const row = aRows.find((r) => r.key === aState?.worktree && r.path === aPath);
  const base = git(repo, "merge-base", "main", aBranch);
  check(
    "a:row",
    aRows.length === 1 &&
      row?.state === "ready" &&
      row.branch === aBranch &&
      row.baseCommit === base &&
      row.owner?.kind === "session" &&
      row.owner.id === sA &&
      /^fix-the-export-button-[0-9a-f]{6}$/.test(row.name ?? ""),
    `rows ${JSON.stringify(aRows)}; expected one ready row on ${aBranch} at base ${base}`,
  );
  check("a:key", row?.key != null && aState?.worktree === row.key, `state.workspace ${JSON.stringify(aState)}`);
  evidence.push(`a: one row "${row?.name}" on ${aBranch}, base ${base.slice(0, 8)}`);

  // ---- leg b: a second session attaches ----------------------------------
  const sB = await create({ model: "stub", start: { worktreeOf: sA } });
  await act(sB, "turn", { prompt: "follow-up" });
  const bRow = (await rows(sA)).find((r) => r.key === row?.key);
  check(
    "b:attached",
    bRow !== undefined && JSON.stringify(bRow.attached) === JSON.stringify([sB]) && bRow.owner?.id === sA && (await stateOf(sB)).workspace?.worktree === bRow.key,
    `row ${JSON.stringify(bRow)}; attached session's state ${JSON.stringify((await stateOf(sB)).workspace)}`,
  );
  evidence.push(`b: ${sB} listed as attached`);

  // ---- leg c: the turn-end read ------------------------------------------
  const before = Date.now();
  await act(sA, "turn", { prompt: "switch" });
  const cRow = (await rows(sA)).find((r) => r.key === row?.key);
  const head = git(aPath, "symbolic-ref", "--short", "HEAD");
  const counted = Number(git(aPath, "rev-list", "--count", "HEAD", "--not", base));
  check(
    "c:snapshot",
    head === "agent/switched" && cRow?.branch === head && cRow.commits === counted && (cRow.lastTurnAt ?? 0) >= before,
    `row ${JSON.stringify(cRow)}; git says ${head} with ${counted} commits past ${base.slice(0, 8)}`,
  );
  evidence.push(`c: row on ${cRow?.branch} with ${cRow?.commits} commits (git: ${counted})`);

  // ---- leg d: removal keeps the row ---------------------------------------
  const dEnded = await act(sA, "removeWorktree", {});
  if (dEnded !== "completed") failures.push(`setup: removeWorktree ended ${dEnded}`);
  const dRow = (await rows(sA)).find((r) => r.key === row?.key);
  check("d:removed", dRow?.state === "removed" && dRow.path === aPath, `row ${JSON.stringify(dRow)}`);
  evidence.push(`d: row kept as ${dRow?.state}`);

  // ---- leg e: who reads it ----------------------------------------------
  const sC = await create({ model: "stub" });
  const cRows = await rows(sC);
  check("e:same-user", cRows.some((r) => r.key === row?.key), `a new session of the same user lists ${JSON.stringify(cRows.map((r) => r.key))}`);
  const sOther = await create({ model: "stub" }, OTHER);
  const otherRows = tell.over("e:other-user · another user's rows", await rows(sOther, OTHER), {
    emptyIs: "another user's session lists no rows",
  });
  check("e:other-user", otherRows.length === 0, `another user's session lists ${JSON.stringify(otherRows)}`);
  evidence.push(`e: same user lists ${cRows.length}, another user ${otherRows.length}`);

  if (CONTROL !== "") {
    const red = Object.entries(legs).filter(([, ok]) => !ok).map(([name]) => name).sort();
    const want = [...EXPECTED[CONTROL]!].sort();
    if (JSON.stringify(red) === JSON.stringify(want)) {
      return { failures: [`control ${CONTROL} reddened exactly ${want.join(", ")}, as it must`], evidence: "" };
    }
    return { failures: [`control ${CONTROL} reddened ${JSON.stringify(red)}, expected ${JSON.stringify(want)}`], evidence: "" };
  }
  return { failures, evidence: evidence.join(" · ") };
});
