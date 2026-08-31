/**
 * Filesystem and `git` primitives the resolutions share. Reads only — nothing in this directory
 * writes, which is what lets every refusal be decided from state the run has not modified.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

/** Read a file, or `null` if it is absent or unreadable. Never throws. */
export function readIfPresent(path) {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return null;
  }
}

/** Parse a `package.json`, or `null` if it is absent or not valid JSON. */
export function readManifest(dir) {
  const raw = readIfPresent(join(dir, "package.json"));
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Directory entries, or an empty list when the directory is absent. */
export function listDir(path) {
  try {
    return readdirSync(path, { withFileTypes: true });
  } catch {
    return [];
  }
}

/** `dir` and every ancestor, nearest first, stopping at the filesystem root. */
export function ancestorsFrom(dir) {
  const chain = [];
  let current = resolve(dir);
  for (;;) {
    chain.push(current);
    const parent = dirname(current);
    if (parent === current) return chain;
    current = parent;
  }
}

/** A path rendered relative to a root, for a report a human reads. Absolute when it escapes the root. */
export function displayPath(path, root) {
  const rel = relative(root, path);
  return rel === "" ? "." : rel.startsWith("..") ? path : rel;
}

/**
 * Is `path` strictly inside `root` (not `root` itself)?
 *
 * Uses `relative()`, so Windows backslashes and a missing trailing separator do not matter.
 * `startsWith(root + "/")` is false when `path` was built with `\\`, which is how a write-root
 * containment check on Windows treated every file as outside and pointed the token at a sibling.
 */
export function isInside(root, path) {
  const rel = relative(resolve(root), resolve(path));
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

/**
 * Run a `git` command in `dir`. Returns `{ ok, stdout, code }` and never throws, because every
 * caller here is asking a question whose "no" is an ordinary answer (not a repository, file not
 * tracked, path not ignored) rather than a failure.
 */
export function git(dir, args) {
  try {
    const stdout = execFileSync("git", ["-C", dir, ...args], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return { ok: true, stdout: stdout.trim(), code: 0 };
  } catch (err) {
    return { ok: false, stdout: "", code: typeof err?.status === "number" ? err.status : 1 };
  }
}

/** The repository root `git` reports for `dir`, or `null` outside a repository. */
export function repositoryRoot(dir) {
  const result = git(dir, ["rev-parse", "--show-toplevel"]);
  // `rev-parse --show-toplevel` prints `/` paths. `ancestorsFrom` uses `resolve()`, which is
  // `\` on Windows — without `resolve()` here the two never `===` and the workspace search
  // walks past the repository into an unrelated checkout.
  return result.ok && result.stdout.length > 0 ? resolve(result.stdout) : null;
}

/**
 * Is `path` tracked by git?
 *
 * Asked with `ls-files --error-unmatch`, whose exit code is the answer. A file that is absent or
 * outside a repository is not tracked, which is the same "no" from the caller's point of view.
 */
export function isTrackedByGit(path) {
  return git(dirname(path), ["ls-files", "--error-unmatch", "--", path]).ok;
}

/**
 * Would git ignore `path`?
 *
 * `-q`, never `-v`. With `-v` the exit code is 0 whenever *any* pattern matches — including a
 * negation that re-includes the file — so a `-v` exit-code test reports "ignored" for a file git
 * will happily commit. `-q` exits 0 only when the file really is ignored.
 */
export function isIgnoredByGit(path) {
  return git(dirname(path), ["check-ignore", "-q", "--", path]).ok;
}

/** Does this directory exist and hold a `package.json`? */
export function isProjectDir(dir) {
  return existsSync(join(dir, "package.json"));
}
