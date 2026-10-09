/**
 * Control `drop-solo`: a create of a project the asker holds alone answers as
 * if it wrote the project, and writes nothing.
 *
 * Loaded into the served Lab in place of `packages/workforce/src/projects/
 * project-writes.ts` (`swap-loader.mjs`, which leaves this module's own import
 * of it alone). It is that module, except that `defineProjectBlocks`'s
 * `createProject` is a router: a create whose members are the session's user
 * alone, shared or private, goes to a block that returns the row it would have
 * written, `created: true`, and stores nothing; every other create goes to the
 * real block. The cos leg's first project names a second member, so it is
 * written; its second, "just for me", is not. The profile's default projects
 * name the crowd, so boot is unchanged. The goal must fail at "cos" on the
 * second project.
 */
import { handler, router } from "@flow-state-dev/core";
import {
  createProjectInputSchema,
  createProjectOutputSchema,
  defineProjectBlocks as defineRealProjectBlocks,
  type CreateProjectInput,
  type ProjectBlocks,
} from "../../../../packages/workforce/src/projects/project-writes.ts";

export * from "../../../../packages/workforce/src/projects/project-writes.ts";

type Ctx = { session: { identity: { userId?: string } } };

/** Whether a create names nobody but the session's user. */
const solo = (input: CreateProjectInput, ctx: Ctx): boolean => {
  const owner = ctx.session.identity.userId;
  return (input.members ?? []).every((member) => member === owner);
};

/** `defineProjectBlocks`, with a create the asker holds alone dropped. */
export function defineProjectBlocks(): ProjectBlocks {
  const blocks = defineRealProjectBlocks();
  const dropped = handler({
    name: "project-create-dropped",
    inputSchema: createProjectInputSchema,
    outputSchema: createProjectOutputSchema,
    execute: (input: CreateProjectInput, ctx: unknown) => {
      const owner = String((ctx as Ctx).session.identity.userId);
      return {
        project: { id: input.id, title: input.title, brief: input.brief ?? null, ownerUserId: owner, members: [owner] },
        visibility: input.visibility ?? "shared",
        created: true,
      };
    },
  } as never);
  const createProject = router({
    name: "project-create-or-drop",
    inputSchema: createProjectInputSchema,
    routes: [blocks.createProject, dropped],
    execute: (input: CreateProjectInput, ctx: unknown) => (solo(input, ctx as Ctx) ? dropped : blocks.createProject),
  } as never);
  return {
    ...blocks,
    createProject: createProject as never,
    actions: { ...blocks.actions, createProject: { ...blocks.actions.createProject, block: createProject as never } },
  };
}
