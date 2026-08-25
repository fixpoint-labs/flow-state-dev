/**
 * The conductor flow — a board, one detached worker, and three zero-model
 * actions.
 *
 * `seed` files an issue-phase as a durable row. `wake` drains the board, which
 * claims a row and hands it to the manager in its own workstream. `status`
 * reads back what happened.
 *
 * ## The board's own ledger is a deliverable, not a default
 *
 * A detached board refuses three things at construction, and a flow that leaves
 * any of them implicit throws before `seed` can run: an explicit stable
 * `boardId`, a durable `defineTaskCollection()` backing, and a ledger the
 * workstream can reach.
 *
 * **`user`-scoped, no `sharedToWorkstream`.** The task row is where a human's
 * later answer lands, through a NEW request, so a parked row has to outlive the
 * coordinator session that created it. `user` rather than `org` because it
 * matches the already-user-scoped inbox where the other half of that round trip
 * arrives, while `org` would share a claim pool across users. At `user` scope
 * the `sharedToWorkstream` refusal never fires — it is conditional on session
 * scope — and the other two requirements still apply exactly as stated.
 *
 * **Partitioned by epic, and the partition has to reach storage.** One board
 * per epic, and each epic gets its own COLLECTION identity. A distinct
 * `boardId` is not sufficient and is not an alternative: it never reaches the
 * ledger — it is hashed into the derived workstream session id and framed into
 * the coordinate key — so two epic boards under one user sharing a collection
 * id and differing only in `boardId` would operate on the same rows, and one
 * epic's drain could claim or settle another's. Both ids are needed and neither
 * substitutes for the other: `boardId` partitions routing, the collection
 * identity partitions storage.
 *
 * ## Why `status` is an action and not a route
 *
 * `defineTaskCollection()` exposes no `client` option, so the board ledger can
 * never declare `client.state.read` and its collection-state route answers 403.
 * And nothing else substitutes: `recordSuccess` writes with `ifAllowed: true`,
 * so a `complete()` refused on a lost claim is DROPPED rather than thrown — the
 * worker returns normally, the workstream request completes, and the run record
 * reads as a success while the board row is still open. **The board row is the
 * authority on completion; the run record never is.**
 */
import { defineFlow, handler, sequencer } from "@flow-state-dev/core";
import { z } from "zod";
import { defineTaskCollection } from "@flow-state-dev/orchestration/tasks";
import { taskBoard } from "@flow-state-dev/orchestration/task-board";
import {
  RUNS,
  readRunRow,
  runRecordCollection,
  runRecordStateSchema,
  runTopic,
  runTopicPrefix,
} from "./run-record";
import {
  conductorDrainBudgetMs,
  conductorTaskInputSchema,
  describeTenant,
  harnessManager,
  requestTenant,
  resolveOwnership,
  type RequestIdentityContext,
  type PhaseSpec,
} from "./manager";
import { implementPhase } from "./implement";
import { assertPositiveInt } from "./config-env";
import {
  assertSafeSegment,
  conductorTaskId,
  joinIdentity,
  tenantSegment,
  type WorkspaceConfig,
} from "./workspace";

/** The one assignee this board routes to. */
export const ASSIGNEE = "harness" as const;

export interface ConductorFlowOptions {
  /**
   * The epic this board belongs to. One board per epic — it names both the
   * routing id and the storage identity, which is why it is required.
   */
  epic: string;
  /**
   * The tenant this conductor serves. **Omitted means untenanted** — which is a
   * distinct identity, not a synonym for any particular tenant name.
   *
   * Construction-time rather than per-request, because it partitions a
   * collection identity. A multi-tenant host builds one conductor per
   * (tenant, epic), and **every action refuses a request resolved to any other
   * tenant before it touches the board** — `seed` before the row is written,
   * `status` before the ledger is read, `wake` before the claim that would
   * charge an attempt. The manager checks again before executing, because a
   * task can reach the board by any route that can write a row.
   */
  tenant?: string;
  workspace: WorkspaceConfig;
  /**
   * How many attempts a row gets. Without one the substrate's default is
   * single-attempt and the retry decision 1 is priced on never happens.
   */
  maxAttempts?: number;
  runTimeoutMs?: number;
  /** Defaults to the implement phase. Swapped by tests and by later phases. */
  phase?: PhaseSpec;
  /** Forwarded to the coding agent (model, tools, permission mode, a test stub). */
  agent?: Parameters<typeof harnessManager>[0]["agent"];
  ownership?: Parameters<typeof harnessManager>[0]["ownership"];
}

