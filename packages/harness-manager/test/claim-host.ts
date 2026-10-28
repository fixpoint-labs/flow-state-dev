/**
 * A host for driving the manager through a task entry's claim gate, in
 * process, on two kinds of board.
 *
 * - **A fixed board**: a manager built with `boardCollectionId`, its rows on
 *   one unpartitioned, user-scoped ledger. The entry is the bare manager, so
 *   no claim reaches its input: today's shape.
 * - **Boards read from a claim**: a manager built with `ledgers`, over a
 *   ledger kept per partition (one set of rows per conversation). The test
 *   plays the trusted entry adapter, putting the claim's ledger and partition
 *   on the manager's input as the gate's ticket names them.
 *
 * Real `createFlowState`, a real `taskLedgers` gate, real fenced settlement and
 * a real git checkout. Only the harness is a stub, scripted per call, and it
 * records what it was fed.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";
import { defineCapability, defineFlow, handler } from "@flow-state-dev/core";
import { harnessRunHandleSchema, harnessRunInputSchema } from "@flow-state-dev/core";
import type { BlockContext, BlockDefinition, HarnessBlock } from "@flow-state-dev/core/types";
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import {
  defineTaskCollection,
  taskLedgerResources,
  getOrCreateTaskCollection,
  openRowQuestions,
  resolveResourceCollection,
  type Task,
  type TaskCollectionRef,
} from "@flow-state-dev/orchestration/tasks";
import { taskLedgers } from "@flow-state-dev/orchestration/task-board";
import {
  harnessManager,
  harnessTaskInputSchema,
  readRunRow,
  runRecordCollection,
  type CompletionRunContext,
  type HarnessFeeds,
  type PromptRunContext,
  type RunRecordState,
} from "../src";
import { RUNS, collectionRef } from "../src/run-record";
import { seedRepo } from "./fixtures";

export const ORG_ID = "org_claim_host";
export const ALICE = "alice";
/** The fixed board's ledger id. */
export const FIXED_BOARD = "feature-board";
/** The ledger kept per partition, one set of rows per conversation. */
export const CONVERSATIONS = "tasks";
export const PHASE = "implement";
/** The assignee the rows are assigned to, which the gate checks. */
const ASSIGNEE = "coder";

const dirs: string[] = [];
/** Remove every directory a host made. Call from `afterAll`. */
export function cleanUpHosts(): void {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
}

/** What one harness call does in the checkout it is handed. */
export interface HarnessStep {
  /** The run's final message. Default `"done"`. `null` reports none. */
  answer?: string | null;
  /** Commit this many files on the run's branch first. */
  commits?: number;
  /** Write this question to the attempt's ask marker. */
  ask?: string;
  /** The run's three-way stop word. Default `"finished"`. */
  outcome?: "finished" | "stopped-at-limit";
  /** Throw this message instead of returning a handle. */
  throws?: string;
  /** Run while the harness holds the checkout, before it reports, on the harness's own context. */
  during?: (ctx: BlockContext) => Promise<unknown>;
}

/** What the stub harness saw on one call. */
export interface SeenRun {
  cwd: string;
  prompt: string;
  resume: string | null;
}

/** Commit `count` new files in the checkout `cwd`. */
function commitIn(cwd: string, count: number, tag: string): void {
  const git = (...args: string[]) => execFileSync("git", args, { cwd, stdio: "pipe", encoding: "utf8" });
  for (let i = 0; i < count; i++) {
    writeFileSync(join(cwd, `${tag}-${i}.txt`), `${tag} ${i}\n`);
    git("add", `${tag}-${i}.txt`);
    git("-c", "user.email=stub@example.test", "-c", "user.name=Stub", "commit", "-m", `${tag} commit ${i}`);
  }
}

function stubHarness(script: HarnessStep[], seen: SeenRun[]) {
  return (feeds: HarnessFeeds): HarnessBlock =>
    handler({
      name: "claim-host-harness",
      inputSchema: harnessRunInputSchema,
      outputSchema: harnessRunHandleSchema,
      execute: async (input, ctx) => {
        const cwd = await feeds.cwd(ctx as never);
        const resume = await feeds.resume(ctx as never);
        seen.push({ cwd, prompt: input.prompt, resume });
        const step = script[seen.length - 1] ?? {};
        const sessionId = resume ?? `sess_${seen.length}`;
        await feeds.onSession(sessionId, ctx as never);
        if (step.commits !== undefined) commitIn(cwd, step.commits, `call${seen.length}`);
        if (step.during !== undefined) await step.during(ctx as unknown as BlockContext);
        if (step.ask !== undefined) {
          const marker = /ASK: (\S+)/.exec(input.prompt)?.[1];
          if (marker === undefined) throw new Error("the prompt names no ask marker");
          mkdirSync(dirname(marker), { recursive: true });
          writeFileSync(marker, step.ask);
        }
        if (step.throws !== undefined) throw new Error(step.throws);
        return {
          source: "stub/test",
          status: "completed" as const,
          sessionId,
          url: null,
          dispatchedAt: Date.now(),
          outcome: step.outcome ?? ("finished" as const),
          finalMessage: step.answer === undefined ? "done" : step.answer,
          usage: null,
          cost: null,
        };
      },
    }) as unknown as HarnessBlock;
}

