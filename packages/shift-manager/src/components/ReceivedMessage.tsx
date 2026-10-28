/**
 * A message another worker sent this one (`workforce:received`, FIX-2238):
 * drawn as a line under its sender's name, with the time it landed and a link
 * to Messages, a note when it answers a message of this worker's, and a mark
 * when it is a call, whose sender waits for this worker's reply (FIX-2239). The
 * item is the message's own: the line the worker's model reads is history
 * only and never reaches the page.
 */
import type { ComponentItem } from "@flow-state-dev/core/items";
import { workerLabel } from "../lib/derive";
import { navigate } from "../lib/routes";
import { clockTime } from "../lib/shell";

type Received = { id?: string; from?: string; text?: string; inReplyTo?: string; call?: boolean };

export function ReceivedMessage({ item }: { item: ComponentItem }) {
  const data = (item.data ?? {}) as Received;
  const from = data.from ?? "";
  // An item stored before calls existed has no flag: it was a plain message.
  const call = data.call === true;
  return (
    <div data-testid="received-message" data-message-id={data.id ?? ""} data-from={from} data-call={String(call)}>
      <p className="mb-2.5 flex items-baseline gap-2 font-mono text-[10.5px] font-medium tracking-[0.12em] text-muted-foreground" data-look="message-label">
        {workerLabel(from).toUpperCase()}
        <span className="tracking-normal" data-look="message-time">
          {clockTime(item.ts)}
        </span>
        {data.inReplyTo === undefined ? null : (
          <span className="tracking-normal normal-case" data-testid="received-message-answers">
            answering your message
          </span>
        )}
        {call ? (
          <span className="tracking-normal normal-case" data-testid="received-message-call">
            call · the reply goes back
          </span>
        ) : null}
        <button
          type="button"
          className="tracking-normal normal-case hover:text-foreground hover:underline"
          onClick={() => navigate({ level: "messages" })}
          data-testid="received-message-messages"
        >
          Messages ›
        </button>
      </p>
      <p className="whitespace-pre-wrap text-sm" data-look="received-message-text">
        {data.text ?? ""}
      </p>
    </div>
  );
}
