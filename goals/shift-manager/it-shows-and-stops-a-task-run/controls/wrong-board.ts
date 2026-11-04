/**
 * Control `wrong-board`: the task frame's action row is built against board
 * id `"plan"` instead of the conversation's `"tasks"`.
 *
 * Built into the control page in place of `src/lib/reads.ts`. Everything the
 * reader reads is the real one; only `taskActions` binds the wrong board, so
 * every press goes to an action the lead's flow doesn't have. The goal must
 * fail at every action leg (release, cancel, retry), with the rows unchanged
 * and the refusal on the page.
 */
import { createInboxClient } from "@flow-state-dev/orchestration/inbox";
import type { Client } from "@flow-state-dev/client";
import { createLabReader as realLabReader, type LabReader } from "../../../../packages/shift-manager/src/lib/reads.ts";

export * from "../../../../packages/shift-manager/src/lib/reads.ts";

export function createLabReader(client: Client): LabReader {
  const inbox = createInboxClient(client);
  return { ...realLabReader(client), taskActions: (conversation) => inbox.board({ flowId: conversation.flowId, sessionId: conversation.id, board: "plan" }) };
}
