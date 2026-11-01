/**
 * The user's list of worktrees, as the host writes it: a row per worktree,
 * marked `provisioning` before the worktree is made and `ready` after, read
 * again at a turn's end, and kept as `removed` when it goes.
 *
 * The rows go into a `Map`-backed collection with the two members the writer
 * uses. Every assertion about the worktree reads git, not the row.
 */
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorktreeCollection, WorktreeRow } from "../src/worktrees";
import { worktreeKey, worktreeName, worktreeRowSchema } from "../src/worktrees";
import { localWorkspaceHost } from "../src/local-host";
import { recordBranchPullRequests } from "../src/branch-pull-requests";
import { createRemote, git, tempDir, type Remote } from "./git-fixtures";

const noSource = () => ({ kind: "refused" as const, reason: "unused", message: "unused" });

/** Rows in a `Map`, parsed through the row schema on every write as the store does. */
function rows(): WorktreeCollection & { all: Map<string, WorktreeRow>; writes: { key: string; state: string | null }[] } {
  const all = new Map<string, WorktreeRow>();
  const writes: { key: string; state: string | null }[] = [];
  const refOf = (key: string) => ({ path: `worktrees/${key}`, state: all.get(key)! });
  return {
    all,
    writes,
    pattern: "worktrees/**",
    scope: "user",
    getOptional: async (key: string) => (all.has(key) ? refOf(key) : undefined),
    upsert: async (key: string, update: Partial<WorktreeRow>, createOnly: Partial<WorktreeRow> = {}) => {
      const prior = all.get(key);
      const next = worktreeRowSchema.parse(prior === undefined ? { ...createOnly, ...update } : { ...prior, ...update });
      all.set(key, next);
      writes.push({ key, state: next.state });
      return refOf(key);
    },
  } as never;
}

let root: string;
let repo: string;
let upstream: Remote;
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  root = tempDir("host");
  upstream = createRemote("marker A");
  repo = join(tempDir("person"), "repo");
  git(join(repo, ".."), "clone", "-q", upstream.url, repo);
  warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  warn.mockRestore();
  rmSync(root, { recursive: true, force: true });
});

function host() {
  return localWorkspaceHost({ root, remotes: { allow: [] }, localRepositories: [repo], source: noSource });
}

const owner = { kind: "session" as const, id: "s-1" };

describe("a provision given the list", () => {
  it("marks the row provisioning before the worktree exists and ready after, with what git made", async () => {
    const h = host();
    const worktrees = rows();
    const place = await h.provision(
      { kind: "repo", repo },
      { place: ["s-1"], branch: "fsd/s-1", worktrees: { collection: worktrees, owner, label: "Fix the Safari export button!" } },
    );
    const key = worktreeKey(h.hostId(), ["s-1"]);
    expect(place.worktree).toBe(key);
    // A failed `git worktree add` must never leave a row saying ready.
    expect(worktrees.writes.map((w) => w.state)).toEqual(["provisioning", "ready"]);
    const row = worktrees.all.get(key)!;
    expect(row).toMatchObject({ key, state: "ready", path: place.cwd, branch: "fsd/s-1", owner, attached: [] });
    expect(row.baseCommit).toBe(git(repo, "merge-base", "main", "fsd/s-1"));
    expect(row.name).toMatch(/^fix-the-safari-export-button-[0-9a-f]{6}$/);
  });

  it("keeps the name, owner and base on a hand-back", async () => {
    const h = host();
    const worktrees = rows();
    const request = { place: ["s-1"], branch: "fsd/s-1", worktrees: { collection: worktrees, owner, label: "first title" } };
    await h.provision({ kind: "repo", repo }, request);
    const key = worktreeKey(h.hostId(), ["s-1"]);
    const first = worktrees.all.get(key)!;
    // The base moves on; a hand-back is still the worktree cut from the old one.
    writeFileSync(join(repo, "later.txt"), "x");
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", "later");
    await h.provision({ kind: "repo", repo }, { ...request, worktrees: { collection: worktrees, owner: { kind: "run", id: "other" }, label: "renamed" } });
    const again = worktrees.all.get(key)!;
    expect(again.name).toBe(first.name);
    expect(again.owner).toEqual(owner);
    expect(again.baseCommit).toBe(first.baseCommit);
  });

  it("leaves a failed provision's row provisioning, never ready", async () => {
    const h = host();
    const worktrees = rows();
    await expect(
      h.provision({ kind: "repo", repo }, { place: ["s-1"], branch: "no/such", existing: true, worktrees: { collection: worktrees, owner } }),
    ).rejects.toThrow();
    expect(worktrees.all.get(worktreeKey(h.hostId(), ["s-1"]))?.state).toBe("provisioning");
  });

  it("writes nothing without the list, and the place is what it always was", async () => {
    const place = await host().provision({ kind: "repo", repo }, { place: ["s-1"], branch: "fsd/s-1" });
    expect(place.worktree).toBeUndefined();
  });
});

