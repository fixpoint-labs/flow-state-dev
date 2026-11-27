// FIX-2725.
/**
 * Which requests of a worker's session are its turns: the actions that run
 * the session's turn block. The door (`respond`), a settled task's turn
 * (`onTaskSettled`), a worker's message (`onMessageReceived`) and the
 * coordinator's later rounds (`routeOn`). The worker sessions view reads it
 * for "a turn runs", the session turns view for which requests it shows. An
 * entry that runs a turn joins it in the same change.
 */
import { RESPOND_ACTION } from "../worker-door";
import { TASK_SETTLED_ENTRY } from "../conversation-board/board-entries";
import { MESSAGE_RECEIVED_ENTRY } from "../messages/keys";
import { ROUTE_ON_ACTION } from "../coordinator/coordinator-keys";

/** The actions that run a worker session's turn block. */
export const TURN_ACTIONS: readonly string[] = [RESPOND_ACTION, TASK_SETTLED_ENTRY, MESSAGE_RECEIVED_ENTRY, ROUTE_ON_ACTION] as const;
