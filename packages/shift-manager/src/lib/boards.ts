/**
 * A conversation's board: where its rows live, and how a task route and a
 * row name it. A row's shape is workforce's own (`BoardTask`), the one mapper
 * the Inbox view reads tasks through too.
 */
export type { BoardTask as BoardTaskView } from "@flow-state-dev/workforce/browser";

/**
 * The collection every conversation's board keeps its rows in: Workforce's
 * conversation ledger (`CONVERSATION_LEDGER_ID`), which its browser entry
 * doesn't export. `static.test.ts` pins the two together.
 */
export const CONVERSATION_BOARD_COLLECTION = "tasks";

/**
 * A conversation board's ref: `<sessionId>.tasks`, so a task route and a row
 * name their board one way.
 */
export function conversationBoardRef(sessionId: string): string {
  return `${sessionId}.${CONVERSATION_BOARD_COLLECTION}`;
}

/**
 * The collection a board's tasks are stamped with on their runs' items (the
 * `collectionId` of each `task-change`): for a conversation's board, the one
 * collection every conversation shares; any other ref names its own.
 */
export function collectionOfBoard(boardRef: string): string {
  return boardRef.endsWith(`.${CONVERSATION_BOARD_COLLECTION}`) ? CONVERSATION_BOARD_COLLECTION : boardRef;
}
