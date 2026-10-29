/**
 * The project writes and the project list as a worker's tools, so any app's
 * worker can make, find and pin a project from its own turn: `listProjects`,
 * `createProject`, `setRepository`, `setBrief` ({@link projectTools}), and
 * `setWorkProject` ({@link setWorkProjectTool}).
 *
 * They are the blocks `defineProjectBlocks()` returns, under the names a
 * worker's `tools:` line spells. A catalog key must be the tool's own name, so
 * `setBrief` and `setWorkProject` are their blocks under `.as()`; the others
 * are sequencers named for the tool, since each waits for an approval first,
 * or, for `listProjects`, adds `forCoding`.
 *
 * **A repository waits for the user.** Which remote a project's code is cloned
 * from is the user's to say, so `setRepository`, and `createProject` with a
 * `repository`, pause on a stock `user_approval` before the write. Approve
 * writes it; Deny throws out of the tool before the write runs, and nothing
 * changes. Without durable execution the tool refuses rather than writing
 * unasked.
 */
import { handler, sequencer } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import { redactRemote } from "@flow-state-dev/workspace";
import { z } from "zod";
import { linkedProjectOf } from "./project-coordinator";
import { listProjectsInputSchema, listProjectsOutputSchema } from "./project-read";
import {
  createProjectInputSchema,
  createProjectOutputSchema,
  setRepositoryInputSchema,
  setRepositoryOutputSchema,
  type ProjectBlocks
} from "./project-writes";
import { defineSetWorkProjectBlock } from "./work-project";

/** The user's projects, with what a coder's task that names no project does next. */
export const listedForCodingSchema = listProjectsOutputSchema.extend({ forCoding: z.string() });

/**
 * What a coder's task that names no project does next, worked out from the
 * projects with a repository rather than left to the model to count: file it
 * for the one there is, or ask, naming them. A real model told the rule in
 * prose picked one of two, or offered instead of filing, about one turn in
 * three.
 */
const forCoding = handler({
  name: "list-projects-for-coding",
  inputSchema: listProjectsOutputSchema,
  outputSchema: listedForCodingSchema,
  execute: (listed) => {
    const coded = listed.projects.filter((project) => project.repository != null);
    const named = (project: (typeof coded)[number]) => `${project.title} (${JSON.stringify({ visibility: project.visibility, id: project.id })})`;
    const [only] = coded;
    const next =
      coded.length === 1 && only !== undefined
        ? `One project has a repository: ${named(only)}. Hand a coder's task that names no project to it now, with createTask, without asking.`
        : coded.length === 0
          ? "No project has a repository. Ask which project the user means."
          : `${coded.length} projects have a repository: ${coded.map(named).join(", ")}. File nothing. Ask which one the user means, naming each.`;
    return { ...listed, forCoding: next };
  }
});

/** What a repository ask reads off a write's input. */
const repositoryApprovalInputSchema = z
  .object({
    id: z.string().optional(),
    project: z.object({ id: z.string() }).passthrough().optional(),
    repository: z.string().nullable().optional()
  })
  .passthrough();

/**
 * The approval a repository write waits on: a stock `user_approval` naming
 * the project and the remote, with any user or password left out of what
 * Inbox shows. Returns on Approve; on Deny the runtime throws out of it.
 */
function approveRepository(projectOf: (input: z.infer<typeof repositoryApprovalInputSchema>, ctx: BlockContext) => string | undefined) {
  return handler({
    name: "project-tools-approve-repository",
    inputSchema: repositoryApprovalInputSchema,
    outputSchema: z.void(),
    execute: async (input: z.infer<typeof repositoryApprovalInputSchema>, ctx: BlockContext) => {
      const project = projectOf(input, ctx);
      // No project to name: the write that follows refuses, so there is nothing to approve.
      if (project === undefined) return;
      const repository = input.repository == null ? null : redactRemote(input.repository);
      // A host without durable execution refuses at the stop itself (FIX-2063).
      await ctx.suspend!({
        reason: "user_approval",
        message:
          repository === null
            ? `Clear the repository of project "${project}"? Its coding work will run on its files.`
            : `Set the repository of project "${project}" to ${repository}?`,
        data: { project, repository },
        allow: ["approve", "reject"]
      });
    }
  });
}

/**
 * The project writes and the project list as tools, `listProjects`,
 * `createProject`, `setRepository` and `setBrief`, over `blocks`.
 *
 * `listProjects` is how a worker knows which project a coder's task works in:
 * the projects the user is a member of, read when asked, never guessed. The
 * owner of a project `createProject` makes is the session's user, who is
 * always a member; `members` adds whoever they name.
 *
 * @param blocks The host's project blocks (`defineProjectBlocks()`), the same
 *   ones its projects flow runs.
 */
export function projectTools(blocks: ProjectBlocks) {
  return {
    listProjects: sequencer({
      name: "listProjects",
      description:
        "List the projects the user you are talking to is a member of: each one's address " +
        "(`visibility` and `id`), its title, and its `repository` (null when it has none), and " +
        "`forCoding`, what to do with a coder's task that names no project. Answer which projects " +
        "they have, and pick the project a task works in, from this, never from memory.",
      inputSchema: listProjectsInputSchema,
      outputSchema: listedForCodingSchema
    })
      .step(blocks.listProjects)
      .step(forCoding),
    createProject: sequencer({
      name: "createProject",
      description:
        "Create a project for the user you are talking to. They own it and are always a project member. " +
        "`id` is a short lowercase slug; `members` adds the user ids they name; `repository` is the git " +
        "remote its code lives in, if they named one. With a repository, the user approves it first.",
      // A project's MCP servers are set on its page, not by a worker.
      inputSchema: createProjectInputSchema.omit({ mcpServers: true }),
      outputSchema: createProjectOutputSchema
    })
      .tapIf((input) => input.repository != null, approveRepository((input) => input.id))
      .step(blocks.createProject),
    setRepository: sequencer({
      name: "setRepository",
      description:
        "Set, change or clear (null) the git remote a project's code lives in, by the project's address " +
        "(`visibility` and `id`); in a project's own conversation, leave `project` out. " +
        "Only project members may, and the user approves it first.",
      inputSchema: setRepositoryInputSchema,
      outputSchema: setRepositoryOutputSchema
    })
      .tap(
        approveRepository((input, ctx) => {
          // Only a project the write can change is asked about: a linked conversation naming another is refused below.
          const linked = linkedProjectOf(ctx.session.state);
          if (linked === undefined) return input.project?.id;
          const named = input.project as { id: string; visibility?: unknown } | undefined;
          return named === undefined || (named.id === linked.id && named.visibility === linked.visibility) ? linked.id : undefined;
        })
      )
      .step(blocks.setRepository),
    setBrief: blocks.setBrief.as({
      name: "setBrief",
      description:
        "Set, change or clear (null) a project's brief, what the project is for, by the project's address " +
        "(`visibility` and `id`); in a project's own conversation, leave `project` out. Only project members may."
    })
  };
}

/**
 * The work-project action as a tool, `setWorkProject`: the worker pins the
 * project its own conversation works in, the one it just created or picked,
 * so the tasks it files there run in that project. The same block and the
 * same refusals as the action (`./work-project`): only in the user's own
 * conversation with the worker, on a project they may work in.
 */
export const setWorkProjectTool = defineSetWorkProjectBlock().as({
  name: "setWorkProject",
  description:
    "Set the project this conversation works in, by the project's address (`visibility` and `id`), " +
    "after you created it or the user picked it. The coding tasks you file from here then run in it. " +
    "Leave `worker` out."
});
