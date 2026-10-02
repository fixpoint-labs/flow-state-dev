/**
 * Projects — the organization's `projects` rows, and the three collections a
 * project's room and its workstream claims live in.
 *
 *   projects/<id>                       one row per project: title, brief, owner, members, workstreams, talk sessions
 *   room-lines/<projectId>/<seq>        one row per line of the project's room, created and never edited
 *   room-seq/<projectId>                the room's sequence counter and its committed watermark, alone
 *   workstream-claims/<channelId>       which project holds a workstream; one shared key, written with `create`
 *
 * A project is runtime data. It is created after the tree was read, so no
 * `CHANNEL.md` and no inventory row can name it; the row is the project's one
 * record, and it lists the workstreams (declared channels) it holds.
 *
 * Every collection here is org-scoped and shared across flows
 * (`flowIsolation: false`, spelled out for the reason the inventory spells it
 * out: left undefined, an app that sets `isolateOrgState` for an unrelated
 * reason would give each flow its own copy, and every reader but the writer
 * would read empty).
 *
 * Only `projects` has a browser read. A room's lines are read through a
 * member's talk session (`talk.ts`), which checks the row's `members` first;
 * a browser read of `room-lines` would skip that check, so neither it nor the
 * counter declares one, and the collection route refuses both with a 403.
 *
 * These keys are a public surface: Shift Manager and the chief of staff read
 * them, and moving a prefix breaks every store that already holds a project.
 */

import { defineResourceCollection } from "@flow-state-dev/core";
import { z } from "zod";
import { recordOrgTalkTemplate, type TalkTemplate } from "./talk-template";

/** The resource-map ref of the projects collection. Pinned: Shift Manager reads it by this name. */
export const PROJECTS_RESOURCE = "projects";
/** The resource-map ref of a room's lines. */
export const ROOM_LINES_RESOURCE = "room-lines";
/** The resource-map ref of a room's counter. */
export const ROOM_SEQ_RESOURCE = "room-seq";
/** The resource-map ref of the workstream claims. */
export const WORKSTREAM_CLAIMS_RESOURCE = "workstream-claims";
/** The resource-map ref of the seat answers a room holds. Not re-exported from the package root. */
export const ROOM_ANSWERS_RESOURCE = "room-answers";
/** The resource-map ref of the deliveries a room's fan-out made. Not re-exported from the package root. */
export const ROOM_DELIVERIES_RESOURCE = "room-deliveries";

/**
 * The route id Shift Manager gives the workstreams no project lists. A project
 * can never take it, or its page would be the No project page.
 */
export const NO_PROJECT_ID = "unassigned";

/** One member's talk session on a project: the session, and whose it is. */
export const projectSessionLinkSchema = z.object({
  sessionId: z.string().min(1),
  userId: z.string().min(1)
});

/** @see projectSessionLinkSchema */
export type ProjectSessionLink = z.infer<typeof projectSessionLinkSchema>;

/**
 * One project, as it is stored.
 *
 * `id`, `title` and `ownerUserId` are required: a row that lost one is not a
 * thinner project, it is one nobody can address or own. Every other field
 * carries a default so a row written by an earlier version still reads
 * (BP-023, BP-030).
 *
 * `members` decides who reads and posts the project's room. It is written only
 * by trusted code — the creator's own grant at create — and nothing a member
 * does adds to it; `join` in particular never adds its caller.
 *
 * `sessions` is the row's side of the link to each member's talk session. It
 * holds at most one entry per user: `join` and `bind` are keyed by the
 * project and the person, never by the calling session.
 */
export const projectRowSchema = z.object({
  /** The project's id, also its key under `projects/`. One path segment; never `unassigned`. */
  id: z.string().min(1),
  title: z.string().min(1),
  /** What the project is for. The project's Brief tab shows it. `null` when none was given. */
  brief: z.string().nullable().default(null),
  /** A free label. New projects are `"active"`. */
  status: z.string().default("active"),
  /** The user who created it, as the engine recorded the creating session's owner. */
  ownerUserId: z.string().min(1),
  /** Who may read and post the room. Always includes the owner. */
  members: z.array(z.string()).default([]),
  /** Full channel ids of the declared channels this project holds, from any team. */
  workstreams: z.array(z.string()).default([]),
  /**
   * The token each listed workstream's claim carried when this row was written.
   * A write that drops a workstream deletes its claim only while the claim
   * still carries this token, so a claim a later write has re-stamped survives.
   * Server-side: not in the browser read.
   */
  claimTokens: z.record(z.string()).default({}),
  /** Each member's talk session, at most one per user. */
  sessions: z.array(projectSessionLinkSchema).default([])
});

/** One stored project. @see projectRowSchema */
export type ProjectRow = z.infer<typeof projectRowSchema>;

/**
 * Every field of the row, named rather than defaulted (BP-015), so a key a
 * later version adds stays server-side until it is listed here. A project is
 * visible to everyone in its organization; that it exists is not a secret,
 * and a session id grants nothing to anyone but its owner.
 */