/** The claim a test puts on the manager's input, playing the entry adapter. */
export interface InputClaim {
  collectionId: string;
  partition?: string;
  incarnationId?: string;
}

export interface HostOptions {
  /** `fixed` builds the manager on `FIXED_BOARD`; `claim` builds it with a resolver. */
  mode: "fixed" | "claim";
  script?: HarnessStep[];
  /** The phase's done-condition. Default: always done. */
  isDone?: (run: { answer?: string | null }) => boolean;
  /** Extra manager options (a judge, say). */
  manager?: Record<string, unknown>;
  /** Give the host durable execution, so a run can wait for a person (`reviewChanges`). */
  durable?: boolean;
  /** Run inside the phase's prompt builder, on its context, before the prompt is built. */
  beforePrompt?: (ctx: BlockContext) => Promise<unknown>;
  /** The resolver a `claim` host's manager is given. Default: the conversations ledger, at the claim's partition. */
  ledgers?: (ledgerId: string, ctx: BlockContext, partition: string | undefined) => Promise<TaskCollectionRef | undefined>;
}

/** Build one host. */
export function claimHost(options: HostOptions) {
  const dir = mkdtempSync(join(tmpdir(), "harness-manager-claim-host-"));
  dirs.push(dir);
  const sourceRepo = join(dir, "repo");
  mkdirSync(sourceRepo, { recursive: true });
  seedRepo(sourceRepo);

  const fixedLedger = defineTaskCollection({ id: FIXED_BOARD, scope: "user" as const });
  const conversations = defineTaskCollection({
    id: CONVERSATIONS,
    scope: "user" as const,
    // Never asked: every ref this host makes names its partition.
    partitionBy: () => "unused",
  });

  /** A ledger as this request's user scope holds it, at `partition` when it keeps them. */
  const ledgerAt = (ctx: BlockContext, ledgerId: string, partition: string | undefined) => {
    const declared = ledgerId === FIXED_BOARD ? fixedLedger : ledgerId === CONVERSATIONS ? conversations : undefined;
    const collection = declared === undefined ? undefined : resolveResourceCollection(ctx, ledgerId);
    if (collection === undefined) return Promise.resolve(undefined);
    return getOrCreateTaskCollection({
      ctx,
      backing: "resource",
      collectionId: ledgerId,
      collection,
      ...(partition !== undefined ? { partition } : {}),
    });
  };
  const ledgers =
    options.ledgers ??
    ((ledgerId: string, ctx: BlockContext, partition: string | undefined) =>
      ledgerId === CONVERSATIONS && partition !== undefined ? ledgerAt(ctx, ledgerId, partition) : Promise.resolve(undefined));

  const seen: SeenRun[] = [];
  const answersSeen: Array<string | null | undefined> = [];
  const manager = harnessManager({
    ...(options.mode === "fixed"
      ? { boardCollectionId: FIXED_BOARD, boardCollection: fixedLedger }
      : { ledgers }),
    tenant: undefined,
    phase: {
      phase: PHASE,
      buildPrompt: async (run: PromptRunContext) => {
        await options.beforePrompt?.(run.ctx);
        return [
          `Work on ${run.issue}, attempt ${run.attempt}: ${run.task.goal}`,
          ...(run.feedback !== undefined ? [`FEEDBACK: ${run.feedback}`] : []),
          ...run.answers.map((a) => `ANSWERED: ${a.question} => ${a.answer}`),
          `ASK: ${run.askMarkerPath}`,
        ].join("\n");
      },
      isDone: (run: CompletionRunContext) => {
        const answer = (run as { answer?: string | null }).answer;
        answersSeen.push(answer);
        return options.isDone?.({ answer }) ?? true;
      },
    },
    workspace: { root: join(dir, "checkouts"), sourceRepo, baseRef: "main", provisionTimeoutMs: 10_000 },
    runTimeoutMs: 20_000,
    ownership: { pollMs: 25 },
    harness: stubHarness(options.script ?? [], seen),
    ...(options.manager ?? {}),
  } as never);

  const ledgerResources = defineCapability({
    name: "claim-host-ledgers",
    resources: { [FIXED_BOARD]: fixedLedger, ...taskLedgerResources(conversations) },
  });

  // File a row and claim it, as a board's drain would before dispatching it.
  const seed = handler({
    name: "claim-host-seed",
    inputSchema: z.object({
      ledgerId: z.string(),
      partition: z.string().optional(),
      id: z.string(),
      goal: z.string(),
      input: z.unknown().optional(),
      maxAttempts: z.number().optional(),
      deps: z.array(z.string()).optional(),
    }),
    outputSchema: z.unknown(),
    uses: [ledgerResources],
    execute: async (input, ctx) => {
      // @ts-expect-error — source bug FIX-2091: a block that uses a capability gets a ctx that is not a BlockContext.
      const ref = (await ledgerAt(ctx as BlockContext, input.ledgerId, input.partition))!;
      if (ref.get(input.id) === undefined) {
        await ref.createTask({
          id: input.id,
          goal: input.goal,
          assignee: ASSIGNEE,
          ...(input.input !== undefined ? { input: input.input } : {}),
          ...(input.deps !== undefined ? { deps: input.deps } : {}),
          maxAttempts: input.maxAttempts ?? 2,
        });
      }
      return null;
    },
  });
  const claim = handler({
    name: "claim-host-claim",
    inputSchema: z.object({ ledgerId: z.string(), partition: z.string().optional(), id: z.string() }),
    outputSchema: z.unknown(),
    uses: [ledgerResources],
    execute: async (input, ctx) => {
      // @ts-expect-error — source bug FIX-2091: a block that uses a capability gets a ctx that is not a BlockContext.
      const ref = (await ledgerAt(ctx as BlockContext, input.ledgerId, input.partition))!;
      const claimed = await ref.claim("drain", { leaseDurationMs: 120_000, eligibility: (t) => t.id === input.id });
      return claimed === null ? null : (JSON.parse(JSON.stringify(claimed)) as unknown);
    },
  });
  // Read a row, or answer the question it parked on, as the conversation would.
  const rowAction = handler({
    name: "claim-host-row",
    inputSchema: z.object({ ledgerId: z.string(), partition: z.string().optional(), id: z.string() }),
    outputSchema: z.unknown(),
    uses: [ledgerResources],
    execute: async (input, ctx) => {
      // @ts-expect-error — source bug FIX-2091: a block that uses a capability gets a ctx that is not a BlockContext.
      const ref = (await ledgerAt(ctx as BlockContext, input.ledgerId, input.partition))!;
      const found = ref.get(input.id);
      return found === undefined ? null : (JSON.parse(JSON.stringify(found)) as unknown);
    },
  });
  // Answer the row's oldest open question as its user, through the board's one hold write.
  const answer = handler({
    name: "claim-host-answer",
    inputSchema: z.object({ ledgerId: z.string(), partition: z.string().optional(), id: z.string(), answer: z.string() }),
    outputSchema: z.unknown(),
    uses: [ledgerResources],
    execute: async (input, ctx) => {
      // @ts-expect-error — source bug FIX-2091: a block that uses a capability gets a ctx that is not a BlockContext.
      const ref = (await ledgerAt(ctx as BlockContext, input.ledgerId, input.partition))!;
      const row = ref.get(input.id);
      const hold = row === undefined ? undefined : openRowQuestions(row)[0];
      if (hold === undefined) return { outcome: "declined", reason: "no-open-question" };
      return ref.answer!(input.id, { questionId: hold.id, message: input.answer, from: "user", by: ALICE });
    },
  });
  const cancel = handler({
    name: "claim-host-cancel",
    inputSchema: z.object({ ledgerId: z.string(), partition: z.string().optional(), id: z.string() }),
    outputSchema: z.unknown(),
    uses: [ledgerResources],
    execute: async (input, ctx) => {
      // @ts-expect-error — source bug FIX-2091: a block that uses a capability gets a ctx that is not a BlockContext.
      const ref = (await ledgerAt(ctx as BlockContext, input.ledgerId, input.partition))!;
      return ref.cancel(input.id, "cancelled by the test");
    },
  });
  const records = handler({
    name: "claim-host-records",
    inputSchema: z.object({ topic: z.string() }),
    outputSchema: z.unknown(),
    resources: { runs: runRecordCollection },
    execute: async (input, ctx) => (await readRunRow(ctx as never, input.topic)) ?? null,
  });
  // Write a run record as it stands, as an earlier version of the manager left it.
  const putRecordBlock = handler({
    name: "claim-host-put-record",
    inputSchema: z.object({ topic: z.string(), state: z.record(z.unknown()) }),
    outputSchema: z.unknown(),
    resources: { runs: runRecordCollection },
    execute: async (input, ctx) => {
      await collectionRef(ctx as never, RUNS).upsert(input.topic, input.state);
      return null;
    },
  });

  const flow = defineFlow({
    kind: "claim-host",
    actions: {
      seed: { block: seed },
      claim: { block: claim },
      row: { block: rowAction },
      answer: { block: answer },
      cancel: { block: cancel },
      records: { block: records },
      putRecord: { block: putRecordBlock },
    },
    task: {
      actions: {
        work: {
          block: manager as BlockDefinition,
          from: taskLedgers({
            name: "claim-host-door",
            resolve: async (ledgerId, ctx, partition) =>
              ledgerId === FIXED_BOARD && partition === undefined
                ? ledgerAt(ctx, ledgerId, undefined)
                : ledgerId === CONVERSATIONS && partition !== undefined
                  ? ledgerAt(ctx, ledgerId, partition)
                  : undefined,
            uses: [ledgerResources],
          }),
        },
      },
    },
  } as never)({ id: "claim-host" } as never);
  const state = createFlowState({
    flows: { "claim-host": flow },
    stores: { test: { primary: inMemoryStores() } },
    defaultProfile: "test",
    dispatchDrainTimeoutMs: 60_000,
    ...(options.durable === true ? { durable: true } : {}),
  } as never);

  let sessions = 0;
  // Every action runs in this organization; `inOrg` moves the host's person to another.
  let orgId = ORG_ID;
  const act = async (action: string, input: unknown, sessionId = `s_${++sessions}`, source?: string, requestId?: string) => {
    const runtime = await (state as unknown as {
      getRuntime(): Promise<{ stores: any; runtimeConfig: object }>;
    }).getRuntime();
    return (await runAction({
      flow,
      actionName: action,
      input,
      userId: ALICE,
      orgId,
      sessionId,
      ...(source !== undefined ? { source } : {}),
      ...(requestId !== undefined ? { requestId } : {}),
      stores: runtime.stores,
      runtimeConfig: { ...runtime.runtimeConfig },
    } as never)) as { output?: unknown; error?: unknown };
  };

  const at = (ledgerId: string, partition?: string) => ({ ledgerId, ...(partition !== undefined ? { partition } : {}) });

  /** Read a row as stored. */
  const row = async (ledgerId: string, id: string, partition?: string): Promise<Task> =>
    (await act("row", { ...at(ledgerId, partition), id })).output as Task;

  /**
   * Claim the row and dispatch one attempt into the gated entry, as a
   * board's dispatch would. `claimOnInput` is what the test's adapter puts on
   * the manager's input: the gate's ledger and partition by default, on a
   * `claim` host; nothing on a `fixed` one.
   */
  const runAttempt = async (
    ledgerId: string,
    id: string,
    partition?: string,
    claimOnInput?: InputClaim | null,
    /** Run the attempt under this request id: as an inline drain runs every turn it takes in its own request. */
    requestId?: string,
  ) => {
    const claimed = (await act("claim", { ...at(ledgerId, partition), id })).output as Task | null;
    if (claimed === null) throw new Error(`row ${id} was not claimable`);
    const onInput =
      claimOnInput === undefined
        ? options.mode === "claim"
          ? { collectionId: ledgerId, ...(partition !== undefined ? { partition } : {}) }
          : null
        : claimOnInput;
    const result = await act(
      "work",
      {
        boardId: ledgerId,
        assignee: ASSIGNEE,
        taskId: id,
        attempt: claimed.attempts,
        createdAt: claimed.createdAt,
        ...(claimed.incarnationId !== undefined ? { incarnationId: claimed.incarnationId } : {}),
        ...(partition !== undefined ? { partition } : {}),
        payload: {
          taskId: id,
          goal: claimed.goal,
          attempts: claimed.attempts,
          ...(claimed.input !== undefined ? { input: claimed.input } : {}),
          ...(claimed.feedback !== undefined ? { feedback: claimed.feedback } : {}),
          ...(onInput !== null ? { claim: onInput } : {}),
        },
      },
      `s_task_${orgId === ORG_ID ? "" : `${orgId}_`}${ledgerId}_${partition ?? "none"}_${id}`,
      "task",
      requestId,
    );
    return { claimed, result };
  };

  const record = async (topic: string): Promise<RunRecordState | null> =>
    (await act("records", { topic })).output as RunRecordState | null;

  const putRecord = async (topic: string, state: Record<string, unknown>): Promise<void> => {
    await act("putRecord", { topic, state });
  };
  const inOrg = (next: string): void => {
    orgId = next;
  };

  return {
    act,
    ledgerAt,
    manager,
    seed: (input: Record<string, unknown>) => act("seed", input),
    row,
    runAttempt,
    record,
    putRecord,
    inOrg,
    seen,
    answersSeen,
    dir,
  };
}

/** The message a failed action carries, however the engine wrapped it. */
export function messageOf(error: unknown): string {
  const e = error as { message?: unknown; cause?: { message?: unknown } } | undefined;
  return `${String(e?.message ?? "")} ${String(e?.cause?.message ?? "")} ${JSON.stringify(error)}`;
}

/** The harness task input schema, re-exported for seeding payload rows. */
export { harnessTaskInputSchema };
