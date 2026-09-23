/**
 * The throwaway repository both checks cut checkouts from, and the durable
 * address the third one publishes work to.
 *
 * A goal that grades "the run was given its own checkout" and "the branch
 * carries a commit its base does not" needs a real git repository to be true
 * about, and it must be a repository this lab created — running against the
 * developer's own tree would make the check's side effects somebody's working
 * copy.
 *
 * Modelled on `packages/harness-manager/test/fixtures.ts`, which is the same
 * fixture for the same provisioning code. Three things in it are not decoration
 * and are the reason this is a helper rather than three lines inline:
 *
 * - **Tracked content.** A repository with no committed files makes a
 *   half-populated checkout indistinguishable from a complete one.
 * - **The ask-marker ignore rule.** Provisioning refuses a checkout whose
 *   repository does not carry it, before the harness runs — so a scratch repo
 *   without it fails every attempt for a reason that has nothing to do with
 *   what is being graded.
 * - **`"type": "module"`.** The brief names a module path and an export, and
 *   the acceptance check imports it. With no `package.json` a `.js` file is
 *   CommonJS, so a run that wrote the `export` the brief asked for would be
 *   rejected on a module-system technicality rather than on its work.
 *
 * ## The artifact's address (D1, S3)
 *
 * The temp-directory repository stays exactly as it was. What is new is an
 * optional **bare repository at a declared path** — {@link ARTIFACTS_ROOT},
 * inside the lab rather than under `tmpdir()` — wired as a remote on the source
 * repository. Work pushed there resolves after the goal's process has exited
 * and its temporary directories are gone, which is the first of D1's three
 * properties and the one the temp directory fails.
 *
 * `git init --bare` plus a push, never `git clone --bare`: a local clone
 * hardlinks its object store to the source by default, and an address whose
 * objects are the run's own objects is not an independent address.
 *
 * It needs no network and no credential. The pull-request release run points
 * the same remote at a real remote instead; that is a human release step, and
 * the lab carries one leg (BR-14).
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { ASK_MARKER_IGNORE_RULE } from "@flow-state-dev/harness-manager";
import { GIT_TIMEOUT_MS } from "@flow-state-dev/harness-manager/checkout";

/** The branch a fresh checkout is cut from, and what `isDone` compares against. */
export const BASE_REF = "main";

/**
 * The remote name the durable artifact repository is wired under.
 *
 * Not `origin`: `origin` already points at a plausible-looking GitHub URL that
 * nothing may contact, and a push that silently went there instead would be the
 * network dependency BR-15 exists to exclude.
 */
const ARTIFACT_REMOTE = "artifacts";

/**
 * Where published artifacts live — the declared path, inside the lab.
 *
 * Under the lab and not under `tmpdir()`, deliberately: a temp directory is
 * swept, and an address that is gone by the time somebody looks fails D1's
 * first property exactly as today's commit-in-a-temp-directory does. Ignored by
 * `goals/devforce-lab/.gitignore`, so a run leaves no tracked change (BR-16).
 */
export const ARTIFACTS_ROOT: string = fileURLToPath(new URL("../.artifacts/", import.meta.url));

export interface ScratchRepo {
  /** The repository checkouts are cut from. */
  sourceRepo: string;
  /** The directory those checkouts land in. */
  root: string;
}

export interface ScratchRepoOptions {
  /**
   * Create a bare repository at this path and wire it as
   * {@link ARTIFACT_REMOTE}. Absent leaves the repository exactly as the two
   * existing checks have it.
   */
  artifactRepo?: string;
  /**
   * Extra files to put in the base commit, as path → contents.
   *
   * The `already-passing` control's whole mechanism: a base ref that already
   * satisfies the acceptance check makes the base-ref half of BR-3 pass, which
   * is the red state of "a condition already true before the run is no
   * evidence".
   */
  seed?: Record<string, string>;
}

/**
 * Run git in a repository, returning stdout.
 *
 * Bounded by `GIT_TIMEOUT_MS`, the same budget the harness manager gives its own
 * git calls and the same one `it-commits-from-the-seats-own-file` already uses.
 * A goal that hangs forever because git wedged is worse than one that fails: the
 * verdict never arrives, so nobody learns anything, and a check whose failure
 * mode is silence is the shape this whole lab exists to refuse.
 */
function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    stdio: "pipe",
    encoding: "utf8",
    timeout: GIT_TIMEOUT_MS,
  });
}

/**
 * Create a fresh source repository and a checkout root, both under the OS temp
 * directory, and optionally a durable bare repository to publish to.
 *
 * @param label A short name, so a leftover directory says which check made it.
 * @param options `artifactRepo` to wire a durable address; `seed` to put extra
 *   files in the base commit.
 * @returns The two paths a `WorkspaceConfig` needs.
 */
