/**
 * `checkRepository`: the host answers, before any run, whether a run on a
 * repository would get a checkout here, with the same ignore check a
 * provision runs. A project's create asks it, so a person learns the problem
 * before the first run fails.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { localWorkspaceHost, type IgnoredDirectory } from "../src";
import { git, tempDir } from "./git-fixtures";

const IGNORED: IgnoredDirectory = { dir: ".fsdev/ask", rule: "**/.fsdev/", why: "A run writes files there." };

/** A working repository with one commit, and `.fsdev/` ignored unless `ignore` is false. */
function repository(ignore = true): string {
  const dir = tempDir("check");
  execFileSync("git", ["init", "-q", "-b", "main", dir]);
  writeFileSync(join(dir, "README.md"), "hello\n");
  if (ignore) writeFileSync(join(dir, ".gitignore"), "**/.fsdev/\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "first");
  return dir;
}

function host(options: { listed?: string[]; allow?: string[] } = {}) {
  return localWorkspaceHost({
    root: tempDir("check-root"),
    remotes: { allow: options.allow ?? ["file"] },
    localRepositories: options.listed ?? [],
    source: () => ({ kind: "files", files: [] }) as never,
  });
}

describe("checkRepository", () => {
  it("answers worktree for a listed repository that ignores the directory", async () => {
    const repo = repository();
    await expect(host({ listed: [repo] }).checkRepository!(repo, { ignored: IGNORED })).resolves.toEqual({
      usable: true,
      how: "worktree",
    });
  });

  it("answers clone for an allowed file:// repository the host doesn't list", async () => {
    const repo = repository();
    await expect(host().checkRepository!(pathToFileURL(repo).href, { ignored: IGNORED })).resolves.toEqual({ usable: true, how: "clone" });
  });

  it("refuses a repository that doesn't ignore the directory, naming the rule to add", async () => {
    const repo = repository(false);
    const answer = await host({ listed: [repo] }).checkRepository!(repo, { ignored: IGNORED });
    expect(answer.usable).toBe(false);
    expect(answer).toMatchObject({ problem: expect.stringContaining("Add `**/.fsdev/`") });
  });

  it("refuses a repository that tracks a file under the directory", async () => {
    const repo = repository(false);
    mkdirSync(join(repo, ".fsdev", "ask"), { recursive: true });
    writeFileSync(join(repo, ".fsdev", "ask", "kept.md"), "x");
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", "tracked");
    writeFileSync(join(repo, ".gitignore"), "**/.fsdev/\n");
    const answer = await host({ listed: [repo] }).checkRepository!(repo, { ignored: IGNORED });
    expect(answer).toMatchObject({ usable: false, problem: expect.stringContaining("already tracks files under .fsdev/ask") });
  });

  it("refuses a folder that is not a git repository", async () => {
    const folder = tempDir("plain");
    const answer = await host().checkRepository!(pathToFileURL(folder).href, { ignored: IGNORED });
    expect(answer).toMatchObject({ usable: false, problem: expect.stringContaining("is not a git repository") });
  });

  it("refuses a folder that doesn't exist", async () => {
    const answer = await host().checkRepository!(pathToFileURL(join(tempDir("gone"), "nope")).href);
    expect(answer).toMatchObject({ usable: false, problem: expect.stringContaining("there is no folder") });
  });

  it("refuses a remote the host's allow-list doesn't reach, without reaching it", async () => {
    const answer = await host({ allow: [] }).checkRepository!("https://github.com/acme/storefront.git");
    expect(answer).toMatchObject({ usable: false, problem: expect.stringContaining("not allowed on this host") });
  });

  it("answers clone for an allowed network remote, which it doesn't reach", async () => {
    await expect(host({ allow: ["example.invalid"] }).checkRepository!("https://example.invalid/acme/x.git")).resolves.toEqual({
      usable: true,
      how: "clone",
    });
  });

  it("gives the same answer as a provision of the same repository", async () => {
    const repo = repository(false);
    const h = host({ listed: [repo] });
    const answer = await h.checkRepository!(repo, { ignored: IGNORED });
    const provision = h.provision({ kind: "repo", repo }, { place: ["p"], branch: "run/one", ignored: IGNORED });
    await expect(provision).rejects.toThrow(/does not ignore the directory/);
    expect(answer).toMatchObject({ usable: false, problem: expect.stringContaining("does not ignore the directory") });
  });
  // A run's checkout is cut from a commit, so a rule only in the working tree protects nothing there.
  it("refuses a rule that is only in uncommitted changes, saying to commit it", async () => {
    const repo = repository(false);
    writeFileSync(join(repo, ".gitignore"), "**/.fsdev/\n");
    const answer = await host({ listed: [repo] }).checkRepository!(repo, { ignored: IGNORED });
    expect(answer.usable).toBe(false);
    expect(answer).toMatchObject({ problem: expect.stringContaining("Commit the .gitignore change") });
  });

  it("answers usable for a committed rule, whatever the working tree has done to it since", async () => {
    const repo = repository();
    writeFileSync(join(repo, ".gitignore"), "");
    await expect(host({ listed: [repo] }).checkRepository!(repo, { ignored: IGNORED })).resolves.toEqual({
      usable: true,
      how: "worktree",
    });
  });

  it("reads a committed rule as git does, an anchored one too", async () => {
    const repo = repository(false);
    writeFileSync(join(repo, ".gitignore"), "/.fsdev/\n");
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", "rule");
    await expect(host({ listed: [repo] }).checkRepository!(repo, { ignored: IGNORED })).resolves.toEqual({
      usable: true,
      how: "worktree",
    });
  });

  it("refuses a repository with no commit yet, since a run's checkout is cut from one", async () => {
    const dir = tempDir("check-empty");
    execFileSync("git", ["init", "-q", "-b", "main", dir]);
    writeFileSync(join(dir, ".gitignore"), "**/.fsdev/\n");
    const answer = await host({ listed: [dir] }).checkRepository!(dir, { ignored: IGNORED });
    expect(answer.usable).toBe(false);
    expect(answer).toMatchObject({ problem: expect.stringContaining("no commit yet") });
  });
  // `how` is the checkout a provision of the same string makes: it lists only a resolved absolute path.
  it("answers clone for a listed repository named by a file:// URL or a symlink, as a provision would", async () => {
    const repo = repository();
    const link = join(tempDir("check-link"), "repo");
    symlinkSync(repo, link);
    const h = host({ listed: [repo] });
    await expect(h.checkRepository!(pathToFileURL(repo).href, { ignored: IGNORED })).resolves.toEqual({ usable: true, how: "clone" });
    await expect(h.checkRepository!(pathToFileURL(link).href, { ignored: IGNORED })).resolves.toEqual({ usable: true, how: "clone" });
  });

  it("checks an unlisted bare repository's commit and committed rule, as its clone would get them", async () => {
    const empty = tempDir("check-bare-empty");
    execFileSync("git", ["init", "-q", "--bare", empty]);
    await expect(host().checkRepository!(pathToFileURL(empty).href, { ignored: IGNORED })).resolves.toMatchObject({
      usable: false,
      problem: expect.stringContaining("no commit yet"),
    });
    const bare = tempDir("check-bare-unignored");
    execFileSync("git", ["clone", "-q", "--bare", repository(false), bare]);
    await expect(host().checkRepository!(pathToFileURL(bare).href, { ignored: IGNORED })).resolves.toMatchObject({
      usable: false,
      problem: expect.stringContaining("Add `**/.fsdev/`"),
    });
    const good = tempDir("check-bare-good");
    execFileSync("git", ["clone", "-q", "--bare", repository(), good]);
    await expect(host().checkRepository!(pathToFileURL(good).href, { ignored: IGNORED })).resolves.toEqual({ usable: true, how: "clone" });
  });

  // A worktree shares the repository's info/exclude; a clone starts without it.
  it("counts a rule in info/exclude for a listed repository, and not for a clone", async () => {
    const repo = repository(false);
    writeFileSync(join(repo, ".git", "info", "exclude"), "**/.fsdev/\n");
    await expect(host({ listed: [repo] }).checkRepository!(repo, { ignored: IGNORED })).resolves.toEqual({ usable: true, how: "worktree" });
    await expect(host().checkRepository!(pathToFileURL(repo).href, { ignored: IGNORED })).resolves.toMatchObject({ usable: false });
  });
});
