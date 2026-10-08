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
 */

import { handler } from "@flow-state-dev/core";
import type { BlockContext, ResourceCollectionRef } from "@flow-state-dev/core/types";
import { z } from "zod";
import { projectAddressSchema, projectRowSchema, projectVisibilitySchema } from "./collections";
import { projectAt, PROJECT_ROW_RESOURCES } from "./project-address";
import { projectProgress, WORKSTREAM_STATUSES } from "./project-progress";
import {
  WORKSTREAM_RESOURCES,
  workstreamEntriesPrefix,
  workstreamEntrySchema,
  workstreamPlaceOf,
  workstreamsAccessor,
  workstreamViewSchema,
  type WorkstreamEntry,
  type WorkstreamView
} from "./workstream-collections";

/** What reading a project takes: its address. */
export const readProjectInputSchema = z.object({ project: projectAddressSchema }).strict();

/** @see readProjectInputSchema */
export type ReadProjectInput = z.infer<typeof readProjectInputSchema>;

/** A project's progress, as `readProject` answers it. @see projectProgress */
export const projectProgressSchema = z.object({
  workstreams: z.number().int(),
  byStatus: z.object(Object.fromEntries(WORKSTREAM_STATUSES.map((status) => [status, z.number().int()]))),
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

/** Read a project, its entries and its progress. `no-such-project` when the address names none. */
export const readProject = handler({
  name: "project-read",
  inputSchema: readProjectInputSchema,
  outputSchema: readProjectOutputSchema,
  resources: { ...PROJECT_ROW_RESOURCES, ...WORKSTREAM_RESOURCES },
  execute: async (input, rawCtx): Promise<ReadProjectOutput> => {
    const ctx = rawCtx as unknown as BlockContext;
    const row = await projectAt(ctx, input.project);
    const entries = ctx.resources[workstreamsAccessor(input.project.visibility)] as unknown as ResourceCollectionRef<WorkstreamEntry>;
    const workstreams: WorkstreamView[] = [];
    for (const ref of await entries.list(workstreamEntriesPrefix(input.project.id))) {
      const place = workstreamPlaceOf(ref.path);
      // The pattern holds exactly three segments, so every key under the prefix is a direct entry.
      if (place === undefined || place.project !== input.project.id) continue;
      workstreams.push({ ...workstreamEntrySchema.parse(ref.state), project: input.project, id: place.id, owner: place.owner });
    }
    workstreams.sort((a, b) => (a.openedAt < b.openedAt ? -1 : a.openedAt > b.openedAt ? 1 : 0));
    return {
      project: projectRowSchema.parse(row.state),
      visibility: input.project.visibility,
      workstreams,
      progress: projectProgress(workstreams, Date.now())
    };
  }
});
