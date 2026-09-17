/**
 * The throwaway repository both checks cut checkouts from.
 *
 * A goal that grades "the run was given its own checkout" and "the branch
 * carries a commit its base does not" needs a real git repository to be true
 * about, and it must be a repository this lab created — running against the
 * developer's own tree would make the check's side effects somebody's working
 * copy.
 *
 * Modelled on `packages/harness-manager/test/fixtures.ts`, which is the same
 * fixture for the same provisioning code. Two things in it are not decoration
 * and are the reason this is a helper rather than three lines inline:
 *
 * - **Tracked content.** A repository with no committed files makes a
 *   half-populated checkout indistinguishable from a complete one.
 * - **The ask-marker ignore rule.** Provisioning refuses a checkout whose
 *   repository does not carry it, before the harness runs — so a scratch repo
 *   without it fails every attempt for a reason that has nothing to do with
 *   what is being graded.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ASK_MARKER_IGNORE_RULE } from "@flow-state-dev/harness-manager";

/** The branch a fresh checkout is cut from, and what `isDone` compares against. */
export const BASE_REF = "main";

export interface ScratchRepo {
  /** The repository checkouts are cut from. */
  sourceRepo: string;
  /** The directory those checkouts land in. */
  root: string;
}

/**
 * Create a fresh source repository and a checkout root, both under the OS temp
 * directory.
 *
 * @param label A short name, so a leftover directory says which check made it.
 * @returns The two paths a `WorkspaceConfig` needs.
 */
export function createScratchRepo(label: string): ScratchRepo {
  const sourceRepo = mkdtempSync(join(tmpdir(), `devforce-lab-${label}-repo-`));
  const root = mkdtempSync(join(tmpdir(), `devforce-lab-${label}-work-`));

  const git = (...args: string[]): string =>
    execFileSync("git", args, { cwd: sourceRepo, stdio: "pipe", encoding: "utf8" });

  git("init", `--initial-branch=${BASE_REF}`, ".");
  git("config", "user.email", "devforce-lab@example.test");
  git("config", "user.name", "DevForce Lab");
  writeFileSync(join(sourceRepo, "README.md"), "A repository for the DevForce lab to work in.\n");
  writeFileSync(join(sourceRepo, ".gitignore"), `${ASK_MARKER_IGNORE_RULE}\n`);
  git("add", "README.md", ".gitignore");
  git("commit", "-m", "root");
  git("remote", "add", "origin", "https://github.com/fixpoint-labs/devforce-lab-scratch.git");

  return { sourceRepo, root };
}

/**
 * Commit everything in a checkout, as a coding run would.
 *
 * Used by the gate's scripted harness. `-A` rather than named paths: what a run
 * wrote is the run's business, and the gate grades the commit, not the diff.
 */
export function commitAll(checkout: string, message: string): void {
  const git = (...args: string[]): string =>
    execFileSync("git", args, { cwd: checkout, stdio: "pipe", encoding: "utf8" });
  git("config", "user.email", "devforce-lab@example.test");
  git("config", "user.name", "DevForce Lab");
  git("add", "-A");
  git("commit", "-m", message);
}
