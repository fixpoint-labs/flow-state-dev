/**
 * A session record as the session routes send it to a client.
 *
 * Scope state is private by default: a client sees a state field only when
 * the owning flow names it in `session.client.expose` (BP-015), or declares
 * it readonly. A readonly field is the session's identity, set at create and
 * already published as a listing filter (`?state.<field>=`), so a client that
 * finds a session by it can also read it back.
 *
 * The session read, the listing, and the create and metadata-edit responses
 * all answer with the session record, so all four send it through here rather
 * than spreading the stored record onto the wire.
 *
 * Server-side code that needs the whole record reads the session store; there
 * is no request flag that widens this view (BP-031).
 */
import type { JsonObject } from "@flow-state-dev/core/types";
import { getReadonlyStateKeys } from "@flow-state-dev/core/helpers";
import type { FlowRegistry } from "../registry/flow-registry";
import type { SessionRecord } from "../stores/types";
import { resolveRecordOwner } from "../context/record-owner";

/**
 * The session record minus what never leaves the server: its `journal` and its
 * stored `resources`. `state` holds only the visible fields.
 */
export type ClientSessionRecord = Omit<SessionRecord, "journal" | "resources">;

/**
 * Project a stored session for a client.
 *
 * `state` keeps only the fields the owning flow exposes or declares readonly.
 * A record whose owner this process cannot resolve has no declarations to
 * honour, so it sends an empty state rather than the stored one. `id` is replaced by the bare id the caller
 * addressed (the stored id is the tenant-namespaced storage key).
 *
 * @param registry  The flows this process runs, to find the record's owner.
 * @param record    The stored session.
 * @param bareId    The session id as the caller knows it.
 */
export function toClientSession(
  registry: Pick<FlowRegistry, "get" | "list">,
  record: SessionRecord,
  bareId: string
): ClientSessionRecord {
  const { journal: _journal, resources: _resources, state, ...envelope } = record;
  const owner = resolveRecordOwner(registry, record);
  const visible = owner.ok
    ? [
        ...(owner.flow.session?.client?.expose ?? []),
        ...getReadonlyStateKeys(owner.flow.session?.stateSchema)
      ]
    : [];
  return { ...envelope, id: bareId, state: visibleState(state, visible) };
}

/** The visible fields of `state` that it holds. Absent or legacy state is empty (BP-030). */
function visibleState(state: JsonObject | undefined, visible: ReadonlyArray<string>): JsonObject {
  const out: JsonObject = {};
  if (state == null) return out;
  for (const name of visible) {
    if (Object.prototype.hasOwnProperty.call(state, name)) out[name] = state[name]!;
  }
  return out;
}
