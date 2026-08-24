/**
 * POC CODE ON A NEVER-MERGED BRANCH (`spec/FIX-1230`, epic FIX-1197). Throwaway.
 *
 * The reply carrier, alone in its own file **so it can be type-checked**:
 *
 *     node_modules/.bin/tsc -p spec-poc/FIX-1230-relay-core
 *
 * Why it earned a file. Four times running, this item was written as a hand-shaped
 * object literal and four times it was invalid — and every one of them passed at
 * runtime, because `response.emit` takes `unknown` and `isOutputItem`
 * (`response-emitter.ts:142-151`) checks only `id`, `type` and `itemIndex`, a guard
 * strictly shallower than the type:
 *
 *   v1  not an item event at all — a raw stream event; woke nobody, silently.
 *   v2  an invented `payload` field, no `role`, no `content`.
 *   v3  role + content, but missing `OutputItemBase`'s `requestId`, `provenance`, `ts`.
 *   v4  (this one) annotated `MessageItem`, so `tsc` rejects a missing field.
 *
 * The type is the only check in that list that could have caught any of the three
 * before it. Note it caught v3 *here*: with `provenance` and `ts` removed this file
 * fails with "not assignable to type 'MessageItem'", which is how the check was
 * verified able to fire rather than merely reported green (tenet 7).
 */
import type { MessageItem } from "@flow-state-dev/core/items";

/**
 * Build the item a relay reply rides on.
 *
 * `itemVisibility` is explicit and load-bearing on BOTH axes, and it is
 * `{ client: false, history: false }` — the contract the spec states (§7's
 * visibility grid). `message` is a *conversational* type, so an absent stamp
 * resolves to `{ client: true, history: true }`
 * (`contracts/src/items/resolve-visibility.ts:23-26`, `:36`, `:43-45`).
 *
 * `history: false` because the serialized correlation envelope would otherwise
 * be replayed into a later generator turn as a fake USER utterance — the sender
 * reading its own answer twice, once as the tool result it awaited and once as
 * invented history.
 *
 * `client: false` because this is an internal correlation envelope and not
 * something a UI should render; the same payload reaches the caller through the
 * normal tool result. **An earlier version of this file stamped `client: true`
 * and the README called that setting load-bearing** — so the executable evidence
 * reviewers are pointed at contradicted the contract it exists to support, and
 * an implementer following the runnable thing would have built the opposite.
 * That is this POC's own recurring lesson arriving as a defect: cite an artifact
 * only for the assertion it was built to make, and keep the artifact honest
 * about the rest.
 *
 * A structural carrier would get both defaults right and need no stamp, which is
 * what the spec asks the real implementation to prefer; this POC keeps `message`
 * and stamps it so the failure mode stays visible in one place.
 */
export function buildReplyItem(args: {
  correlationId: string;
  waitingRequestId: string;
  itemIndex: number;
  payload: unknown;
}): MessageItem {
  return {
    id: `relay_reply_${args.correlationId}`,
    type: "message",
    status: "completed",
    requestId: args.waitingRequestId,
    itemIndex: args.itemIndex,
    provenance: {
      blockName: "relay.replyMessage",
      blockInstanceId: "poc",
      phase: "main"
    },
    ts: Date.now(),
    itemVisibility: { client: false, history: false },
    role: "user",
    content: [
      {
        type: "output_text",
        text: JSON.stringify({ correlationId: args.correlationId, payload: args.payload })
      }
    ]
  };
}
