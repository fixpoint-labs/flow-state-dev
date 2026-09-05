/**
 * Goal check — harness-manager › an answered run continues the coding session
 * that asked.
 *
 * Attempt 1 is told one fact, made to ask a question, and parks. The `answer`
 * action answers it. Attempt 2 is told to write the fact to a file — and its
 * prompt does not restate the fact. If the run continued attempt 1's session,
 * the fact is in the conversation; if it started fresh, nothing on the machine
 * can supply it.
 *
 * ## Why this cannot be proved with a scripted SDK
 *
 * Tenet 7. A fake `query` "resumes" by whatever the fake decides resuming means,
 * so a scripted version of this check would assert that the manager passed a
 * string to a stub — which is what the CI specs already assert, and is a
 * different claim from *the vendor honoured it*. Only a real session can carry
 * knowledge across the wait, so the model is real here and the fact is generated
 * per run.
 *
 * ## Where the proof actually lives
 *
 * Two independent readings of one claim, because either alone is weaker than it
 * looks:
 *
 * - **the same session id on both attempts' run rows.** The id says the vendor
 *   was asked to continue and confirmed it did. It does not say the conversation
 *   carried anything.
 * - **the fact, on disk, in the run's own checkout.** That says the conversation
 *   carried the knowledge. On its own it would be satisfiable by a model that
 *   guessed — which is why the fact is a random token rather than anything
 *   derivable, and why the second prompt is asserted not to contain it.
 *
 * ## The anti-game is checked on the prompt this script built
 *
 * Not reviewed once and trusted. `buildPrompt` is this check's own, so the
 * strings it produces are inspected before the run: attempt 2's prompt must
 * contain neither the fact nor the session id. The manager's prompt-based
 * carry-forward is retired (LAB-154, PR a) — while it existed, a run told the
 * fact in attempt 1 was told it again in attempt 2's answer fold, and "resume
 * worked" was indistinguishable from "the model was told the answer".
 *
 * Run: pnpm tsx goals/harness-manager/answered-run-continues-its-session/run.mts
 */
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  conductorFlow,
  CONDUCTOR_FLOW_KIND,
} from "../../../labs/conductor/src/flow.ts";
import type { PhaseSpec } from "../../../labs/conductor/src/manager.ts";
import {
  positiveIntFromEnv,
  requireSourceRepo,
} from "../../../labs/conductor/src/config-env.ts";
import { GIT_TIMEOUT_MS } from "../../../labs/conductor/src/exec.ts";
import { loadFixture, runGoal, silentLogger } from "../../lib/index.mts";

interface Fixture {
  issue: string;
  phase: string;
  epic: string;
  factFileName: string;
  askJob: string;
  answerText: string;
  writeJob: string;
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
    branch: string | null;
  } | null;
  questions: Array<{ question: string; text: string; attempt: number }>;
};

const USER_ID = "harness-manager-goal-user";
const RUN_TIMEOUT_MS = positiveIntFromEnv("GOAL_RUN_TIMEOUT_MS", 900_000);
const POLL_INTERVAL_MS = 5_000;

/**
 * Two attempts, and no more.
 *
 * The proof is exactly "attempt 2 continues attempt 1", so a third attempt would
 * be a retry after the thing under test already failed — and it could still
 * reach a green file, since attempt 3 resumes attempt 2. Bounding at two makes
 * the check assert what it claims.
 */
const MAX_ATTEMPTS = 2;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Every file under `dir` whose text contains `needle`.
 *
 * The goal's own anti-game sweep, and the control it would be hollow without:
 * it answers "could the next attempt have READ this instead of remembering
 * it?". It walks the tree rather than asking git, because an untracked scratch
 * file is precisely where a stray copy would be, and skips the object store so
 * a commit does not report the working tree twice.
 */
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
        // Unreadable or binary: not a plaintext copy of the fact, which is the
        // only thing this sweep is looking for.
      }
    }
  };
  walk(dir);
  return hits;
}

