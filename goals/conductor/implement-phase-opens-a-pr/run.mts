/**
 * Goal check — conductor › an implement phase ends with a pull request open and
 * the row settled.
 *
 * A real Linear issue's implement phase, filed onto a conductor board, driven by
 * a real Claude Code run in a checkout that is not the server's, read back
 * through the flow's own `status` action.
 *
 * ## What is real here, and what the goal would prove nothing without
 *
 * - **A real `createFlowState` runtime.** The dispatch operation is
 *   installed by `createFlowState`; a script that only calls `runAction` has no
 *   request host and the first dispatch throws by name.
 * - **A real Claude Code run**, through the real Agent SDK, in a real git
 *   worktree cut from a real repository. Whether it did the job *well* is
 *   LAB-135's question, not this one's.
 * - **A checkout that is not the process's directory.** Asserted, not assumed:
 *   if the run's directory equalled the server's, the whole working-directory
 *   half of this issue would be untested while the check still passed.
 *
 * ## Completion is read off the BOARD ROW and nothing else
 *
 * `recordSuccess` writes with `ifAllowed: true`, so a `complete()` refused on a
 * lost claim is DROPPED rather than thrown: the worker returns normally, the
 * child session request completes, and the run record reads as a success while the
 * row is still open. Inferring completion from either is the same silent-success
 * defect this issue exists to remove, relocated into the thing that verifies it.
 *
 * The board ledger cannot be made client-readable — `defineTaskCollection()`
 * exposes no `client` option, so its collection-state route answers 403 — which
 * is why the read goes through the flow's zero-model `status` action.
 *
 * Run: pnpm tsx goals/conductor/implement-phase-opens-a-pr/run.mts
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  conductorFlow,
  CONDUCTOR_FLOW_KIND,
} from "../../../labs/conductor/src/flow.ts";
import {
  hasCompletingPr,
  repoSlugFromRemote,
  implementPhase,
} from "../../../labs/conductor/src/implement.ts";
import {
  branchFor,
  isStrictlyInside,
} from "../../../labs/conductor/src/workspace.ts";
import {
  positiveIntFromEnv,
  requireSourceRepo,
} from "../../../labs/conductor/src/config-env.ts";
import {
  GIT_TIMEOUT_MS,
  NETWORK_CALL_TIMEOUT_MS,
} from "../../../labs/conductor/src/exec.ts";
import { loadFixture, runGoal, silentLogger } from "../../lib/index.mts";

interface Fixture {
  issue: string;
  phase: string;
  epic: string;
  job: string;
}

type StatusRow = {
  taskId: string;
  issue: string | null;
  phase: string | null;
  status: string;
  attempts: number;
  feedback: string | null;
  run: {
    outcome: string | null;
    reason: string | null;
    sessionId: string | null;
    workspacePath: string | null;
    branch: string | null;
    costUsd: number | null;
  } | null;
};

const USER_ID = "conductor-goal-user";
// The production parser, not `Number()`. A `NaN` here would survive every
// comparison and reach `AbortSignal.timeout` only after the row was claimed
// and the checkout provisioned — charging an attempt for a shell typo.
const RUN_TIMEOUT_MS = positiveIntFromEnv("GOAL_RUN_TIMEOUT_MS", 1_800_000);
const POLL_INTERVAL_MS = 5_000;

/**
 * How many attempts the board gives this row — and, because of that, how many
 * worker budgets the poll loop below has to wait through.
 *
 * **Named, because the wait was sized for one attempt while the board was
 * configured for two.** `drainBudgetMs` is the budget for ONE drain: an
 * ownership wait, provisioning, the agent, and the pull-request probe. The loop
 * wakes a `pending` row, so a first attempt that legitimately spends most of its
 * run timeout and then fails leaves the retry running against a wall clock that
 * has already nearly expired — and the goal reports a timeout against a run that
 * never exceeded any limit it was given. A flaky check that fails honest work is
 * worse than no check.
 *
 * One constant rather than two, so the two numbers cannot drift apart again.
 */
