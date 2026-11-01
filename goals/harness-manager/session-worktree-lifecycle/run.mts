/**
 * Goal check for `goal.md` beside this file — where a coding session starts,
 * and removing what it left on disk without losing work.
 *
 * Real path, no model, out of CI: harness-manager's session flow behind the
 * engine's HTTP router, its workspace the workspace package's local host over
 * a real clone of a bare remote on disk, listed as Kitchen Sink lists its own.
 * The harness is a stub that commits one file per turn. Every assertion reads
 * git or the session's stored state, never what the host reports.
 *
 * Run:      pnpm tsx goals/harness-manager/session-worktree-lifecycle/run.mts
 * Controls: GOAL_CONTROL=no-fetch  (must FAIL a:fresh, and nothing else)
 *           GOAL_CONTROL=cut       (must FAIL b:on-branch and b:recorded, and nothing else)
 *           GOAL_CONTROL=lose-work (must FAIL c:dirty-refused, and nothing else)
 *           GOAL_CONTROL=no-attach (must FAIL the d legs a branch can't do; see EXPECTED)
 *           GOAL_CONTROL=any-user  (must FAIL d:other-user-refused and d:recorded; see EXPECTED)
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
import { REPO_ROOT, intentFreeEnv, loadFixture, runGoal, silentLogger, stripIntentOverrides } from "../../lib/index.mts";

stripIntentOverrides();

const CONTROL = process.env.GOAL_CONTROL ?? "";
const EXPECTED: Record<string, string[]> = {
  "no-fetch": ["a:fresh"],
  cut: ["b:on-branch", "b:recorded"],
  "lose-work": ["c:dirty-refused"],
  // no-attach: the follow-up asks for the owner's branch instead (`{ branch }`), as a caller had to before attaching.
  "no-attach": ["d:attached-turn", "d:on-owner-branch", "d:recorded", "d:waits-for-owner"],
  // any-user: attach never reaches the host, so the follow-up points at a key no row holds and its row reads as nothing.
  "any-user": ["d:other-user-refused", "d:recorded"],
};
if (CONTROL !== "" && EXPECTED[CONTROL] === undefined) {
  throw new Error(`unknown GOAL_CONTROL "${CONTROL}"; known: ${Object.keys(EXPECTED).join(", ")}`);
}

const fixture = loadFixture<{ existingBranch: string; subject: string }>(import.meta.url);
const KIND = "goal-session";
const USER = "u_goal";

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.email=goal@example.com", "-c", "user.name=goal", ...args], { cwd, encoding: "utf8", timeout: 30_000 }).trim();
const tmp = (label: string) => mkdtempSync(join(tmpdir(), `fsd-goal-worktrees-${label}-`));

// ---- the repository: a bare remote, the person's clone, a teammate's clone --
const remote = join(tmp("remote"), "origin.git");
const seedDir = tmp("seed");
git(seedDir, "init", "-q", "-b", "main");
git(seedDir, "commit", "-q", "--allow-empty", "-m", "first");
git(seedDir, "clone", "-q", "--bare", seedDir, remote);
const repo = join(tmp("person"), "repo");
git(join(repo, ".."), "clone", "-q", remote, repo);
const teammate = join(tmp("teammate"), "repo");
git(join(teammate, ".."), "clone", "-q", remote, teammate);
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
    // no-fetch: the base as the commit the tracking ref names now, so nothing is fetched.
    const baseRef =
      CONTROL === "no-fetch" && resolved.baseRef !== undefined ? git(repo, "rev-parse", resolved.baseRef) : resolved.baseRef;
    // cut: the existing branch ignored, the session's own cut instead.
    const existing = resolved.branch !== undefined && CONTROL !== "cut";
    const branch = existing ? resolved.branch! : sessionBranch(place.sessionId);
    const made = await host.provision(
      { kind: "repo", repo, ...(baseRef !== undefined ? { baseRef } : {}) },
      { place: [place.sessionId], branch, existing, ...(request?.worktrees !== undefined ? { worktrees: request.worktrees } : {}) },
    );
    return { path: made.cwd, ...(made.worktree !== undefined ? { worktree: made.worktree } : {}) };
  },
  // any-user: a workspace that answers every attach, never asking the user's own list.
  attach: async (owner, request) =>
    CONTROL === "any-user" ? `any/${owner.sessionId}` : await host.attach!({ place: [owner.sessionId] }, request),
  recordCheckout: async (place, request) => await host.recordCheckout!({ place: [place.sessionId] }, request),
  locate: (place) => host.locate({ kind: "repo", repo }, { place: [place.sessionId] }).cwd,
  branch: (place) => sessionBranch(place.sessionId),
  remove: async (place, options) => {
    if (CONTROL === "lose-work") {
      // A second removal path that forces the tree away, uncommitted work and all.
      const cwd = host.locate({ kind: "repo", repo }, { place: [place.sessionId] }).cwd;
      git(repo, "worktree", "remove", "--force", cwd);
      return { branchDeleted: false };
    }
    return await host.remove!({ place: [place.sessionId] }, options);
  },
};

// ---- the stub harness: commits one file per turn; "wait" holds the turn ---
let release: () => void = () => undefined;
let gate: Promise<void> = Promise.resolve();
const stubAgent = (feeds: HarnessSessionFeeds) =>
  handler({
    name: "stub-harness",
    inputSchema: z.object({ prompt: z.string() }),
    execute: async (input, ctx) => {
      const c = ctx as unknown as HarnessCallbackContext;
      await feeds.resume(c);
      const cwd = await feeds.cwd(c);
      if (input.prompt === "wait") await gate;
      writeFileSync(join(cwd, `turn-${Date.now()}.txt`), input.prompt);
      git(cwd, "add", "-A");
      git(cwd, "commit", "-q", "-m", fixture.subject);
      return { outcome: "completed" };
    },
  }) as unknown as HarnessBlock;

const stores = createInMemoryStores() as unknown as StoreRegistry;
const registry = createFlowRegistry();
registry.registerMany([harnessSessionFlow({ kind: KIND, workspace, agent: stubAgent })]);
const router = createFlowApiRouter({ registry, stores, runtimeConfig: { logger: silentLogger } } as never);

async function create(state: Record<string, unknown>, userId = USER): Promise<string> {
  const made = await tryCreate(state, userId);
  if (made.id === undefined) throw new Error(`create refused (${made.status})`);
  return made.id;
}

/** Create a session; its id, or the status the create route refused it with. */
async function tryCreate(state: Record<string, unknown>, userId = USER): Promise<{ status: number; id?: string }> {
  const res = await router.POST(
    new Request(`http://goal/api/flows/${KIND}/sessions`, { method: "POST", body: JSON.stringify({ userId, state }) }),
    { params: { path: [KIND, "sessions"] } },
  );
  const body = (await res.json()) as { session?: { id: string } };
  return { status: res.status, ...(body.session !== undefined ? { id: body.session.id } : {}) };
}

