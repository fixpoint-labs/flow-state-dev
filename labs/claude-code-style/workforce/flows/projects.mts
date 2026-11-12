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
import { labDismissals, labPins } from "./user-marks.mts";

/** The flow kind the screen reads projects through. */
export const PROJECTS_FLOW = "projects";

/**
 * Build the flow: the project blocks' actions and views and nothing else.
 * Given the host's `checkRepository`, a project on a repository no run could
 * use is refused when it is made, and the `checkRepository` view answers the
 * picker first, with no session.
 */
export function defineProjectsFlow(options: { checkRepository?: RepositoryCheck } = {}) {
  const projects = defineProjectBlocks(options.checkRepository === undefined ? {} : { checkRepository: options.checkRepository });
  return defineFlow({
    kind: PROJECTS_FLOW,
    // Your pins and dismissals: declared on a flow the host serves, as every resource is, so the
    // screen reads them by scope and writes them through the default write flow (FIX-2624).
    resources: { labPins, labDismissals },
    actions: {
      listProjects: projects.actions.listProjects,
      createProject: projects.actions.createProject,
    },
    views: { ...projects.views },
  } as never);
}
