// FIX-2623.
/**
 * The roster as a view: a user's workers, their own and the standard ones,
 * answered at user scope with no session, keyed by worker id.
 *
 * It joins the two worker collections on the server, the way the client did
 * over a roster session before: a standard worker the user edited is listed
 * once, as their copy, still standard and on its file's team. Each row shows
 * what a browser may read of it (the own collection's client projection, the
 * standard projection as it is). The view records what it read, so a hire, an
 * edit, a fork or a fire reaches its watchers with no topic named by the app.
 *
 * The client's handle is `rosterView` (`roster-view-ref.ts`), which holds no block.
 */
import { defineView, handler, type ViewDefinition } from "@flow-state-dev/core";
import type { BlockDefinition } from "@flow-state-dev/core/types";
import { z } from "zod";
import type { WorkerInstallation } from "./installation";
import { STANDARD_WORKERS_RESOURCE, WORKERS_RESOURCE } from "./keys";

/** One worker on a user's roster, as the roster view answers it. */
const rosterEntrySchema = z.object({
  id: z.string(),
  flow: z.string(),
  standard: z.boolean(),
  description: z.string().nullable(),
  name: z.string().nullable(),
  teamName: z.string().nullable(),
  forkedFrom: z.string().nullable(),
  edited: z.boolean(),
  settings: z.record(z.unknown())
});

const rosterSchema = z.array(rosterEntrySchema);

/** The roster view, as {@link defineRosterView} builds it. Import as a type in client code. */
export type RosterView = ViewDefinition<BlockDefinition<z.ZodObject<Record<string, never>>, typeof rosterSchema>, "user">;

type StoredEntry = { path: string; state: Record<string, unknown> };

const textOrNull = (value: unknown): string | null => (typeof value === "string" ? value : null);
const recordOf = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

/**
 * The roster view over `installation`'s worker collections. Install it in the
 * roster flow's `views`.
 */
export function defineRosterView(installation: WorkerInstallation): RosterView {
  const own = installation.resources[WORKERS_RESOURCE];
  const standard = installation.resources[STANDARD_WORKERS_RESOURCE];
  // What a browser reads of an own row: the collection's client projection.
  const project = (own as { client?: { data?: (state: unknown) => unknown } }).client?.data ?? ((state: unknown) => state);
  return defineView({
    scope: "user",
    key: (entry) => entry.id,
    block: handler({
      name: "workforce-roster",
      inputSchema: z.object({}),
      outputSchema: rosterSchema,
      resources: { [WORKERS_RESOURCE]: own, [STANDARD_WORKERS_RESOURCE]: standard },
      execute: async (_input, ctx) => {
        const resources = ctx.resources as unknown as {
          [WORKERS_RESOURCE]: { list(): Promise<StoredEntry[]> };
          [STANDARD_WORKERS_RESOURCE]: { list(query?: { cursor?: string }): Promise<{ items: StoredEntry[]; nextCursor?: string }> };
        };
        // The standard projection answers in pages: read every one.
        const everyStandard = async (): Promise<StoredEntry[]> => {
          const all: StoredEntry[] = [];
          for (let cursor: string | undefined, first = true; first || cursor !== undefined; first = false) {
            const page = await resources[STANDARD_WORKERS_RESOURCE].list(cursor !== undefined ? { cursor } : undefined);
            all.push(...page.items);
            cursor = page.nextCursor;
          }
          return all;
        };
        const byPath = (a: StoredEntry, b: StoredEntry) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
        const [ownEntriesStored, standardStored] = (await Promise.all([resources[WORKERS_RESOURCE].list(), everyStandard()])).map((entries) => [...entries].sort(byPath));
        const entryOf = (stored: StoredEntry, data: Record<string, unknown>, isStandard: boolean): z.infer<typeof rosterEntrySchema> => ({
          id: stored.path.slice(stored.path.lastIndexOf("/") + 1),
          flow: String(data.flow),
          standard: isStandard,
          description: textOrNull(data.description),
          name: textOrNull(data.name),
          teamName: isStandard ? textOrNull(data.teamName) : null,
          forkedFrom: isStandard ? null : textOrNull(data.forkedFrom),
          edited: false,
          settings: recordOf(data.settings)
        });
        const ownEntries = ownEntriesStored.map((stored) => entryOf(stored, recordOf(project(stored.state)), false));
        const copies = new Map(ownEntries.map((entry) => [entry.id, entry]));
        // A standard worker the user edited is listed once, as their copy:
        // still standard, on its file's team, read from their own stored.
        const standardEntries = standardStored.map((stored) => {
          const file = entryOf(stored, stored.state, true);
          const copy = copies.get(file.id);
          if (copy === undefined) return file;
          copies.delete(file.id);
          return { ...copy, standard: true, teamName: file.teamName, forkedFrom: null, edited: true };
        });
        return [...ownEntries.filter((entry) => copies.has(entry.id)), ...standardEntries];
      }
    })
  }) as unknown as RosterView;
}
