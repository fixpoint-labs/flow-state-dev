/**
 * FIX-1728 · workstream slice — portable shape, not a production export.
 *
 * Org-scoped workstream row + hand-built talk-channel manifest + openChannels.
 * Nothing here is imported by `packages/workforce`. Do not promote it by
 * moving the file.
 *
 * Fences this sketch obeys:
 * - Durable owner/status live on the resource, never in session state.
 * - No `CHANNELS.md`. No `workforce/projects/`. No L1 Workstream type.
 * - Session is talk *about* the row. The join is `resourceId` ↔ session id.
 */

import { defineResourceCollection } from "../../../../../packages/core/src/index";
import { z } from "zod";
import {
  openChannels,
  type ChannelManifest,
  type OpenChannelsOptions,
} from "../../../../../packages/workforce/src/channel";

/** Closed status set for the org-visible row. Not a session field. */
export const workstreamStatusSchema = z.enum(["open", "parked", "done"]);

/**
 * One org-visible workstream. Owner and status are the fields others can
 * list without opening the owner's talk session.
 */
export const workstreamRowSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  ownerUserId: z.string().min(1),
  status: workstreamStatusSchema,
  /** Session id minted for the owner. Same value as {@link talkSessionIdOf}. */
  talkSessionId: z.string().min(1),
});

/** One row of the workstream collection. @see workstreamRowSchema */
export type WorkstreamRow = z.infer<typeof workstreamRowSchema>;

/**
 * Org-scoped workstream inventory. Shared across flows so a desk that is not
 * the owner's session can still list ownership and status.
 *
 * Pattern sits beside `inventory/channels/*`, not under it: channel inventory
 * is "which rooms opened". This is "which workstreams exist".
 */
export function defineWorkstreamCollection() {
  return defineResourceCollection({
    pattern: "workstreams/*",
    scope: "org",
    flowIsolation: false,
    stateSchema: workstreamRowSchema,
    client: {
      state: { read: true },
      expose: ["id", "title", "ownerUserId", "status", "talkSessionId"],
    },
  });
}

/**
 * Deterministic talk-session id for a workstream. The resource stores the
 * same string; the session may also carry `metadata.resourceId`.
 *
 * Prefixed so it cannot collide with a `<team>.<channel>` file id.
 */
export function talkSessionIdOf(workstreamId: string): string {
  return `ws.${workstreamId}`;
}

/**
 * Hand-built channel record for the owner talk session.
 *
 * Only keys `channelInstances` already accepts. `resourceId` is not one of
 * them — stamping it through `CHANNEL.md` frontmatter is refused today, and
 * this sketch does not add it to the closed list.
 */
export function workstreamTalkManifest(row: Pick<WorkstreamRow, "id" | "title">): ChannelManifest {
  return {
    id: talkSessionIdOf(row.id),
    declared: { description: `Talk about workstream ${row.title}.` },
    body: "",
  };
}

/**
 * Session-client wrap that stamps `metadata.resourceId` on create.
 *
 * `openChannels` does not forward metadata. The smallest host-side cut is
 * this wrap, not a new declarable `CHANNEL.md` key and not a workforce edit.
 */
export function withResourceLink(
  client: OpenChannelsOptions["client"],
  resourceId: string
): OpenChannelsOptions["client"] {
  return {
    ...client,
    createSession: async (options) =>
      // `openChannels` does not type `metadata`. A real SessionClient accepts
      // it; the wrap is the stamp, not a CHANNEL.md key.
      client.createSession({
        ...options,
        metadata: { resourceId },
      } as Parameters<OpenChannelsOptions["client"]["createSession"]>[0]),
  };
}

/**
 * Mint the owner-bound talk session about an already-written workstream row.
 *
 * Caller writes the org row first (so inventory exists even if open fails).
 * User on the session is the owner — not a seat member list.
 */
export async function openWorkstreamTalk(
  row: WorkstreamRow,
  options: { client: OpenChannelsOptions["client"] }
): Promise<ChannelManifest> {
  const manifest = workstreamTalkManifest(row);
  await openChannels([manifest], {
    client: withResourceLink(options.client, row.id),
    userId: row.ownerUserId,
  });
  return manifest;
}
