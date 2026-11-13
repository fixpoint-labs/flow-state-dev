// FIX-2624.
/**
 * The names a project is reached by from a client: the collection's pattern
 * and the flow that writes it. Import-free, so a browser bundle can name them.
 */

/** The projects' key pattern, at org scope for a shared project and the owner's user scope for a private one. */
export const PROJECTS_PATTERN = "projects/*" as const;

/**
 * The flow a host registers its project writes on (`defineProjectBlocks().actions`),
 * and the projects collections' `runBy`: a client's `createProject` or
 * `setBrief` runs here. **Pinned**: a host that serves projects to a client
 * registers its projects flow under this name.
 */
export const PROJECTS_FLOW = "projects" as const;

/** The repository check's view name on the projects flow (`defineProjectBlocks({ checkRepository }).views`). */
export const CHECK_REPOSITORY_VIEW = "checkRepository" as const;