const PROJECT_CLIENT_FIELDS = [
  "id",
  "title",
  "brief",
  "status",
  "ownerUserId",
  "members",
  "workstreams",
  "sessions"
] as const;

/**
 * One line of a room, or the tombstone that took a line's place.
 *
 * `userId` is the poster's session owner as the engine recorded it — never a
 * field the caller sends. A seat's answer carries its `author`; a person's
 * line carries `null`. A tombstone fills a sequence number whose line was
 * never written within the grace period, so the watermark can move past it;
 * readers skip it.
 */
export const roomLineSchema = z.object({
  projectId: z.string().min(1),
  seq: z.number().int().min(1),
  userId: z.string(),
  author: z.string().nullable().default(null),
  body: z.string(),
  tombstone: z.boolean().default(false)
});

/** One stored room line. @see roomLineSchema */
export type RoomLine = z.infer<typeof roomLineSchema>;

/**
 * A room's counter. `next` is the last sequence number handed out; `committed`
 * is the highest one below which every line (or its tombstone) is written.
 * Readers see `seq <= committed` only, so a line that was allocated and not yet
 * written is never passed over.
 *
 * `stalledSince` is when `committed` was first seen stuck behind a missing
 * line, or `null` when it is not stuck. It is how the next poster knows the
 * grace period has run out for that line. Nullable with a `null` default
 * (BP-023).
 */
export const roomSeqSchema = z.object({
  next: z.number().int().min(0).default(0),
  committed: z.number().int().min(0).default(0),
  stalledSince: z.number().nullable().default(null)
});

/** One room's counter. @see roomSeqSchema */
export type RoomSeq = z.infer<typeof roomSeqSchema>;

/**
 * Which project holds one workstream, and the token of the write that last
 * stamped the claim. The token is what a later release checks before it
 * deletes: a claim re-stamped since is someone else's to keep.
 */
export const workstreamClaimSchema = z.object({ projectId: z.string().min(1), token: z.string().default("") });

/** @see workstreamClaimSchema */
export type WorkstreamClaim = z.infer<typeof workstreamClaimSchema>;

/** Shared across flows on purpose; see the module header. */
const SHARED_ACROSS_FLOWS = false;

// Each `define*Collection` below returns ONE shared declaration rather than a
// fresh one per call. A flow refuses two different declarations under one ref
// ("Resource conflict"), and these are declared by every channel kind, by the
// project writes, and by an app's own `org/resources/projects.ts` — which may
// all meet in one flow. Rows are addressed by pattern and scope either way.

/**
 * The organization's projects, at `projects/*`.
 *
 * Install it wherever projects are read or written. Org-scoped, shared across
 * flows, and readable by a browser through `expose`. Takes no options: the
 * prefix, the scope and the sharing are what Shift Manager and the talk entries
 * join against.
 *
 * **Write a row with `create()`, never `upsert()`.** `create()` refuses a key
 * that is held, and that refusal is what stops a second project taking an id.
 * The project blocks (`defineProjectBlocks`) are the writers; prefer them.
 *
 * **The org-level talk template** rides here, beside the collection: `talk`
 * names the seats a post in any project's room wakes, the room's charter, and
 * the channel kind talk sessions run on. It is read by `channelInstances`
 * (pass it the org's resource map as `resources`), which builds it onto the
 * kind and mints each creator's talk session when a row is created. The
 * declaration returned is the same one every call returns; see
 * `talk-template.ts` for why the template is the process's.
 *
 * @param options `talk`: the org-level talk template. Omitted, any template
 *   recorded earlier stands.
 * @example
 *   // workforce/org/resources/projects.ts
 *   export default defineProjectsCollection({
 *     talk: { seats: ["eng.em", "chief-of-staff"], charter: "Plan the work; say what is blocked." }
 *   });
 */
export function defineProjectsCollection(options: ProjectsCollectionOptions = {}) {
  if (options.talk !== undefined) recordOrgTalkTemplate(PROJECTS_COLLECTION, options.talk);
  return PROJECTS_COLLECTION;
}

/** Options for {@link defineProjectsCollection}. */
export type ProjectsCollectionOptions = {
  /** The org-level talk template: the seats, charter and kind of every project's room. */
  talk?: TalkTemplate;
};

/**
 * The one projects declaration, for an identity check (`channelInstances`
 * asks whether a `mintFor:` names it). Not re-exported from the package root:
 * apps declare it with {@link defineProjectsCollection}.
 */
export const PROJECTS_COLLECTION = defineResourceCollection({
  pattern: "projects/*",
  scope: "org",
  flowIsolation: SHARED_ACROSS_FLOWS,
  stateSchema: projectRowSchema,
  client: { state: { read: true }, expose: PROJECT_CLIENT_FIELDS }
});

/**
 * A room's lines, at `room-lines/<projectId>/<seq>`. Lazy, because a room
 * grows without bound and a request must never load every line; no browser
 * read, because only a member's talk session may read them.
 */
export function defineRoomLinesCollection() {
  return ROOM_LINES_COLLECTION;
}

