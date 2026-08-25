/**
 * The implement phase — the one set of phase values this lab ships.
 *
 * Three values, handed to the manager: what to say to the run, how to tell the
 * job is done, and which collections the prompt may read. A record type, a
 * registry, or a second phase module would be abstraction for a set of one.
 * The spec and review phases arrive with a second shape to generalise from.
 *
 * **The done-condition is `a pull request exists for this issue-phase`, and it
 * is never an alternative route to completion** — the manager consults it only
 * after a successful verdict, because a run can open the pull request and then
 * exhaust its turn budget.
 */
import { execFileSync } from "node:child_process";
import type { PhaseRunContext, PhaseSpec } from "./manager";
import type { WorkspaceConfig } from "./workspace";
import { GIT_TIMEOUT_MS, NETWORK_CALL_TIMEOUT_MS, run } from "./exec";

export interface ImplementPhaseOptions {
  /**
   * Does a pull request exist for this branch? Injectable so a deterministic
   * test can stage both arms of the conjunction without a network.
   */
  prExists?: (run: PhaseRunContext) => boolean | Promise<boolean>;
}

/**
 * The pull-request states that count as "this phase produced something".
 *
 * **`CLOSED` is excluded, and that exclusion is the whole point.** A branch
 * whose pull request was opened and then closed WITHOUT merging still has a row
 * on GitHub. Counting it means a later attempt that exits cleanly completes the
 * task with no open and no merged pull request anywhere — a silent success,
 * which is the exact defect class this lab exists to close, re-entering through
 * the completion check itself.
 *
 * Not hypothetical: a closed-unmerged pull request is an ordinary artifact of
 * this repo's own process (every spec PR closes unmerged by design).
 */
const COMPLETING_PR_STATES = new Set(["OPEN", "MERGED"]);

/**
 * Does this branch have a pull request that counts?
 *
 * Split from the `gh` call so the state rule is testable without a network —
 * the rule is the part that can be wrong, and the part a reviewer needs pinned.
 * Tolerates a row with no `state` by rejecting it (BP-030): an answer we cannot
 * classify must not complete a task.
 *
 * **`inRepo` is the repository the run worked in**, and a row whose head lives
 * anywhere else is rejected however green its state. `gh`'s `--head` filter
 * matches a branch NAME, so a fork's branch carrying this run's name comes back
 * in the same listing; counting it would settle the row on a pull request the
 * run did not open. Rejected rather than trusted, for the same reason a missing
 * `state` is: an answer we cannot attribute must not complete a task.
 */
export function hasCompletingPr(stdout: string, inRepo?: string): boolean {
  let rows: unknown;
  try {
    rows = JSON.parse(stdout || "[]");
  } catch {
    return false;
  }
  if (!Array.isArray(rows)) return false;
  return rows.some((row) => {
    const r = row as {
      state?: unknown;
      headRepository?: { name?: unknown } | null;
      headRepositoryOwner?: { login?: unknown } | null;
    } | null;
    if (!COMPLETING_PR_STATES.has(String(r?.state))) return false;
    if (inRepo === undefined) return true;
    const owner = r?.headRepositoryOwner?.login;
    const name = r?.headRepository?.name;
    // Either field missing is unattributable, so it does not count.
    if (typeof owner !== "string" || typeof name !== "string") return false;
    return sameRepo(`${owner}/${name}`, inRepo);
  });
}

/**
 * Do two `owner/name` spellings name one GitHub repository?
 *
 * **Case-folded, because GitHub's are.** Owner and repository names are
 * case-insensitive there: a remote spelled `Fixpoint-Labs/Flow-State-Dev`
 * reaches the same repository as `fixpoint-labs/flow-state-dev`, and `gh -R`
 * accepts either. The API answers in ONE canonical casing regardless, so an
 * exact comparison against the remote's spelling rejects every pull request the
 * run actually opened — a successful run reported unfinished, retried, and its
 * budget spent. The same harm the attribution check itself was added to prevent,
 * arriving through the check.
 *
 * Folded with `toLowerCase()` rather than a locale-aware fold: these are ASCII
 * identifiers, and a locale-sensitive one would make the answer depend on the
 * host's locale.
 */
