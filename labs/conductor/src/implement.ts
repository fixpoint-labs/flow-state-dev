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
import type { PhaseRunContext, PhaseSpec, PromptRunContext } from "./manager";
import type { WorkspaceConfig } from "./workspace";
import { GIT_TIMEOUT_MS, NETWORK_CALL_TIMEOUT_MS, run } from "./exec";
import {
  API_PORT_SCHEMES,
  GIT_SUFFIX,
  HOST_PORT,
  REMOTE_VIA_SCP,
  REMOTE_VIA_URL,
  TRAILING_SLASHES,
} from "./patterns";

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
/**
 * How many rows the completion probe asks `gh` for, per state.
 *
 * **Explicit because the default is 30 and this is an existential question**,
 * and generous because a page that fills is a question this probe cannot
 * answer — see {@link readCompletion}.
 *
 * What makes a limit tolerable at all is {@link COMPLETING_QUERY_STATES}: the
 * probe no longer asks for CLOSED, which was the only state that accumulates
 * without bound here — one per abandoned attempt on this deterministic branch.
 * Asking for rows that could never count and then discarding them is what let
 * them push the row that counts off the page.
 */
const PR_LIST_LIMIT = 100;

/**
 * The states the probe queries, one listing each.
 *
 * **Filtered at the source rather than discarded after loading.** These are
 * exactly the states {@link COMPLETING_PR_STATES} keeps, so a listing can no
 * longer be dominated by rows that were going to be thrown away. Two calls
 * rather than one `--state all`, which costs nothing that matters: the probe
 * runs once per attempt, after a paid coding run, and the whole of it is
 * already bounded by one deadline in the manager rather than per call.
 *
 * The JSON filter stays underneath and is not redundant — it also carries the
 * repository attribution, and a query changed in isolation should not silently
 * widen what counts.
 */
export const COMPLETING_QUERY_STATES = ["open", "merged"] as const;

/**
 * The `gh pr list` arguments for one state.
 *
 * Split out so the command the probe actually sends is assertable — the
 * defect this shape exists to prevent lives in the ARGUMENTS, not in the
 * parsing, and a test that only exercised the parser would not have caught it.
 */
export function prListArgs(
  branch: string,
  state: string,
  selector: string,
  limit: number = PR_LIST_LIMIT,
): string[] {
  return [
    "pr",
    "list",
    "--head",
    branch,
    "--state",
    state,
    "--json",
    "number,state,headRepository,headRepositoryOwner",
    "--limit",
    String(limit),
    "-R",
    selector,
  ];
}

/**
 * The probe's answer, or a refusal when the page cannot support one.
 *
 * **A saturated page is not evidence of absence.** If the listing came back
 * full and nothing in it counts, the answer is unknown rather than no — the
 * matching pull request may simply be on the next page. Both outcomes re-pend
 * the row, so the difference is not the row's fate but whether anybody can tell
 * what happened: a silent `false` is indistinguishable from a run that really
 * did not finish, which is the substitution this lab exists to remove.
 *
 * A match short-circuits, so a full page that DOES contain a completing pull
 * request answers normally — saturation only matters when the answer would
 * otherwise be no.
 *
 * **Kept as a backstop rather than as the fix.** Since the probe stopped asking
 * for CLOSED, a full page means a hundred OPEN or MERGED pull requests on one
 * branch, which is not a thing that happens by ordinary use. The refusal is
 * what keeps the limit from being load-bearing for correctness if it ever does.
 */
