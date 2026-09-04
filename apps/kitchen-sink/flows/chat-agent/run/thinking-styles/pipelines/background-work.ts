/**
 * Background-work pipeline — the turn files the work and returns.
 *
 * Every other thinking style answers inside the turn. This one does not: it
 * writes the request onto a durable board and hands it to a **child session** —
 * one that outlives the request that started it — then replies and ends the
 * turn while the work is still going. The reply a later turn gives is where
 * the result shows up.
 *
 * ## The three declarations that make the hand-off legal
 *
 * - **`backgroundWorkLedger` is resource-backed.** A detached worker's row
 *   outlives the claiming request, so the board refuses anything but a durable
 *   collection at construction.
 * - **`sharedToLineage: true`.** The ledger is session-scoped, and a
 *   child session is a different session — without this it would hydrate empty
 *   inside the child and the child could not settle the row it was dispatched
 *   for. The flag resolves a session-scoped resource against the lineage root,
 *   so the conversation and every child session under it address one ledger.
 * - **An explicit `boardId`.** It is hashed into the child session's id, so it
 *   has to be stable and deliberate rather than an incidental string.
 *
 * ## What this pipeline can and cannot show you
 *
 * The parent's view of the ledger is the one it hydrated when the request
 * started, and it never observes the child session's write. So {@link
 * reportBackgroundWork} reports the *just-filed* row as running no matter how
 * fast the child is, and results appear on the next turn. Polling for
 * completion inside one turn would wait forever; the shape here is the one that
 * works.
 *
 * A detached generator also streams no in-flight text — a reader attaching to
 * the child session sees completed items, not tokens arriving.
 */
import { dispatcher, generator, handler, sequencer } from "@flow-state-dev/core";
import { defineTaskCollection } from "@flow-state-dev/orchestration/tasks";
import { taskBoard, taskWorkerInputSchema } from "@flow-state-dev/orchestration/task-board";
import type { TaskWorker, TaskWorkerInput } from "@flow-state-dev/orchestration/tasks";
import { z } from "zod";
import type { PipelineConfig } from "./config";

/** Stable board id. Hashed into every child session this board starts — renaming it re-keys live ones. */
const BOARD_ID = "kitchen-sink-background-work";

/** The one assignee this board routes to, and the coordinate its child sessions are addressed by. */
const ASSIGNEE = "brief";

/** Longest display label we render for a filed row. Never used for routing. */
const LABEL_MAX_LENGTH = 60;

/** What a filed request carries to its worker. */
const briefRequestSchema = z.object({ request: z.string() });

/**
 * The durable ledger the conversation and its child sessions share.
 *
 * Exported so the board's rows are addressable from a test or a debug read
 * without rebuilding the declaration — `taskBoard` binds this exact object.
 */
export const backgroundWorkLedger = defineTaskCollection({
  id: "background-work",
  scope: "session",
  sharedToLineage: true,
  stateSchema: briefRequestSchema,
});

/**
 * The child session's `topic` — a **routing identity**, not a label.
 *
 * Whitespace-normalized and otherwise complete. `deriveChildSessionId` hashes
 * this together with the board's routing key, so it is the value that decides
 * which child session a task lands in. Two turns asking the same thing land on
 * the same child session and continue its history, which is the substrate's
 * adoption path rather than an accident.
 *
 * **Never truncate this.** It used to be cut to 60 characters and reused as the
 * display label, which meant two different prompts sharing their first 59
 * characters derived the *same* child session and the panel showed one row mixing
 * both jobs. The task board frames its coordinates by length
 * (`orchestration/task-board/coordinate.ts`) precisely so two distinct
 * addresses can never alias; truncating the other half of the identity at the
 * app layer gave that back. Display truncation belongs at the render edge —
 * see {@link labelFor} and the panel's `truncate` class.
 */
function routingTopicFor(message: string): string {
  return message.replace(/\s+/g, " ").trim();
}

/** One-line display label. Display only — never an input to routing. */
function labelFor(topic: string): string {
  return topic.length > LABEL_MAX_LENGTH
    ? `${topic.slice(0, LABEL_MAX_LENGTH - 1)}…`
    : topic;
}

/** Row shape the report reads. Narrow on purpose — it renders, it does not steer. */
type ReportedTask = {
  id: string;
  goal: string;
  status: string;
  output: unknown;
  /** True once this row has been reported to the user on an earlier turn. */
  reported: boolean;
};

/** Render one finished row's output, whatever shape the worker settled it with. */
function renderOutput(output: unknown): string {
  return typeof output === "string" ? output : JSON.stringify(output);
}

