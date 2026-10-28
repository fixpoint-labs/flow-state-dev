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
 * of a project's files; `run-project.ts` for the one read of a coding run's
 * project and owner; `project-workspace.ts` for the run source a coding run
 * gets its files from; `project-source.ts` for the tools that read those files
 * without a run; `project-mcp-tools.ts` and `mcp-credentials.ts` for the
 * MCP servers a run gets and each user's keys for them; `work-project.ts` for
 * the action that sets the project a user's conversation works in.
 */

export {
  definePrivateProjectFilesCollection,
  definePrivateProjectsCollection,
  defineProjectFilesCollection,
  defineProjectsCollection,
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
  type ProjectFile,
  type ProjectRow
} from "./collections";

export {
  createProjectInputSchema,
  createProjectOutputSchema,
  defineProjectBlocks,
  setBriefInputSchema,
  setBriefOutputSchema,
  setMcpServersInputSchema,
  setMcpServersOutputSchema,
  setRepositoryInputSchema,
  setRepositoryOutputSchema,
  type CreateProjectInput,
  type CreateProjectOutput,
  type ProjectBlocks,
  type ProjectBlocksOptions,
  type SetBriefInput,
  type SetMcpServersInput,
  type SetRepositoryInput
} from "./project-writes";

export { checkedMcpServers, isMcpServerName } from "./mcp-server-name";

export {
  defineMcpCredentialsCollection,
  MCP_CREDENTIALS_PREFIX,
  MCP_CREDENTIALS_RESOURCE,
  mcpCredentialProblem,
  mcpCredentialSchema,
  mcpCredentialsCapability,
  type McpCredential
} from "./mcp-credentials";

export {
  projectMcpTools,
  type ProjectMcpServerConfig,
  type ProjectMcpServers,
  type ProjectMcpToolsOptions,
  type ProjectMcpToolsResolver,
  type RelayedMcpServer,
  type RelayedMcpTool
} from "./project-mcp-tools";

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
  parseWorkstreamEntry,
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
  type ParsedWorkstreamEntry,
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
  listedProjectSchema,
  listProjects,
  listProjectsInputSchema,
  listProjectsOutputSchema,
  projectProgressSchema,
  readProject,
  readProjectInputSchema,
  readProjectOutputSchema,
  type ListProjectsOutput,
  type ReadProjectInput,
  type ReadProjectOutput
} from "./project-read";

export { parseProjectRef, parseWorkstreamRef, projectRef, workstreamRef, type WorkstreamAddress } from "./workstream-ref";

export { WORKSTREAM_OPENED_ENTRY, workstreamOpenedEntry } from "./workstream-lead";

export {
  defineWorkstreamBlocks,
  editWorkstreamInputSchema,
  listLeadsOutputSchema,
  openWorkstreamInputSchema,
  openWorkstreamOutputSchema,
  updateOwnWorkstreamInputSchema,
  updateWorkstreamInputSchema,
  updateWorkstreamOutputSchema,
  type EditWorkstreamInput,
  type ListLeadsOutput,
  type OpenWorkstreamInput,
  type OpenWorkstreamOutput,
  type UpdateOwnWorkstreamInput,
  type UpdateWorkstreamInput,
  type UpdateWorkstreamOutput,
  type WorkstreamBlocks,
  type WorkstreamBlocksOptions
} from "./workstream-writes";

export {
  linkedProjectOf,
  projectCoordinatorTools,
  WORKSTREAM_DELEGATE_ACTION,
  workstreamDelegateChangeSchema,
  type WorkstreamDelegateChange
} from "./project-coordinator";

export {
  projectWorkspace,
  projectWorkspaceCapability,
  type ProjectCheckout,
  type ProjectWorkspaceOptions,
  type ProjectWorkspaceRefusalReason
} from "./project-workspace";

export {
  defineSetWorkProjectBlock,
  setWorkProjectAction,
  setWorkProjectInputSchema,
  setWorkProjectOutputSchema,
  type SetWorkProjectInput,
  type SetWorkProjectOutput
} from "./work-project";

export {
  globProjectSourceOutputSchema,
  grepProjectSourceOutputSchema,
  PROJECT_SOURCE_CAPABILITY,
  projectSourceCapability,
  readProjectSourceOutputSchema,
  type ProjectSourceCapabilityOptions
} from "./project-source";
