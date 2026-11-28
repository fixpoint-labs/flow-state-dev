/**
 * Control `wrong-board`: the task frame's action row is built against board
 * id `"plan"` instead of the conversation's `"tasks"`.
 *
 * Built into the control page in place of `src/lib/inbox.ts`. Everything is
 * the real module; only `useBoardActions` binds the wrong board, so every
 * press goes to an action the lead's flow doesn't have. The goal must fail at
 * every action leg (release, cancel, retry), with the rows unchanged and the
 * refusal on the page.
 */
import { useMemo } from "react";
import { createInboxClient, type BoardActions } from "@flow-state-dev/orchestration/inbox";
import { useLab } from "../../../../packages/shift-manager/src/lib/lab-data.tsx";

export * from "../../../../packages/shift-manager/src/lib/inbox.ts";

export function useBoardActions(conversation: { id: string; flowId: string } | undefined): BoardActions | undefined {
  const { client } = useLab();
  const id = conversation?.id;
  const flowId = conversation?.flowId;
  return useMemo(
    () => (id === undefined || flowId === undefined ? undefined : createInboxClient(client).board({ flowId, sessionId: id, board: "plan" })),
    [client, id, flowId],
  );
}
