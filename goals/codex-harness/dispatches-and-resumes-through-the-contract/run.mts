/**
 * Goal check — codex-harness › it dispatches and resumes through the contract.
 *
 * A real Codex run, in a real throwaway git checkout, driven through the real
 * engine, read back through the framework's NEUTRAL harness handle. Then a
 * second turn that continues the same conversation holding nothing but the
 * session id the first one handed back.
 *
 * ## What is real here, and what the goal would prove nothing without
 *
 * - **A real Codex and a real model.** The CI specs script the client; that
 *   proves the block and nothing about Codex. Only a real run can show that the
 *   thing the manager will drive actually does work.
 * - **A real checkout that is not this process's directory.** Asserted, not
 *   assumed: if the run's directory were the repo, the working-directory half of
 *   the issue would be untested while the check still passed.
 * - **A real resume.** The follow-up prompt never names the file. A harness that
 *   quietly started a fresh thread has nothing to append to, so leg one fails
 *   before the session-id comparison even runs — which is the point: the
 *   comparison alone could be satisfied by echoing an id back.
 *
 * ## The session id is read off the HOOK, not off the handle
 *
 * `onSession` is what a host actually wires, and it is the only carrier that
 * survives a cancelled run — so leg three depends on it. Reading the id from the
 * handle instead would leave the one case the resolver exists for untested.
 *
 * Run: CODEX_API_KEY=… pnpm tsx goals/codex-harness/dispatches-and-resumes-through-the-contract/run.mts
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { z } from "zod";
import { defineFlow, sequencer } from "@flow-state-dev/core";
import { harnessRunHandleSchema } from "@flow-state-dev/core";
import { codexAgent } from "@flow-state-dev/codex";
import type { CodexAgentHandle } from "@flow-state-dev/codex";
import { loadFixture, runGoal, silentLogger } from "../../lib/index.mts";

interface Fixture {
  fileName: string;
  firstLine: string;
  secondLine: string;
  model: string;
}

const fixture = loadFixture<Fixture>(import.meta.url);
const KIND = "codex-harness-goal";
const USER_ID = "goal-user";

const checkout = mkdtempSync(join(tmpdir(), "codex-goal-"));
// Codex refuses to work outside a git repository unless told otherwise; a real
// checkout is closer to how a manager would point it than skipping the check.
execFileSync("git", ["init", "-q"], { cwd: checkout });

/** The id the block hands the host mid-run — the write side of `resume`. */
let hookSessionId: string | null = null;
/** What the resume resolver will answer with. A host's durable state, in miniature. */
let storedSessionId: string | null = null;

function buildFlow(deadlineMs?: number) {
  const agent = codexAgent({
    cwd: () => checkout,
    resume: () => storedSessionId,
    onSession: (id) => {
      hookSessionId = id;
    },
    thread: {
      model: fixture.model,
      sandboxMode: "workspace-write",
      approvalPolicy: "never",
      skipGitRepoCheck: true,
    },
  });
  // The harness runs as a SEQUENCER STEP, not as the action's block directly,
  // because `abortSignal` is a step option — this is the shape a manager uses
  // (spec §5), and putting the deadline anywhere else would leave leg 3 hollow:
  // the run would simply finish and the check would still pass.
  const pipeline = sequencer({ name: "codex-goal-seq", inputSchema: z.object({ prompt: z.string() }) })
    .step(
      agent as never,
      deadlineMs === undefined
        ? {}
        : { abortSignal: () => AbortSignal.timeout(deadlineMs) },
    );

  return defineFlow({
    kind: KIND,
    stateSchema: z.object({}),
    actions: {
      run: {
        block: pipeline,
        inputSchema: z.object({ prompt: z.string() }),
      },
    },
  } as never);
}

