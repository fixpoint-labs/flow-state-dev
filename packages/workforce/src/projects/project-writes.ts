/**
 * The project writes: `createProject`, `setRepository`, `setMcpServers` and `setBrief`.
 *
 * **Shared or private.** `createProject` takes a `visibility`, `"shared"` when
 * omitted. A shared project is a row of the organization's `projects`; a
 * private one is the same row in its owner's user scope, with only its owner
 * as a member. Every later read
 * and write names the project by its address, its visibility plus its id
 * (`project-address.ts`).
 *
 * Each is a block an app installs on the flow that creates projects — its own
 * boot code, or the Shift Coordinator's tool — and {@link defineProjectBlocks}
 * also hands them back, with the project files read (`project-files.ts`), as
 * an `actions` map to spread into a flow.
 *
 * **Who the owner is.** The creating session's owner, as the engine recorded
 * it, never a field of the input. `members` in the input is the creator's own
 * grant, and the owner is always one of them. Nothing else writes `members`:
 * `join` never adds its caller.
 *
 * **Re-sending a create.** The same owner sending the same id again gets the
 * existing row back, unchanged.
 *
 * **MCP servers.** A project names the MCP servers its coding runs get, by the
 * bare names the host offers: `defineProjectBlocks({ mcpServers })` is that
 * list, and with none every name is refused (`mcp-server-name.ts`). The row
 * holds names only; the address is the host's and the key each user's own.
 */

import { handler } from "@flow-state-dev/core";
import type { ActionConfig, BlockContext, ResourceCollectionRef } from "@flow-state-dev/core/types";
import { z } from "zod";
import { retryOnConflict } from "./cas-retry";
import {
  PROJECTS_RESOURCE,
  projectAddressSchema,
  projectIdProblem,
  projectRowSchema,
  projectVisibilitySchema,
  type ProjectAddress,
  type ProjectRow,
  type ProjectVisibility
} from "./collections";
import { projectAt, projectRowsAt, PROJECT_ROW_RESOURCES } from "./project-address";
import { isMember } from "./membership-gate";
import { isAlreadyExists } from "./store-errors";
import { readProjectFiles } from "./project-files";
import { listProjects, readProject } from "./project-read";
import { projectOfWrite } from "./project-coordinator";
import { ProjectRefusedError } from "./project-refusal";
import { repositoryProblem } from "./repository-value";
import { checkedMcpServers } from "./mcp-server-name";

/** What creating a project takes. Closed: nothing in it names the owner. */
export const createProjectInputSchema = z
  .object({
    /** The project's id: one path segment, never `unassigned`. */
    id: z.string().min(1),
    title: z.string().min(1),
    brief: z.string().optional(),
    /**
     * `"shared"` (the default): a row of the organization, which everyone in it
     * reads. `"private"`: the same row in the creator's user scope, which nobody
     * else lists or reads.
     */
    visibility: projectVisibilitySchema.optional(),
    /**
     * On a shared project, who besides the creator may open workstreams in it.
     * The creator is always a member. A private project names nobody else.
     */
    members: z.array(z.string().min(1)).optional(),
    /** The git remote the project's code lives in. Omitted or `null`: a project with no repository. */
    repository: z.string().nullable().optional(),
    /**
     * The MCP servers the project's coding runs get, by the names the host
     * offers. Omitted: none. Checked like `setMcpServers`.
     */
    mcpServers: z.array(z.unknown()).optional()
  })
  .strict();

/** @see createProjectInputSchema */
export type CreateProjectInput = z.infer<typeof createProjectInputSchema>;

/** What creating a project returns: the row, where it lives, and whether this call wrote it. */
export const createProjectOutputSchema = z.object({
  project: projectRowSchema,
  /** Where the row lives. With the row's id, the project's address. */
  visibility: projectVisibilitySchema,
  /** `false` when the same owner re-sent an id it already holds; the row is returned unchanged. */
  created: z.boolean()
});