const ROOM_LINES_COLLECTION = defineResourceCollection({
  pattern: "room-lines/**",
  scope: "org",
  flowIsolation: SHARED_ACROSS_FLOWS,
  prefetchMode: "lazy",
  stateSchema: roomLineSchema
});

/**
 * One counter per room, at `room-seq/<projectId>`. Apart from the project row,
 * so posts contend only with posts, never with an edit to the project or a
 * join. No browser read.
 */
export function defineRoomSeqCollection() {
  return ROOM_SEQ_COLLECTION;
}

const ROOM_SEQ_COLLECTION = defineResourceCollection({
  pattern: "room-seq/*",
  scope: "org",
  flowIsolation: SHARED_ACROSS_FLOWS,
  prefetchMode: "lazy",
  stateSchema: roomSeqSchema
});

/**
 * Workstream claims, at `workstream-claims/<channelId>`. One shared key per
 * workstream, written with `create`, so of two projects claiming the same
 * workstream at once exactly one lands. No browser read: the project rows
 * already say which workstreams each holds.
 */
export function defineWorkstreamClaimsCollection() {
  return WORKSTREAM_CLAIMS_COLLECTION;
}

const WORKSTREAM_CLAIMS_COLLECTION = defineResourceCollection({
  pattern: "workstream-claims/*",
  scope: "org",
  flowIsolation: SHARED_ACROSS_FLOWS,
  prefetchMode: "lazy",
  stateSchema: workstreamClaimSchema
});

/**
 * One seat's answer to one post in a room, at
 * `room-answers/<projectId>/<postId>/<author>`: the durable record of the
 * answer's progress (`room-answer.ts`). Created before the line, holding the
 * seq allocated for it and the line itself, so a run that dies after the claim
 * leaves the next delivery everything it needs to finish. Never deleted.
 * Server-written: nothing a caller seeds into a session reaches it. No browser
 * read.
 */
export const roomAnswerSchema = z.object({
  projectId: z.string().min(1),
  postId: z.string().min(1),
  author: z.string().min(1),
  /** The owner of the talk session the answer was delivered into: the line's `userId`. */
  userId: z.string().min(1),
  body: z.string().min(1),
  /** The seq the line is written at. Moves only off a tombstone. */
  seq: z.number().int().min(1)
});

/** @see roomAnswerSchema */
export type RoomAnswer = z.infer<typeof roomAnswerSchema>;

/** The seat-answer claims. Not re-exported from the package root: only the talk entries read it. */
export function defineRoomAnswersCollection() {
  return ROOM_ANSWERS_COLLECTION;
}

const ROOM_ANSWERS_COLLECTION = defineResourceCollection({
  pattern: "room-answers/**",
  scope: "org",
  flowIsolation: SHARED_ACROSS_FLOWS,
  prefetchMode: "lazy",
  stateSchema: roomAnswerSchema
});

/**
 * One post's delivery to one seat, at `room-deliveries/<token>`: written by the
 * talk fan-out before it wakes the seat, and the token handed to that seat
 * alone. An answer names its delivery by the token, and its author is the
 * seat the delivery was made to, never the answer's own claim. `sessionId` is
 * the poster's talk session the delivery came from, the only session the
 * answer may come back through. The token is unguessable, so a seat cannot
 * answer under a delivery it was not handed. No browser read.
 */
export const roomDeliverySchema = z.object({
  projectId: z.string().min(1),
  postId: z.string().min(1),
  seat: z.string().min(1),
  sessionId: z.string().min(1)
});

/** @see roomDeliverySchema */
export type RoomDelivery = z.infer<typeof roomDeliverySchema>;

/** The deliveries. Not re-exported from the package root: only the talk entries read it. */
export function defineRoomDeliveriesCollection() {
  return ROOM_DELIVERIES_COLLECTION;
}

const ROOM_DELIVERIES_COLLECTION = defineResourceCollection({
  pattern: "room-deliveries/*",
  scope: "org",
  flowIsolation: SHARED_ACROSS_FLOWS,
  prefetchMode: "lazy",
  stateSchema: roomDeliverySchema
});

/** Digits a sequence number is padded to, so keys sort by `seq`. */
const SEQ_DIGITS = 12;

/**
 * The key of one room line, relative to the collection: `<projectId>/<seq>`,
 * zero-padded so a room's keys sort in sequence order.
 */
export function roomLineKey(projectId: string, seq: number): string {
  return `${projectId}/${String(seq).padStart(SEQ_DIGITS, "0")}`;
}

/**
 * Why a project id is not usable, or `undefined` when it is. One path segment,
 * so it can head a `room-lines` key; never {@link NO_PROJECT_ID}.
 */
export function projectIdProblem(id: string): string | undefined {
  if (id.length === 0) return "a project id can't be empty";
  if (id === NO_PROJECT_ID) return `"${NO_PROJECT_ID}" is where workstreams no project lists are shown, so no project can take it`;
  if (id.includes("/") || id === "." || id === "..") return `project id "${id}" must be one path segment`;
  return undefined;
}
