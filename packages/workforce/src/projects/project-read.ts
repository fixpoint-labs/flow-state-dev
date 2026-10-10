/**
 * `readProject`: a project as a view opens it — its row, every workstream's
 * entry, and the progress worked out from them.
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
 */

import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import { projectAddressSchema, projectRowSchema, projectVisibilitySchema, type ProjectAddress } from "./collections";
import { projectAt, PROJECT_ROW_RESOURCES, workstreamsAt, type ResourcesContext } from "./project-address";
import { projectProgress } from "./project-progress";
import {
  WORKSTREAM_RESOURCES,
  workstreamEntriesPrefix,
  workstreamEntrySchema,
  workstreamPlaceOf,
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
    const place = workstreamPlaceOf(ref.path);
    // The pattern holds exactly three segments, so every key under the prefix is a direct entry.
    if (place === undefined || place.project !== project.id) continue;
    workstreams.push({ ...workstreamEntrySchema.parse(ref.state), project, id: place.id, owner: place.owner });
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
