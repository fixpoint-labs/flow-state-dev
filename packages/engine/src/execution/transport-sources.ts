/**
 * Transport sources stamped by the runtime, in one place (FIX-999), and the
 * rule that turns a source into a dispatch type.
 *
 * Importing these from `transports/*` would create an `execution → transports`
 * cycle, which is why they had been re-declared locally per consumer. This
 * module imports nothing from the engine, so depending on it cannot create a
 * cycle in either direction, and every runtime-stamped source lives here.
 *
 * A source is trusted precisely because a caller cannot set it: it is stamped by
 * the adapter (or, for the framework-stamped sources below, by the seam that
 * dispatches) and persisted on the request record. Every authorization branch
 * that reads one depends on that (BP-031).
 */
import type { DispatchType } from "@flow-state-dev/core/types";

/** Stamped by the webhook adapter. Resolves a `webhook` entry. */
export const WEBHOOK_SOURCE = "webhook";

/** Stamped by the scheduled adapter. Resolves a `schedule` entry. */
export const SCHEDULED_SOURCE = "scheduled";

/**
 * Stamped by the dispatch seam on a task hand-off — a board drain handing a
 * claimed row to `flow.task.actions[name]` in a child session. Deliberately
 * absent from the public re-entry allow-list and present in its never-set: a
 * task request has no caller-facing entry, so it must have no caller-facing
 * re-entry.
 */
export const TASK_SOURCE = "task";

/**
 * Stamped by the dispatch seam on an internal dispatch — a `dispatcher()` block
 * in a running request sending to `flow.internal.actions[name]`. Same re-entry
 * posture as {@link TASK_SOURCE}, for the same reason.
 */
export const INTERNAL_SOURCE = "internal";

/**
 * Stamped by the removed chat adapter (FIX-1330). Kept only so a request that
 * was recorded or queued before the removal — a durable request row, a BullMQ
 * job enqueued by a pre-upgrade process — still fails closed: its `action` was
 * the chat handler block's name, provenance only, and letting the source fall
 * through to `public` would resolve a same-named caller action instead. No
 * adapter stamps this source any more, so nothing new can carry it.
 */
const REMOVED_CHAT_SOURCE = "chat";

/**
 * The dispatch type a source delivers. **A dispatch's type is decided by which
 * door it came through**, never by anything in its body — which is what makes
 * the entry map a caller cannot pick a boundary. Every caller-facing transport
 * (`http`, `mcp`, `voice`, a custom adapter's own source) delivers `public`
 * dispatches; the four framework-stamped sources each deliver their own type.
 * The removed chat source delivers nothing (`undefined`), so a dispatch that
 * still carries it is refused rather than retyped as a caller's.
 */
export function dispatchTypeOf(source: string | undefined): DispatchType | undefined {
  switch (source) {
    case REMOVED_CHAT_SOURCE:
      return undefined;
    case WEBHOOK_SOURCE:
      return "webhook";
    case SCHEDULED_SOURCE:
      return "schedule";
    case TASK_SOURCE:
      return "task";
    case INTERNAL_SOURCE:
      return "internal";
    default:
      return "public";
  }
}