/**
 * Build the `background-work` pipeline from the resolved router config.
 *
 * The board is constructed here rather than at module scope because its worker
 * takes the router's model resolver, and because the detached bindings it
 * stamps onto `board.drain` reach the flow through this pipeline being a route
 * — a board nobody composes declares nothing.
 */
/**
 * Session state this pipeline persists: which finished ledger rows it has
 * already announced.
 *
 * Exported, with {@link alreadyReportedTaskIds}, so a test can exercise the
 * REAL schema and the REAL read rule. The first version of that test mirrored
 * both locally, which meant dropping the legacy key from production left every
 * assertion passing — a test that cannot fail when the logic changes (CLAUDE.md
 * rule 5), pinning a duplicate-announcement bug it could not have caught.
 */
export const reportAcknowledgementSchema = z.object({
  reportedSideChainTaskIds: z.array(z.string()).default([]),
  /**
   * The pre-rename spelling of the key above, read-only.
   *
   * FIX-766 renamed the middle execution tier from `work` to `sideChain`,
   * and this key travelled with it as an ordinary identifier — which it is
   * NOT: it is a persisted session-state key, so a conversation that
   * started before the deploy holds its acknowledgements under the old
   * name. Reading only the new one would default to `[]` and re-announce
   * every job the user has already been told about.
   *
   * That is a third persisted surface. FIX-766 decision 2 accepted "no
   * shim" for exactly two — `provenance.phase` (a value nothing reads to
   * decide anything) and the block path (an identifier, where the alias
   * would have to land in every prefix comparison in the path grammar).
   * Neither argument covers this one: it IS read to decide something, and
   * dual-reading a flat state key is four lines. So it gets the shim
   * BP-030 asks for rather than an exemption argued from the other two.
   *
   * Never written. The union below is persisted under the new name on the
   * next acknowledgement, so a session converges after one report and this
   * key can be deleted once no live session predates the deploy.
   */
  reportedBackgroundTaskIds: z.array(z.string()).default([]),
});

/**
 * The rows this conversation has already told the user about, in EITHER
 * spelling.
 *
 * The union is the whole shim: a session that started before FIX-766 holds its
 * acknowledgements under `reportedBackgroundTaskIds`, and reading only the
 * current key would default to `[]` and re-announce every finished job. Never
 * written — the merged set is persisted under the current name on the next
 * acknowledgement, so a session converges after one report.
 */
export function alreadyReportedTaskIds(
  state: Partial<z.infer<typeof reportAcknowledgementSchema>> | undefined
): Set<string> {
  return new Set([
    ...(state?.reportedSideChainTaskIds ?? []),
    ...(state?.reportedBackgroundTaskIds ?? []),
  ]);
}

