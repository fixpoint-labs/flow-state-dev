/**
 * Projects: the organization's `projects` rows, the writes that create them,
 * and each project's room, reached through a member's own talk session.
 *
 * `collections.ts` is canonical for the keys and row shapes; `project-files.ts`
 * for a member's read of a project's files; `project-workspace.ts` for the run
 * source a coding run on a project's board gets its files from; `talk.ts` for how
 * a session reaches a room; `room-store.ts` for how a room is written and read;
 * `talk-template.ts` for a room's seats and charter, and the mint on create.
 * The talk entries are built into every mailbox kind by `defineMailboxFlow`.
 */

export {
  definePrivateProjectFilesCollection,
  definePrivateProjectsCollection,
  defineProjectFilesCollection,
  defineProjectsCollection,
  defineRoomLinesCollection,
  defineRoomSeqCollection,
  defineWorkstreamClaimsCollection,
  NO_PROJECT_ID,
  PRIVATE_PROJECT_FILES_RESOURCE,
  PRIVATE_PROJECTS_RESOURCE,
  PROJECT_FILES_RESOURCE,
  projectAddressSchema,
  projectFileSchema,
  projectFilesPrefix,
  PROJECTS_RESOURCE,
  projectRowSchema,
  projectSessionLinkSchema,
  projectVisibilitySchema,
  type ProjectAddress,
  type ProjectVisibility,
  ROOM_LINES_RESOURCE,
  ROOM_SEQ_RESOURCE,
  roomLineKey,
  roomLineSchema,
  roomSeqSchema,
  WORKSTREAM_CLAIMS_RESOURCE,
  workstreamClaimSchema,
  type ProjectFile,
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
  projectWritesMailboxInventory,
  setRepositoryInputSchema,
  setRepositoryOutputSchema,
  setWorkstreamsInputSchema,
  setWorkstreamsOutputSchema,
  type CreateProjectInput,
  type CreateProjectOutput,
  type ProjectBlocks,
  type SetRepositoryInput,
  type SetWorkstreamsInput
} from "./project-writes";

export {
  readProjectFilesInputSchema,
  readProjectFilesOutputSchema,
  type ReadProjectFilesInput,
  type ReadProjectFilesOutput
} from "./project-files";

export { ProjectRefusedError, type ProjectRefusalReason } from "./project-refusal";

export {
  definePrivateWorkstreamsCollection,
  defineWorkstreamsCollection,
  PRIVATE_WORKSTREAMS_RESOURCE,
  workstreamAddressSchema,
  workstreamDueSchema,
  workstreamEntriesPrefix,
  workstreamEntryKey,
  workstreamEntrySchema,
  workstreamIdProblem,
  workstreamObjectiveSchema,
  workstreamPlaceOf,
  WORKSTREAM_RESOURCES,
  WORKSTREAMS_PATTERN,
  WORKSTREAMS_RESOURCE,
  workstreamStatusSchema,
  type WorkstreamEntry,
  type WorkstreamEntryPlace,
  type WorkstreamObjective,
  type WorkstreamStatus
} from "./workstream-collections";

export { parseWorkstreamRef, workstreamRef, type WorkstreamAddress } from "./workstream-ref";

export { leadsWorkstreams, WORKSTREAM_OPENED_ENTRY, workstreamOpenedEntry } from "./workstream-lead";

export {
  defineWorkstreamBlocks,
  openWorkstreamInputSchema,
  openWorkstreamOutputSchema,
  updateOwnWorkstreamInputSchema,
  updateWorkstreamInputSchema,
  updateWorkstreamOutputSchema,
  workstreamViewSchema,
  type OpenWorkstreamInput,
  type OpenWorkstreamOutput,
  type UpdateWorkstreamInput,
  type WorkstreamBlocks,
  type WorkstreamBlocksOptions,
  type WorkstreamView
} from "./workstream-writes";

export {
  projectWorkspace,
  projectWorkspaceCapability,
  type ProjectWorkspaceOptions,
  type ProjectWorkspaceRefusalReason
} from "./project-workspace";

export { ROOM_LINE_GRACE_MS, ROOM_PAGE_SIZE } from "./room-store";

export {
  talkReadOutputSchema,
  talkSessionStateSchema,
  type TalkReadOutput
} from "./talk";

export type { TalkTemplate } from "./talk-template";
