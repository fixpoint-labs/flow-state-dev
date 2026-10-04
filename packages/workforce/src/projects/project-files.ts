/**
 * `readProjectFiles`: a member's read of the files a project keeps.
 *
 * The `project-files` collection has no browser read, so this is how a person
 * reads them. It checks the session's owner against the row's `members` first
 * (`membership-gate.ts`), then lists only `project-files/<projectId>/…`,
 * filtered at the source (BP-033), never the whole collection. It returns each
 * file's path and size, never its body: a handler's output is logged as the
 * tool result, so a body here would land whole in the session log and the
 * model's context.
 */

import { handler } from "@flow-state-dev/core";
import type { BlockContext, ResourceCollectionRef } from "@flow-state-dev/core/types";
import { z } from "zod";
import {
  defineProjectFilesCollection,
  defineProjectsCollection,
  PROJECT_FILES_RESOURCE,
  projectFilesPrefix,
  PROJECTS_RESOURCE,
  type ProjectFile,
  type ProjectRow
} from "./collections";
import { isMember } from "./membership-gate";
import { ProjectRefusedError } from "./project-refusal";

/** What reading a project's files takes. */
export const readProjectFilesInputSchema = z.object({ projectId: z.string().min(1) }).strict();

/** @see readProjectFilesInputSchema */
export type ReadProjectFilesInput = z.infer<typeof readProjectFilesInputSchema>;

/** What reading a project's files returns: each file's path under the project, and its size in UTF-8 bytes. */
export const readProjectFilesOutputSchema = z.object({
  files: z.array(z.object({ path: z.string(), size: z.number().int().nonnegative() }))
});

/** @see readProjectFilesOutputSchema */
export type ReadProjectFilesOutput = z.infer<typeof readProjectFilesOutputSchema>;

const utf8 = new TextEncoder();

/** The collection's storage prefix, stripped from a ref's `path`. */
const COLLECTION_PREFIX = `${PROJECT_FILES_RESOURCE}/`;

/** Read a project's files. Members only; `no-such-project` and `not-a-member` otherwise. */
export const readProjectFiles = handler({
  name: "project-read-files",
  inputSchema: readProjectFilesInputSchema,
  outputSchema: readProjectFilesOutputSchema,
  resources: {
    [PROJECTS_RESOURCE]: defineProjectsCollection(),
    [PROJECT_FILES_RESOURCE]: defineProjectFilesCollection()
  },
  execute: async (input, rawCtx): Promise<ReadProjectFilesOutput> => {
    const ctx = rawCtx as unknown as BlockContext;
    const projects = ctx.resources[PROJECTS_RESOURCE] as unknown as ResourceCollectionRef<ProjectRow>;
    const files = ctx.resources[PROJECT_FILES_RESOURCE] as unknown as ResourceCollectionRef<ProjectFile>;
    const row = await projects.getOptional(input.projectId);
    if (row === undefined) {
      throw new ProjectRefusedError("no-such-project", `this organization has no project "${input.projectId}".`);
    }
    if (!isMember(row.state, ctx.session.identity.userId)) {
      throw new ProjectRefusedError("not-a-member", `only project "${input.projectId}"'s members may read its files.`);
    }
    const prefix = projectFilesPrefix(input.projectId);
    const out: ReadProjectFilesOutput["files"] = [];
    for (const ref of await files.list(prefix)) {
      const content = await ref.readContent();
      if (content === null) continue;
      out.push({ path: ref.path.slice(COLLECTION_PREFIX.length + prefix.length), size: utf8.encode(content).length });
    }
    return { files: out };
  }
});
