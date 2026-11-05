/**
 * The `projects` flow: where a user lists the projects they may work in
 * and creates one. Nothing of the lab's own: the project blocks' actions
 * (`defineProjectBlocks`), on a flow the screen opens one session of.
 *
 * A session works in one of these projects (spec D3): *New session* lists
 * them through `listProjects`, which answers only the projects the caller may
 * work in (a shared one it belongs to, or a private one it owns), and
 * `setWorkProject` checks the same rule on the server.
 */
import { defineFlow } from "@flow-state-dev/core";
import { defineProjectBlocks, type RepositoryCheck } from "@flow-state-dev/workforce";

/** The flow kind the screen reads projects through. */
export const PROJECTS_FLOW = "projects";

/**
 * Build the flow: the project blocks' actions and nothing else. Given the
 * host's `checkRepository`, a project on a repository no run could use is
 * refused when it is made, and `checkRepository` answers the picker first.
 */
export function defineProjectsFlow(options: { checkRepository?: RepositoryCheck } = {}) {
  const projects = defineProjectBlocks(options.checkRepository === undefined ? {} : { checkRepository: options.checkRepository });
  return defineFlow({
    kind: PROJECTS_FLOW,
    actions: {
      listProjects: projects.actions.listProjects,
      createProject: projects.actions.createProject,
      ...(projects.actions.checkRepository === undefined ? {} : { checkRepository: projects.actions.checkRepository }),
    },
  } as never);
}