/**
 * Send an action; the HTTP status, and how the request ended once it settles.
 * With `settle`, a 409 is retried for a few seconds: the turn before it holds
 * the session until its own end-of-request work (the pull request check) is
 * done, a moment after its record reads completed.
 */
async function act(sessionId: string, action: string, input: unknown, settle = true, userId = USER): Promise<{ status: number; ended?: string; requestId?: string }> {
  for (let attempt = 0; ; attempt += 1) {
    const sent = await send(sessionId, action, input, settle, userId);
    if (!settle || sent.status !== 409 || attempt >= 100) return sent;
    await new Promise((r) => setTimeout(r, 50));
  }
}

async function send(sessionId: string, action: string, input: unknown, settle: boolean, userId = USER): Promise<{ status: number; ended?: string; requestId?: string }> {
  const res = await router.POST(
    new Request(`http://goal/api/flows/${KIND}/${sessionId}/actions/${action}`, {
      method: "POST",
      body: JSON.stringify({ userId, input }),
    }),
    { params: { path: [KIND, sessionId, "actions", action] } },
  );
  const body = (await res.json()) as { request?: { id: string } };
  if (process.env.GOAL_DEBUG) console.error(action, res.status, JSON.stringify(body).slice(0, 300));
  const requestId = body.request?.id;
  if (!settle || requestId === undefined) return { status: res.status, ...(requestId !== undefined ? { requestId } : {}) };
  return { status: res.status, requestId, ended: await settled(requestId) };
}

async function settled(requestId: string): Promise<string | undefined> {
  for (let i = 0; i < 400; i += 1) {
    const record = await stores.request.get(requestId);
    if (record !== undefined && record.status !== "in_progress") return record.status;
    await new Promise((r) => setTimeout(r, 25));
  }
  return undefined;
}

/** The worktree row a session points at (`state.workspace.worktree`), read as a page reads it. */
async function rowOf(sessionId: string): Promise<WorktreeRow | undefined> {
  const key = (((await stores.session.get(sessionId))?.state ?? {}) as { workspace?: { worktree: string | null } | null }).workspace?.worktree;
  if (key == null) return undefined;
  const res = await router.GET(
    new Request(`http://goal/api/flows/sessions/${sessionId}/resources/worktrees?userId=${USER}`),
    { params: { path: ["sessions", sessionId, "resources", "worktrees"] } },
  );
  const body = (await res.json()) as { items?: Array<{ clientData?: WorktreeRow }> };
  return (body.items ?? []).map((item) => item.clientData).find((row) => row?.key === key);
}