export function readCompletion(
  stdout: string,
  inRepo: string,
  limit: number = PR_LIST_LIMIT,
): boolean {
  if (hasCompletingPr(stdout, inRepo)) return true;
  let rows: unknown;
  try {
    rows = JSON.parse(stdout || "[]");
  } catch {
    return false;
  }
  if (Array.isArray(rows) && rows.length >= limit) {
    throw new Error(
      `[conductor] the completion check listed ${rows.length} pull requests for this ` +
        `branch — its whole page — and none of them counts. That is not evidence there ` +
        `is none: a completing pull request may be on a page this listing never asked ` +
        `for. Refusing rather than reporting a finished run as unfinished.`,
    );
  }
  return false;
}

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
  const trimmed = url.trim().replace(TRAILING_SLASHES, "").replace(GIT_SUFFIX, "");
  // `scheme://[user@]host/owner/name`
  // The port is part of the HOST, captured with it. Matching it and throwing it
  // away sent an Enterprise checkout on `:8443` to the same hostname on 443 — a
  // different server, quietly, which is the one outcome this function's own
  // doc says must never happen. It was matched only so it could not be mistaken
  // for the first path segment; dropping it was the bug.
  // A bracketed IPv6 literal is ONE host, colons and all. Without the first
  // alternative the host class stops at the literal's first colon and the whole
  // URL fails to parse — which since the startup preflight consumes this parser
  // is no longer a probe that returns false, it is a conductor that refuses to
  // build on a remote `gh` can query perfectly well.
  const viaUrl = REMOTE_VIA_URL.exec(trimmed);
  const viaScp = REMOTE_VIA_SCP.exec(trimmed);
  if (viaUrl === null && viaScp === null) return undefined;
  // The URL form carries a scheme; the scp-like form has no port to begin with.
  const [scheme, matchedHost, rest] =
    viaUrl !== null
      ? [viaUrl[1], viaUrl[2], viaUrl[3]]
      : [undefined, viaScp![1], viaScp![2]];
  // **The port survives only when it is the API's port.** Keeping it for every
  // scheme was over-generalising from the `:8443` case: that remote is HTTP, so
  // its port is where the API answers. An `ssh://…:2222` remote names an SSH
  // daemon, and `gh -R host:2222/owner/repo` would query the SSH port — passing
  // startup and then failing once per attempt, after each paid run, which is
  // the shape the preflight beside it exists to prevent.
  const host =
    scheme !== undefined && !API_PORT_SCHEMES.test(scheme)
      ? matchedHost.replace(HOST_PORT, "")
      : matchedHost;
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
 *
 * **`repo` is required, and there is no re-read to fall back to.** It is read
 * once at construction and travels on the run context; this function runs AFTER
 * the agent, and a linked worktree shares `remote.origin.url` with the
 * repository it was cut from, so a re-read here answers with whatever the agent
 * last left there. A fallback that re-read `origin` would be the silent wrong
 * success this probe exists to detect, reachable by making the value absent.
 */
async function prExistsViaGh(ctx: PhaseRunContext): Promise<boolean> {
  // Read inside the async body, not at the call site: `isDone` is declared
  // `boolean | Promise<boolean>` and every caller awaits it, so a probe that
  // throws synchronously on one path and rejects on the others is an asymmetry
  // waiting to be handled in one place and not the other.
  const repo = pinFrom(ctx);

  // One listing per state that counts, stopping at the first match. The whole
  // probe is bounded by a single deadline in the manager, so the second listing
  // is not a second budget — it is the same one.
  for (const state of COMPLETING_QUERY_STATES) {
    const { stdout } = await run("gh", prListArgs(ctx.branch, state, repo.selector), {
      cwd: ctx.workspacePath,
      // Bounded twice. Without either, a listing that never answers holds the
      // row `in_progress` past the paid agent it was reporting on — the worker
      // does not return, so nothing settles and the attempt is charged anyway.
      timeoutMs: NETWORK_CALL_TIMEOUT_MS,
      signal: ctx.ctx.signal,
      maxBuffer: 4 * 1024 * 1024,
    });
    if (readCompletion(stdout, repo.ownerRepo)) return true;
  }
  return false;
}

/**
 * Refuse a configuration the completion probe cannot run under.
 *
 * **The probe's unstated preconditions, moved to startup.** `prExistsViaGh`
 * needs two things the rest of the conductor never touches: an `origin` remote
 * it can name a repository from, and a runnable `gh`. Neither is checked
 * anywhere else, and both fail AFTER the paid agent run — the rescue re-pends
 * the row, the next attempt runs the agent again, and it fails identically,
 * until the retry budget is gone. A permanent configuration error charged once
 * per retry is exactly what the guards beside this one exist to stop.
 *
 * Order matters: the remote is checked first, because "no origin" is the more
 * specific diagnosis and a host missing `gh` usually knows it.
 *
 * **What this deliberately does NOT check is authentication.** `gh auth status
 * --hostname H` would catch a host with no usable credentials, and that failure
 * has the same shape as these. It is left out because it makes flow
 * construction depend on a live API call: a network hiccup at startup would
 * become a permanent refusal to build the conductor at all, which is a worse
 * failure than the one being prevented. It could not promise much anyway —
 * credentials valid at construction can expire before the probe runs.
 */
