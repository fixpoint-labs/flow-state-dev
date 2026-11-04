/** A worker's conversation, read from the script. See `../shared.ts`. */
export * from "../../../lib/conversation";
import { useState } from "react";
import { script, useConversation, useOpen } from "../../script";
import { itemOf } from "../shared";

/** `?surface=first-send`: no conversation until the first line opens one, as a worker's first conversation. */
const first = new URLSearchParams(location.search).get("surface") === "first-send";

export function useWorkerConversation() {
  const open = useOpen();
  // As the real one: the session a first line opened, set by `ensure` before the line is sent into it.
  const [opened, setOpened] = useState<string | null>(null);
  const sessionId = first ? opened : open;
  const conversation = useConversation(sessionId ?? open);
  return {
    sessionId,
    opened: first ? opened : open,
    read: { items: sessionId === null ? [] : conversation.lines.map(itemOf), truncated: false },
    failure: undefined,
    reread: () => undefined,
    resolving: false,
    ensure: async () => {
      if (!first) return open;
      script.create("opened");
      setOpened("opened");
      return "opened";
    },
  };
}
