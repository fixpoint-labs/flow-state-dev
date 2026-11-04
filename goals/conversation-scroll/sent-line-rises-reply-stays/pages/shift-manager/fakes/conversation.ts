/** A worker's conversation, read from the script. See `../shared.ts`. */
export * from "../../../lib/conversation";
import { useConversation, useOpen } from "../../script";
import { itemOf } from "../shared";

export function useWorkerConversation() {
  const open = useOpen();
  const conversation = useConversation(open);
  return {
    sessionId: open,
    opened: open,
    read: { items: conversation.lines.map(itemOf), truncated: false },
    failure: undefined,
    reread: () => undefined,
    resolving: false,
    ensure: async () => open,
  };
}