function assertCompletionProbeUsable(workspace: WorkspaceConfig): RemoteRepo {
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
  const repo = repoSlugFromRemote(url);
  if (repo === undefined) {
    throw new Error(
      `[conductor] the "origin" remote of ${workspace.sourceRepo} is "${url}", which does ` +
        `not name a host and repository the completion check can query. Same cost as a ` +
        `missing remote: a paid run per attempt, then a permanent failure.`,
    );
  }
  try {
    // Availability only. `--version` neither authenticates nor reaches the
    // network, so this answers "can the probe's binary be executed here" and
    // nothing else — which is the half of the precondition that is permanent
    // and knowable at startup.
    execFileSync("gh", ["--version"], { stdio: "ignore", timeout: GIT_TIMEOUT_MS });
  } catch {
    throw new Error(
      `[conductor] the \`gh\` CLI could not be run. The implement phase's completion ` +
        `check shells out to it to find this branch's pull request, and it runs after the ` +
        `agent — so on a host without \`gh\` every attempt pays for a full coding run and ` +
        `then fails permanently. Install \`gh\`, or supply your own \`prExists\`.`,
    );
  }
  // Handed back so the probe can be pinned to the repository that was checked,
  // rather than to whatever `origin` says once the agent has been and gone.
  return repo;
}

/**
 * The repository this run's completion check queries, off the run context.
 *
 * **Missing is a refusal, not a fallback.** `conductorFlow` binds what
 * `validate` returned into every run context it builds, so an absent value
 * means the phase reached a probe by some route that never validated it. The
 * tempting recovery — re-read `origin` here — is the defect this whole pin
 * exists to remove: the probe runs after the agent, and a linked worktree
 * shares `remote.origin.url` with the repository it was cut from, so the answer
 * is whatever the agent last left there. Failing is the safe direction: the
 * attempt re-pends with a reason, where a wrong answer settles the board.
 */
function pinFrom(ctx: PhaseRunContext): RemoteRepo {
  const pin = ctx.validated as RemoteRepo | undefined;
  if (pin === undefined) {
    throw new Error(
      `[conductor] the implement phase's completion check has no repository to query. ` +
        `\`conductorFlow\` binds the one \`validate\` checked at construction into every ` +
        `run context, so this phase reached its probe another way. Build it through ` +
        `\`conductorFlow\`, or supply your own \`prExists\`.`,
    );
  }
  return pin;
}

