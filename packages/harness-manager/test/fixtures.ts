/**
 * The stand-in source repository the checkout tests cut worktrees from.
 *
 * Owned by this package's tests because three of them need it — `workspace`,
 * `run-record` and `guards` — and it is a *git repository* fixture rather than
 * a board fixture. `labs/conductor` imports it for its own harness, which is
 * one definition of "what a source repository looks like" rather than two that
 * drift; the same reason `inbox-fake` lives beside the inbox it models.
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { ASK_MARKER_IGNORE_RULE } from "../src/ask";

/** A real git repository with one commit, so `worktree add` has something to cut. */
export function seedRepo(dir: string): void {
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: dir, stdio: "pipe", encoding: "utf8" });
  git("init", "--initial-branch=main", ".");
  git("config", "user.email", "conductor@example.test");
  git("config", "user.name", "Conductor Test");
  // **A stand-in repository has tracked content, because a real one does.**
  // These fixtures committed nothing, so every worktree cut from them had zero
  // tracked files — which makes a half-populated checkout indistinguishable from
  // a complete one (`git ls-files --deleted` is empty either way), and that
  // distinction is what the provisioning marker is now corroborated against.
  // Another fixture that had drifted from the thing it stands for.
  writeFileSync(join(dir, "tracked.txt"), "content the checkout should carry\n");
  // **A stand-in source repository ignores the ask marker, because a real one
  // has to.** The marker lands in the product checkout, so the rule that keeps
  // it out of a commit belongs to THAT repository — and provisioning now
  // refuses a checkout whose repository does not carry it, before the agent
  // runs. Third fixture in this file that had drifted from the thing it stands
  // for, and the same tell each time: the specs passed because nothing asked.
  writeFileSync(join(dir, ".gitignore"), `${ASK_MARKER_IGNORE_RULE}\n`);
  git("add", "tracked.txt", ".gitignore");
  git("commit", "-m", "root");
  // **A stand-in source repository has an `origin`, because a real one does.**
  // The implement phase's completion probe reads it, and `conductorFlow` now
  // refuses a source repo without one — a guard that exists because the failure
  // otherwise lands after a paid agent run, once per retry. These fixtures had
  // no remote at all, so every flow built here was one the probe could not have
  // run against; the specs passed only because the probe is stubbed. Nothing
  // resolves this URL: the phase's `gh` call is replaced in every test that
  // reaches it.
  git("remote", "add", "origin", "https://github.com/fixpoint-labs/conductor-fixture.git");
}