await runGoal(async () => {
  const failures: string[] = [];
  const { createFlowState, runAction, inMemoryStores } = await import("@flow-state-dev/engine");

  function neverResolvesAModel(): never {
    throw new Error("this goal declares no generator actions — nothing here resolves a model");
  }

  async function dispatch(
    prompt: string,
    deadlineMs?: number,
  ): Promise<{ handle?: CodexAgentHandle; threw?: Error }> {
    const flow = buildFlow(deadlineMs);
    const state = createFlowState({
      flows: { [KIND]: flow },
      modelResolver: Object.assign(neverResolvesAModel, {
        resolveId: neverResolvesAModel,
      }) as never,
      stores: { prod: { primary: inMemoryStores() } },
      defaultProfile: "prod",
      logger: silentLogger,
    } as never);
    try {
      const runtime = await state.getRuntime();
      const result = await runAction({
        flow: flow as never,
        actionName: "run",
        input: { prompt },
        userId: USER_ID,
        sessionId: `goal-session-${Date.now()}`,
        stores: runtime.stores as never,
        runtimeConfig: runtime.runtimeConfig as never,
      });
      return { handle: result.output as CodexAgentHandle };
    } catch (err) {
      return { threw: err as Error };
    } finally {
      await state.dispose().catch(() => undefined);
    }
  }

  // ---- Leg 1: a fresh dispatch does real work in a directory it was pointed at.
  const first = await dispatch(
    `Create a file named ${fixture.fileName} in this directory containing exactly this single line:\n${fixture.firstLine}`,
  );
  if (first.handle === undefined) {
    return { failures: [`first dispatch threw: ${first.threw?.message}`], evidence: "" };
  }
  storedSessionId = hookSessionId;
  if (storedSessionId === null) {
    failures.push("the session hook was never called, so nothing could be resumed");
  }

  // ---- Leg 2: a resume that makes sense ONLY if the conversation continued.
  //      The prompt deliberately never names the file.
  const second =
    storedSessionId === null
      ? { handle: undefined, threw: new Error("skipped: no session id") }
      : await dispatch(
          `Append this as a second line to the file you just created. Do not create any other file.\n${fixture.secondLine}`,
        );

  // ---- Grade on the WORKING TREE and the two handles. Never on the prose.
  const path = join(checkout, fixture.fileName);
  const contents = existsSync(path) ? readFileSync(path, "utf8") : "";
  if (!contents.includes(fixture.firstLine)) {
    failures.push(`${fixture.fileName} is missing the first held-out line`);
  }
  if (!contents.includes(fixture.secondLine)) {
    failures.push(
      `${fixture.fileName} is missing the second held-out line — the follow-up never named the file, so a fresh thread cannot have written it`,
    );
  }

  for (const [label, handle] of [
    ["first", first.handle],
    ["second", second.handle],
  ] as const) {
    if (handle === undefined) {
      failures.push(`${label} dispatch returned no handle`);
      continue;
    }
    const parsed = harnessRunHandleSchema.safeParse(handle);
    if (!parsed.success) {
      failures.push(`${label} handle does not parse against the neutral contract schema`);
    }
    if (handle.outcome !== "finished") {
      failures.push(`${label} handle reports outcome ${JSON.stringify(handle.outcome)}, not finished`);
    }
    if (handle.usage === null) failures.push(`${label} handle reports no usage`);
    if (handle.cost?.basis !== "estimated") {
      failures.push(
        `${label} handle's cost basis is ${JSON.stringify(handle.cost?.basis ?? null)}, not estimated`,
      );
    }
  }
  if (
    first.handle.sessionId !== null &&
    second.handle !== undefined &&
    second.handle.sessionId !== first.handle.sessionId
  ) {
    failures.push(
      `the resumed run reports a different thread (${second.handle.sessionId}) than the first (${first.handle.sessionId})`,
    );
  }
  if (resolve(checkout) === resolve(process.cwd())) {
    failures.push("the run's directory was this process's own — the working-directory seam is untested");
  }

  // ---- Leg 3: a fired deadline throws promptly, and leaves the run resumable.
  hookSessionId = null;
  const startedAt = Date.now();
  const cancelled = await dispatch(
    "Count slowly from 1 to 500, printing each number with a shell command in its own step. Do not stop early.",
    2_000,
  );
  const elapsed = Date.now() - startedAt;
  if (cancelled.threw === undefined) {
    failures.push("the fired deadline returned a handle; a cancelled run must throw (LAB-152 §9)");
  }
  if (elapsed > 30_000) {
    failures.push(`the deadline took ${elapsed}ms to surface — it did not bound the run`);
  }
  if (hookSessionId === null) {
    failures.push("the cancelled run named no thread to the host, so it cannot be resumed");
  }

  rmSync(checkout, { recursive: true, force: true });

  return {
    failures,
    evidence:
      `working tree at ${checkout}/${fixture.fileName} (${contents.length} bytes), ` +
      `two handles parsed against harnessRunHandleSchema, session ids ` +
      `${first.handle.sessionId} / ${second.handle?.sessionId}, ` +
      `deadline surfaced in ${elapsed}ms with thread ${hookSessionId}. ` +
      "Cannot be faked by the model's prose: the second line was written by a turn that was never told the file name.",
  };
});