const MAX_ATTEMPTS = 2;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Every pull-request number GitHub currently lists for this branch. */
function prNumbersFor(repoDir: string, branch: string): Set<number> {
  const url = execFileSync("git", ["remote", "get-url", "origin"], {
    cwd: repoDir,
    encoding: "utf8",
    timeout: GIT_TIMEOUT_MS,
  });
  const repo = repoSlugFromRemote(url);
  // `conductorFlow` has already refused a source repo whose `origin` cannot be
  // named, so this cannot be reached with an unparseable remote — and an empty
  // set is the conservative answer anyway: it makes the assertion below demand a
  // pull request rather than excuse one.
  if (repo === undefined) return new Set();
  const listed = execFileSync(
    "gh",
    [
      "pr",
      "list",
      "--head",
      branch,
      "--state",
      "all",
      "--json",
      "number",
      "-R",
      repo.selector,
    ],
    { cwd: repoDir, encoding: "utf8", timeout: NETWORK_CALL_TIMEOUT_MS },
  );
  const rows = JSON.parse(listed || "[]") as Array<{ number?: unknown }>;
  return new Set(
    rows.map((r) => r.number).filter((n): n is number => typeof n === "number"),
  );
}

/**
 * Is there a completing pull request this run did not inherit?
 *
 * Deliberately NOT `hasCompletingPr` with a filter bolted on: that function is
 * the product's rule about which STATES count, and it is shared with the phase.
 * This is the goal check's own, stricter question — did *this* invocation
 * produce one — and mixing them would let a change to either quietly weaken the
 * other.
 */
function hasNewCompletingPr(
  stdout: string,
  inRepo: string,
  before: Set<number>,
): boolean {
  const rows = JSON.parse(stdout || "[]") as Array<{ number?: unknown }>;
  return rows.some((row) => {
    const n = row.number;
    if (typeof n !== "number" || before.has(n)) return false;
    return hasCompletingPr(JSON.stringify([row]), inRepo);
  });
}

