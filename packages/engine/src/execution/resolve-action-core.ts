/**
 * Resolve the action core to execute for a dispatched request.
 *
 * An action comes in forms that share `ActionCore` (the handler block plus
 * execution policy), so the runtime runs them identically — it only needs to
 * find the right one:
 *
 * - a caller-addressed `ActionConfig` in `flow.actions` (HTTP / MCP), named by
 *   the caller and authorized per principal;
 * - an event-addressed binding carried inline on its transport map, selected by
 *   an event coordinate and trusted at the transport boundary:
 *   - webhook: `flow.webhooks[provider].on[event]`, keyed by `(provider, eventType)`;
 *   - chat: `flow.chat.on[eventKey]`, keyed by the matched subscription key;
 *   - scheduled (static): `flow.schedules.static[scheduleId]`, keyed by the id.
 *   - relay: `flow.relay.on[kind]` or `flow.actions[kind]`, selected by the door
 *     the SEND already decided and stamped on `metadata.relay`. Terminal for its
 *     source, like the detached dispatch below.
 *
 * An event dispatch carries its coordinate in a namespaced metadata slot
 * (`metadata.webhook` / `metadata.chat` / `metadata.schedule`), stamped by the
 * adapter and persisted on the request record so recovery can re-resolve it.
 * When present, resolution reads the matching transport map; otherwise it falls
 * back to the named action. This is the single seam that lets an event handler
 * be a first-class action without ever appearing in `flow.actions`.
 *
 * Security: each event branch is gated on its internal-only `source`
 * (`"webhook"` / `"chat"` / `"scheduled"`). Those sources are set only by the
 * adapters, never from a request body — whereas `metadata` on a caller-addressed
 * dispatch (the HTTP action endpoint spreads `body.metadata`) is
 * attacker-controlled. Without the source gate, a caller could POST
 * `{ metadata: { chat: { eventKey } } }` to the public action endpoint and
 * pivot resolution into an event handler, running it with forged input and no
 * transport authentication. The gate closes that pivot for every
 * caller-addressed surface at once, independent of which route forwards caller
 * metadata.
 *
 * The one event path with no static coordinate is the dynamic schedule, whose
 * core is produced at dispatch time by a resolver and cannot be reached from
 * `flow.schedules.static`. That case is handled upstream by a carried core on
 * the dispatch envelope (`resolvedActionCore`), not here — see
 * `runAction`'s `resolveAction`.
 */
import type { ActionCore, FlowInstance } from "@flow-state-dev/core/types";
import { readRelayStamp } from "./relay-metadata";
import {
  CHAT_SOURCE,
  RELAY_SOURCE,
  SCHEDULED_SOURCE,
  WEBHOOK_SOURCE,
  WORKSTREAM_SOURCE
} from "./transport-sources";

type WebhookDispatchMetadata = {
  webhook?: { provider?: string; eventType?: string | null };
};

type ChatDispatchMetadata = {
  chat?: { eventKey?: string };
};

type ScheduleDispatchMetadata = {
  schedule?: { scheduleId?: string };
};

/**
 * Find the `ActionCore` for a dispatch. An event binding is resolved only for a
 * genuine dispatch from its own transport (`source === "webhook" | "chat" |
 * "scheduled"`); every other source resolves the named `flow.actions` entry, so
 * a caller cannot reach an event handler by injecting `metadata.<transport>`.
 * Returns `undefined` when neither an event binding nor a named action matches —
 * callers decide whether that is a hard error (initial dispatch) or a tolerable
 * absence (optional prefetch / token-budget reads).
 */
export function resolveActionCore(
  flow: FlowInstance,
  actionName: string,
  source: string | undefined,
  metadata: unknown
): ActionCore | undefined {
  if (source === WEBHOOK_SOURCE) {
    const webhook = (metadata as WebhookDispatchMetadata | undefined)?.webhook;
    if (
      webhook !== undefined &&
      typeof webhook.provider === "string" &&
      typeof webhook.eventType === "string"
    ) {
      const binding = flow.webhooks?.[webhook.provider]?.on?.[webhook.eventType];
      if (binding !== undefined) return binding;
    }
  }

  if (source === CHAT_SOURCE) {
    const eventKey = (metadata as ChatDispatchMetadata | undefined)?.chat?.eventKey;
    if (typeof eventKey === "string") {
      const binding = flow.chat?.on?.[eventKey];
      if (binding !== undefined) return binding;
    }
  }

  if (source === SCHEDULED_SOURCE) {
    const scheduleId = (metadata as ScheduleDispatchMetadata | undefined)?.schedule?.scheduleId;
    if (typeof scheduleId === "string") {
      const binding = flow.schedules?.static?.[scheduleId];
      if (binding !== undefined) return binding;
    }
  }

  // Detached dispatch (FIX-999). TERMINAL for this source — note the `return`
  // rather than the `if (binding !== undefined) return` shape the event branches
  // above use. Those may fall through because an event whose coordinate does not
  // match should still be able to resolve a named action; a detached dispatch
  // must not. It carries `actionName` as provenance only, and that name can
  // collide with a public `flow.actions` key, so falling through here would hand
  // a framework-stamped dispatch a caller-addressed handler — the seam's own
  // source admitting everything. An absent core returns `undefined`, which the
  // caller turns into a named refusal.
  if (source === WORKSTREAM_SOURCE) {
    return flow.workstream;
  }

  // Relay delivery (FIX-1230). TERMINAL for this source, for the same reason the
  // detached branch above is: `actionName` is provenance, and the routing answer
  // is the stamp. Falling through would hand a framework-stamped dispatch a
  // caller-addressed handler the door never approved.
  //
  // The door is NOT decided here. It was decided once at the `sendMessage` verb,
  // from the sender's and recipient's session kinds — neither of which exists at
  // this point in the run, since resolution happens before the recipient's
  // session record is loaded and the sender's kind never crosses the dispatch
  // boundary at all. So this honours the stamped answer rather than recomputing
  // a second one, and `readRelayStamp` is what makes reading it safe: the
  // coordinate is the caller's own bag, and only the seam-stamped `source` says
  // the runtime put it there.
  if (source === RELAY_SOURCE) {
    const relay = readRelayStamp(source, metadata);
    if (relay === undefined) return undefined;
    return relay.door === "declared"
      ? flow.relay?.on?.[relay.kind]
      : flow.actions[relay.kind];
  }

  return flow.actions[actionName];
}