/** @see createProjectOutputSchema */
export type CreateProjectOutput = z.infer<typeof createProjectOutputSchema>;

/** What `setRepository` takes: the address and the new remote or `null`. No address: the linked project. */
export const setRepositoryInputSchema = z
  .object({ project: projectAddressSchema.optional(), repository: z.string().nullable() })
  .strict();

/** @see setRepositoryInputSchema */
export type SetRepositoryInput = z.infer<typeof setRepositoryInputSchema>;

/** What setting a project's repository returns: the row as written. */
export const setRepositoryOutputSchema = z.object({ project: projectRowSchema });

/**
 * What `setMcpServers` takes: the address and the whole new list of MCP
 * server names; `[]` turns them all off. No address: the linked project.
 * Each item is checked by the write, not here, so a value that isn't a name
 * is refused as `invalid-mcp-server` without being repeated.
 */
export const setMcpServersInputSchema = z
  .object({ project: projectAddressSchema.optional(), mcpServers: z.array(z.unknown()) })
  .strict();

/** @see setMcpServersInputSchema */
export type SetMcpServersInput = z.infer<typeof setMcpServersInputSchema>;

/** What setting a project's MCP servers returns: the row as written. */
export const setMcpServersOutputSchema = z.object({ project: projectRowSchema });

/** Options for {@link defineProjectBlocks}. */
export interface ProjectBlocksOptions {
  /**
   * The names of the MCP servers this host offers its projects. A project
   * may name only these. Absent or empty: it offers none, and every name is
   * refused `unknown-mcp-server`.
   */
  mcpServers?: readonly string[];
}

/** What `setBrief` takes: the address and the new brief or `null`. No address: the linked project. */
export const setBriefInputSchema = z
  .object({ project: projectAddressSchema.optional(), brief: z.string().nullable() })
  .strict();

/** @see setBriefInputSchema */
export type SetBriefInput = z.infer<typeof setBriefInputSchema>;

/** What setting a project's brief returns: the row as written. */
export const setBriefOutputSchema = z.object({ project: projectRowSchema });

/** The project writes, the project read and the project files read, and the same blocks as an `actions` map. */
export type ProjectBlocks = {
  createProject: ReturnType<typeof defineWriteProject>;
  setRepository: typeof setRepository;
  setMcpServers: ReturnType<typeof defineSetMcpServers>;
  setBrief: typeof setBrief;
  readProject: typeof readProject;
  listProjects: typeof listProjects;
  readProjectFiles: typeof readProjectFiles;
  actions: {
    createProject: ActionConfig;
    setRepository: ActionConfig;
    setMcpServers: ActionConfig;
    setBrief: ActionConfig;
    readProject: ActionConfig;
    listProjects: ActionConfig;
    readProjectFiles: ActionConfig;
  };
};

/** One map, shared by every write: a flow refuses two declarations under one ref. */
const WRITE_RESOURCES = { ...PROJECT_ROW_RESOURCES };

function refsOf(ctx: BlockContext) {
  return {
    projects: ctx.resources[PROJECTS_RESOURCE] as unknown as ResourceCollectionRef<ProjectRow>
  };
}

const unique = (ids: readonly string[]): string[] => [...new Set(ids)];

/** Refuse a repository value no row may record. `null` and omitted are a project with none. */
function assertRepository(repository: string | null | undefined): void {
  if (repository == null) return;
  const problem = repositoryProblem(repository);
  if (problem !== undefined) throw new ProjectRefusedError("invalid-repository", `${problem}.`);
}