await runGoal(async () => {
  const fixture = loadFixture<Fixture>(import.meta.url);
  const failures: string[] = [];

  /**
   * The held-out fact — generated, never stored.
   *
   * A value in the fixture file is a value a model may have seen, and a value
   * derivable from the issue or the branch is one it can reconstruct without
   * remembering anything. Random per run is the only form that makes "it knew
   * this" mean "it remembered this".
   */
  const fact = `FSD-${randomBytes(8).toString("hex")}`;

  let sourceRepo: string;
  try {
    sourceRepo = requireSourceRepo("GOAL_CONDUCTOR_REPO");
  } catch (err) {
    return {
      failures: [err instanceof Error ? err.message : String(err)],
      evidence: "",
    };
  }

  const scratch = mkdtempSync(join(tmpdir(), "harness-manager-goal-"));
  const workspaceRoot = join(scratch, "checkouts");
  const dbFile = join(scratch, "goal.sqlite");

  /** Every prompt this check built, in order, so the anti-game can read them. */
  const prompts: string[] = [];

  let state: unknown;
  let row: StatusRow | undefined;
  let parkedSessionId: string | null = null;
  let factFile: string | undefined;

  try {
    const { createFlowState, runAction } = await import("@flow-state-dev/engine");
    const { sqliteStores } = await import("@flow-state-dev/store-sqlite");

    const baseRef = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: sourceRepo,
      encoding: "utf8",
      timeout: GIT_TIMEOUT_MS,
    }).trim();

    /**
     * The phase, written here rather than reused from the lab.
     *
     * `implementPhase`'s done-condition is a `gh` probe for a pull request,
     * which is LAB-138's proof and not this one's — and it would make this check
     * fail for reasons that have nothing to do with resume. The completion
     * condition here is the fact file, which is the thing being proved.
     */
    const phase: PhaseSpec = {
      phase: fixture.phase,
      readable: {},
      buildPrompt: (run) => {
        const target = join(run.workspacePath, fixture.factFileName);
        factFile = target;
        // Attempt 1 is told the fact and made to ask. Attempt 2 is told to
        // write it — and is NOT told what it is.
        const first = run.answers.length === 0;
        const prompt = [
          `Task ${run.issue}.`,
          "",
          ...(first ? [`FACT: ${fact}`, ""] : []),
          first ? fixture.askJob : fixture.writeJob,
          "",
          ...(first
            ? [
                "To ask your question, write it as the entire contents of this file:",
                `  ${run.askMarkerPath}`,
                "Then stop. Do not do anything else.",
              ]
            : [`Write it to this file: ${target}`]),
          ...(run.answers.length === 0
            ? []
            : [
                "",
                "You asked, and were answered:",
                ...run.answers.flatMap(({ question, answer }) => [
                  `  You asked: ${question}`,
                  `  The answer: ${answer}`,
                ]),
              ]),
        ].join("\n");
        prompts.push(prompt);
        return prompt;
      },
      // Attempt 1 parks before this is ever consulted (the park arm is asked
      // first), so this only ever grades attempt 2's work.
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
        allowedTools: ["Read", "Write", "Edit"],
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
      modelResolver: Object.assign(neverResolvesAModel, {
        resolveId: neverResolvesAModel,
      }) as never,
      stores: { prod: { primary: sqliteStores({ filename: dbFile }) } },
      defaultProfile: "prod",
      dispatchDrainTimeoutMs: built.drainBudgetMs,
      logger: silentLogger,
    } as never);

    const sessionId = `sess_harness_manager_goal_${Date.now()}`;
    const runtime = await (
      state as { getRuntime(): Promise<{ stores: unknown; runtimeConfig: object }> }
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

    /** Poll the board row until it stops being one this loop should wait on. */
    const settle = async (label: string): Promise<StatusRow | undefined> => {
      const deadline = Date.now() + built.drainBudgetMs;
      for (;;) {
        const current = await readRow();
        if (current === undefined) return undefined;
        if (current.status !== "in_progress") return current;
        if (Date.now() >= deadline) {
          failures.push(
            `the row was still in_progress ${built.drainBudgetMs}ms into ${label} — ` +
              `last reason: ${current.run?.reason ?? current.feedback ?? "none recorded"}`,
          );
          return current;
        }
        await sleep(POLL_INTERVAL_MS);
      }
    };

    // ── Attempt 1: told the fact, asks, parks ──────────────────────────────
    await call("seed", { issue: fixture.issue, phase: fixture.phase });
    row = await settle("attempt 1");

    if (row === undefined) {
      failures.push("the board has no row for this issue-phase — seeding did not file one");
    } else if (row.status !== "parked") {
      failures.push(
        `attempt 1 read "${row.status}" rather than "parked" — it did not ask a question. ` +
          `Reason: ${row.run?.reason ?? row.feedback ?? "none recorded"}`,
      );
    } else if (row.questions.length === 0) {
      failures.push("the row parked but `status` lists no open question to answer");
    } else {
      // 1 — the run named a session, which is the thing attempt 2 will continue.
      parkedSessionId = row.run?.sessionId ?? null;
      if (parkedSessionId === null) {
        failures.push(
          "attempt 1's run row carries no harness session id, so there is nothing for " +
            "attempt 2 to continue — the harness never named its session, or the hook " +
            "that records it never fired",
        );
      }

      // **The control this check would be hollow without.** Attempt 2 can Read
      // the checkout, and attempt 1 worked in the same one. If attempt 1 left
      // the fact anywhere on disk — in the ask marker, in a scratch file, in a
      // commit — then attempt 2 producing it says nothing about the session; it
      // says the fact was lying around. The instruction not to write it down is
      // not evidence that it was obeyed.
      //
      // Swept BEFORE the answer, so what is inspected is the tree attempt 2 is
      // about to inherit.
      const checkoutBefore = row.run?.workspacePath ?? null;
      if (checkoutBefore !== null) {
        const leaked = filesHolding(checkoutBefore, fact);
        if (leaked.length > 0) {
          failures.push(
            `attempt 1 left the fact on disk in the shared checkout (${leaked.join(", ")}), ` +
              `so attempt 2 could read it without remembering anything — this run proves ` +
              `nothing about resume`,
          );
        }
      }

      // ── The operator answers ────────────────────────────────────────────
      //
      // The answer is about the trailing newline and says nothing about the
      // fact. If answering could carry the fact, the whole check would be
      // measuring the prompt fold rather than the session.
      await call("answer", {
        question: row.questions[0]!.question,
        answer: fixture.answerText,
      });

      // ── Attempt 2: told to write the fact it was never given ────────────
      row = await settle("attempt 2");

      if (row === undefined) {
        failures.push("the board row vanished after the answer");
      } else {
        // 4 — the board row is the authority on completion.
        if (row.status !== "completed") {
          failures.push(
            `the board row reads "${row.status}", not "completed" — reason: ` +
              `${row.run?.reason ?? row.feedback ?? "none recorded"}`,
          );
        }

        // 2 — the same session, which is the claim.
        const resumedSessionId = row.run?.sessionId ?? null;
        if (parkedSessionId !== null && resumedSessionId !== parkedSessionId) {
          failures.push(
            `attempt 2 ran in session "${resumedSessionId}" while attempt 1 ran in ` +
              `"${parkedSessionId}" — the answered run started a new conversation ` +
              `instead of continuing the one that asked`,
          );
        }

        // 3 — and the conversation actually carried the knowledge.
        if (factFile === undefined || !existsSync(factFile)) {
          failures.push(
            `the fact file (${factFile ?? "never derived"}) was not written, so the ` +
              `resumed run did not produce the value only attempt 1 was told`,
          );
        } else {
          const written = readFileSync(factFile, "utf8");
          if (!written.includes(fact)) {
            failures.push(
              `the fact file does not hold the generated fact — it holds ` +
                `${JSON.stringify(written.slice(0, 80))}. A run that started fresh has ` +
                `no way to know it, so this is what a lost session looks like`,
            );
          }
        }
      }
    }

    // ── Anti-game, asserted on the prompts this check built ────────────────
    const second = prompts[1];
    if (second === undefined) {
      failures.push("no second prompt was built, so the anti-game check inspected nothing");
    } else {
      if (second.includes(fact)) {
        failures.push(
          "attempt 2's prompt contains the fact, so a fresh session would satisfy this " +
            "check as easily as a resumed one — the proof is void",
        );
      }
      if (parkedSessionId !== null && second.includes(parkedSessionId)) {
        failures.push(
          "attempt 2's prompt names the session id, which is the prompt-based " +
            "carry-forward this issue retired",
        );
      }
    }
    if (fixture.answerText.includes(fact)) {
      failures.push("the operator's answer carries the fact — the check would measure the fold");
    }
  } finally {
    await (state as { dispose?: () => Promise<void> } | undefined)?.dispose?.();
    rmSync(scratch, { recursive: true, force: true });
  }

  return {
    failures,
    evidence:
      `board row "${row?.status}" after ${row?.attempts} attempt(s); attempt 1 session ` +
      `${parkedSessionId}, attempt 2 session ${row?.run?.sessionId}; fact file ` +
      `${factFile}; prompts built ${prompts.length}`,
  };
});
