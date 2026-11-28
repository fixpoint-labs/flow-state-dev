import { useConversation } from "../app";
import { isFeedStale } from "../components/flow-state/connection-banner";

export { age, useNow } from "./now";

/** Whether a conversation's feed has lost the server, so what it last said may be out of date. */
export function useStale(sessionId: string | undefined): boolean {
  const connection = useConversation(sessionId)?.connection;
  return connection !== undefined && isFeedStale(connection);
}
