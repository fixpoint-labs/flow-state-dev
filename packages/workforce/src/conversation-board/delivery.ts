/**
 * How a session's board delivers each ending to the session that filed it
 * (FIX-2078): the conversation ledger's `delivery`, which orchestration's one
 * delivery runs around every ending's write.
 *
 * - **The pass** a wake runs in the filer's session is the board's run entry
 *   (`dispatch`): one pass at a time, which pays every debt and clears the
 *   wake (`./board`).
 * - **The notice** arrives on `onTaskSettled`, a routed task's too (FIX-2083).
 * - **Reaching the filer** from the running request: its own session; or,
 *   from a task session, the session that filed its task, on the flow the
 *   hand-over named at the task session's birth (`filingFlow`), both readonly
 *   server-written state; or, from a workstream's session, the project
 *   coordinator whose routed task it worked (FIX-2083): a workstream's record
 *   is a coordinator's, and only a coordinator files for one. From anywhere
 *   else the wake delivers, its flow read from the filer's own session record
 *   by the engine.
 * - **A row filed before `Task.filer`** (BP-030) is heard by the conversation
 *   its partition names.
 * - **A notice nobody can take** (the filer's session is gone) is said where
 *   its writer runs, and a final failure's report goes to the Error Reporter
 *   from there (epic decision (f)).
 * - **A midway question** (FIX-2241) is no ending and no notice: it reaches
 *   the filer as a message from the task's worker, sent by the running
 *   flow's `onMessageReceived` (`../messages/received-mark`).
 */
import type { BlockContext } from "@flow-state-dev/core/types";
import type { DeclaredDelivery, Task, TaskNotice } from "@flow-state-dev/orchestration/tasks";
import { COORDINATOR_FLOW } from "../coordinator/coordinator-keys";
import { FILING_FLOW_STATE_KEY, FILING_SESSION_STATE_KEY, WORKSTREAM_STATE_KEY } from "../workers/keys";
import { boardAboveOf } from "./board-above";
import { DISPATCH_ENTRY, TASK_SETTLED_ENTRY } from "./board-entries";
import { sessionIdOfFiling } from "./filing-session";
import { sendTaskReport } from "./report-owed";
import { midwayQuestionTellerOf } from "../messages/received-mark";

/** The conversation ledger's delivery. `ledgerId` is the board id its notices name. */
export function conversationDelivery(ledgerId: string): DeclaredDelivery {
  return {
    passEntry: DISPATCH_ENTRY,
    noticeEntry: () => TASK_SETTLED_ENTRY,
    address: (ctx, filer) => {
      if (filer === ctx.session.identity.id) return { session: { id: filer } };
      const state = (ctx.session.state ?? {}) as Record<string, unknown>;
      const filing = state[FILING_SESSION_STATE_KEY];
      const flow = state[FILING_FLOW_STATE_KEY];
      if (typeof filing === "string" && typeof flow === "string" && sessionIdOfFiling(filing) === filer) {
        return { session: { id: filer }, flowKind: flow };
      }
      // A workstream's session works no filer's tasks but the routed ones its
      // records' coordinators file for it.
      if (typeof state[WORKSTREAM_STATE_KEY] === "string" && typeof filing !== "string") {
        return { session: { id: filer }, flowKind: COORDINATOR_FLOW };
      }
      return undefined;
    },
    legacyFiler: (_row, partition) => (partition === undefined ? undefined : sessionIdOfFiling(partition)),
    // A task's question, told to its filer as a message (FIX-2241), by the
    // running flow's own `onMessageReceived`, which knows its installation.
    onMidwayQuestion: async (ctx, row, holds) => {
      const tell = midwayQuestionTellerOf((ctx as { readonly flow?: unknown }).flow);
      if (tell === undefined) {
        console.warn("[workforce] a task's midway question has no worker to tell: its flow hears no messages, so it is in the Inbox only", { taskId: row.id });
        return;
      }
      await tell(ctx, row, holds);
    },
    onUndeliverable: async (ctx: BlockContext, row: Task, notice: TaskNotice, detail: string) => {
      // The task's ending stands; the conversation that filed it can't be told.
      ctx.emit.message(`The conversation that filed task "${row.title ?? row.goal}" couldn't be told it ${notice.ending}: ${detail}`);
      // The board the task is on: the conversation this session was opened
      // for, or, in a workstream's session, the one whose routed task it works.
      const partition = boardAboveOf(ctx);
      if (notice.ending === "errored" && partition !== undefined) {
        await sendTaskReport(
          ctx,
          row,
          { attempt: notice.attempt, error: notice.error ?? "" },
          { boardId: ledgerId, partition },
          "conversation-board-undeliverable"
        );
      }
    }
  };
}