/** `createProject`, refusing an MCP server name outside `offered`. */
function defineWriteProject(offered: readonly string[]) {
  return handler({
    name: "project-create",
    inputSchema: createProjectInputSchema,
    outputSchema: createProjectOutputSchema,
    resources: WRITE_RESOURCES,
    execute: async (input, ctx): Promise<CreateProjectOutput> => {
      const problem = projectIdProblem(input.id);
      if (problem !== undefined) throw new ProjectRefusedError("invalid-project-id", `${problem}.`);
      assertRepository(input.repository);
      const mcpServers = checkedMcpServers(input.mcpServers ?? [], offered);
      const owner = ctx.session.identity.userId;
      if (owner === undefined || owner.length === 0) {
        throw new Error("createProject needs a session with an owner: the owner is the session's user.");
      }
      const visibility: ProjectVisibility = input.visibility ?? "shared";
      if (visibility === "private") return writePrivateProject(ctx, input, owner, mcpServers);
      const { projects } = refsOf(ctx);

      const heldBy = (row: ProjectRow): CreateProjectOutput => {
        if (row.ownerUserId === owner) return { project: projectRowSchema.parse(row), visibility, created: false };
        throw new ProjectRefusedError(
          "project-id-held",
          `project id "${input.id}" is held by another owner. Choose another id.`
        );
      };

      const existing = await projects.getOptional(input.id);
      if (existing !== undefined) return heldBy(existing.state as ProjectRow);

      const row: ProjectRow = projectRowSchema.parse({
        id: input.id,
        title: input.title,
        brief: input.brief ?? null,
        ownerUserId: owner,
        members: unique([owner, ...(input.members ?? [])]),
        repository: input.repository ?? null,
        mcpServers
      });
      try {
        await projects.create(input.id, row);
      } catch (error) {
        // A duplicate create won the row: hand it back as any held id is.
        const winner = isAlreadyExists(error) ? (await projects.getOptional(input.id))?.state : undefined;
        if (winner === undefined) throw error;
        return heldBy(winner as ProjectRow);
      }
      return { project: row, visibility, created: true };
    }
  });
}

/**
 * Create a private project: the row in the owner's own user scope, with the
 * owner as its only member. Nobody else writes that scope, so an id it holds
 * is the owner's own, and a re-sent create hands the row back unchanged.
 *
 * @throws `private-has-members` when the input names anyone but the owner.
 */
async function writePrivateProject(
  ctx: BlockContext,
  input: CreateProjectInput,
  owner: string,
  mcpServers: string[]
): Promise<CreateProjectOutput> {
  const others = unique(input.members ?? []).filter((member) => member !== owner);
  if (others.length > 0) {
    throw new ProjectRefusedError(
      "private-has-members",
      `a private project is its owner's alone, so it can't list ${others.map((m) => `"${m}"`).join(", ")}. ` +
        `Make it shared to work on it with others.`
    );
  }
  const projects = projectRowsAt(ctx, "private");
  const done = (state: unknown, created: boolean): CreateProjectOutput => ({
    project: projectRowSchema.parse(state),
    visibility: "private",
    created
  });
  const existing = await projects.getOptional(input.id);
  if (existing !== undefined) return done(existing.state, false);
  const row: ProjectRow = projectRowSchema.parse({
    id: input.id,
    title: input.title,
    brief: input.brief ?? null,
    ownerUserId: owner,
    members: [owner],
    repository: input.repository ?? null,
    mcpServers
  });
  try {
    await projects.create(input.id, row);
  } catch (error) {
    // The same owner's duplicate create won: hand its row back.
    const winner = isAlreadyExists(error) ? await projects.getOptional(input.id) : undefined;
    if (winner === undefined) throw error;
    return done(winner.state, false);
  }
  return done(row, true);
}


/**
 * `setRepository`: set, change or clear a project's repository. Members only.
 * The row is rewritten from the state the store hands the updater, so a
 * concurrent write keeps what it wrote, and of two
 * `setRepository` writes at once the later one wins whole. A lost race is
 * retried past the engine's own budget, as the other contended row writes are.
 */
const setRepository = handler({
  name: "project-set-repository",
  inputSchema: setRepositoryInputSchema,
  outputSchema: setRepositoryOutputSchema,
  resources: WRITE_RESOURCES,
  execute: async (input, ctx) => {
    const row = await projectRowToChange(ctx, input.project, "repository");
    assertRepository(input.repository);
    await retryOnConflict(() => row.updateState((state) => ({ ...state, repository: input.repository })));
    return { project: projectRowSchema.parse(row.state) };
  }
});