function sameRepo(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/**
 * `host/owner/name` from a git remote URL, in the form `gh -R` accepts.
 *
 * **The host is part of the answer, not decoration.** Reducing
 * `git@ghe.acme:owner/repo.git` to `owner/repo` sends the listing to
 * github.com (or wherever `GH_HOST` points) instead of the Enterprise host the
 * checkout actually came from — so a real pull request is missed, or a
 * same-named one on another host settles the task. `gh` documents `-R` as
 * `[HOST/]OWNER/REPO` precisely so this can be said.
 *
 * Handles the two spellings a checkout carries: `scheme://host/owner/name` and
 * `user@host:owner/name`, with or without `.git`.
 *
 * **Undefined is a refusal, not a fallback.** A remote with no host — a local
 * path, a relative clone — is not a repository `gh` can be pointed at, and a
 * remote we cannot name is one we cannot pin the listing to. A host `gh` does
 * not serve is left to fail loudly at the call rather than being guessed at
 * here; what must never happen is silently querying a DIFFERENT host.
 */
export interface RemoteRepo {
  /** For `gh -R`, which documents `[HOST/]OWNER/REPO`. */
  selector: string;
  /** For attribution: what a PR row's `headRepositoryOwner/headRepository` spells. */
  ownerRepo: string;
}

export function repoSlugFromRemote(url: string): RemoteRepo | undefined {
  // **Trailing slashes come off BEFORE `.git`, not after.** `…/repo.git/` left
  // the suffix in place, so the selector named a repository called `repo.git`
  // and every pull request for `repo` was missed — a successful run reported
  // unfinished, retried, budget spent. Fourth spelling this parser has been
  // wrong about, after the host, the port and the casing.
  const trimmed = url.trim().replace(/\/+$/, "").replace(/\.git$/, "");
  // `scheme://[user@]host/owner/name`
  // The port is part of the HOST, captured with it. Matching it and throwing it
  // away sent an Enterprise checkout on `:8443` to the same hostname on 443 — a
  // different server, quietly, which is the one outcome this function's own
  // doc says must never happen. It was matched only so it could not be mistaken
  // for the first path segment; dropping it was the bug.
  const viaUrl = /^[A-Za-z][A-Za-z0-9+.-]*:\/\/(?:[^@/]+@)?([^/:]+(?::\d+)?)\/(.+)$/.exec(trimmed);
  // `[user@]host:owner/name` — scp-like, and NOT a path (`/tmp/x:y` has a slash
  // before the colon, so it is excluded by the host pattern).
  const viaScp = /^(?:[^@/]+@)?([A-Za-z0-9._-]+):(?!\/)(.+)$/.exec(trimmed);
  const parsed = viaUrl ?? viaScp;
  if (parsed === null) return undefined;
  const [, host, rest] = parsed;
  const segments = rest.split("/").filter((part) => part.length > 0);
  if (segments.length < 2) return undefined;
  // The last two are owner and name; anything before is a path prefix some
  // hosts allow and `gh` does not, so it is refused rather than dropped.
  if (segments.length > 2) return undefined;
  // **Two values, named, because they are not interchangeable and I shipped them
  // as if they were.** `-R` wants the host; a PR row's head identity is
  // `owner/repo` with no host, so comparing the selector against it rejects
  // every matching pull request and a successful run exhausts its retries.
  // Returning one string made passing the wrong one a typo rather than a type
  // error, and the typo is exactly what happened.
  return {
    selector: `${host}/${segments[0]}/${segments[1]}`,
    ownerRepo: `${segments[0]}/${segments[1]}`,
  };
}

/**
 * Ask GitHub whether this branch has a pull request that counts.
 *
 * Run from inside the run's own checkout, so `gh` resolves the repository from
 * where the work happened rather than from wherever the server sits.
 *
 * `--state all` is still passed, deliberately: the alternative — asking only for
 * open ones — would miss a run that opened a PR and had it merged before the
 * verdict was read. The state is requested and judged here instead.
 *
 * **`--head` matches a branch NAME, not a branch.** `gh` documents it as a
 * head-branch filter and does not accept `<owner>:<branch>`, so a pull request
 * opened from a FORK whose head branch happens to carry this run's name is
 * returned by this listing. Accepting it would complete a clean agent run that
 * never opened a pull request at all — a stranger's branch settling our row as
 * done, which is the silent wrong success this phase exists to detect. So the
 * head repository is requested and checked: only a pull request whose head is
 * in the repository the run worked in counts.
 *
 * **The repository is taken from git, not from `gh`, and then pinned with
 * `-R`.** `GH_REPO` in the host's environment redirects every `gh` command that
 * would otherwise work from the local checkout — so asking `gh` which
 * repository this is and then asking `gh` for its pull requests lets ONE
 * process-level override redirect both halves of the comparison, which then
 * agree with each other about the wrong repository. Reading the remote with
 * `git` puts the answer outside `gh`'s environment, and passing it back as `-R`
 * stops the listing drifting to another one.
 */
async function prExistsViaGh(ctx: PhaseRunContext): Promise<boolean> {
  const { stdout: originStdout } = await run(
    "git",
    ["remote", "get-url", "origin"],
    {
      cwd: ctx.workspacePath,
      timeoutMs: NETWORK_CALL_TIMEOUT_MS,
      signal: ctx.ctx.signal,
    },
  );
  const repo = repoSlugFromRemote(originStdout.trim());
  if (repo === undefined) return false;

  const { stdout } = await run(
    "gh",
    [
      "pr",
      "list",
      "--head",
      ctx.branch,
      "--state",
      "all",
      "--json",
      "number,state,headRepository,headRepositoryOwner",
      "-R",
      repo.selector,
    ],
    {
      cwd: ctx.workspacePath,
      // Bounded twice. Without either, a listing that never answers holds the
      // row `in_progress` past the paid agent it was reporting on — the worker
      // does not return, so nothing settles and the attempt is charged anyway.
      timeoutMs: NETWORK_CALL_TIMEOUT_MS,
      signal: ctx.ctx.signal,
      maxBuffer: 4 * 1024 * 1024,
    },
  );
  return hasCompletingPr(stdout, repo.ownerRepo);
}

/**
 * Refuse a source repository the completion probe cannot read a remote from.
 *
 * **The probe's one unstated precondition, moved to startup.** `prExistsViaGh`
 * runs `git remote get-url origin`, and git exits non-zero when no remote by
 * that name exists — a repository cloned with its GitHub remote called
 * `upstream` is perfectly valid and fails here. That failure lands AFTER the
 * paid agent run: the rescue re-pends the row, the next attempt runs the agent
 * again, and it fails identically, until the retry budget is gone. A permanent
 * configuration error charged once per retry is exactly what the guards beside
 * this one exist to stop.
 *
 * Checks that the URL is one this module can name too, since a remote it cannot
 * parse fails the probe just as completely, only later and more confusingly.
 */
function assertCompletionRemote(workspace: WorkspaceConfig): void {
  let url: string;
  try {
    url = execFileSync("git", ["remote", "get-url", "origin"], {
      cwd: workspace.sourceRepo,
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
      timeout: GIT_TIMEOUT_MS,
    }).trim();
  } catch {
    throw new Error(
      `[conductor] ${workspace.sourceRepo} has no "origin" remote. The implement phase's ` +
        `completion check reads it to find this branch's pull request, and it runs after ` +
        `the agent — so without one every attempt pays for a full coding run and then ` +
        `fails permanently. Add an "origin" remote, or supply your own \`prExists\`.`,
    );
  }
  if (repoSlugFromRemote(url) === undefined) {
    throw new Error(
      `[conductor] the "origin" remote of ${workspace.sourceRepo} is "${url}", which does ` +
        `not name a host and repository the completion check can query. Same cost as a ` +
        `missing remote: a paid run per attempt, then a permanent failure.`,
    );
  }
}

/** Build the implement phase. */
export function implementPhase(options: ImplementPhaseOptions = {}): PhaseSpec {
  const prExists = options.prExists ?? prExistsViaGh;

  return {
    phase: "implement",
    // **Only when the built-in probe is the one that will run.** A caller who
    // supplies `prExists` has replaced the thing that reads `origin`, so
    // demanding one would refuse a configuration that works — and the tests,
    // which stub the probe against repositories that have no remote at all, are
    // the proof that this distinction is load-bearing rather than theoretical.
    ...(options.prExists === undefined ? { validate: assertCompletionRemote } : {}),
    // Empty, and that is not an oversight: this phase reads no collection of its
    // own. It does not read the run record either — everything it needs about
    // the previous attempt arrives on `PhaseRunContext`, because that row
    // describes the attempt now running and has already been cleared by the
    // time a prompt is built.
    //
    // `runs` is the MANAGER's collection regardless — always declared, and
    // reserved, because a phase re-declaring it would replace the manager's own
    // and send its bookkeeping somewhere `status` never reads. `readable` is for
    // collections a phase brings of its own.
    readable: {},

    buildPrompt(ctx: PhaseRunContext): string {
      const lines = [
        `Implement Linear issue ${ctx.issue}.`,
        "",
        `You are working in ${ctx.workspacePath}, on branch ${ctx.branch}.`,
        "Commit your work and open a pull request for that branch when the change is done.",
      ];

      if (ctx.attempt > 1) {
        lines.push(
          "",
          `This is attempt ${ctx.attempt}. The checkout still holds whatever the last`,
          "attempt left behind, uncommitted work included — read it before you start,",
          "and continue rather than beginning again.",
        );
      }

      // The carry-forward decision 2's economics rest on. It comes from the
      // board's own `feedback` field, captured when `fail()` re-pended the row —
      // never from the run record, which keeps only the last outcome and is
      // overwritten when this attempt opens.
      if (ctx.feedback !== undefined && ctx.feedback !== "") {
        lines.push("", "The last attempt stopped for this reason:", ctx.feedback);
      }

      // From the MANAGER, not from the run record. The record's `sessionId`
      // describes the attempt now running, and this attempt's opening write
      // cleared it before a prompt could be built — so reading it here always
      // saw `null` and the previous session was silently never named. The
      // manager captures it before the clear and hands it over.
      if (ctx.previousSessionId !== undefined) {
        lines.push("", `The previous run's harness session was ${ctx.previousSessionId}.`);
      }

      return lines.join("\n");
    },

    isDone: (ctx) => prExists(ctx),
  };
}
