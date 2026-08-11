/**
 * Background-work pipeline — the turn files the work and returns.
 *
 * Every other thinking style answers inside the turn. This one does not: it
 * writes the request onto a durable board and hands it to a **Workstream** — a
 * child session that outlives the request that started it — then replies and
 * ends the turn while the work is still going. The reply a later turn gives is
 * where the result shows up.
 *
 * ## The three declarations that make the hand-off legal
 *
 * - **`backgroundWorkLedger` is resource-backed.** A detached worker's row
 *   outlives the claiming request, so the board refuses anything but a durable
 *   collection at construction.
 * - **`sharedToWorkstream: true`.** The ledger is session-scoped, and a
 *   Workstream is a different session — without this it would hydrate empty
 *   inside the child and the child could not settle the row it was dispatched
 *   for. The flag resolves a session-scoped resource against the lineage root,
 *   so the conversation and every Workstream under it address one ledger.
 * - **An explicit `boardId`.** It is hashed into the child session's id, so it
 *   has to be stable and deliberate rather than an incidental string.
 *
 * ## What this pipeline can and cannot show you
 *
 * The parent's view of the ledger is the one it hydrated when the request
 * started, and it never observes the Workstream's write. So {@link
 * reportBackgroundWork} reports the *just-filed* row as running no matter how
 * fast the child is, and results appear on the next turn. Polling for
 * completion inside one turn would wait forever; the shape here is the one that
 * works.
 *
 * A detached generator also streams no in-flight text — a reader attaching to
 * the Workstream sees completed items, not tokens arriving.
 */
import { generator, handler, sequencer } from "@flow-state-dev/core";
import { defineTaskCollection } from "@flow-state-dev/orchestration/tasks";
import { taskBoard, taskWorkerInputSchema } from "@flow-state-dev/orchestration/task-board";
import type { TaskWorker, TaskWorkerInput } from "@flow-state-dev/orchestration/tasks";
import { z } from "zod";
import type { PipelineConfig } from "./config";

/** Stable board id. Hashed into every Workstream this board starts — renaming it re-keys live ones. */
const BOARD_ID = "kitchen-sink-background-work";

/** The one assignee this board routes to, and the coordinate its Workstreams are addressed by. */
const ASSIGNEE = "brief";

/** Longest display label we render for a filed row. Never used for routing. */
const LABEL_MAX_LENGTH = 60;

/** What a filed request carries to its worker. */
const briefRequestSchema = z.object({ request: z.string() });

/**
 * The durable ledger the conversation and its Workstreams share.
 *
 * Exported so the board's rows are addressable from a test or a debug read
 * without rebuilding the declaration — `taskBoard` binds this exact object.
 */
export const backgroundWorkLedger = defineTaskCollection({
  id: "background-work",
  scope: "session",
  sharedToWorkstream: true,
  stateSchema: briefRequestSchema,
});

/**
 * The Workstream's `topic` — a **routing identity**, not a label.
 *
 * Whitespace-normalized and otherwise complete. `deriveChildSessionId` hashes
 * this together with the board's routing key, so it is the value that decides
 * which child session a task lands in. Two turns asking the same thing land on
 * the same Workstream and continue its history, which is the substrate's
 * adoption path rather than an accident.
 *
 * **Never truncate this.** It used to be cut to 60 characters and reused as the
 * display label, which meant two different prompts sharing their first 59
 * characters derived the *same* Workstream and the panel showed one row mixing
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
export function createBackgroundWorkPipeline(config: PipelineConfig) {
  const { modelId } = config;

  /**
   * The detached worker.
   *
   * Deliberately bare — no capabilities, no context bundle, no history. It runs
   * in a Workstream whose session state and conversation are not the parent's,
   * so anything it read from them would be empty rather than wrong, and a
   * detached worker may not declare `sessionStateSchema` at all (every detached
   * worker in a flow shares one Workstream flow, where two routes choosing the
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
    // Without this a generator auto-emits nothing, and the Workstream's own
    // history would hold block traces and no answer. `history: true` because
    // these items ARE the Workstream's conversation — they never reach the
    // parent's, which is a different session.
    itemVisibility: { client: true, history: true },
  });

  const board = taskBoard({
    name: "background-work",
    boardId: BOARD_ID,
    collection: backgroundWorkLedger,
    workers: {
      // Cast: a registry is heterogeneous, so `TaskWorker` fixes its output at
      // `unknown` while this worker settles a `string`. The board only ever
      // reads `task.output` as `unknown`, so the runtime contract holds — the
      // same narrowing `task-queue-demo` takes on its registry.
      [ASSIGNEE]: {
        worker: briefWorker as unknown as TaskWorker,
        dispatch: { mode: "detached" },
      },
    },
  });

  /** File this turn's message as a durable row for the board to hand off. */
  const fileBackgroundTask = handler({
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
        // `metadata.topic` is what the spawn seeds the Workstream's routing
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
    uses: [board.capability],
    execute: async (input, ctx) => {
      // One ref, several reads and a write per delivered row — the accessor
      // sugar re-hydrates the durable collection per call, so `tasks()` once is
      // the documented shape for this.
      const board = await ctx.cap["background-work"].tasks();
      const handles = await board.list();
      const rows = handles.map(
        (task): ReportedTask => ({
          id: task.id,
          goal: task.goal,
          status: task.status,
          output: task.output,
          reported: task.metadata?.["reportedAtMs"] != null,
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
      // A row that never reached a Workstream — the spawn was refused, or the
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
      // Leading with "it runs in its own workstream" over a row that never
      // reached one, and then appending "did not run" below, hands the user two
      // contradictory instructions in a single message.
      const filedFailed =
        filed !== undefined &&
        (filed.status === "errored" || filed.status === "cancelled");

      const label = labelFor(routingTopicFor(input.message));
      const parts = [
        filedFailed
          ? `**${label}** could not be handed to a workstream — it was refused before it ` +
            `started (${filed.status}), so nothing is running for it. The Background work ` +
            `panel will not show a row for this one.`
          : `Filed **${label}** as background work. It runs in its own ` +
            `workstream, so this turn is done — open the Background work panel to watch it, ` +
            `or ask me again in a moment and I'll report what came back.`,
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

      // Now record what was just delivered. Only the rows actually in the reply.
      // `patchMetadata` merges, so the row's `topic` survives.
      //
      // Contained per row, and deliberately: the reply is already out, so a
      // failed marking must not fail the turn on top of it. An unmarked row is
      // reported again next turn — the benign, self-correcting failure this
      // ordering exists to prefer. Containing it per row also stops one bad
      // write from stranding the rows behind it in the same loop.
      for (const row of [...finished, ...broken]) {
        try {
          await board.patchMetadata(row.id, { reportedAtMs: Date.now() });
        } catch {
          ctx.emit.status(`Could not mark "${row.goal}" as reported; it may repeat.`);
        }
      }

      return reply;
    },
  });

  return sequencer({
    name: "background-work-thinking",
    inputSchema: z.object({ message: z.string() }),
    outputSchema: z.string(),
  })
    .tap(fileBackgroundTask)
    // The drain claims the row, hands it to a Workstream, and returns with the
    // row still open. `.tap` keeps the turn's message as the running value so
    // the report below reads its own input rather than the drain's bookkeeping.
    .tap(board.drain)
    .step(reportBackgroundWork);
}
