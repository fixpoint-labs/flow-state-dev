/**
 * Projects: the organization's `projects` rows, the writes that create them,
 * and each project's room, reached through a member's own talk session.
 *
 * `collections.ts` is canonical for the keys and row shapes; `talk.ts` for how
 * a session reaches a room; `room-store.ts` for how a room is written and read;
 * `talk-template.ts` for a room's seats and charter, and the mint on create.
 * The talk entries are built into every channel kind by `defineChannelFlow`.
 */

export {
  defineProjectsCollection,
  defineRoomLinesCollection,
  defineRoomSeqCollection,
  defineWorkstreamClaimsCollection,
  NO_PROJECT_ID,
  PROJECTS_RESOURCE,
  projectRowSchema,
  projectSessionLinkSchema,
  ROOM_LINES_RESOURCE,
  ROOM_SEQ_RESOURCE,
  roomLineKey,
  roomLineSchema,
  roomSeqSchema,
  WORKSTREAM_CLAIMS_RESOURCE,
  workstreamClaimSchema,
  type ProjectRow,
  type ProjectsCollectionOptions,
  type ProjectSessionLink,
  type RoomLine,
  type RoomSeq,
  type WorkstreamClaim
} from "./collections";

export {
  createProjectInputSchema,
  createProjectOutputSchema,
  defineProjectBlocks,
  projectWritesChannelInventory,
  setWorkstreamsInputSchema,
  setWorkstreamsOutputSchema,
  type CreateProjectInput,
  type CreateProjectOutput,
  type ProjectBlocks,
  type SetWorkstreamsInput
} from "./project-writes";

export { ProjectRefusedError, type ProjectRefusalReason } from "./project-refusal";

export { ROOM_LINE_GRACE_MS, ROOM_PAGE_SIZE } from "./room-store";

export {
  talkReadOutputSchema,
  talkSessionStateSchema,
  type TalkReadOutput
} from "./talk";

export type { TalkTemplate } from "./talk-template";
