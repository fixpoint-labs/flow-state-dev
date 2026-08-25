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
 * - **A real `createFlowState` runtime.** The detached start operation is
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
 * workstream request completes, and the run record reads as a success while the
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
import { conductorFlow, CONDUCTOR_FLOW_KIND } from "../../../labs/conductor/src/flow.ts";
import { implementPhase } from "../../../labs/conductor/src/implement.ts";
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
const RUN_TIMEOUT_MS = Number(process.env.GOAL_RUN_TIMEOUT_MS ?? 1_800_000);
const POLL_INTERVAL_MS = 5_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

await runGoal(async () => {
  const fixture = loadFixture<Fixture>(import.meta.url);
  const failures: string[] = [];

  // The repository the checkout is cut from. Named by env rather than derived,
  // so this check never cuts a worktree out of a repository nobody chose.
  const sourceRepo = process.env.GOAL_CONDUCTOR_REPO;
  if (sourceRepo === undefined || sourceRepo === "") {
    return {
      failures: [
        "GOAL_CONDUCTOR_REPO is not set — point it at a clone this check may cut " +
          "worktrees from. It must not be the directory this process runs in.",
      ],
      evidence: "",
    };
  }
  if (resolve(sourceRepo) === resolve(process.cwd())) {
    return {
      failures: [
        `GOAL_CONDUCTOR_REPO is the process's own directory (${sourceRepo}). The run ` +
          "would edit the thing that dispatched it, and the working directory this " +
          "issue adds would go untested while this check still passed.",
      ],
      evidence: "",
    };
  }

  const scratch = mkdtempSync(join(tmpdir(), "conductor-goal-"));
  const workspaceRoot = join(scratch, "checkouts");
  const dbFile = join(scratch, "goal.sqlite");

  const { createFlowState } = await import("@flow-state-dev/engine");
  const { runAction } = await import("@flow-state-dev/engine");
  const { sqliteStores } = await import("@flow-state-dev/store-sqlite");

  const baseRef = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    cwd: sourceRepo,
    encoding: "utf8",
  }).trim();

  const built = conductorFlow({
    epic: fixture.epic,
    workspace: { root: workspaceRoot, sourceRepo, baseRef },
    maxAttempts: 2,
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
            : ["", "The last attempt stopped for this reason:", run.feedback]),
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

  const state = createFlowState({
    flows: { [CONDUCTOR_FLOW_KIND]: built.flow },
    modelResolver: Object.assign(neverResolvesAModel, {
      resolveId: neverResolvesAModel,
    }) as never,
    stores: { prod: { primary: sqliteStores({ filename: dbFile }) } },
    defaultProfile: "prod",
    // The finding, not a workaround: the default is tuned to a serverless
    // SIGTERM grace period rather than to a coding run, so an in-process host
    // must raise it past its longest expected run or a shutdown kills one.
    detachedDrainTimeoutMs: RUN_TIMEOUT_MS,
    logger: silentLogger,
  } as never);

  const sessionId = `sess_conductor_goal_${Date.now()}`;
  const runtime = await (state as { getRuntime(): Promise<{
    stores: unknown;
    runtimeConfig: object;
  }> }).getRuntime();

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
      throw new Error(`conductor "${action}" failed: ${JSON.stringify(result.error)}`);
    }
    return result.output as T;
  };

  const readRow = async (): Promise<StatusRow | undefined> => {
    const { rows } = await call<{ rows: StatusRow[] }>("status", { issue: fixture.issue });
    return rows[0];
  };

  let row: StatusRow | undefined;
  try {
    await call("seed", { issue: fixture.issue, phase: fixture.phase });

    // Poll the BOARD ROW. `in_progress` means the run is still alive; anything
    // else is a settlement the board's own fenced recorder made. `pending`
    // means a retry is waiting, so wake it.
    const deadline = Date.now() + RUN_TIMEOUT_MS;
    for (;;) {
      row = await readRow();
      if (row === undefined) {
        failures.push("the board has no row for this issue-phase — seeding did not file one");
        break;
      }
      if (row.status !== "in_progress" && row.status !== "pending") break;
      if (row.status === "pending") await call("wake", {});
      if (Date.now() >= deadline) {
        failures.push(
          `the row was still ${row.status} after ${RUN_TIMEOUT_MS}ms — last reason: ` +
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
          failures.push("the run record carries no cost — the harness reported none");
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
          if (!resolve(checkout).startsWith(resolve(workspaceRoot))) {
            failures.push(
              `the run's checkout (${checkout}) is not under the workspace root this ` +
                `check configured (${workspaceRoot})`,
            );
          }
          const head = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
            cwd: checkout,
            encoding: "utf8",
          }).trim();
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
          const prs = execFileSync(
            "gh",
            ["pr", "list", "--head", row.run.branch, "--state", "all", "--json", "number"],
            { cwd: checkout, encoding: "utf8" },
          );
          if ((JSON.parse(prs || "[]") as unknown[]).length === 0) {
            failures.push(`no pull request exists for branch "${row.run.branch}"`);
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
    await (state as unknown as { dispose?: () => Promise<void> }).dispose?.();
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
