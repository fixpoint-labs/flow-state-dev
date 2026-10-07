/**
 * Goal check — harness-manager › a person's turn continues the coding session
 * it was sent into.
 *
 * Attempt 1 is told one fact and told to wait for a person. While it waits, a
 * person sends a turn through the run's message door: *write down what you
 * were given*. The door stops attempt 1, and attempt 2 resumes the same coding
 * session with the turn. Attempt 2's prompt never contains the fact, so only a
 * continued conversation can write it down.
 *
 * ## Why the model is real
 *
 * Tenet 7. A scripted SDK "resumes" by whatever the script decides resuming
 * means; the CI spec (`packages/harness-manager/test/message-door.spec.ts`)
 * already asserts the manager hands the previous session id to the harness.
 * What only a real session can show is that a run stopped mid-work by a
 * person still holds what it knew when it continues.
 *
 * ## Where the proof lives
 *
 * - **the fact file**, in the run's own checkout, holding a value generated
 *   per run that attempt 2 was never told. This is the reading that
 *   discriminates.
 * - **the same harness session id on both attempts** — corroboration only: an
 *   Agent SDK invoked from inside a Claude Code session can report the ambient
 *   id (see the answered-run goal).
 * - **retry standing unchanged**: the turn's re-entry is not charged, so a row
 *   with `maxAttempts: 1` still runs attempt 2 and still could retry nothing.
 *
 * Run: pnpm tsx goals/harness-manager/a-persons-turn-continues-its-session/run.mts
 */
import { randomBytes } from "node:crypto";
import { DEFAULT_ORG_ID } from "@flow-state-dev/core";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { conductorFlow, CONDUCTOR_FLOW_KIND } from "../../../labs/conductor/src/flow.ts";
import type { PhaseSpec } from "@flow-state-dev/harness-manager";
import { GIT_TIMEOUT_MS } from "@flow-state-dev/harness-manager/checkout";
import { positiveIntFromEnv, requireSourceRepo } from "../../../labs/conductor/src/config-env.ts";
import { loadFixture, runGoal, silentLogger } from "../../lib/index.mts";

interface Fixture {
  issue: string;
  phase: string;
  epic: string;
  factFileName: string;
  holdJob: string;
  nextJob: string;
  turnText: string;
}

type StatusRow = {
  taskId: string;
  status: string;
  attempts: number;
  feedback: string | null;
  run: {
    outcome: string | null;
    reason: string | null;
    sessionId: string | null;
    workspacePath: string | null;
  } | null;
};

/** The board row as the substrate stored it: the run link and the turn counters. */
type BoardRow = {
  status: string;
  attempts: number;
  abandonments?: number;
  turnReentries?: number;
  run?: { sessionId: string; requestId: string; attempt: number };
};

const USER_ID = "harness-manager-turn-goal-user";
const RUN_TIMEOUT_MS = positiveIntFromEnv("GOAL_RUN_TIMEOUT_MS", 900_000);
const POLL_INTERVAL_MS = 2_000;
/** How long attempt 1 gets to reach its wait after naming its session. */
const SETTLE_INTO_WAIT_MS = positiveIntFromEnv("GOAL_SETTLE_INTO_WAIT_MS", 30_000);

/**
 * One charged attempt. The turn's re-entry is attempt 2, and it is not charged:
 * if it were, this row would have no standing left for attempt 2 to fail into,
 * and the counters read at the end would say so.
 */
const MAX_ATTEMPTS = 1;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Every file under `dir` (outside `.git`) whose text contains `needle`. */
function filesHolding(dir: string, needle: string): string[] {
  const hits: string[] = [];
  const walk = (at: string): void => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      if (entry.name === ".git") continue;
      const full = join(at, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      try {
        if (readFileSync(full, "utf8").includes(needle)) hits.push(full);
      } catch {
        // Unreadable or binary: not a plaintext copy of the fact.
      }
    }
  };
  walk(dir);
  return hits;
}

