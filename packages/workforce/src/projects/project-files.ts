/**
 * `readProjectFiles`: a member's read of the files a project keeps.
 *
 * The `project-files` collections have no browser read, so this is how a
 * person reads them. It finds the project by its address (a private one only
 * in the caller's own user scope), checks the session's owner against the
 * row's `members` (`membership-gate.ts`), then lists only
 * `project-files/<projectId>/…` at that visibility, filtered at the source
 * (BP-033), never the whole collection. It returns each file's path and size,
 * never its body: a handler's output is logged as the tool result, so a body
 * here would land whole in the session log and the model's context.
 */

import { handler } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import { z } from "zod";
import { projectAddressSchema, projectFilesPrefix } from "./collections";
import { isMember } from "./membership-gate";
import { projectAt, projectFilesAt, PROJECT_FILE_RESOURCES, PROJECT_ROW_RESOURCES } from "./project-address";
import { ProjectRefusedError } from "./project-refusal";

/** What reading a project's files takes: the project's address. */
export const readProjectFilesInputSchema = z.object({ project: projectAddressSchema }).strict();

/** @see readProjectFilesInputSchema */
export type ReadProjectFilesInput = z.infer<typeof readProjectFilesInputSchema>;

/** What reading a project's files returns: each file's path under the project, and its size in UTF-8 bytes. */
export const readProjectFilesOutputSchema = z.object({
  files: z.array(z.object({ path: z.string(), size: z.number().int().nonnegative() }))
});

/** @see readProjectFilesOutputSchema */
export type ReadProjectFilesOutput = z.infer<typeof readProjectFilesOutputSchema>;

const utf8 = new TextEncoder();

/** The storage prefix both visibilities' file collections share (`project-files/**`), stripped from a ref's `path`. */
const COLLECTION_PREFIX = "project-files/";

/** Read a project's files. Members only; `no-such-project` and `not-a-member` otherwise. */
export const readProjectFiles = handler({
  name: "project-read-files",
  inputSchema: readProjectFilesInputSchema,
  outputSchema: readProjectFilesOutputSchema,
  resources: { ...PROJECT_ROW_RESOURCES, ...PROJECT_FILE_RESOURCES },
  execute: async (input, rawCtx): Promise<ReadProjectFilesOutput> => {
    const ctx = rawCtx as unknown as BlockContext;
    const { visibility, id } = input.project;
    const row = await projectAt(ctx, input.project);
    if (!isMember(row.state, ctx.session.identity.userId)) {
      throw new ProjectRefusedError("not-a-member", `only project "${id}"'s members may read its files.`);
    }
    const prefix = projectFilesPrefix(id);
    const out: ReadProjectFilesOutput["files"] = [];
    for (const ref of await projectFilesAt(ctx, visibility).list(prefix)) {
      const content = await ref.readContent();
      if (content === null) continue;
      out.push({ path: ref.path.slice(COLLECTION_PREFIX.length + prefix.length), size: utf8.encode(content).length });
    }
    return { files: out };
  }
});