export function createScratchRepo(label: string, options: ScratchRepoOptions = {}): ScratchRepo {
  const sourceRepo = mkdtempSync(join(tmpdir(), `devforce-lab-${label}-repo-`));
  const root = mkdtempSync(join(tmpdir(), `devforce-lab-${label}-work-`));

  git(sourceRepo, "init", `--initial-branch=${BASE_REF}`, ".");
  git(sourceRepo, "config", "user.email", "devforce-lab@example.test");
  git(sourceRepo, "config", "user.name", "DevForce Lab");
  writeFileSync(join(sourceRepo, "README.md"), "A repository for the DevForce lab to work in.\n");
  writeFileSync(join(sourceRepo, ".gitignore"), `${ASK_MARKER_IGNORE_RULE}\n`);
  writeFileSync(
    join(sourceRepo, "package.json"),
    `${JSON.stringify({ name: "devforce-lab-scratch", private: true, type: "module" }, null, 2)}\n`,
  );
  git(sourceRepo, "add", "README.md", ".gitignore", "package.json");
  for (const [path, contents] of Object.entries(options.seed ?? {})) {
    const full = join(sourceRepo, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, contents);
    git(sourceRepo, "add", path);
  }
  git(sourceRepo, "commit", "-m", "root");
  git(
    sourceRepo,
    "remote",
    "add",
    "origin",
    "https://github.com/fixpoint-labs/devforce-lab-scratch.git",
  );

  if (options.artifactRepo === undefined) return { sourceRepo, root };

  mkdirSync(dirname(options.artifactRepo), { recursive: true });
  execFileSync("git", ["init", "--bare", "--quiet", options.artifactRepo], {
    stdio: "pipe",
    timeout: GIT_TIMEOUT_MS,
  });
  git(sourceRepo, "remote", "add", ARTIFACT_REMOTE, options.artifactRepo);
  return { sourceRepo, root };
}

/**
 * Publish refs from the source repository to the durable artifact repository.
 *
 * **The lab pushes, not the coding agent, and that is a deliberate reading of
 * S3.** Where an artifact has to survive to is the lab's question; what the
 * artifact *contains* is the run's, and BR-2 grades only the second. Making the
 * agent responsible for the transport would let the proof go red because a
 * model forgot `git push`, which is not what any of this is trying to measure.
 *
 * The base ref goes too: a third party resolving the address needs something to
 * read the work against, and the base-ref half of BR-3 is executed from the
 * same address as the produced half.
 *
 * @param sourceRepo The repository holding the refs.
 * @param refs Branch names to publish.
 */
export function publishArtifact(sourceRepo: string, refs: readonly string[]): void {
  git(sourceRepo, "push", "--quiet", ARTIFACT_REMOTE, ...refs);
}

/**
 * Every branch in a repository matching a prefix, sorted.
 *
 * Works on a bare repository as well as a working one — which is the point:
 * after the run the branch is read out of the published address, not out of
 * anything the run still holds.
 */
export function branchesUnder(repo: string, prefix: string): string[] {
  return git(repo, "branch", "--list", `${prefix}*`, "--format=%(refname:short)")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .sort();
}

/**
 * How many commits `ref` carries that `base` does not.
 *
 * **The branch is not the work.** Provisioning cuts a `conductor/…` branch
 * before the harness runs, so a branch exists even for an attempt that produced
 * nothing — asking whether one appeared measures the checkout, not the run.
 * Asking how far ahead it is measures the run.
 *
 * @param repo The repository holding both refs. Bare or working.
 * @param base The ref to compare against.
 * @param ref The branch to measure.
 * @returns The number of commits `ref` is ahead of `base`.
 */
export function commitsAhead(repo: string, base: string, ref: string): number {
  return Number.parseInt(git(repo, "rev-list", "--count", `${base}..${ref}`).trim(), 10);
}

/**
 * Clone one ref out of a repository into `dest`.
 *
 * `--no-hardlinks`, so the checkout's objects are its own copy and deleting the
 * source cannot empty it — the same reason the artifact repository is built
 * with `init --bare` and a push.
 *
 * @param repo The repository to read from.
 * @param ref The branch to check out.
 * @param dest Where the working tree lands.
 */
export function cloneRef(repo: string, ref: string, dest: string): void {
  mkdirSync(dirname(dest), { recursive: true });
  execFileSync(
    "git",
    ["clone", "--quiet", "--no-hardlinks", "--branch", ref, "--single-branch", repo, dest],
    { stdio: "pipe", timeout: GIT_TIMEOUT_MS },
  );
}

/**
 * Commit everything in a checkout, as a coding run would.
 *
 * Used by the gate's scripted harness. `-A` rather than named paths: what a run
 * wrote is the run's business, and the gate grades the commit, not the diff.
 */
export function commitAll(checkout: string, message: string): void {
  git(checkout, "config", "user.email", "devforce-lab@example.test");
  git(checkout, "config", "user.name", "DevForce Lab");
  git(checkout, "add", "-A");
  git(checkout, "commit", "-m", message);
}
