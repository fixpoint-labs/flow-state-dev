/**
 * Real git repositories for the host's tests: a bare "remote" the host
 * reaches over `file://`, and helpers to move it on underneath a run.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const AUTHOR = ["-c", "user.email=test@example.com", "-c", "user.name=test"];

/** Run git and return its trimmed stdout. */
export function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", [...AUTHOR, ...args], { cwd, encoding: "utf8" }).trim();
}

/** A fresh temporary directory. */
export function tempDir(label: string): string {
  return mkdtempSync(join(tmpdir(), `fsd-workspace-${label}-`));
}

export interface Remote {
  /** The bare repository on disk. */
  bare: string;
  /** Its `file://` spelling, which is what a run source answers with. */
  url: string;
  /** Commit `file` with `content` on `branch` of the remote; returns the new commit. */
  commit(branch: string, file: string, content: string): string;
  /** Point the remote's HEAD — its default branch — at `branch`. */
  setDefault(branch: string): void;
  /** The commit `ref` names on the remote. */
  rev(ref: string): string;
}

/** A bare remote with one commit on `main` holding `marker.txt`. */
export function createRemote(marker = "marker A"): Remote {
  const root = tempDir("remote");
  const work = join(root, "work");
  const bare = join(root, "origin.git");
  execFileSync("git", ["init", "-q", "-b", "main", work]);
  writeFileSync(join(work, "marker.txt"), marker);
  git(work, "add", "marker.txt");
  git(work, "commit", "-q", "-m", "marker");
  execFileSync("git", ["clone", "-q", "--bare", work, bare]);

  return {
    bare,
    url: pathToFileURL(bare).href,
    commit(branch, file, content) {
      git(work, "fetch", "-q", bare, "+refs/heads/*:refs/remotes/bare/*");
      const exists = git(bare, "branch", "--list", branch) !== "";
      git(work, "checkout", "-q", "-B", branch, exists ? `bare/${branch}` : "HEAD");
      writeFileSync(join(work, file), content);
      git(work, "add", file);
      git(work, "commit", "-q", "-m", `${file} on ${branch}`);
      git(work, "push", "-q", bare, `${branch}:${branch}`);
      return git(work, "rev-parse", "HEAD");
    },
    setDefault(branch) {
      git(bare, "symbolic-ref", "HEAD", `refs/heads/${branch}`);
    },
    rev: (ref) => git(bare, "rev-parse", ref),
  };
}
