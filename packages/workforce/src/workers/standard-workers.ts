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
import { shownSettingsOf, type ShownSettingsOf } from "./shown-settings";

/**
 * What a standard worker's projected row says: which flow it runs on, what it's
 * for, the names a user reads it and its team by (its file's `name:` and its
 * team's `TEAM.md` `name:`, each `null` when unset), and the settings its flow
 * shows.
 */
export const standardWorkerRowSchema = z.object({
  flow: z.string().min(1),
  description: z.string().nullable(),
  name: z.string().nullable(),
  teamName: z.string().nullable(),
  settings: z.record(z.unknown())
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

/** A worker's display name, its file's `name:`, or `null` when it names none. */
export function workerDisplayName(manifest: WorkerManifest): string | null {
  const name = manifest.declared.name;
  return typeof name === "string" ? name : null;
}

/**
 * A standard worker's projected row.
 *
 * @param shown Which settings each flow shows.
 */
export function standardWorkerRow(manifest: WorkerManifest, defaultFlow: string, shown: ShownSettingsOf): StandardWorkerRow {
  const description = manifest.declared.description;
  const flow = standardWorkerFlow(manifest, defaultFlow) ?? defaultFlow;
  return {
    flow,
    description: typeof description === "string" ? description : null,
    name: workerDisplayName(manifest),
    teamName: manifest.teamName ?? null,
    settings: shownSettingsOf(shown(flow), manifest.declared)
  };
}

/**
 * The standard-worker projection, read from `standard()` on every read.
 *
 * @param standard The installation's standard workers, by id.
 * @param defaultFlow The flow a worker that names none runs on.
 * @param shown Which settings each flow shows (`showSettings`). Omitted, none.
 */
export function defineStandardWorkerCollection(
  standard: () => ReadonlyMap<string, WorkerManifest>,
  defaultFlow: string,
  shown: ShownSettingsOf = () => []
) {
  return defineProjectedResourceCollection({
    pattern: STANDARD_WORKERS_PATTERN,
    scope: "user",
    stateSchema: standardWorkerRowSchema,
    read: async ({ key }) => {
      const manifest = standard().get(key);
      return manifest === undefined ? null : standardWorkerRow(manifest, defaultFlow, shown);
    },
    search: async ({ query }) => {
      const prefix = query.prefix ?? "";
      const hits = [...standard().values()]
        .filter((manifest) => manifest.id.startsWith(prefix))
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        .map((manifest) => ({ key: manifest.id, state: standardWorkerRow(manifest, defaultFlow, shown) }));
      return { hits };
    },
    client: { state: { read: true } }
  });
}
