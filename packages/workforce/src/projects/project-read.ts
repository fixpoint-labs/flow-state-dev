/**
 * `readProject`: a project as a view opens it — its row, every workstream's
 * entry, and the progress worked out from them. `listProjects`: the projects
 * the caller is a member of, one line each.
 *
 * Two store reads, whatever the project holds: the row by its address, and
 * the project's entries by one prefix (`workstreams/<projectId>/`), never one
 * read per entry and never the whole Lab. Progress is computed from those
 * entries at read (`project-progress.ts`) and nothing is written back.
 *
 * Who reads: a shared project, everyone in its organization, every owner's
 * entries included; a private project, its owner alone, since its address
 * reaches only the caller's own user scope. Reports, the entries' content,
 * are left out: reading them would be a read per entry.
 *
 * {@link readProjectAt} is the read itself: the app's `readProject` action and
 * a project coordinator's `readProject` tool (`project-coordinator.ts`) both
 * run it.
 *
 * `listProjects` reads two collections whole: the organization's projects and
 * the caller's own private ones. A shared row is kept only when the session's
 * owner is one of its `members` (`membership-gate.ts`); a private row is in the
 * caller's own user scope, so it is theirs. The rows carry no member index, so
 * the shared filter runs on the rows read.
 */

import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import { projectAddressSchema, projectRowSchema, projectVisibilitySchema, type ProjectAddress, type ProjectVisibility } from "./collections";
import { isMember } from "./membership-gate";
import { projectAt, projectRowsAt, PROJECT_ROW_RESOURCES, workstreamsAt, type ResourcesContext } from "./project-address";
import { projectProgress } from "./project-progress";
import {
  WORKSTREAM_RESOURCES,
  parseWorkstreamEntry,
  workstreamEntriesPrefix,
  workstreamViewSchema,
  type WorkstreamView
} from "./workstream-collections";

/** What reading a project takes: its address. */
export const readProjectInputSchema = z.object({ project: projectAddressSchema }).strict();

/** @see readProjectInputSchema */
export type ReadProjectInput = z.infer<typeof readProjectInputSchema>;

/** A project's progress, as `readProject` answers it. @see projectProgress */
export const projectProgressSchema = z.object({
  workstreams: z.number().int(),
  /** How many workstreams carry each status label, for the labels present. */
  byStatus: z.record(z.number().int()),
  objectives: z.object({ met: z.number().int(), total: z.number().int() }),
  nextDue: z.string().nullable(),
  stale: z.array(z.object({ owner: z.string(), id: z.string(), updatedAt: z.string() }))
});

/** What reading a project returns. */
export const readProjectOutputSchema = z.object({
  project: projectRowSchema,
  visibility: projectVisibilitySchema,
  /** Every workstream's entry, oldest first. */
  workstreams: z.array(workstreamViewSchema),
  progress: projectProgressSchema
});

/** @see readProjectOutputSchema */
export type ReadProjectOutput = z.infer<typeof readProjectOutputSchema>;

/**
 * Every entry of the project at `project`, oldest first, from one prefix read.
 * The calling block declares {@link WORKSTREAM_RESOURCES}.
 */
export async function projectEntries(ctx: ResourcesContext, project: ProjectAddress): Promise<WorkstreamView[]> {
  const entries = workstreamsAt(ctx, project.visibility);
  const workstreams: WorkstreamView[] = [];
  for (const ref of await entries.list(workstreamEntriesPrefix(project.id))) {
    // The pattern holds exactly three segments, so every key under the prefix is a direct entry.
    const entry = parseWorkstreamEntry(ref.path, ref.state);
    if (entry === undefined || entry.project !== project.id) continue;
    workstreams.push({ ...entry, project });
  }
  return workstreams.sort((a, b) => (a.openedAt < b.openedAt ? -1 : a.openedAt > b.openedAt ? 1 : 0));
}

/**
 * Read the project at `project`, its entries and its progress: the row by its
 * address, the entries by one prefix. `no-such-project` when the address
 * names none. The calling block declares the project rows and the entries.
 */
export async function readProjectAt(ctx: ResourcesContext, project: ProjectAddress): Promise<ReadProjectOutput> {
  const row = await projectAt(ctx, project);
  const workstreams = await projectEntries(ctx, project);
  return {
    project: projectRowSchema.parse(row.state),
    visibility: project.visibility,
    workstreams,
    progress: projectProgress(workstreams, Date.now())
  };
}

/** Read a project, its entries and its progress. `no-such-project` when the address names none. */
export const readProject = handler({
  name: "project-read",
  inputSchema: readProjectInputSchema,
  outputSchema: readProjectOutputSchema,
  resources: { ...PROJECT_ROW_RESOURCES, ...WORKSTREAM_RESOURCES },
  execute: (input, ctx): Promise<ReadProjectOutput> => readProjectAt(ctx, input.project)
});

/** What listing the caller's projects takes: nothing. */
export const listProjectsInputSchema = z.object({}).strict();

/** One project the caller is a member of, as `listProjects` lists it. */
export const listedProjectSchema = z.object({
  visibility: projectVisibilitySchema,
  id: z.string(),
  title: z.string(),
  /** The git remote its code lives in, or `null` for a project with no repository. */
  repository: z.string().nullable()
});

/** What listing the caller's projects returns: shared ones first, then private, each by id. */
export const listProjectsOutputSchema = z.object({ projects: z.array(listedProjectSchema) });

/** @see listProjectsOutputSchema */
export type ListProjectsOutput = z.infer<typeof listProjectsOutputSchema>;

/**
 * The projects `userId` is a member of: every shared row whose `members` hold
 * them, and every private row in their own scope. The calling block declares
 * the project rows at both visibilities.
 */
export async function listProjectsOf(ctx: ResourcesContext, userId: string | undefined): Promise<ListProjectsOutput> {
  const projects: ListProjectsOutput["projects"] = [];
  for (const visibility of ["shared", "private"] as const satisfies readonly ProjectVisibility[]) {
    const listed: ListProjectsOutput["projects"] = [];
    for (const ref of await projectRowsAt(ctx, visibility).list()) {
      // A row that lost its id, title or owner is no project anyone can address: left
      // out of the list, where `readProjectAt` refuses the one address loudly.
      const parsed = projectRowSchema.safeParse(ref.state);
      if (!parsed.success) continue;
      const row = parsed.data;
      if (visibility === "shared" && !isMember(row, userId)) continue;
      listed.push({ visibility, id: row.id, title: row.title, repository: row.repository });
    }
    projects.push(...listed.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)));
  }
  return { projects };
}

/** List the projects the session's owner is a member of: each one's address, title and repository. */
export const listProjects = handler({
  name: "project-list",
  inputSchema: listProjectsInputSchema,
  outputSchema: listProjectsOutputSchema,
  resources: { ...PROJECT_ROW_RESOURCES },
  execute: (_input, ctx): Promise<ListProjectsOutput> => listProjectsOf(ctx, ctx.session.identity.userId)
});
