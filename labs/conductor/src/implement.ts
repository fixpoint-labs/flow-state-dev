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
import type { PhaseRunContext, PhaseSpec } from "./manager";
import { NETWORK_CALL_TIMEOUT_MS, run } from "./exec";

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
    return `${owner}/${name}` === inRepo;
  });
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
export function repoSlugFromRemote(url: string): string | undefined {
  const trimmed = url.trim().replace(/\.git$/, "");
  // `scheme://[user@]host/owner/name`
  const viaUrl = /^[A-Za-z][A-Za-z0-9+.-]*:\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+)$/.exec(trimmed);
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
  return `${host}/${segments[0]}/${segments[1]}`;
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
  const thisRepo = repoSlugFromRemote(originStdout.trim());
  if (thisRepo === undefined) return false;

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
      thisRepo,
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
  return hasCompletingPr(stdout, thisRepo);
}

/** Build the implement phase. */
export function implementPhase(options: ImplementPhaseOptions = {}): PhaseSpec {
  const prExists = options.prExists ?? prExistsViaGh;

  return {
    phase: "implement",
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
