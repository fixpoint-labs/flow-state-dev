/**
 * The session-repository run source answers a run's repository from its
 * session's server-written field alone: a listed repository, by path or
 * `file://` remote, runs in a worktree of its real path; an unlisted one runs
 * only if the host's check finds it usable; a session naming none is refused.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { BlockContext } from "@flow-state-dev/core/types";
import { listedRepository, sessionRepositorySource } from "../src/index";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A listed folder, reached through a symlink too, so a listing by real path is what matches. */
function folders() {
  const root = mkdtempSync(join(tmpdir(), "fsd-session-repo-"));
  dirs.push(root);
  const real = join(root, "repo");
  mkdirSync(real);
  symlinkSync(real, join(root, "link"));
  const other = join(root, "other");
  mkdirSync(other);
  return { root, real: realpathSync(real), link: join(root, "link"), other };
}

const session = (state: Record<string, unknown> | undefined) => ({ session: { state } }) as unknown as BlockContext;

describe("listedRepository", () => {
  it("maps a listed folder's path, symlink or file:// remote to its real path, and nothing else", () => {
    const f = folders();
    expect(listedRepository(f.real, [f.real])).toBe(f.real);
    expect(listedRepository(f.link, [f.real])).toBe(f.real);
    expect(listedRepository(pathToFileURL(f.link).href, [f.real])).toBe(f.real);
    expect(listedRepository(f.other, [f.real])).toBeUndefined();
    expect(listedRepository("https://github.com/acme/app.git", [f.real])).toBeUndefined();
    expect(listedRepository(join(f.root, "gone"), [f.real])).toBeUndefined();
  });
});

describe("sessionRepositorySource", () => {
  it("answers a listed repository by its real path, without asking the check", async () => {
    const f = folders();
    const asked: string[] = [];
    const source = sessionRepositorySource({ field: "repository", repositories: [f.real], check: async (r) => (asked.push(r), { usable: true, how: "clone" }) });
    expect(await source(session({ repository: pathToFileURL(f.link).href }))).toEqual({ kind: "repo", repo: f.real });
    expect(asked).toEqual([]);
  });

  it("refuses a session that names no repository, reading only its own field", async () => {
    const source = sessionRepositorySource({ field: "repository", repositories: [] });
    expect(await source(session({ project: "/some/where" }))).toMatchObject({ kind: "refused", reason: "no-repository" });
    expect(await source(session(undefined))).toMatchObject({ kind: "refused", reason: "no-repository" });
  });

  it("runs an unlisted repository the check finds usable, and refuses one it doesn't, with its problem", async () => {
    const f = folders();
    const source = sessionRepositorySource({
      field: "repository",
      repositories: [f.real],
      check: async (repository) => (repository === f.other ? { usable: false, problem: `${repository} is not a git repository.` } : { usable: true, how: "clone" }),
    });
    expect(await source(session({ repository: "file:///elsewhere/repo" }))).toEqual({ kind: "repo", repo: "file:///elsewhere/repo" });
    expect(await source(session({ repository: f.other }))).toEqual({ kind: "refused", reason: "repository-unusable", message: `repository-unusable: ${f.other} is not a git repository.` });
  });
});
