/**
 * The boot step that lets a store written under another organization open its
 * channels under this app's one organization.
 *
 * **Why it exists.** A channel is a named session whose id is the channel's id
 * (`support.desk`). A store this app wrote before it named its organization
 * holds every channel session in the framework's development organization. The
 * boot's channel open then finds the id taken, reads the session to decide what
 * to do, and is refused, because a session bound to one organization cannot be
 * read from another. So the boot fails with
 * `channel "…" could not be opened — Request failed (403)`.
 *
 * **What it does.** For each file-declared channel whose session belongs to an
 * organization other than {@link KITCHEN_SINK_ORG_ID}, it moves that session out
 * of the channel's id, to `<channel id>~<its organization>`, and takes the
 * session's requests with it. The id is then free, and the channel open that
 * runs next creates the channel fresh in this app's organization.
 *
 * **Earlier history is left behind, not carried over and not deleted.** Nothing
 * moves into the new organization. The old session keeps its organization, its
 * transcript and its lineage, and its requests keep their organization; they
 * only change which session id they hang under. Board rows are organization
 * storage, so the old organization's rows stay where they are, and the new
 * channel's boards start empty. All of it is still in the store, so a migration
 * can be written later if someone needs the history.
 *
 * The requests go with the session because they are keyed by session id and the
 * request list checks no organization. Left where they were, the old channel's
 * runs would be listed under the new channel.
 *
 * **Safe to re-run.** A channel already in this app's organization is left
 * alone, so every boot after the first does nothing here. A boot that stopped
 * partway finds its own earlier copy at the set-aside id (same lineage) and
 * finishes the move. A different session at that id stops the boot, naming
 * both, rather than being overwritten.
 */
import type { RequestRecord, SessionRecord, StoreRegistry } from "@flow-state-dev/engine";

import { KITCHEN_SINK_ORG_ID } from "@/lib/kitchen-sink-principal";

/** The three store operations this needs. Satisfied by the engine's `StoreRegistry`. */
export type ChannelUpgradeStores = {
  session: Pick<StoreRegistry["session"], "get" | "set" | "delete">;
  request: Pick<StoreRegistry["request"], "list" | "set">;
};

/** A channel moved out of the way: its id, and where its old session now lives. */
export interface SetAsideChannel {
  channelId: string;
  /** The organization the old session belonged to. `null` when it recorded none. */
  fromOrgId: string | null;
  setAsideAs: string;
  /** How many of its requests moved with it. */
  requests: number;
}

/**
 * Move every channel session that belongs to another organization out of its
 * channel's id, with its requests. Run it before the channel open.
 *
 * @param channelIds The file-declared channels' ids. Sessions at any other id are not touched.
 * @returns One entry per channel moved. Empty when every channel is already this app's.
 * @throws When the set-aside id is held by an unrelated session, or a record changed under the move.
 */
export async function setAsideOtherOrgChannelSessions(
  stores: ChannelUpgradeStores,
  channelIds: readonly string[],
): Promise<SetAsideChannel[]> {
  const moved: SetAsideChannel[] = [];

  for (const channelId of [...channelIds].sort()) {
    const session = await stores.session.get(channelId);
    if (session === undefined || session.orgId === KITCHEN_SINK_ORG_ID) continue;

    // `== null` per BP-030: a session written before sessions recorded an
    // organization is not this app's either.
    const fromOrgId = session.orgId ?? null;
    const setAsideAs = `${channelId}~${fromOrgId ?? "no-org"}`;
    const now = Date.now();

    // 1. Copy the session to its set-aside id. `"absent"`, so an unrelated
    //    session there is never overwritten.
    const copy: SessionRecord = { ...session, id: setAsideAs, version: 0, updatedAt: now };
    const written = await stores.session.set(setAsideAs, copy, "absent");
    if (!written.ok) {
      const holder = written.conflict.currentValue ?? (await stores.session.get(setAsideAs));
      if (holder === undefined || holder.lineageId !== session.lineageId) {
        throw new Error(
          `channel "${channelId}" belongs to organization "${fromOrgId}" and cannot be set aside: ` +
            `"${setAsideAs}" already holds a different session. Move or delete one of them.`,
        );
      }
      // Our own copy, from a boot that stopped before it finished.
    }

    // 2. Its requests, keyed by the channel's id, follow it. Only the old
    //    organization's: a run of this app's organization is never moved.
    const requests = await stores.request.list({ sessionId: channelId });
    let count = 0;
    for (const request of requests) {
      if (request.orgId === KITCHEN_SINK_ORG_ID) continue;
      const next: RequestRecord = {
        ...request,
        sessionId: setAsideAs,
        version: request.version + 1,
        updatedAt: now,
      };
      const result = await stores.request.set(request.id, next, request.version);
      if (!result.ok) {
        throw new Error(
          `channel "${channelId}": request "${request.id}" changed while it was being set aside. ` +
            `Restart to try again.`,
        );
      }
      count += 1;
    }

    // 3. Free the channel's id. Only the record: the channel's boards are
    //    organization storage and stay with the old organization.
    await stores.session.delete(channelId);
    moved.push({ channelId, fromOrgId, setAsideAs, requests: count });
  }

  return moved;
}
