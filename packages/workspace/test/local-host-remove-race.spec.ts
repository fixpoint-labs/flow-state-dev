/**
 * A run that ends between `remove`'s listing and its lease: whatever HEAD the
 * run left is what removal judges, not what the listing saw. Git calls go
 * through the real `run`; the run's last moves are slipped in right after the
 * listing, which is the window a real host leaves open.
 */
import { existsSync, rmSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HOST_LOCK_BOUNDS, tryAcquireLock } from "../src/lock";
import { worktreeLockPath } from "../src/occupancy";
import { createRemote, git, tempDir } from "./git-fixtures";

let afterListing: (() => void) | undefined;
let beforeRemoving: (() => void) | undefined;

vi.mock("../src/exec", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/exec")>();
  return {
    ...actual,
    run: async (...args: Parameters<typeof actual.run>) => {
      if (beforeRemoving !== undefined && args[1].includes("worktree") && args[1].includes("remove")) {
        const then = beforeRemoving;
        beforeRemoving = undefined;
        then();
      }
      const result = await actual.run(...args);
      if (afterListing !== undefined && args[1].includes("worktree") && args[1].includes("list")) {
        const then = afterListing;
        afterListing = undefined;
        then();
      }
      return result;
    },
  };
});

const { localWorkspaceHost, WorkspaceRefusedError } = await import("../src/local-host");

const noSource = () => ({ kind: "refused" as const, reason: "unused", message: "unused" });

let root: string;
let repo: string;

beforeEach(() => {
  root = tempDir("host");
  const upstream = createRemote("marker A");
  repo = join(tempDir("person"), "repo");
  git(join(repo, ".."), "clone", "-q", upstream.url, repo);
});

afterEach(() => {
  afterListing = undefined;
  beforeRemoving = undefined;
  vi.useRealTimers();
  rmSync(root, { recursive: true, force: true });
});

describe("remove after a run moved HEAD", () => {
  it("refuses a detached HEAD the run left after the listing, which the listing saw on a branch", async () => {
    const h = localWorkspaceHost({ root, remotes: { allow: [] }, localRepositories: [repo], source: noSource });
    const place = await h.provision({ kind: "repo", repo }, { place: ["run-1"], branch: "fsd/run-1" });
    afterListing = () => {
      git(place.cwd, "checkout", "-q", "--detach");
      git(place.cwd, "commit", "-q", "--allow-empty", "-m", "the run's last commit, on no branch");
    };

    const refusal = await h.remove!({ place: ["run-1"] }).catch((error: unknown) => error);

    expect(refusal).toBeInstanceOf(WorkspaceRefusedError);
    expect((refusal as InstanceType<typeof WorkspaceRefusedError>).reason).toBe("unique-commits");
    expect(existsSync(place.cwd)).toBe(true);
  });
});

describe("a removal that outlasts the stale threshold", () => {
  it("keeps its in-use lock fresh, so a run can't take the worktree while it is being deleted", async () => {
    const h = localWorkspaceHost({ root, remotes: { allow: [] }, localRepositories: [repo], source: noSource });
    const place = await h.provision({ kind: "repo", repo }, { place: ["run-1"], branch: "fsd/run-1" });
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    let taken: unknown = "not tried";
    beforeRemoving = () => {
      // A minute and more into the removal, by the lock's age; then one heartbeat's worth of time passes.
      const old = new Date(Date.now() - 2 * HOST_LOCK_BOUNDS.staleAfterMs);
      utimesSync(worktreeLockPath(place.cwd), old, old);
      vi.advanceTimersByTime(HOST_LOCK_BOUNDS.heartbeatMs!);
      // What a run starting now (`occupyWorktree`) would get.
      taken = tryAcquireLock(worktreeLockPath(place.cwd), HOST_LOCK_BOUNDS);
    };

    await h.remove!({ place: ["run-1"] });

    expect(taken).toBeUndefined();
  });
});