const branchExists = (branch: string) => git(repo, "branch", "--list", branch) !== "";

/** `fsdev worktrees <root> --json`, through the real CLI. */
function listedByCli(): Array<{ cwd: string; branch: string | null }> {
  const stdout = execFileSync(
    join(REPO_ROOT, "node_modules", ".bin", "tsx"),
    [join(REPO_ROOT, "packages", "cli", "src", "bin.ts"), "worktrees", root, "--json"],
    { encoding: "utf8", env: intentFreeEnv(process.env), timeout: 120_000 },
  );
  return JSON.parse(stdout) as Array<{ cwd: string; branch: string | null }>;
}

await runGoal(async (failures, tell) => {
  const legs: Record<string, boolean> = {};
  const check = (name: string, ok: boolean, why: string) => {
    legs[name] = ok;
    if (!ok) failures.push(`${name}: ${why}`);
  };
  const evidence: string[] = [];

  // ---- leg a: a fresh base from the remote -----------------------------
  git(teammate, "commit", "-q", "--allow-empty", "-m", "a teammate's merge");
  git(teammate, "push", "-q", "origin", "main");
  const remoteTip = git(remote, "rev-parse", "main");
  const stale = git(repo, "rev-parse", "refs/remotes/origin/main");
  if (stale === remoteTip) failures.push("setup: the person's tracking ref already had the remote's tip; leg a proves nothing");
  const sA = await create({ model: "stub", start: { base: "origin/main" } });
  const aTurn = await act(sA, "turn", { prompt: "work" });
  check("a:turn", aTurn.ended === "completed", `turn ended ${aTurn.ended}`);
  const aBranch = sessionBranch(sA);
  // A commit the repository never received is not contained, however git words that.
  const aHasTip = branchExists(aBranch) && (() => {
    try {
      git(repo, "merge-base", "--is-ancestor", remoteTip, aBranch);
      return true;
    } catch {
      return false;
    }
  })();
  check("a:fresh", aHasTip, `branch ${aBranch} does not contain the remote's tip ${remoteTip}`);
  evidence.push(`a: ${aBranch} contains remote tip ${remoteTip.slice(0, 8)} (tracking ref was ${stale.slice(0, 8)})`);

  // ---- leg b: an existing branch, worked on as it stands -----------------
  git(repo, "branch", fixture.existingBranch, "main");
  const sB = await create({ model: "stub", start: { branch: fixture.existingBranch } });
  const bTurn = await act(sB, "turn", { prompt: "work" });
  check("b:turn", bTurn.ended === "completed", `turn ended ${bTurn.ended}`);
  const bSubject = git(repo, "log", "-1", "--format=%s", fixture.existingBranch);
  check("b:on-branch", bSubject === fixture.subject, `${fixture.existingBranch}'s last commit is "${bSubject}", not the stub's`);
  check("b:recorded", (await rowOf(sB))?.branch === fixture.existingBranch, `row ${JSON.stringify(await rowOf(sB))}`);
  evidence.push(`b: the stub's commit is on ${fixture.existingBranch}`);

  // ---- leg d: a follow-up session attached to b's worktree ----------------
  const missing = await tryCreate({ model: "stub", start: { worktreeOf: "sess_never_made" } });
  check("d:missing-refused", missing.status === 404, `attaching to a session with no worktree answered ${missing.status}`);
  const bPath = (await rowOf(sB))?.path ?? "";
  // Whatever branch b's worktree is on (so leg d proves attaching, not leg b's start).
  const ownerBranch = (await rowOf(sB))?.branch ?? fixture.existingBranch;
  const ownerTip = git(repo, "rev-parse", ownerBranch);
  const sE = await create({ model: "stub", start: CONTROL === "no-attach" ? { branch: ownerBranch } : { worktreeOf: sB } });
  const eTurn = await act(sE, "turn", { prompt: "follow-up" });
  check("d:attached-turn", eTurn.ended === "completed", `the attached turn ended ${eTurn.ended}`);
  const onOwnerBranch = git(repo, "rev-parse", ownerBranch) !== ownerTip && git(repo, "log", "-1", "--format=%s", ownerBranch) === fixture.subject;
  check("d:on-owner-branch", onOwnerBranch && !branchExists(sessionBranch(sE)), `the follow-up's commit is not on ${ownerBranch}, or it cut a branch of its own`);
  const eRow = await rowOf(sE);
  check("d:recorded", eRow?.path === bPath && eRow.owner?.id === sB && eRow.attached.some((entry) => entry.id === sE), `row ${JSON.stringify(eRow)}`);
  // Another user names b's session: the worktree isn't in their list, so their turn never gets it.
  const sOther = await create({ model: "stub", start: { worktreeOf: sB } }, "u_someone_else");
  const beforeOther = git(repo, "rev-parse", ownerBranch);
  const otherTurn = await act(sOther, "turn", { prompt: "snoop" }, true, "u_someone_else");
  check(
    "d:other-user-refused",
    otherTurn.ended === "failed" && git(repo, "rev-parse", ownerBranch) === beforeOther,
    `another user's attached turn ended ${otherTurn.ended}`,
  );
  const eRemove = await act(sE, "removeWorktree", {});
  check("d:remove-refused", eRemove.ended === "failed" && existsSync(bPath), `the attached session's removal ended ${eRemove.ended}`);
  // Both sessions' turns take the one worktree's in-use lock: the follow-up waits out the owner's turn.
  gate = new Promise<void>((resolve) => (release = resolve));
  const ownerTurn = act(sB, "turn", { prompt: "wait" });
  await new Promise((r) => setTimeout(r, 150));
  const before = git(repo, "rev-parse", ownerBranch);
  const followUp = act(sE, "turn", { prompt: "follow-up two" });
  await new Promise((r) => setTimeout(r, 300));
  const movedWhileOwnerRan = git(repo, "rev-parse", ownerBranch) !== before;
  release();
  const [ownerEnded, followEnded] = await Promise.all([ownerTurn, followUp]);
  check(
    "d:waits-for-owner",
    !movedWhileOwnerRan && ownerEnded.ended === "completed" && followEnded.ended === "completed",
    `the follow-up committed while the owner's turn ran: ${movedWhileOwnerRan}; turns ended ${ownerEnded.ended} and ${followEnded.ended}`,
  );
  evidence.push(`d: attaching to a missing worktree 404, the follow-up committed on ${ownerBranch} in b's worktree, waited out b's turn, and could not remove it`);

  // ---- leg c: removal, which never loses work ----------------------------
  const sC = await create({ model: "stub" });
  await act(sC, "turn", { prompt: "work" });
  const cPath = (await rowOf(sC))?.path ?? "";
  const cBranch = sessionBranch(sC);
  const listedBefore = tell.over("c:listed · fsdev worktrees", listedByCli().filter((entry) => entry.branch === cBranch));
  check("c:listed", listedBefore.length === 1, `fsdev worktrees listed ${listedBefore.length} entries on ${cBranch}`);

  gate = new Promise<void>((resolve) => (release = resolve));
  const running = act(sC, "turn", { prompt: "wait" });
  await new Promise((r) => setTimeout(r, 150));
  const midTurn = await act(sC, "removeWorktree", {}, false);
  release();
  await running;
  check("c:refused-mid-turn", midTurn.status === 409 && existsSync(cPath), `removeWorktree mid-turn answered ${midTurn.status}`);

  const unsaved = join(cPath, "unsaved.txt");
  writeFileSync(unsaved, "work that exists nowhere else");
  const dirty = await act(sC, "removeWorktree", {});
  check("c:dirty-refused", dirty.ended === "failed" && existsSync(unsaved), `removal with uncommitted work ended ${dirty.ended}; file kept: ${existsSync(unsaved)}`);

  if (existsSync(unsaved)) {
    rmSync(unsaved);
    const unforced = await act(sC, "removeWorktree", { deleteBranch: true });
    check(
      "c:branch-refused",
      unforced.ended === "failed" && existsSync(cPath) && branchExists(cBranch),
      `deleting a branch with the only copy of its commits ended ${unforced.ended}`,
    );
    const forced = await act(sC, "removeWorktree", { deleteBranch: true, force: true });
    check("c:forced", forced.ended === "completed" && !existsSync(cPath) && !branchExists(cBranch), `forced removal ended ${forced.ended}`);
    check("c:record", (await rowOf(sC))?.state === "removed", `row ${JSON.stringify(await rowOf(sC))}`);
  }

  const sD = await create({ model: "stub" });
  await act(sD, "turn", { prompt: "work" });
  const dPath = (await rowOf(sD))?.path ?? "";
  const dRemoved = await act(sD, "removeWorktree", {});
  check("c:removed", dRemoved.ended === "completed" && !existsSync(dPath) && branchExists(sessionBranch(sD)), `plain removal ended ${dRemoved.ended}`);
  const listing = tell.over("c:unlisted · fsdev worktrees (sessions a and b still hold theirs)", listedByCli());
  const listedAfter = tell.over(
    "c:unlisted · the removed worktrees",
    listing.filter((entry) => entry.branch === cBranch || entry.branch === sessionBranch(sD)),
    { emptyIs: "both removed worktrees are gone from the listing" },
  );
  check("c:unlisted", listedAfter.length === 0, `fsdev worktrees still lists ${JSON.stringify(listedAfter)}`);
  evidence.push("c: refused mid-turn (409), refused dirty, branch kept until forced, removed and unlisted");

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