await runGoal(async () => {
  const fixture = loadFixture<Fixture>(import.meta.url);
  const failures: string[] = [];

  /** The held-out fact, generated per run so "it knew this" means "it remembered this". */
  const fact = `FSD-${randomBytes(8).toString("hex")}`;

  let sourceRepo: string;
  try {
    sourceRepo = requireSourceRepo("GOAL_CONDUCTOR_REPO");
  } catch (err) {
    return { failures: [err instanceof Error ? err.message : String(err)], evidence: "" };
  }

  const scratch = mkdtempSync(join(tmpdir(), "harness-manager-turn-goal-"));
  const workspaceRoot = join(scratch, "checkouts");
  const dbFile = join(scratch, "goal.sqlite");

  /** Every phase prompt this check built, in order. */
  const prompts: string[] = [];
  let turn: string | undefined;

  let state: unknown;
  let row: StatusRow | undefined;
  let board: BoardRow | undefined;
  let firstSessionId: string | null = null;
  let factFile: string | undefined;
  let doorOutcome: string | undefined;

  try {
    const { createFlowState, runAction } = await import("@flow-state-dev/engine");
    const { sqliteStores } = await import("@flow-state-dev/store-sqlite");

    const baseRef = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: sourceRepo,
      encoding: "utf8",
      timeout: GIT_TIMEOUT_MS,
    }).trim();

    const phase: PhaseSpec = {
      phase: fixture.phase,
      buildPrompt: (run) => {
        factFile = join(run.workspacePath, fixture.factFileName);
        // Attempt 1 is told the fact and told to wait. Every later attempt is
        // told only to continue; the person's turn is what the manager adds.
        const first = run.attempt === 1;
        const prompt = [
          `Task ${run.issue}.`,
          "",
          ...(first ? [`FACT: ${fact}`, ""] : []),
          first ? fixture.holdJob : fixture.nextJob,
        ].join("\n");
        prompts.push(prompt);
        return prompt;
      },
      isDone: (run) => {
        const target = join(run.workspacePath, fixture.factFileName);
        return existsSync(target) && readFileSync(target, "utf8").includes(fact);
      },
    };

    const built = conductorFlow({
      epic: fixture.epic,
      workspace: { root: workspaceRoot, sourceRepo, baseRef },
      maxAttempts: MAX_ATTEMPTS,
      runTimeoutMs: RUN_TIMEOUT_MS,
      phase,
      agent: {
        allowedTools: ["Read", "Write", "Edit", "Bash"],
        permissionMode: "acceptEdits",
        maxTurns: 20,
        systemPrompt:
          "You are a coding agent working in the directory you have been placed in. " +
          "Follow the instructions exactly and do nothing else.",
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
      modelResolver: Object.assign(neverResolvesAModel, { resolveId: neverResolvesAModel }) as never,
      stores: { prod: { primary: sqliteStores({ filename: dbFile }) } },
      defaultProfile: "prod",
      dispatchDrainTimeoutMs: built.drainBudgetMs,
      logger: silentLogger,
    } as never);

    const coordinator = `sess_harness_manager_turn_goal_${Date.now()}`;
    const runtime = await (
      state as {
        getRuntime(): Promise<{
          stores: {
            resourceState: {
              get(t: string, id: string, key: string): Promise<{ state: unknown } | undefined>;
            };
          };
          runtimeConfig: object;
        }>;
      }
    ).getRuntime();

    const call = async <T,>(action: string, input: unknown, sessionId = coordinator): Promise<T> => {
      const result = (await runAction({
        orgId: DEFAULT_ORG_ID,
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

    /** The board row itself, for the run link and the turn counters. */
    const readBoard = async (taskId: string): Promise<BoardRow | undefined> => {
      const key = `${built.collectionId}/${taskId}`;
      const found = await runtime.stores.resourceState.get("user", `${USER_ID}:~org:${DEFAULT_ORG_ID}`, key);
      return found?.state as BoardRow | undefined;
    };

    const until = async (
      label: string,
      predicate: (current: StatusRow) => boolean,
    ): Promise<StatusRow | undefined> => {
      const deadline = Date.now() + built.drainBudgetMs;
      for (;;) {
        const current = await readRow();
        if (current !== undefined && predicate(current)) return current;
        if (Date.now() >= deadline) {
          failures.push(
            `timed out waiting for ${label}; the row reads ${JSON.stringify(current ?? null)}`,
          );
          return current;
        }
        await sleep(POLL_INTERVAL_MS);
      }
    };

    // ── Attempt 1: told the fact, waits for a person ───────────────────────
    const { taskId } = await call<{ taskId: string }>("seed", {
      issue: fixture.issue,
      phase: fixture.phase,
    });
    row = await until(
      "attempt 1 to name its coding session",
      (r) => r.status !== "in_progress" || (r.run?.sessionId ?? null) !== null,
    );
    await sleep(SETTLE_INTO_WAIT_MS);
    row = await readRow();
    board = await readBoard(taskId);

    if (row?.status !== "in_progress" || board?.run === undefined) {
      failures.push(
        `attempt 1 was not working when the turn was due: the row reads "${row?.status}" — ` +
          `reason: ${row?.run?.reason ?? row?.feedback ?? "none recorded"}`,
      );
    } else {
      firstSessionId = row.run?.sessionId ?? null;
      const checkout = row.run?.workspacePath ?? null;

      // Swept before the turn: attempt 2 inherits this tree, so a stray copy of
      // the fact would let it read rather than remember.
      if (checkout !== null) {
        const leaked = filesHolding(checkout, fact);
        if (leaked.length > 0) {
          failures.push(
            `attempt 1 left the fact on disk (${leaked.join(", ")}), so this run proves nothing ` +
              `about the session`,
          );
        }
      }

      // ── A person's turn, sent into the run's own session ────────────────
      turn = `${fixture.turnText}\n  ${factFile}`;
      const turnSession = board.run.sessionId;
      const sent = await call<{ outcome: string }>("message", { message: turn }, turnSession);
      doorOutcome = sent.outcome;
      if (sent.outcome !== "continuing") {
        failures.push(`the door answered "${sent.outcome}", not "continuing"`);
      }

      // ── Attempt 2: continues with the turn ──────────────────────────────
      row = await until(
        "attempt 2 to settle",
        (r) => r.status === "completed" || r.status === "errored" || r.status === "cancelled",
      );
      board = await readBoard(taskId);

      if (row?.status !== "completed") {
        failures.push(
          `the board row reads "${row?.status}", not "completed" — reason: ` +
            `${row?.run?.reason ?? row?.feedback ?? "none recorded"}`,
        );
      }

      // The run link, read after delivery: attempt 2 runs in the session the
      // person sent the turn into, not one beneath it.
      if (board?.run?.sessionId !== turnSession) {
        failures.push(
          `attempt 2 ran in session "${board?.run?.sessionId}", not "${turnSession}" where the ` +
            `turn was sent — the run moved out of the session the person is looking at`,
        );
      }

      const secondSessionId = row?.run?.sessionId ?? null;
      if (firstSessionId === null || secondSessionId !== firstSessionId) {
        failures.push(
          `attempt 2 ran in coding session "${secondSessionId}" while attempt 1 ran in ` +
            `"${firstSessionId}" — the turn started a new conversation`,
        );
      }

      if (factFile === undefined || !existsSync(factFile)) {
        failures.push(`the fact file (${factFile ?? "never derived"}) was not written`);
      } else if (!readFileSync(factFile, "utf8").includes(fact)) {
        failures.push(
          `the fact file holds ${JSON.stringify(readFileSync(factFile, "utf8").slice(0, 80))}, ` +
            `not the generated fact — what a lost session looks like`,
        );
      }

      // Retry standing: the turn re-entered without spending the task's budget.
      if (board === undefined) {
        failures.push("the board row could not be read back for its counters");
      } else {
        const standing = board.attempts - (board.abandonments ?? 0) - (board.turnReentries ?? 0);
        if (board.attempts !== 2 || board.turnReentries !== 1 || standing !== 1) {
          failures.push(
            `retry standing moved: attempts ${board.attempts}, turn re-entries ` +
              `${board.turnReentries ?? 0}, abandonments ${board.abandonments ?? 0} ` +
              `(standing ${standing}, expected 1)`,
          );
        }
      }
    }

    // ── Anti-game, on the strings this check built ─────────────────────────
    const second = prompts[1];
    if (second === undefined) {
      failures.push("no second phase prompt was built, so the anti-game inspected nothing");
    } else if (second.includes(fact)) {
      failures.push("attempt 2's phase prompt contains the fact — the proof is void");
    }
    if (turn !== undefined && turn.includes(fact)) {
      failures.push("the person's turn carries the fact — the check would measure the turn");
    }
    if (firstSessionId !== null && [second, turn].some((s) => s?.includes(firstSessionId!))) {
      failures.push("a prompt names the coding session id — the resume must come from the run record");
    }
  } finally {
    await (state as { dispose?: () => Promise<void> } | undefined)?.dispose?.();
    rmSync(scratch, { recursive: true, force: true });
  }

  return {
    failures,
    evidence:
      `door "${doorOutcome}"; board row "${row?.status}" after ${board?.attempts} claim(s), ` +
      `${board?.turnReentries ?? 0} turn re-entr(ies); attempt 1 session ${firstSessionId}, ` +
      `attempt 2 session ${row?.run?.sessionId}; fact file ${factFile}; prompts built ` +
      `${prompts.length}`,
  };
});
