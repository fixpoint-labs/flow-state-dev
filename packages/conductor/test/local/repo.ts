/**
 * A real git repository in a temporary directory.
 *
 * There is no fake git here on purpose. The local observer's whole claim is
 * that it reads actual state, so a test double that answered `rev-parse` from a
 * table would test the mapping and skip the claim. Every helper below shells out
 * to the same `git` the observer does.
 *
 * Commit timestamps are set explicitly rather than left to the clock. The
 * observer resolves an undated review to *the head the branch stood at when the
 * file was written*, which is a comparison between commit times and a file's
 * modification time — a comparison with one-second granularity that is
 * unreproducible if both sides land in the same second.
 */

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { GitResult, GitRunner } from "../../src/dispatch/branch";

/** Run one git command, optionally pinning the commit timestamps it writes. */
function git(
  argv: readonly string[],
  cwd: string,
  date?: string,
): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", [...argv], {
      cwd,
      env: date
        ? { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date }
        : process.env,
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

/** A checkout under test, with the operations a local review process performs. */
export interface TestRepo {
  readonly root: string;
  /** The runner to hand the observer — the real thing, no interception. */
  readonly git: GitRunner;
  /** Run a git command, failing the call if it does not succeed. */
  run(...argv: string[]): Promise<string>;
  /** Write a file and commit it at a pinned timestamp. */
  commit(file: string, content: string, message: string, date: string): Promise<string>;
  /** The commit a ref points at. */
  sha(ref: string): Promise<string>;
  /** Write a file under the repo, creating parents. */
  write(relative: string, content: string): Promise<string>;
  /** Set a file's modification time — what an undated review is dated by. */
  touch(relative: string, at: string): Promise<void>;
  cleanup(): Promise<void>;
}

/**
 * Create a repository with one commit on `main`.
 *
 * @param initialDate Timestamp of the first commit. Later commits should be
 *   given later dates so the head-at-a-time resolution is unambiguous.
 */
export async function createTestRepo(
  initialDate = "2026-08-01T00:00:00Z",
): Promise<TestRepo> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conductor-local-"));

  const run = async (...argv: string[]): Promise<string> => {
    const result = await git(argv, root);
    if (result.code !== 0) {
      throw new Error(`git ${argv.join(" ")} failed (${result.code}): ${result.stderr}`);
    }
    return result.stdout.trim();
  };

  await run("init", "-q", "-b", "main");
  await run("config", "user.email", "test@example.com");
  await run("config", "user.name", "Test");

  const write = async (relative: string, content: string): Promise<string> => {
    const file = path.join(root, relative);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, content);
    return file;
  };

  const commit = async (
    file: string,
    content: string,
    message: string,
    date: string,
  ): Promise<string> => {
    await write(file, content);
    await run("add", "--", file);
    const result = await git(["commit", "-q", "-m", message], root, date);
    if (result.code !== 0) {
      throw new Error(`git commit failed (${result.code}): ${result.stderr}`);
    }
    return run("rev-parse", "HEAD");
  };

  await commit("README.md", "start\n", "initial", initialDate);

  return {
    root,
    git: (argv, cwd) => git(argv, cwd),
    run,
    commit,
    sha: (ref) => run("rev-parse", `${ref}^{commit}`),
    write,
    touch: async (relative, at) => {
      const when = new Date(at);
      await fs.utimes(path.join(root, relative), when, when);
    },
    cleanup: () => fs.rm(root, { recursive: true, force: true }),
  };
}