export function createBackgroundWorkPipeline(config: PipelineConfig) {
  const { modelId } = config;

  /**
   * The detached worker.
   *
   * Deliberately bare — no capabilities, no context bundle, no history. It runs
   * in a child session whose session state and conversation are not the parent's,
   * so anything it read from them would be empty rather than wrong, and a
   * detached worker may not declare `sessionStateSchema` at all (every detached
   * worker in a flow shares one child-session flow, where two routes choosing the
   * same key with different shapes would corrupt each other silently).
   */
  const briefWorker = generator({
    name: "background-brief",
    model: modelId,
    // The substrate's own worker-input shape, which is what `TaskWorker` is
    // typed against. `input.input` is `unknown` there by design — the board
    // carries heterogeneous payloads — so the parse below is reading an
    // untyped value, not re-checking a typed one.
    inputSchema: taskWorkerInputSchema,
    outputSchema: z.string(),
    prompt:
      "You are writing a short briefing that someone will read later, away from the " +
      "conversation that asked for it. Give the answer in at most six sentences, " +
      "plain markdown, no preamble and no offer to help further.",
    user: (input: TaskWorkerInput) => {
      const payload = briefRequestSchema.safeParse(input.input);
      return payload.success ? payload.data.request : input.goal;
    },
    // Without this a generator auto-emits nothing, and the child session's own
    // history would hold block traces and no answer. `history: true` because
    // these items ARE the child session's conversation — they never reach the
    // parent's, which is a different session.
    itemVisibility: { client: true, history: true },
  });

  const board = taskBoard({
    name: "background-work",
    boardId: BOARD_ID,
    collection: backgroundWorkLedger,
    // Not the default (`"skip"`), and deliberately. `onError` decides what a
    // worker failure does to the run executing it — and for a detached worker
    // that run is the **child session's**, not the drain's. Under `"skip"` a
    // worker that throws leaves the task `errored` while its child request
    // still completes, so the panel renders the row green while the next turn
    // reports the same work as failed: two surfaces disagreeing about one
    // event, which is the defect this demo is supposed to help people avoid.
    //
    // `"skip"` exists so one failing task does not abandon its siblings. This
    // board has a single worker and one task per turn, so there is no sibling
    // for a failure to be skipped in favour of — the policy buys nothing here
    // and costs the honest status.
    onError: "fail",
    workers: {
      // The seat is a dispatcher: it hands each row off to the flow's
      // `brief` task entry (`briefWorker`, declared below) instead of running
      // anything in the drain. Keyed on the task's `metadata.topic`: two
      // requests on one topic land in the same child session and continue its
      // history, which is the point of the topic (see `routingTopicFor`). A
      // row with no topic gets a child of its own.
      [ASSIGNEE]: dispatcher<TaskWorkerInput>({
        name: "background-work-hand-off",
        type: "task",
        target: ASSIGNEE,
        session: {
          key: (task) =>
            typeof task.metadata?.topic === "string" ? task.metadata.topic : task.taskId,
        },
      }),
    },
  });

  /** File this turn's message as a durable row for the board to hand off. */
  const fileSideChainTask = handler({
    name: "file-background-task",
    inputSchema: z.object({ message: z.string() }),
    uses: [board.capability],
    execute: async (input, ctx) => {
      const topic = routingTopicFor(input.message);
      await ctx.cap["background-work"].addTask({
        goal: input.message,
        // Display only. The full `topic` below is the routing identity.
        title: labelFor(topic),
        assignee: ASSIGNEE,
        input: { request: input.message },
        // `metadata.topic` is what the spawn seeds the child session's routing
        // with — the value hashed into the child session id. Full, never
        // truncated; see `routingTopicFor`.
        metadata: { topic },
      });
      ctx.emit.status(`Filed background work: ${labelFor(topic)}`);
    },
  });

  /**
   * The turn's reply: what was just filed, plus anything that has landed since.
   *
   * Reads the ledger rather than the drain's output, because the rows a
   * *previous* turn detached are the interesting ones — this turn's own row is
   * still `in_progress` by construction.
   */
  const reportBackgroundWork = handler({
    name: "report-background-work",
    inputSchema: z.object({ message: z.string() }),
    outputSchema: z.string(),
    // "Which rows this conversation has already told the user about" is
    // CONVERSATION state, not task state, and putting it in the right place is
    // what keeps it out of the transcript.
    //
    // It lived on the task's `metadata` first, written with `patchMetadata`.
    // That emits a client-visible `task-change` carrying the WHOLE row —
    // `output` included — which the parent's `<TaskPlan />` then rendered
    // inline. So the acknowledgement that a result had been delivered
    // *republished that result into the transcript*, beside the explicit "Back
    // from the background" message: precisely the folding-back-in this demo
    // exists to argue against. Nothing about a delivery belongs to the task,
    // and once it is held here the board publishes no completed row at all —
    // the settle happens in the child, whose stream is its own.
    sessionStateSchema: reportAcknowledgementSchema,
    uses: [board.capability],
    execute: async (input, ctx) => {
      // One ref for several reads — the accessor sugar re-hydrates the durable
      // collection per call, so `tasks()` once is the documented shape.
      const ledger = await ctx.cap["background-work"].tasks();
      const handles = await ledger.list();
      const alreadyReported = alreadyReportedTaskIds(ctx.session.state);
      const rows = handles.map(
        (task): ReportedTask => ({
          id: task.id,
          goal: task.goal,
          status: task.status,
          output: task.output,
          reported: alreadyReported.has(task.id),
        }),
      );

      // Terminal rows this conversation has ALREADY told the user about are not
      // news. The ledger is durable and `list()` returns all of it, so without
      // this every later turn re-reports every finished job and the reply grows
      // with the whole session's history. `== null` rather than a truthiness
      // check: a row filed before this marker existed has no key at all
      // (BP-030), and it is marked below after being reported once.
      const finished = rows.filter((row) => row.status === "completed" && !row.reported);
      const running = rows.filter(
        (row) => row.status === "pending" || row.status === "in_progress",
      );
      // A row that never reached a child session — the spawn was refused, or the
      // worker threw. Reported by name: saying "filed as background work" over
      // a row that failed inside this very turn is the one thing this reply
      // must not do.
      const broken = rows.filter(
        (row) =>
          (row.status === "errored" || row.status === "cancelled") && !row.reported,
      );

      // This turn's own row. Matched on goal and taken newest-first, because
      // asking the same question twice is a legitimate second row on the board.
      const filed = handles
        .filter((task) => task.goal === input.message)
        .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))[0];
      // A spawn refused at dispatch settles the row `errored` inside THIS turn.
      // Leading with "it runs in its own child session" over a row that never
      // reached one, and then appending "did not run" below, hands the user two
      // contradictory instructions in a single message.
      const filedFailed =
        filed !== undefined &&
        (filed.status === "errored" || filed.status === "cancelled");

      const label = labelFor(routingTopicFor(input.message));
      const parts = [
        filedFailed
          ? `**${label}** could not be handed to a child session — it was refused before it ` +
            `started (${filed.status}), so nothing is running for it. The Background work ` +
            `panel will not show a row for this one.`
          : // Deliberately does NOT invite another turn. "Ask me again in a
            // moment" is a status check, and a status check on this style is
            // not free: the next turn files ANOTHER job and drains again
            // before it reports, so checking on work creates work and bills a
            // model call for the privilege. The panel is the right surface —
            // it is the whole point that background work lives outside the
            // conversation — and finished work still arrives on the next real
            // reply on its own, which is stated as a fact rather than as an
            // instruction to go and trigger one.
            `Filed **${label}** as background work. It runs in its own ` +
            `child session, so this turn is done. Watch it in the Background work panel ` +
            `beside this conversation, which has its own refresh — and anything that has ` +
            `finished will come back with my next reply.`,
      ];

      if (running.length > 1) {
        parts.push(`Still running: ${running.length} items.`);
      }

      for (const row of finished) {
        parts.push(`---\n\n**Back from the background:** ${row.goal}\n\n${renderOutput(row.output)}`);
      }

      for (const row of broken) {
        // The just-filed row, when it failed, is already the lead. Saying it
        // again below the fold reads as two separate failures.
        if (filedFailed && row.id === filed.id) continue;
        parts.push(`---\n\n**Background work did not run:** ${row.goal} (${row.status}).`);
      }

      const reply = parts.join("\n\n");
      // Every other style ends in a generator, and a generator is what emits the
      // assistant message. This one answers without a model, so the message is
      // emitted here — otherwise the turn returns a string nothing renders.
      //
      // **Emit BEFORE marking, never after.** `reportedAtMs` is an
      // acknowledgement that the user has been told, so it must not become
      // durable until the telling has actually happened. Marking first and
      // emitting second means a `patchMetadata` that throws part-way leaves
      // earlier rows marked delivered while the reply never went out — those
      // results are then filtered from every later turn and the user never sees
      // work that completed fine. Silent and permanent. This way round the
      // worst case is a row marked late or not at all, which repeats a report
      // next turn: visible, harmless, and self-correcting.
      ctx.emit.message(reply);

      // Now record what was just delivered — one session-state write, after
      // the reply is out. Same ordering rule as before and for the same
      // reason: this is an acknowledgement that the user has been told, so it
      // must not become durable before the telling happened. Contained,
      // because the reply is already delivered and a failed write must not
      // fail the turn on top of it; the cost of losing it is a repeat report
      // next turn, which is visible and self-correcting.
      const delivered = [...finished, ...broken].map((row) => row.id);
      if (delivered.length > 0) {
        try {
          await ctx.session.patchState({
            reportedSideChainTaskIds: [...alreadyReported, ...delivered],
          });
        } catch {
          ctx.emit.status("Could not record what was reported; it may repeat.");
        }
      }

      return reply;
    },
  });

  const pipeline = sequencer({
    name: "background-work-thinking",
    inputSchema: z.object({ message: z.string() }),
    outputSchema: z.string(),
  })
    .tap(fileSideChainTask)
    // The drain claims the row, hands it to a child session, and returns with the
    // row still open. `.tap` keeps the turn's message as the running value so
    // the report below reads its own input rather than the drain's bookkeeping.
    .tap(board.drain)
    .step(reportBackgroundWork);

  // The task entry rides along so the flow can declare it under
  // `task: { actions }`: the block that runs in the child session for each row
  // the seat hands off. `defineFlow` puts it behind the board's claim gate,
  // and refuses the flow if the hand-off is reachable and the entry is not
  // declared. Cast: a registry is heterogeneous, so `TaskWorker` fixes its
  // output at `unknown` while this worker settles a `string` — the same
  // narrowing `task-queue-demo` takes.
  return Object.assign(pipeline, {
    taskEntries: { [ASSIGNEE]: { block: briefWorker as unknown as TaskWorker } },
  });
}
