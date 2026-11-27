/**
 * `fsdev worktrees`: a person at a terminal sees the worktrees a host on a
 * root made, and removes one through the host's one removal path, which
 * refuses to lose work. Real git; the host is built as Kitchen Sink builds it,
 * a repository on this machine listed, so the command finds it from the pins
 * that host kept in the root.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localWorkspaceHost } from "@flow-state-dev/workspace";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executeWorktreesCommand } from "../src/commands/worktrees";
import { EXIT_EXECUTION_ERROR, EXIT_SUCCESS } from "../src/exit-codes";

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", ...args], { cwd, encoding: "utf8" }).trim();

let root: string;
let repo: string;
let out: string[];
let err: string[];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "fsdev-worktrees-root-"));
  repo = mkdtempSync(join(tmpdir(), "fsdev-worktrees-repo-"));
  git(repo, "init", "-q", "-b", "main");
  git(repo, "commit", "-q", "--allow-empty", "-m", "first");
  out = [];
  err = [];
  vi.spyOn(console, "log").mockImplementation((line: unknown) => void out.push(String(line)));
  vi.spyOn(console, "error").mockImplementation((line: unknown) => void err.push(String(line)));
});

afterEach(() => vi.restoreAllMocks());

async function session(run = "s-1") {
  const host = localWorkspaceHost({
    root,
    remotes: { allow: [] },
    localRepositories: [repo],
    source: () => ({ kind: "refused", reason: "unused", message: "unused" }),
  });
  return await host.provision({ kind: "repo", repo }, { place: ["kind", run], branch: `sessions/${run}` });
}

describe("fsdev worktrees", () => {
  it("lists what a host on the root made, finding the repository from the root alone", async () => {
    const place = await session();
    writeFileSync(join(place.cwd, "notes.txt"), "unsaved");

    expect(await executeWorktreesCommand(root, {})).toBe(EXIT_SUCCESS);

    expect(out.join("\n")).toContain(`dirty  sessions/s-1  ${place.cwd}`);
  });

  it("refuses to remove a worktree with uncommitted work, and leaves it", async () => {
    const place = await session();
    writeFileSync(join(place.cwd, "notes.txt"), "unsaved");

    expect(await executeWorktreesCommand(root, { remove: place.cwd })).toBe(EXIT_EXECUTION_ERROR);

    expect(err.join("\n")).toContain("Refused (uncommitted-work)");
    expect(existsSync(join(place.cwd, "notes.txt"))).toBe(true);
  });

  it("removes a clean one and, asked, its branch", async () => {
    const place = await session();

    expect(await executeWorktreesCommand(root, { remove: place.cwd, deleteBranch: true })).toBe(EXIT_SUCCESS);

    expect(existsSync(place.cwd)).toBe(false);
    expect(git(repo, "branch", "--list", "sessions/s-1")).toBe("");
    out.length = 0;
    await executeWorktreesCommand(root, {});
    expect(out.join("\n")).toBe("No worktrees.");
  });
});
