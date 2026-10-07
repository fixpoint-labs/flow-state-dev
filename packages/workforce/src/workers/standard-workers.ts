/**
 * The standard workers: the ones the installation's `WORKER.md` files declare,
 * the same for every user, projected read-only.
 *
 * Nothing stores them. They are read from the loaded files each time, so a
 * deploy that changes a file changes the worker for everyone, and nothing a
 * user does at run time can write one: the projection has no write path, and
 * every write the worker model offers refuses a standard worker's id
 * (BR-3). To change one for yourself, fork it.
 */
import { defineProjectedResourceCollection } from "@flow-state-dev/core";
import { z } from "zod";
import type { WorkerManifest } from "../manifest";
import { readDeclaredFlow } from "../declared-flow";
import { STANDARD_WORKERS_PATTERN } from "./keys";

/** What a standard worker's projected row says: which flow it runs on, and what it's for. */
export const standardWorkerRowSchema = z.object({
  flow: z.string().min(1),
  description: z.string().nullable()
});

/** One standard worker as the projection shows it. */
export type StandardWorkerRow = z.infer<typeof standardWorkerRowSchema>;

/**
 * The flow a standard worker runs on: its `flow:`, or `defaultFlow` when its
 * file names none. `undefined` for a file whose `flow:` names no flow, which
 * the installation refuses when it is created.
 */
export function standardWorkerFlow(manifest: WorkerManifest, defaultFlow: string): string | undefined {
  const declared = readDeclaredFlow(manifest.declared, defaultFlow);
  return "kind" in declared ? declared.kind : undefined;
}

/** A standard worker's projected row. */
export function standardWorkerRow(manifest: WorkerManifest, defaultFlow: string): StandardWorkerRow {
  const description = manifest.declared.description;
  return {
    flow: standardWorkerFlow(manifest, defaultFlow) ?? defaultFlow,
    description: typeof description === "string" ? description : null
  };
}

/**
 * The standard-worker projection, read from `standard()` on every read.
 *
 * @param standard The installation's standard workers, by id.
 * @param defaultFlow The flow a worker that names none runs on.
 */
export function defineStandardWorkerCollection(
  standard: () => ReadonlyMap<string, WorkerManifest>,
  defaultFlow: string
) {
  return defineProjectedResourceCollection({
    pattern: STANDARD_WORKERS_PATTERN,
    scope: "user",
    stateSchema: standardWorkerRowSchema,
    read: async ({ key }) => {
      const manifest = standard().get(key);
      return manifest === undefined ? null : standardWorkerRow(manifest, defaultFlow);
    },
    search: async ({ query }) => {
      const prefix = query.prefix ?? "";
      const hits = [...standard().values()]
        .filter((manifest) => manifest.id.startsWith(prefix))
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        .map((manifest) => ({ key: manifest.id, state: standardWorkerRow(manifest, defaultFlow) }));
      return { hits };
    },
    client: { state: { read: true } }
  });
}
