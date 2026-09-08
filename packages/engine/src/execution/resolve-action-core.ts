/**
 * Resolve the action core to execute for a dispatched request.
 *
 * Every arrival is a dispatch of one type, delivered to one entry addressed by
 * `(type, name)`, and all of them share `ActionCore` (the handler block plus
 * execution policy), so the runtime runs them identically — it only needs to
 * find the right one. The envelope's trusted `source` decides the type; the
 * type's own map is the only one read (`resolve-entry.ts`):
 *
 * - `public` — a caller-addressed `ActionConfig` in `flow.actions` (HTTP / MCP),
 *   named by the caller and authorized per principal;
 * - `internal` / `task` — `flow.internal.actions[name]` / `flow.task.actions[name]`,
 *   dispatched by the seam from inside a running request;
 * - `webhook` / `chat` / `schedule` — the binding carried inline on its transport
 *   map, selected by the adapter's coordinate in the namespaced metadata slot
 *   (`metadata.webhook` / `metadata.chat` / `metadata.schedule`) and trusted at
 *   the transport boundary.
 *
 * **No fallback, for any type.** An earlier shape let an event whose coordinate
 * did not match fall through to `flow.actions[name]`, and made the detached
 * source the one terminal exception. A dispatch's name is provenance for every
 * type but `public`, so a fall-through hands a framework-stamped dispatch a
 * caller-addressed handler whose key happens to collide. Every branch is now
 * terminal: an absent entry returns `undefined`, which the caller turns into a
 * named refusal.
 *
 * Security: each branch is gated on the source, and sources are set only by the
 * adapters and the seam, never from a request body — whereas `metadata` on a
 * caller-addressed dispatch (the HTTP action endpoint spreads `body.metadata`)
 * is attacker-controlled. Without the source gate, a caller could POST
 * `{ metadata: { chat: { eventKey } } }` to the public action endpoint and
 * pivot resolution into an event handler, running it with forged input and no
 * transport authentication.
 *
 * The one path with no static coordinate is the dynamic schedule, whose core
 * is produced at dispatch time by a resolver and cannot be reached from
 * `flow.schedules.static`. That case is handled upstream by a carried core on
 * the dispatch envelope (`resolvedActionCore`), not here — see `runAction`'s
 * `resolveAction`.
 */
import type { ActionCore, FlowInstance } from "@flow-state-dev/core/types";
import { resolveEntry } from "./resolve-entry";

/**
 * Find the `ActionCore` for a dispatch, or `undefined` when its type's map
 * declares none — callers decide whether that is a hard error (initial
 * dispatch) or a tolerable absence (optional prefetch / token-budget reads).
 */
export function resolveActionCore(
  flow: FlowInstance,
  actionName: string,
  source: string | undefined,
  metadata: unknown
): ActionCore | undefined {

  return resolveEntry<ActionCore>(flow, actionName, source, metadata);
}
