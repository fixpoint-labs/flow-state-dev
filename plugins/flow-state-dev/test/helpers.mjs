/**
 * Fixture helpers: build a project tree in a temporary directory, optionally as a git repository.
 *
 * Every fixture here is a real tree on disk rather than a mock, because the whole module under
 * test is "what does the filesystem and `git` actually say" — a mocked `existsSync` would let a
 * resolution pass while the real walk it models does something else.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";

const roots = [];

/** Build a tree from `{ "relative/path": "contents" }`. Directories are created as needed. */
export function makeTree(files, { git = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "fsd-detect-"));
  roots.push(root);
  for (const [relativePath, contents] of Object.entries(files)) {
    const path = join(root, relativePath);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents);
  }
  if (git) initGit(root);
  return root;
}

/** Turn a tree into a git repository with one commit, so tracked/ignored questions have answers. */
export function initGit(root, { commit = ["."] } = {}) {
  const run = (args) => execFileSync("git", ["-C", root, ...args], { stdio: "ignore" });
  run(["init", "-q"]);
  run(["config", "user.email", "fixture@example.invalid"]);
  run(["config", "user.name", "Fixture"]);
  run(["config", "commit.gpgsign", "false"]);
  if (commit.length > 0) {
    run(["add", "--", ...commit]);
    run(["commit", "-q", "-m", "fixture", "--allow-empty"]);
  }
}

/** Remove every fixture this process created. */
export function cleanupTrees() {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
}

/** Every file beneath `root` with its size and mtime — the snapshot a "writes nothing" check compares. */
export function snapshotTree(root) {
  const seen = {};
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path);
        continue;
      }
      const stats = statSync(path);
      seen[relative(root, path)] = `${stats.size}:${stats.mtimeMs}`;
    }
  };
  walk(root);
  return seen;
}

/** A minimal manifest, with anything extra merged in. */
export function manifest(extra = {}) {
  return `${JSON.stringify({ name: "fixture", version: "1.0.0", private: true, ...extra }, null, 2)}\n`;
}

/** A Next app manifest at a supported version. */
export function nextManifest(extra = {}) {
  return manifest({ dependencies: { next: "^15.4.0" }, scripts: { dev: "next dev" }, ...extra });
}