/** Build the implement phase. */
export function implementPhase(options: ImplementPhaseOptions = {}): PhaseSpec {
  // **Nothing is stored on the spec.** `validate` returns the identity it
  // checked and `conductorFlow` binds it into this conductor's run contexts as
  // `validated`, so a spec handed to two conductors carries no state either
  // could reach. Storing it here instead produced three defects in as many
  // rounds — shared between conductors, retained by a construction that then
  // failed, and a comparison written to paper over both.
  //
  // **And nothing is configurable either.** There used to be a `repo` option, a
  // caller-supplied pin that `validate`'s finding then had to be reconciled
  // with — the two could name different repositories, and no disposition was
  // safe: query the caller's and a pull request the run opened is never found,
  // so a finished attempt retries until its budget is gone; query the
  // workspace's and the board settles from somewhere the caller did not
  // configure. Nothing in this repository ever passed it. An option with no
  // callers whose only effect is to reintroduce the ambiguity this change
  // removes is not an escape hatch, it is the hatch left open.
  const prExists = options.prExists ?? prExistsViaGh;

  return {
    phase: "implement",
    // **Only when the built-in probe is the one that will run.** A caller who
    // supplies `prExists` has replaced the thing that reads `origin`, so
    // demanding one would refuse a configuration that works — and the tests,
    // which stub the probe against repositories that have no remote at all, are
    // the proof that this distinction is load-bearing rather than theoretical.
    ...(options.prExists === undefined
      ? {
          // Returns the identity rather than keeping it: see
          // {@link PhaseSpec.validate}. Pure, so a construction that fails a
          // later check leaves nothing behind for the retry to trip over, and
          // the only route from here to the probe is the run context.
          validate: (workspace: WorkspaceConfig): RemoteRepo =>
            assertCompletionProbeUsable(workspace),
        }
      : {}),
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

    buildPrompt(ctx: PromptRunContext): string {
      const lines = [
        `Implement Linear issue ${ctx.issue}.`,
        "",
        `You are working in ${ctx.workspacePath}, on branch ${ctx.branch}.`,
        "Commit your work and open a pull request for that branch when the change is done.",
        "",
        // **The forced ask.** The harness offers no seam for a question, so this
        // instruction IS the seam: nothing else tells the run how to reach a
        // person, and a run that ignores it takes the ordinary no-question
        // failure path. Written imperatively, with the path spelled in full and
        // the ordering constraint stated, because both are load-bearing and a
        // reworded version of either is a question nobody ever sees.
        "If you hit an ambiguity you genuinely cannot resolve — a decision that",
        "belongs to a person rather than to you — do NOT guess and do NOT stop",
        "silently. Write the question, and only the question, to this exact file:",
        "",
        `  ${ctx.askMarkerPath}`,
        "",
        "Write it BEFORE you open the pull request, then stop working. Someone will",
        "answer it and your run will be started again holding the answer. Only write",
        "that file if you actually have a question — an empty or leftover file is not",
        "one.",
        "",
        // **An instruction, where this used to be a reassurance.** It read "the
        // file is already gitignored, so it will not be committed" — a promise
        // the conductor cannot keep for the length of a run. Provisioning checks
        // the rule at the door, and `.gitignore` is a TRACKED file in the tree
        // this run is about to edit: a task that legitimately rewrites it, then
        // runs `git add -A`, stages every marker in `.fsdev/` including its own.
        // The next attempt's check catches that one commit too late.
        //
        // Nothing outside the run can close that window — the run holds the
        // shell and opens the pull request. So the one lever that works during
        // it is the run itself, and telling it the rule holds is the opposite of
        // using that lever: a run reassured the file cannot be committed has no
        // reason to look, which is exactly the run that commits it.
        "Never stage or commit anything under `.fsdev/` — not this file, not one a",
        "previous attempt left. An ignore rule normally keeps it out of your way, but",
        "it is a tracked file you may end up editing, so do not rely on it: if you",
        "run `git add -A`, check what you staged before you commit.",
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

      // **The other channel, and it never carries the one above.** These are
      // answers a person gave to questions this run asked; `feedback` is why an
      // attempt failed. Handing an answer back through `feedback` is the
      // cheapest wiring and would tell the run *"your last attempt stopped
      // because: take the second option."*
      //
      // Oldest first, ordered by the manager. Every answered row for this
      // issue-phase across every attempt — the question history, not a
      // freshness assumption — and folding it is idempotent, so a replay builds
      // the same prompt.
      if (ctx.answers.length > 0) {
        lines.push("", "Questions you asked earlier have been answered:");
        for (const { question, answer } of ctx.answers) {
          lines.push("", `  You asked: ${question}`, `  The answer: ${answer}`);
        }
        lines.push("", "Continue on those answers.");
      }

      // **No session id in the prompt, deliberately.** The prompt used to name
      // the last attempt's session, which told a model a fact it had no way to
      // act on — the run still started over in a tree it had never seen. The
      // manager continues the session through the harness's own `resume` feed
      // now, and two mechanisms for "continue" in one window is dual semantics:
      // whichever one is actually working, the other makes it look like it is.
      //
      // It is also what makes the resume proof honest. A prompt carrying the id
      // gives a fresh session everything it needs to look like a resumed one.

      return lines.join("\n");
    },

    isDone: (ctx) => prExists(ctx),
  };
}
