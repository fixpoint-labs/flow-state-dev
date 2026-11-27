#!/usr/bin/env node
/**
 * Pre-push guard: a `preview/*` branch never leaves this machine.
 *
 * A preview branch merges one developer's in-flight feature branches for a local preview
 * (`.agents/skills/preview-mode/`). `.husky/pre-push` pipes git's pushed-ref lines to this script
 * on stdin (`<local ref> <local sha> <remote ref> <remote sha>`, one per ref); it exits 1 and
 * names the rule when a push would publish a preview.
 *
 * A push is refused when either ref is `refs/heads/preview/*`, or when the pushed commit is the
 * tip of a local preview branch and carries work no feature branch has. The second rule catches
 * `git push origin HEAD:<branch>` from the preview, and a branch cut from it. It is judged by
 * content rather than by the shared tip alone, because a preview fast-forwarded onto a feature
 * (or sitting at origin/main right after it was made) shares that commit with a push that
 * publishes nothing of the preview's. Deleting a remote ref is let through.
 *
 * Usage: node scripts/check-preview-push.mjs < pushed-refs
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const ZERO = /^0+$/;

/** Run git and return its trimmed stdout, or null when it exits non-zero. */
function git(args) {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

/**
 * True when `sha` carries a commit that is in neither origin/main nor any listed feature branch
 * (`git config preview.branch`), which only a preview's own merges and commits are.
 */
function carriesPreviewWork(sha) {
  const features = (git(["config", "--get-all", "preview.branch"]) ?? "").split("\n").filter(Boolean);
  const exclude = ["origin/main", ...features].filter((ref) => git(["rev-parse", "--verify", "--quiet", ref]) !== null);
  const own = git(["rev-list", "-n1", sha, "--not", ...exclude]);
  // An unreadable history is not proof of safety.
  return own === null || own !== "";
}

const previewTips = new Set((git(["for-each-ref", "--format=%(objectname)", "refs/heads/preview/"]) ?? "").split("\n").filter(Boolean));

for (const line of readFileSync(0, "utf8").split("\n")) {
  const [localRef, localSha, remoteRef] = line.trim().split(/\s+/);
  if (!localSha || ZERO.test(localSha)) continue;
  const byName = localRef.startsWith("refs/heads/preview/") || remoteRef?.startsWith("refs/heads/preview/");
  if (byName || (previewTips.has(localSha) && carriesPreviewWork(localSha))) {
    console.error("pre-push: preview/* branches are local-only; push the feature branch instead.");
    process.exit(1);
  }
}