describe("recordCheckout", () => {
  it("writes the branch HEAD is on and the commits past the base, together", async () => {
    const h = host();
    const worktrees = rows();
    const place = await h.provision({ kind: "repo", repo }, { place: ["s-1"], branch: "fsd/s-1", worktrees: { collection: worktrees, owner } });
    for (const n of [1, 2]) {
      writeFileSync(join(place.cwd, `f${n}.txt`), String(n));
      git(place.cwd, "add", "-A");
      git(place.cwd, "commit", "-q", "-m", `c${n}`);
    }
    git(place.cwd, "checkout", "-q", "-b", "agent/own");
    await h.recordCheckout!({ place: ["s-1"] }, { worktrees });
    const row = worktrees.all.get(worktreeKey(h.hostId(), ["s-1"]))!;
    expect(row.branch).toBe("agent/own");
    expect(row.commits).toBe(2);
    expect(row.lastTurnAt).toEqual(expect.any(Number));
  });

  it("says unknown, not 0, when the row has no base", async () => {
    const h = host();
    const worktrees = rows();
    await h.provision({ kind: "repo", repo }, { place: ["s-1"], branch: "fsd/s-1", worktrees: { collection: worktrees, owner } });
    const key = worktreeKey(h.hostId(), ["s-1"]);
    await worktrees.upsert(key, { baseCommit: null });
    await h.recordCheckout!({ place: ["s-1"] }, { worktrees });
    expect(worktrees.all.get(key)!.commits).toBeNull();
  });

  it("marks the row lost when the directory is gone", async () => {
    const h = host();
    const worktrees = rows();
    const place = await h.provision({ kind: "repo", repo }, { place: ["s-1"], branch: "fsd/s-1", worktrees: { collection: worktrees, owner } });
    rmSync(place.cwd, { recursive: true, force: true });
    await h.recordCheckout!({ place: ["s-1"] }, { worktrees });
    expect(worktrees.all.get(worktreeKey(h.hostId(), ["s-1"]))!.state).toBe("lost");
  });
});

describe("attach and remove", () => {
  it("lists an attached session once, never the owner, and answers null with no row", async () => {
    const h = host();
    const worktrees = rows();
    await h.provision({ kind: "repo", repo }, { place: ["s-1"], branch: "fsd/s-1", worktrees: { collection: worktrees, owner } });
    const key = worktreeKey(h.hostId(), ["s-1"]);
    expect(await h.attach!({ place: ["s-1"] }, { worktrees, session: "s-2" })).toBe(key);
    expect(await h.attach!({ place: ["s-1"] }, { worktrees, session: "s-2" })).toBe(key);
    expect(await h.attach!({ place: ["s-1"] }, { worktrees, session: "s-1" })).toBe(key);
    expect(worktrees.all.get(key)!.attached).toEqual(["s-2"]);
    expect(await h.attach!({ place: ["nobody"] }, { worktrees, session: "s-2" })).toBeNull();
  });

  it("keeps the row, marked removed, once the worktree is gone", async () => {
    const h = host();
    const worktrees = rows();
    const place = await h.provision({ kind: "repo", repo }, { place: ["s-1"], branch: "fsd/s-1", worktrees: { collection: worktrees, owner } });
    await h.remove!({ place: ["s-1"] }, { worktrees });
    expect(git(repo, "worktree", "list")).not.toContain(place.cwd);
    const row = worktrees.all.get(worktreeKey(h.hostId(), ["s-1"]))!;
    expect(row.state).toBe("removed");
    expect(row.path).toBe(place.cwd);
    // A turn-end read after removal leaves it removed.
    await h.recordCheckout!({ place: ["s-1"] }, { worktrees });
    expect(worktrees.all.get(worktreeKey(h.hostId(), ["s-1"]))!.state).toBe("removed");
  });
});

describe("the pull requests on the branch", () => {
  it("are added to the row once each", async () => {
    const h = host();
    const worktrees = rows();
    const place = await h.provision({ kind: "repo", repo }, { place: ["s-1"], branch: "fsd/s-1", worktrees: { collection: worktrees, owner } });
    const key = worktreeKey(h.hostId(), ["s-1"]);
    const gh = join(tempDir("gh"), "gh");
    writeFileSync(
      gh,
      `#!/bin/sh\necho '[{"number":7,"html_url":"https://github.com/o/r/pull/7","title":"T","state":"open","created_at":"2030-01-01T00:00:00Z","head":{"ref":"fsd/s-1"}}]'\n`,
      { mode: 0o755 },
    );
    const session = new Map<string, Record<string, unknown>>();
    const observed = {
      getOptional: async (k: string) => (session.has(k) ? { state: session.get(k) } : undefined),
      upsert: async (k: string, u: Record<string, unknown>) => session.set(k, { ...session.get(k), ...u }),
    };
    const ctx = { resources: { "observed-pull-requests": observed }, request: { identity: { id: "r1" } } };
    for (let i = 0; i < 2; i++) {
      const result = await recordBranchPullRequests(ctx, { cwd: place.cwd, gh, worktree: { collection: worktrees, key } });
      expect(result.status).toBe("recorded");
    }
    expect(worktrees.all.get(key)!.pullRequests).toEqual([{ url: "https://github.com/o/r/pull/7", number: 7, state: "open", title: "T" }]);
  });
});

describe("a row's name", () => {
  it("is a slug of at most 32 then 6 hex, falling back to the place's last segment", () => {
    expect(worktreeName("k", "A".repeat(50), ["x"])).toMatch(/^a{32}-[0-9a-f]{6}$/);
    expect(worktreeName("k", undefined, ["Session_ABC"])).toMatch(/^session-abc-[0-9a-f]{6}$/);
    expect(worktreeName("k", "!!!", [".."])).toMatch(/^worktree-[0-9a-f]{6}$/);
  });
});