await runGoal(async () => {
  const fixture = loadFixture<Fixture>(import.meta.url);
  const failures: string[] = [];

  // **The dispatcher's whole repository rule, not a local copy of part of it.**
  // This runner kept path equality after `fsdev.config.ts` moved to repository
  // identity, so a subdirectory, a sibling worktree or a symlinked spelling all
  // walked past it — and this is the site that launches a REAL coding agent, so
  // the one on the weaker rule had the larger blast radius.
  //
  // The variable name is a parameter, which is what lets this reuse the
  // absent-check too rather than keeping its own. Three rules on this branch
  // were adopted in `labs/conductor/src` and missed here; importing the whole
  // function is what stops a fourth.
  let sourceRepo: string;
  try {
    sourceRepo = requireSourceRepo("GOAL_CONDUCTOR_REPO");
  } catch (err) {
    return {
      failures: [
        `${err instanceof Error ? err.message : String(err)} The working directory this ` +
          "issue adds would also go untested while this check still passed.",
      ],
      evidence: "",
    };
  }

  const scratch = mkdtempSync(join(tmpdir(), "conductor-goal-"));
  const workspaceRoot = join(scratch, "checkouts");
  const dbFile = join(scratch, "goal.sqlite");

  // **Everything past the scratch directory is inside this `try`.** Creating it
  // is the first irreversible act here, and every step after it can fail: the
  // dynamic imports, the base-ref query, `conductorFlow` refusing the remote or
  // `gh`, and the runtime construction itself. A throw from any of them is
  // caught by `runGoal`, which exits — so anything left outside this boundary
  // leaks the whole tree, once per failed run.
  //
  // `state` is declared here rather than where it is built, because `finally`
  // has to dispose it whether or not construction ever got that far. That is
  // the reason the boundary could not simply be moved statement by statement.
  let state: unknown;
  let row: StatusRow | undefined;
  try {
    const { createFlowState } = await import("@flow-state-dev/engine");
    const { runAction } = await import("@flow-state-dev/engine");
    const { sqliteStores } = await import("@flow-state-dev/store-sqlite");

    // Bounded like every other child process this lab spawns. Local git is fast
    // until it is not — an NFS stall or an index lock hangs it, and an unbounded
    // hang here never reaches `finally`, so the runtime is never disposed and the
    // scratch tree is never removed. Same rule, same reason as the `gh` probe.
    const baseRef = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: sourceRepo,
      encoding: "utf8",
      timeout: GIT_TIMEOUT_MS,
    }).trim();

    const built = conductorFlow({
      epic: fixture.epic,
      workspace: { root: workspaceRoot, sourceRepo, baseRef },
      maxAttempts: MAX_ATTEMPTS,
      runTimeoutMs: RUN_TIMEOUT_MS,
      // The real implement phase, with its real `gh`-backed done-condition. Only
      // the prompt's job text comes from the held-out fixture.
      phase: {
        ...implementPhase(),
        buildPrompt: (run) =>
          [
            `Issue ${run.issue}.`,
            "",
            fixture.job,
            "",
            `You are working in ${run.workspacePath}, on branch ${run.branch}.`,
            ...(run.feedback === undefined
              ? []
              : [
                  "",
                  "The last attempt stopped for this reason:",
                  run.feedback,
                ]),
          ].join("\n"),
      },
      agent: {
        allowedTools: ["Read", "Edit", "Write", "Bash", "Grep", "Glob"],
        // `acceptEdits`, not `bypassPermissions`: the latter maps to
        // `--dangerously-skip-permissions`, which the CLI refuses outright when
        // the process has root privileges, and the refusal arrives as a bare
        // "process exited with code 1" that reads like a broken dispatch.
        permissionMode: "acceptEdits",
        maxTurns: 40,
        systemPrompt:
          "You are a coding agent working on one small, self-contained change in the " +
          "repository you have been placed in. Make the change, commit it, and open a " +
          "pull request for the branch you are on.",
      },
    });

    function neverResolvesAModel(): never {
      throw new Error(
        "conductor declares no generator actions — the coding run goes through the " +
          "Claude Code Agent SDK, which resolves its own model.",
      );
    }

    state = createFlowState({
      flows: { [CONDUCTOR_FLOW_KIND]: built.flow },
      modelResolver: Object.assign(neverResolvesAModel, {
        resolveId: neverResolvesAModel,
      }) as never,
      stores: { prod: { primary: sqliteStores({ filename: dbFile }) } },
      defaultProfile: "prod",
      // The finding, not a workaround: the default is tuned to a serverless
      // SIGTERM grace period rather than to a coding run, so an in-process host
      // must raise it past its longest expected run or a shutdown kills one.
      detachedDrainTimeoutMs: built.drainBudgetMs,
      logger: silentLogger,
    } as never);

    const sessionId = `sess_conductor_goal_${Date.now()}`;
    const runtime = await (
      state as {
        getRuntime(): Promise<{
          stores: unknown;
          runtimeConfig: object;
        }>;
      }
    ).getRuntime();

    const call = async <T,>(action: string, input: unknown): Promise<T> => {
      const result = (await runAction({
        flow: built.flow as never,
        actionName: action as never,
        input: input as never,
        userId: USER_ID,
        sessionId,
        stores: runtime.stores as never,
        runtimeConfig: { ...runtime.runtimeConfig } as never,
      })) as { output?: unknown; error?: unknown };
      if (result.error != null) {
        throw new Error(
          `conductor "${action}" failed: ${JSON.stringify(result.error)}`,
        );
      }
      return result.output as T;
    };

    const readRow = async (): Promise<StatusRow | undefined> => {
      const { rows } = await call<{ rows: StatusRow[] }>("status", {
        issue: fixture.issue,
      });
      return rows[0];
    };

    // **What was already there before this run touched anything.**
    //
    // The branch is a pure function of the durable task, so a second invocation of
    // this check against the same fixture derives the SAME branch — and the pull
    // request the previous invocation opened is still OPEN in `sourceRepo`. The
    // scratch database and checkout are fresh, so nothing else carries over, and a
    // clean no-op agent then satisfies the completion check on somebody else's
    // work. The goal would report its outcome proved without this run having
    // proved it: precisely the silent wrong success the whole lab exists to
    // remove, re-entering through the check that certifies its absence.
    //
    // So the pull requests that exist BEFORE the run are recorded, and the
    // assertion at the end demands one that is not among them.
    // **The board's COLLECTION identity, not the bare epic.** The manager builds
    // its location with `epic: boardCollectionId` — `conductor-tasks--t0--<epic>`,
    // not `<epic>` — so a snapshot keyed on `fixture.epic` inspects a branch no run
    // ever uses. It comes back empty every time, and the assertion it feeds then
    // passes unconditionally: a guard against a false pass that is itself a false
    // pass. `conductorFlow` returns the value; the first version derived a
    // plausible one instead of asking for the real one.
    const snapshotBranch = branchFor({
      principal: { userId: USER_ID },
      epic: built.collectionId,
      issue: fixture.issue,
      phase: fixture.phase,
    });
    const preexistingPrs = prNumbersFor(sourceRepo, snapshotBranch);
    // **Pinned here, before the agent exists.** The final assertion below used
    // to read `origin` from the checkout after the run — and a linked worktree
    // shares that config with the repository it was cut from, so the agent can
    // move it. The product path now pins at construction; this independent
    // verifier was the other half of that same rule, and only one half got it.
    const pinnedRepo = repoSlugFromRemote(
      execFileSync("git", ["remote", "get-url", "origin"], {
        cwd: sourceRepo,
        encoding: "utf8",
        timeout: NETWORK_CALL_TIMEOUT_MS,
      }),
    );

    await call("seed", { issue: fixture.issue, phase: fixture.phase });

    // Poll the BOARD ROW. `in_progress` means the run is still alive; anything
    // else is a settlement the board's own fenced recorder made. `pending`
    // means a retry is waiting, so wake it.
    // **The whole worker's budget, not the agent step's.** A worker waits for
    // the checkout lock, provisions, runs the agent, and then probes for the
    // pull request. Deadlining on `RUN_TIMEOUT_MS` records a permanent failure
    // for a run that was still legitimately working — and would then delete the
    // checkout out from under it.
    //
    // This is the third site to need the same number, and the second to be
    // missed after `fsdev.config.ts` was fixed. Hence the derived value rather
    // than another local sum.
    //
    // **Times the attempts, because this loop waits through all of them.**
    // `drainBudgetMs` bounds ONE drain, which is exactly right where it is used
    // as a host's shutdown budget — `fsdev.config.ts` passes it to
    // `detachedDrainTimeoutMs` and must NOT scale it. This site is the one that
    // waits across retries: it wakes a `pending` row, so the wall clock has to
    // cover every attempt the board is allowed to run, not just the first.
    const deadline = Date.now() + built.drainBudgetMs * MAX_ATTEMPTS;
    for (;;) {
      row = await readRow();
      if (row === undefined) {
        failures.push(
          "the board has no row for this issue-phase — seeding did not file one",
        );
        break;
      }
      if (row.status !== "in_progress" && row.status !== "pending") break;
      if (row.status === "pending") await call("wake", {});
      if (Date.now() >= deadline) {
        failures.push(
          // The number reported is the one actually waited, not the per-drain
          // term it is derived from — a message naming a bound the loop did not
          // enforce sends the next reader looking for the wrong overrun.
          `the row was still ${row.status} after ${built.drainBudgetMs * MAX_ATTEMPTS}ms ` +
            `(${MAX_ATTEMPTS} × the ${built.drainBudgetMs}ms drain budget) — last reason: ` +
            `${row.run?.reason ?? row.feedback ?? "none recorded"}`,
        );
        break;
      }
      await sleep(POLL_INTERVAL_MS);
    }

    if (row !== undefined && failures.length === 0) {
      // 1 — the board row is the authority on completion.
      if (row.status !== "completed") {
        failures.push(
          `the board row reads "${row.status}", not "completed" — reason: ` +
            `${row.run?.reason ?? row.feedback ?? "none recorded"}`,
        );
      }

      // 2 — the run's row carries what only it holds.
      if (row.run === null) {
        failures.push("no run record was written for this issue-phase");
      } else {
        if (row.run.sessionId === null) {
          failures.push("the run record carries no harness session id");
        }
        if (row.run.costUsd === null) {
          failures.push(
            "the run record carries no cost — the harness reported none",
          );
        }
        if (row.run.workspacePath === null) {
          failures.push("the run record carries no checkout path");
        }

        // 3 — the checkout is the RUN's, not the server's.
        const checkout = row.run.workspacePath;
        if (checkout !== null) {
          if (resolve(checkout) === resolve(process.cwd())) {
            failures.push(
              `the run worked in this process's own directory (${checkout}) — the ` +
                "working directory was not exercised",
            );
          }
          // Segment containment, not a string prefix: a sibling named
          // `<root>-other` shares the prefix and would pass this signal without
          // being under the root at all. `isStrictlyInside` is the lab's own
          // rule and its doc argues exactly this case — a second hand-rolled
          // copy here is how the two drift.
          if (!isStrictlyInside(resolve(checkout), resolve(workspaceRoot))) {
            failures.push(
              `the run's checkout (${checkout}) is not under the workspace root this ` +
                `check configured (${workspaceRoot})`,
            );
          }
          const head = execFileSync(
            "git",
            ["rev-parse", "--abbrev-ref", "HEAD"],
            {
              timeout: GIT_TIMEOUT_MS,
              cwd: checkout,
              encoding: "utf8",
            },
          ).trim();
          if (head !== row.run.branch) {
            failures.push(
              `the checkout is on "${head}" while the row records "${row.run.branch}"`,
            );
          }
        }

        // 4 — a pull request exists for that branch. Read from GitHub rather
        // than from anything the manager wrote, so this is independent of the
        // done-condition the manager consulted.
        if (row.run.branch !== null && checkout !== null) {
          // Bounded, like the manager's own probe. Unbounded, a wedged `gh` or
          // a hanging credential helper never returns — so `finally` is never
          // reached, the runtime is never disposed, and the scratch checkout is
          // never removed.
          //
          // **The manager's own state rule, imported.** `--state all` returns
          // closed-unmerged rows too, and counting any nonempty result certified
          // a task whose pull request had been closed without merging — the
          // silent success this lab exists to close, re-entering through the
          // check that is supposed to catch it. `state` has to be REQUESTED for
          // the rule to have anything to read, which is why asking for `number`
          // alone made the goal structurally unable to apply it.
          // **The repository is pinned here too, and read from git.** `--head`
          // matches a branch NAME, so a fork carrying this branch's name shows
          // up in the listing; and `GH_REPO` redirects any `gh` command that
          // would otherwise work from the checkout, so asking `gh` where it is
          // and then asking `gh` what is there lets one override move both
          // halves of the answer. Reading the remote with `git` puts it outside
          // that environment. Imported rather than restated — this is the
          // fourth rule on this branch that lived in `src` and was missed here.
          // The identity snapshotted before dispatch, never re-read here: the
          // agent has run by now and `origin` is something it can change.
          const repo = pinnedRepo;
          if (repo === undefined) {
            failures.push(
              `could not name the repository behind ${sourceRepo}, so the pull-request ` +
                `check could not be pinned to it`,
            );
          } else {
            const prs = execFileSync(
              "gh",
              [
                "pr",
                "list",
                "--head",
                row.run.branch,
                "--state",
                "all",
                "--json",
                "number,state,headRepository,headRepositoryOwner",
                "-R",
                repo.selector,
              ],
              {
                cwd: checkout,
                encoding: "utf8",
                timeout: NETWORK_CALL_TIMEOUT_MS,
              },
            );
            // **The snapshot has to be of the branch the run actually used.**
            // Derived before the run from values this script composes itself, so
            // a wrong composition silently snapshots a branch nobody touches and
            // the new-PR assertion below passes unconditionally. That is not a
            // hypothetical: the first version of this snapshot keyed on the bare
            // epic instead of the board's collection identity and was inert.
            // Compared against what the manager recorded, so the mis-wiring
            // becomes a failure instead of a green.
            if (row.run.branch !== snapshotBranch) {
              failures.push(
                `the pre-run pull-request snapshot was taken for branch ` +
                  `"${snapshotBranch}" but the run used "${row.run.branch}", so the ` +
                  `check that this run opened a NEW pull request proved nothing`,
              );
            }
            if (!hasCompletingPr(prs, repo.ownerRepo)) {
              failures.push(
                `no open or merged pull request exists for branch "${row.run.branch}"`,
              );
            } else if (
              !hasNewCompletingPr(prs, repo.ownerRepo, preexistingPrs)
            ) {
              // A completing pull request exists and every one of them was
              // already there before this run started. The check would pass on
              // the previous invocation's artifact.
              failures.push(
                `the only open or merged pull requests for branch "${row.run.branch}" ` +
                  `(#${[...preexistingPrs].join(", #")}) already existed before this run ` +
                  `started, so this run did not prove that it opened one`,
              );
            }
          }
        }
      }
    }
  } finally {
    // **Dispose before deleting.** On the timeout path the row is still
    // `in_progress`, so a detached run is still executing against this checkout
    // — removing the tree and the SQLite files underneath it produces a cascade
    // of follow-on failures that look like the finding and are not, and leaves
    // the runtime's resources open. Disposal drains the detached work first.
    await (state as { dispose?: () => Promise<void> } | undefined)?.dispose?.();
    rmSync(scratch, { recursive: true, force: true });
  }

  return {
    failures,
    evidence:
      `board row "${row?.status}" after ${row?.attempts} attempt(s); run row: session ` +
      `${row?.run?.sessionId}, checkout ${row?.run?.workspacePath}, branch ` +
      `${row?.run?.branch}, cost ${row?.run?.costUsd}`,
  };
});
