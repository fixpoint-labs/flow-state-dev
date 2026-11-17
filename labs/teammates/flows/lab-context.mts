// FIX-2624; FIX-2771.
/**
 * What the lab works on and with, as a user-scope view the page reads with no
 * session: the working folder and the problem a coding run's checkout of it
 * would be refused with, the model, the default harness, and each worker's
 * declared delegates. The page draws its context strip and first-run lines
 * from it, through `labContextView` (`lab-context-ref.mts`); the host serves
 * the flow ({@link labContextFlow}). Its answer is the host's settings, the
 * same for every caller: it reads no resource, so it names no topic.
 */
import { defineFlow, defineView, handler } from "@flow-state-dev/core";
import { z } from "zod";
import { LAB_CONTEXT_FLOW } from "./lab-context-ref.mts";

const labContextSchema = z.object({
  /** The working folder, as an absolute path. */
  folder: z.string(),
  /** Why a coding run's checkout of the folder would be refused, or `null` when it wouldn't. */
  folderProblem: z.string().nullable(),
  /** The model the teammates answer on. */
  model: z.string(),
  /** The harness a coding worker whose file names none runs on. */
  harness: z.string(),
  /** Each worker's declared delegates, by worker id: ids, or `"all"`. A worker with none is absent. */
  delegates: z.record(z.string(), z.union([z.literal("all"), z.array(z.string())])),
});

/** What the lab works on and with, as the view answers it. */
export type LabContext = z.infer<typeof labContextSchema>;

/** The lab's context view, answering `read()`. */
export function labContextViewOf(read: () => Promise<LabContext>) {
  return defineView({
    scope: "user",
    block: handler({
      name: "lab-context",
      description: "What the lab works on and with: the working folder and its problem if any, the model, the default harness, and each worker's delegates.",
      inputSchema: z.object({}),
      outputSchema: labContextSchema,
      execute: read,
    }),
  });
}

/** The view, for the page's ref (a type import: the page holds no block). */
export type LabContextView = ReturnType<typeof labContextViewOf>;

/** The flow that serves {@link labContextViewOf} as its `context` view. Register what it returns. */
export const labContextFlow = (read: () => Promise<LabContext>) =>
  defineFlow({ kind: LAB_CONTEXT_FLOW, actions: {}, views: { context: labContextViewOf(read) } })({ id: LAB_CONTEXT_FLOW });
