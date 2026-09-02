/**
 * Resolve the entry a dispatched request runs.
 *
 * The engine's half of addressing: the envelope's trusted `source` decides the
 * message type (`transport-sources.ts`), the adapter's namespaced metadata slot
 * carries the protocol coordinate for `chat` / `webhook` / `schedule`, and
 * `core`'s `resolveEntry` reads exactly one map with no fallback. See
 * `packages/core/src/flow/resolve-entry.ts` for the rule and why the fallback
 * is gone.
 *
 * Security: `source` is set only by adapters and the dispatch seam, never from
 * a request body, whereas `metadata` on a caller-addressed dispatch is
 * attacker-controlled (the HTTP action endpoint spreads `body.metadata`).
 * Because the type comes from the source and the coordinate is read only for
 * the type it belongs to, a caller POSTing `{ metadata: { chat: { eventKey } } }`
 * to the public action endpoint still resolves a `user` entry by name — it
 * cannot pivot into a chat, webhook, schedule, task or internal handler.
 *
 * The one path with no static coordinate is the dynamic schedule, whose core
 * is produced at dispatch time by a resolver. That case is handled upstream by
 * a carried core on the dispatch envelope (`resolvedActionCore`), not here —
 * see `runAction`'s `resolveAction`.
 */
import { resolveEntry as resolveTypedEntry, type EntryCoordinate, type EntryMaps } from "@flow-state-dev/core";
import { messageTypeOf } from "./transport-sources";

/**
 * Find the entry for a dispatch, or `undefined` when its type's map declares
 * none. Callers decide whether that is a hard error (initial dispatch) or a
 * tolerable absence (optional prefetch / token-budget reads).
 */
export function resolveEntry<TEntry>(
  flow: EntryMaps<TEntry>,
  actionName: string,
  source: string | undefined,
  metadata: unknown
): TEntry | undefined {
  return resolveTypedEntry(
    flow,
    messageTypeOf(source),
    actionName,
    metadata as EntryCoordinate | undefined
  );
}