/** The flow's `kind`, which is how the HTTP routes address it. */
export const CONDUCTOR_FLOW_KIND = "conductor" as const;

/** Build the conductor flow for one epic. */
export function conductorFlow(options: ConductorFlowOptions) {
  const {
    epic,
    tenant,
    workspace,
    maxAttempts = 3,
    runTimeoutMs = 1_800_000,
    phase = implementPhase(),
    agent,
    ownership,
  } = options;

  // Both ids, per epic, and neither substituting for the other.
  // The tenant is in BOTH ids for the same reason the epic is: `boardId`
  // partitions routing (it is hashed into the derived workstream session id),
  // the collection identity partitions storage, and neither substitutes for the
  // other.
  // **Every numeric option is validated at THIS door too.**
  //
  // `conductorFlow` is exported, so a host reaches these values without passing
  // through `positiveIntFromEnv`. Unvalidated, a `NaN` survives the ownership
  // comparisons silently and only surfaces at `AbortSignal.timeout` — after the
  // row is claimed and the checkout provisioned, once per retry. Same rule as
  // the env door, same predicate, applied where the value actually enters.
  assertPositiveInt("runTimeoutMs", runTimeoutMs);
  assertPositiveInt("maxAttempts", maxAttempts);
  if (workspace.provisionTimeoutMs !== undefined) {
    assertPositiveInt("workspace.provisionTimeoutMs", workspace.provisionTimeoutMs);
  }
  for (const [key, value] of Object.entries(ownership ?? {})) {
    if (value !== undefined) assertPositiveInt(`ownership.${key}`, value as number);
  }

  // `tenantSegment`, not `encodeSegment(tenant ?? something)`. The board and
  // the checkout MUST agree on what a tenant is, and the way they stopped
  // agreeing was a default here that the checkout did not share.
  const boardId = joinIdentity("conductor", tenantSegment(tenant), assertSafeSegment("epic", epic));
  // **The tenant is in the collection identity, not just the epic.**
  //
  // User scope is keyed on the BARE user id — `createExecutionContext` passes
  // `scopeId: userId` — while session scope tenant-qualifies its key. So two
  // tenants sharing a user id share every `user`-scoped collection, and the
  // board is one: one tenant's `wake` could claim a row another tenant filed and
  // run that task in the claiming tenant's workspace, with status and retry
  // accounting shared.
  //
  // Conductor owns this identity, which is the lever that already carries the
  // epic — so the tenant goes in the same place rather than reaching for a
  // framework change. It has to be construction-time because a collection id is:
  // a multi-tenant host builds one conductor per (tenant, epic).
  //
  // **Partitioning is only half of it.** A separate collection isolates nothing
  // unless the tenant is actually checked on the way in, and this sentence used
  // to claim the manager did that — which was true for one action of three. The
  // gate is `assertRequestTenant`, and every action passes it before any board
  // access; see its note for what each one leaked without it.
  //
  // **This partitions the run record too, for free.** The run topic leads with
  // this id, so putting the tenant here puts it in both keys — one change, one
  // rule, both stores.
  const collectionId = joinIdentity(
    "conductor-tasks",
    tenantSegment(tenant),
    assertSafeSegment("epic", epic),
  );

  const tasks = defineTaskCollection({
    id: collectionId,
    scope: "user",
    stateSchema: conductorTaskInputSchema,
  });

  const manager = harnessManager({
    boardCollectionId: collectionId,
    boardCollection: tasks,
    tenant,
    phase,
    workspace,
    runTimeoutMs,
    ...(agent !== undefined ? { agent } : {}),
    ...(ownership !== undefined ? { ownership } : {}),
  });

  const board = taskBoard({
    name: boardId,
    boardId,
    collection: tasks,
    // ONE issue at a time, stated rather than inherited. The substrate's default
    // is 4, so a single drain would launch four detached coding runs at once —
    // contradicting this lab's own deployment contract and multiplying model
    // spend by four. The manager holds a worker slot for its run's whole
    // duration, so this is also what keeps that cost legible.
    concurrency: 1,
    workers: {
      [ASSIGNEE]: { worker: manager, dispatch: { mode: "detached" } },
    },
  });

  const seedInput = conductorTaskInputSchema;

  /**
   * File one issue-phase as a durable row, with its retry budget on it.
   *
   * **Idempotent per issue-phase**, because everything downstream already is.
   * Two rows for one issue-phase derive the same checkout, the same branch and
   * the same `runs/<epic>/<issue>/<phase>` record — so a duplicated `seed` charges two
   * full coding runs whose independently valid claims overwrite one shared run
   * record, and `status` then answers with two board rows carrying the last
   * writer's metadata. The task id is therefore the issue-phase itself rather
   * than a fresh mint, and a second `seed` returns the existing row.
   *
   * The id is built from the same validated segments the checkout path is, so
   * it cannot carry a separator or a traversal into the ledger's key space.
   */
  const seedTask = handler({
    name: "conductor-seed-task",
    inputSchema: seedInput,
    outputSchema: z.object({ taskId: z.string() }),
    uses: [board.capability],
    execute: async (input, ctx) => {
      // One board, one phase. Refused here so the mistake surfaces at the call
      // that made it rather than as a row that runs the wrong phase's prompt —
      // the manager refuses it too, since a task can reach the board by any
      // route that can write a row.
      if (input.phase !== phase.phase) {
        throw new Error(
          `[conductor] this board runs the "${phase.phase}" phase; refusing to file a ` +
            `"${input.phase}" row. A conductor runs one phase, and the board identity is ` +
            `(tenant, epic) — so a second phase needs its own \`epic\`, NOT a second ` +
            `conductor on this one. Two conductors sharing an epic share this board: the ` +
            `other one's \`wake\` claims these rows, refuses them on phase, and charges a ` +
            `valid task an attempt for the mistake.`,
        );
      }

      const taskId = conductorTaskId(input.issue, input.phase);
      const existing = await ctx.cap[boardId].getTask(taskId);
      if (existing !== undefined) {
        // Already filed. `wake` is what re-drains it — re-seeding must not mint
        // a second run, and must not reset the retry budget of the first.
        await ctx.sequencer?.patchState({ taskId: existing.id });
        return { taskId: existing.id };
      }

      // **The read above does not make this safe on its own.** Two concurrent
      // seeds can both find the row absent before either creates it; the loser's
      // create then fails on the id that already exists. Losing that race is the
      // correct outcome — one row was filed — so the loser re-reads and returns
      // the winner's row rather than surfacing a conflict the caller cannot act
      // on.
      //
      // Read-then-create is not atomic and cannot be made so through this
      // surface; the stable id is what turns the race into a *detectable*
      // conflict rather than two rows, and this turns the detection into the
      // idempotent answer.
      try {
        const task = await ctx.cap[boardId].addTask({
          id: taskId,
          goal: `Drive ${input.issue} through its ${input.phase} phase.`,
          assignee: ASSIGNEE,
          // The typed payload. NEVER `metadata`: that is model-patchable through
          // `updateTask`, and the checkout path is derived from these two fields.
          input: { issue: input.issue, phase: input.phase },
          // Without this the substrate is single-attempt and a reported failure
          // costs nothing and delivers nothing — the defect this lab exists to fix.
          maxAttempts,
          // The workstream routing identity the detached spawn seeds. Routing
          // only; nothing derives a path or a permission from it.
          metadata: { topic: `${input.issue}/${input.phase}` },
        });
        await ctx.sequencer?.patchState({ taskId: task.id });
        return { taskId: task.id };
      } catch (err) {
        // Only a lost race is absorbed. Anything else — a malformed task, a
        // store outage — is a real failure and must not be reported as a
        // successful seed.
        const raced = await ctx.cap[boardId].getTask(taskId);
        if (raced === undefined) throw err;
        await ctx.sequencer?.patchState({ taskId: raced.id });
        return { taskId: raced.id };
      }
    },
  });

  /** Hand the seeded task id back as the action's output. */
  const returnTaskId = handler({
    name: "conductor-return-task-id",
    inputSchema: z.unknown(),
    outputSchema: z.object({ taskId: z.string() }),
    execute: (_input, ctx) => {
      const taskId = (ctx.sequencer?.state as { taskId?: unknown } | undefined)?.taskId;
      if (typeof taskId !== "string" || taskId === "") {
        throw new Error(
          "[conductor] seed completed without recording a task id — the row was filed but " +
            "the caller cannot name it.",
        );
      }
      return { taskId };
    },
  });

  /**
   * What `status` answers with. The board row leads, because it is the
   * authority on completion.
   */
  const statusOutput = z.object({
    rows: z.array(
      z.object({
        taskId: z.string(),
        issue: z.string().nullable(),
        phase: z.string().nullable(),
        /** The BOARD's status. Never inferred from the run record. */
        status: z.string(),
        attempts: z.number(),
        feedback: z.string().nullable(),
        /**
         * The run's own row, **as the schema declares it** rather than as a
         * hand-listed subset.
         *
         * A projection enumerated here would drift the moment a field is added
         * to the row — silently, and only for readers of that one field. That
         * is the same shape of defect the clearing rule exists to prevent, so
         * it is removed the same way: there is one list, and this is not a
         * second copy of it.
         */
        run: runRecordStateSchema.nullable(),
      }),
    ),
  });

  /**
   * **The tenant gate. Every action passes it before touching the board.**
   *
   * The tenant is resolved from the request's own authenticated principal —
   * never from a body, a payload, or task metadata (BP-031) — and compared to
   * the one this conductor was constructed for.
   *
   * It used to live only inside the manager, which runs when the drain
   * *dispatches a claimed row*. That left the guarantee this file documents
   * untrue for two of the three actions and too late for the third:
   *
   * - `seed` wrote a row with no tenant check at all — cross-tenant task
   *   injection.
   * - `status` read the ledger with no tenant check at all — cross-tenant
   *   status disclosure.
   * - `wake` claimed first and refused after. `applyClaimToTask` sets
   *   `in_progress` and increments `attempts` in one write, so a refused
   *   cross-tenant wake still burnt an attempt on another tenant's valid task.
   *   Refusing is not enough; it has to refuse *before the claim*.
   *
   * A partition only isolates if the tenant is actually checked, and the
   * collection identity carrying the tenant is what makes this the whole of the
   * isolation rather than half of it.
   *
   * The manager keeps its own copy of this check. Not redundancy: a task can
   * reach the board by any route that can write a row, so the gate guards the
   * actions and the manager guards the execution.
   */
  function assertRequestTenant(ctx: RequestIdentityContext): void {
    const resolved = requestTenant(ctx);
    if (resolved !== tenant) {
      throw new Error(
        `[conductor] this conductor serves ${describeTenant(tenant)}; the request resolved ` +
          `to ${describeTenant(resolved)}. Refusing before reading or writing the board, ` +
          `rather than running one tenant's task in another's workspace.`,
      );
    }
  }

  /**
   * The gate as a step, so `seed` and `wake` refuse before the drain claims.
   *
   * A `.tap()` and not a `.step()`: it inspects the request and passes the
   * chain value through untouched.
   */
  const tenantGate = handler({
    name: "conductor-tenant-gate",
    inputSchema: z.unknown(),
    // `void`, not the input echoed back. `.tap()` already preserves the chain
    // value and ignores what this returns, so returning the input would be an
    // identity handler — a step that exists only to satisfy a type
    // (AGENTS.md 5). The gate's whole job is the throw.
    outputSchema: z.void(),
    execute: (_input, ctx) => {
      assertRequestTenant(ctx);
    },
  });

  const readStatus = handler({
    name: "conductor-status",
    inputSchema: z.object({ issue: z.string().optional() }),
    outputSchema: statusOutput,
    uses: [board.capability],
    resources: { [RUNS]: runRecordCollection },
    execute: async (input, ctx) => {
      // Before the listing, not after it — a refusal that has already read the
      // rows has already disclosed them.
      assertRequestTenant(ctx);
      const tasksOnBoard = await ctx.cap[boardId].listTasks();
      const rows = [];
      for (const task of tasksOnBoard) {
        const payload = conductorTaskInputSchema.safeParse(task.input);
        const issue = payload.success ? payload.data.issue : null;
        const phaseName = payload.success ? payload.data.phase : null;
        if (input.issue !== undefined && issue !== input.issue) continue;

        const record =
          issue !== null && phaseName !== null
            ? await readRunRow(ctx as never, runTopic(collectionId, issue, phaseName))
            : undefined;

        rows.push({
          taskId: task.id,
          issue,
          phase: phaseName,
          status: task.status,
          attempts: task.attempts,
          feedback: task.feedback ?? null,
          // The whole row, not a re-listing of it — see the output schema.
          run: record ?? null,
        });
      }
      return { rows };
    },
  });

  const defineConductor = defineFlow({
    kind: CONDUCTOR_FLOW_KIND,
    actions: {
      /** File an issue-phase and start it in one call. */
      seed: {
        block: sequencer({
          name: "conductor-seed",
          inputSchema: seedInput,
          outputSchema: z.object({ taskId: z.string() }),
          stateSchema: z.object({ taskId: z.string().nullable().default(null) }),
        })
          // First, before the row is written: seeding is a WRITE, so a check
          // that ran after it would be reporting an injection rather than
          // preventing one.
          .tap(tenantGate)
          .tap(seedTask)
          // The drain claims the row and hands it to a workstream, then returns
          // with the row still open. The seeding request does not wait for the
          // run — which is the point.
          .step(board.drain)
          // **The action answers with the task id, not the drain's output.**
          // `.tap()` discards what `seedTask` returned and the drain replaces the
          // chain value, so without this the caller got `undefined` — and a
          // caller cannot follow up on a row it cannot name. It also made the
          // concurrent-idempotency test pass for the wrong reason: both reads
          // were `undefined`, so "both seeds named one row" held vacuously.
          .step(returnTaskId),
      },
      /** Drain again: claim whatever is ready, including a re-pended retry. */
      wake: {
        // **Wrapped, so the gate runs before the claim.** A bare `board.drain`
        // claimed the row and let the manager refuse afterwards — and the claim
        // write is what increments `attempts`, so the refusal arrived one
        // charged attempt too late, on a task belonging to someone else.
        block: sequencer({
          name: "conductor-wake",
          inputSchema: z.unknown(),
          outputSchema: z.unknown(),
        })
          .tap(tenantGate)
          .step(board.drain),
      },
      /** The read surface. Zero-model, server-side, board row first. */
      status: { block: readStatus },
    },
  });

  // Instantiated here rather than by the caller: a conductor is one board per
  // epic, so there is exactly one instance and nothing to choose.
  const flow = defineConductor({ id: "default" });

  // **The host's shutdown budget, derived rather than guessed.** Exposed
  // because only this module knows all four terms a worker spends, and a host
  // that picks its own number picks it from the one term it can see.
  const drainBudgetMs = conductorDrainBudgetMs({
    runTimeoutMs,
    provisionTimeoutMs: workspace.provisionTimeoutMs,
    ownershipWaitMs: resolveOwnership({
      runTimeoutMs,
      provisionTimeoutMs: workspace.provisionTimeoutMs,
      ...(ownership !== undefined ? { ownership } : {}),
    }).ownership.waitMs,
  });

  return {
    flow,
    board,
    tasks,
    boardId,
    collectionId,
    runs: runRecordCollection,
    drainBudgetMs,
  };
}

export { runTopic, runTopicPrefix };
