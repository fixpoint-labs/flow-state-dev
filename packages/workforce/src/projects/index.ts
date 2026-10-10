/**
 * Projects: shared and private `projects` rows and the writes that create
 * them, and each project's workstream entries.
 *
 * `collections.ts` is canonical for the project keys and row shapes;
 * `project-address.ts` for reaching a project by its visibility and id;
 * `workstream-collections.ts` for the workstream entries and their owner rule;
 * `workstream-writes.ts` for opening and updating a workstream;
 * `project-read.ts` and `project-progress.ts` for a project's read and the
 * progress worked out from its entries; `project-files.ts` for a member's read
 * of a project's files; `project-workspace.ts` for the run source a coding run
 * gets its files from.
 */

export {
  definePrivateProjectFilesCollection,
  definePrivateProjectsCollection,
  defineProjectFilesCollection,
  defineProjectsCollection,
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
  projectVisibilitySchema,
  type ProjectAddress,
  type ProjectVisibility,
  WORKSTREAM_CLAIMS_RESOURCE,
  workstreamClaimSchema,
  type ProjectFile,
  type ProjectRow,
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
  workstreamObjectiveSchema,
  workstreamPlaceOf,
  WORKSTREAM_RESOURCES,
  WORKSTREAMS_PATTERN,
  WORKSTREAMS_RESOURCE,
  workstreamStatusSchema,
  workstreamViewSchema,
  type WorkstreamEntry,
  type WorkstreamEntryPlace,
  type WorkstreamObjective,
  type WorkstreamStatus,
  type WorkstreamView
} from "./workstream-collections";

export {
  projectProgress,
  STALE_AFTER_MS,
  DONE_STATUS,
  WORKSTREAM_STATUS_MAX_LENGTH,
  type ProgressEntry,
  type ProjectProgress
} from "./project-progress";

export {
  projectProgressSchema,
  readProject,
  readProjectInputSchema,
  readProjectOutputSchema,
  type ReadProjectInput,
  type ReadProjectOutput
} from "./project-read";

export { parseProjectRef, parseWorkstreamRef, projectRef, workstreamRef, type WorkstreamAddress } from "./workstream-ref";

export { WORKSTREAM_OPENED_ENTRY, workstreamOpenedEntry } from "./workstream-lead";

export {
  defineWorkstreamBlocks,
  openWorkstreamInputSchema,
  openWorkstreamOutputSchema,
  updateOwnWorkstreamInputSchema,
  updateWorkstreamInputSchema,
  updateWorkstreamOutputSchema,
  type OpenWorkstreamInput,
  type OpenWorkstreamOutput,
  type UpdateOwnWorkstreamInput,
  type UpdateWorkstreamInput,
  type UpdateWorkstreamOutput,
  type WorkstreamBlocks,
  type WorkstreamBlocksOptions
} from "./workstream-writes";

export {
  projectCoordinatorTools,
  WORKSTREAM_DELEGATE_ACTION,
  workstreamDelegateChangeSchema,
  type WorkstreamDelegateChange
} from "./project-coordinator";

export {
  projectWorkspace,
  projectWorkspaceCapability,
  type ProjectWorkspaceOptions,
  type ProjectWorkspaceRefusalReason
} from "./project-workspace";