/**
 * `setMcpServers`: replace a project's MCP server names whole; `[]` turns
 * them off. Members only, each name one `offered`. Rewritten like
 * `setRepository`, so a concurrent write to another field keeps what it wrote.
 */
function defineSetMcpServers(offered: readonly string[]) {
  return handler({
    name: "project-set-mcp-servers",
    inputSchema: setMcpServersInputSchema,
    outputSchema: setMcpServersOutputSchema,
    resources: WRITE_RESOURCES,
    execute: async (input, ctx) => {
      const row = await projectRowToChange(ctx, input.project, "MCP servers");
      const mcpServers = checkedMcpServers(input.mcpServers, offered);
      await retryOnConflict(() => row.updateState((state) => ({ ...state, mcpServers })));
      return { project: projectRowSchema.parse(row.state) };
    }
  });
}

/** Members only. Rewritten like `setRepository`, so a concurrent write keeps what it wrote. */
const setBrief = handler({
  name: "project-set-brief",
  inputSchema: setBriefInputSchema,
  outputSchema: setBriefOutputSchema,
  resources: WRITE_RESOURCES,
  execute: async (input, ctx) => {
    const row = await projectRowToChange(ctx, input.project, "brief");
    await retryOnConflict(() => row.updateState((state) => ({ ...state, brief: input.brief })));
    return { project: projectRowSchema.parse(row.state) };
  }
});

/** The row a later write changes ({@link projectOfWrite}), when the caller is one of its members. */
async function projectRowToChange(ctx: BlockContext, named: ProjectAddress | undefined, field: string) {
  const address = projectOfWrite(ctx.session.state, named, `change its ${field}`);
  const row = await projectAt(ctx, address);
  if (!isMember(row.state, ctx.session.identity.userId)) {
    throw new ProjectRefusedError("not-a-member", `only project "${address.id}"'s members may change its ${field}.`);
  }
  return row;
}

/**
 * Build the project writes, the project read, the caller's project list and
 * the project files read.
 *
 * @param options `mcpServers`: the MCP server names this host offers its
 *   projects. Absent: none, and a project can name no server.
 * @example
 *   const projects = defineProjectBlocks({ mcpServers: ["linear"] });
 *   defineFlow({ kind: "lab", actions: { ...projects.actions } });
 */
export function defineProjectBlocks(options: ProjectBlocksOptions = {}): ProjectBlocks {
  const offered = [...(options.mcpServers ?? [])];
  const createProject = defineWriteProject(offered);
  const setMcpServers = defineSetMcpServers(offered);
  return {
    createProject,
    setRepository,
    setMcpServers,
    setBrief,
    readProject,
    listProjects,
    readProjectFiles,
    actions: {
      createProject: {
        block: createProject,
        description: "Create a project owned by the caller, with its members. Refused when the id is held by another owner."
      },
      setRepository: {
        block: setRepository,
        description:
          "Set, change or clear (null) the git remote a project's code lives in. Members only; a bare path or a remote carrying a credential is refused."
      },
      setMcpServers: {
        block: setMcpServers,
        description:
          "Replace the MCP servers a project's coding runs get, by the names the server offers; [] turns them off. Members only."
      },
      setBrief: {
        block: setBrief,
        description: "Set, change or clear (null) a project's brief: what the project is for. Members only."
      },
      readProject: {
        block: readProject,
        description:
          "Read a project by its address: its row, every workstream's entry, and its progress worked out from them."
      },
      listProjects: {
        block: listProjects,
        description:
          "List the projects the caller is a member of: each one's visibility, id, title and repository (null when it has none)."
      },
      readProjectFiles: {
        block: readProjectFiles,
        description: "Read the files a project keeps: each file's path under the project and its size in bytes. Members only."
      }
    }
  };
}
