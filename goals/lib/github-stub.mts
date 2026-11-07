/**
 * A GitHub stand-in for goal checks that land a run's work as a pull request
 * (an accept's **Open a PR**), with no network and no account.
 *
 * - {@link REMOTE} is a GitHub-shaped `origin`, so a host's `landWays`
 *   offers `pull-request` and pins it at start.
 * - `bin/ssh`, first on the server's `PATH`, takes a push or fetch to that
 *   remote to a bare repository under the scratch folder, so the push a
 *   landing makes succeeds.
 * - `bin/gh` answers `gh pr list` and `gh pr create` (the landing), the
 *   branch listing a run's end makes, and one pull request's state, from a
 *   state file {@link githubStub}'s `set` writes, logging every call.
 *
 * ```ts
 * const github = githubStub(scratch);
 * const repo = github.checkout(join(scratch, "repo"), { "NOTES.md": "# Notes\n" });
 * const host = await start({ env: github.env, workdir: repo });
 * // … accept with Open a PR, then:
 * github.set(7, "merged");
 * ```
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** The `origin` every stubbed checkout names: `acme/app` on github.com, over ssh. */
export const REMOTE = "git@github.com:acme/app.git";

/** The link the stub gives pull request `n`. */
export const stubPullRequestUrl = (n: number): string => `https://github.com/acme/app/pull/${n}`;

/** One pull request as the stub holds it. */
export interface StubPullRequest {
  /** The branch it was opened from (`gh pr create --head`). */
  branch?: string;
  /** Text the run's branch or checkout path contains, for a pull request the run itself opened. */
  match?: string;
  state: "open" | "merged" | "closed";
  title?: string | null;
}

const BIN = fileURLToPath(new URL("./github-stub/bin", import.meta.url));

/** The GitHub stand-in under `scratch`: its environment for the server, a checkout maker, and its state. */
export function githubStub(scratch: string) {
  const stateFile = join(scratch, "gh-state.json");
  const ghLog = join(scratch, "gh-calls.log");
  const sshLog = join(scratch, "ssh-calls.log");
  const sshRoot = join(scratch, "github");
  const bare = join(sshRoot, "acme", "app.git");
  mkdirSync(join(sshRoot, "acme"), { recursive: true });
  if (!existsSync(bare)) execFileSync("git", ["init", "-q", "--bare", "-b", "main", bare]);
  writeFileSync(ghLog, "");
  writeFileSync(sshLog, "");
  writeFileSync(stateFile, JSON.stringify({ prs: {} }));

  const read = (): { prs: Record<string, StubPullRequest>; next?: number; fail?: boolean } => JSON.parse(readFileSync(stateFile, "utf8"));
  const write = (state: ReturnType<typeof read>) => writeFileSync(stateFile, JSON.stringify(state));
  const lines = (file: string) =>
    readFileSync(file, "utf8")
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => JSON.parse(line) as { args: string[]; code: number });

  return {
    /** The server's environment: the stubs first on `PATH`, and where they read and log. */
    env: {
      PATH: `${BIN}:${process.env.PATH ?? ""}`,
      GOAL_GH_STATE: stateFile,
      GOAL_GH_LOG: ghLog,
      GOAL_SSH_ROOT: sshRoot,
      GOAL_SSH_LOG: sshLog,
      // No `url.*.insteadOf` from the environment (a sandbox may rewrite github.com to https): the push must reach the stub ssh.
      GIT_CONFIG_COUNT: "0",
    } as Record<string, string>,
    /** The bare repository `REMOTE` reaches. */
    bare,
    /**
     * A git checkout at `dir` on `main`, one commit of `files` (and a
     * `.gitignore` of `.fsdev/`), its `origin` {@link REMOTE}, `main` pushed
     * there and tracked, so a run's branch has a base on the remote.
     */
    checkout(dir: string, files: Record<string, string> = {}): string {
      mkdirSync(dir, { recursive: true });
      const git = (...args: string[]) =>
        execFileSync("git", ["-c", "user.email=goal@example.com", "-c", "user.name=goal", ...args], { cwd: dir, stdio: "pipe" });
      git("init", "-q", "-b", "main");
      writeFileSync(join(dir, ".gitignore"), ".fsdev/\n");
      for (const [name, text] of Object.entries({ "README.md": "# App\n", ...files })) writeFileSync(join(dir, name), text);
      git("add", ".");
      git("commit", "-q", "-m", "start");
      git("remote", "add", "origin", REMOTE);
      // Straight to the bare repository: the stub ssh is only on the server's PATH.
      git("push", "-q", bare, "main:main");
      git("fetch", "-q", bare, "+refs/heads/main:refs/remotes/origin/main");
      git("branch", "-q", "--set-upstream-to=origin/main", "main");
      return dir;
    },
    /** Pull request `n` as the stub has it, or `undefined`. */
    pullRequest: (n: number): StubPullRequest | undefined => read().prs[n],
    /** Every pull request the stub holds, by number. */
    pullRequests: () => read().prs,
    /** Set pull request `n`'s state, as GitHub would after a merge or a close. */
    set(n: number, state: StubPullRequest["state"]) {
      const now = read();
      const pr = now.prs[n];
      if (pr === undefined) throw new Error(`the stub holds no pull request ${n}`);
      now.prs[n] = { ...pr, state };
      write(now);
    },
    /** While on, every read of one pull request fails, as gh does signed out. */
    failReads(on: boolean) {
      write({ ...read(), fail: on });
    },
    /** Every `gh` call, in order. */
    ghCalls: () => lines(ghLog),
    /** Every `ssh` call, in order. */
    sshCalls: () => lines(sshLog),
  };
}

/** What {@link githubStub} returns. */
export type GithubStub = ReturnType<typeof githubStub>;
