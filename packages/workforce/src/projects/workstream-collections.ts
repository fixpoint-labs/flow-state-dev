/**
 * Workstream entries: one per workstream, keyed by its project, its owner and
 * its id, at both visibilities.
 *
 *   workstreams/<projectId>/<~owner>/<workstreamId>
 *
 * A workstream is one area of a project with one owner: this entry, which
 * everyone who reads the project reads, and its lead's workstream session,
 * which only the owner opens. The entry says who leads it, which session is
 * theirs, its status, its due date, its objectives and its latest report (the
 * entry's content).
 *
 * **One writer.** The collections declare `ownerWrites` on the owner segment,
 * so the engine refuses a create, update or delete from anyone but the user
 * the key names, whichever flow writes (FIX-1793 BR-11). Who wrote last is
 * `writtenBy`, stamped from the session (`shared-resource.ts`), for display
 * only: it never decides a write. The owner is read off the key, never the
 * state.
 *
 * **Two visibilities.** A shared project's entries are the organization's,
 * read by everyone in it; a private project's are the same keys in the
 * owner's user scope. A project's entries are its direct children under
 * `workstreams/<projectId>/`, read by one prefix.
 *
 * Leaf module: core, zod and the shared-resource helper only, so the worker
 * installation's create check and the project blocks share one declaration.
 * The entry's own shape and parser are `workstream-entry.ts`, a leaf a browser
 * imports.
 */

import { ownerSegment } from "@flow-state-dev/core";
import { z } from "zod";
import { sharedResource } from "../shared-resource";
import { projectAddressSchema, type ProjectVisibility } from "./collections";
import {
  parseWorkstreamEntry,
  workstreamDueSchema,
  workstreamEntryShape,
  workstreamEntrySchema,
  workstreamObjectiveSchema,
  workstreamPlaceOf,
  workstreamStatusSchema,
  type ParsedWorkstreamEntry,
  type WorkstreamEntry,
  type WorkstreamEntryPlace,
  type WorkstreamObjective,
  type WorkstreamStatus
} from "./workstream-entry";
import { PRIVATE_WORKSTREAMS_RESOURCE, WORKSTREAMS_RESOURCE, workstreamsAccessor } from "./workstream-ref";

export { PRIVATE_WORKSTREAMS_RESOURCE, WORKSTREAMS_RESOURCE, workstreamsAccessor };
export {
  parseWorkstreamEntry,
  workstreamDueSchema,
  workstreamEntrySchema,
  workstreamObjectiveSchema,
  workstreamPlaceOf,
  workstreamStatusSchema,
  type ParsedWorkstreamEntry,
  type WorkstreamEntry,
  type WorkstreamEntryPlace,
  type WorkstreamObjective,
  type WorkstreamStatus
};

/** The entries' key pattern. **Pinned**: persisted, and FIX-1792 and FIX-1794 read it. */
export const WORKSTREAMS_PATTERN = "workstreams/[project]/[owner]/[workstream]";

/** Every field a browser reads, named (BP-015). The session id grants nothing to anyone but the owner. */
const ENTRY_CLIENT_FIELDS = [
  "title",
  "lead",
  "sessionId",
  "status",
  "due",
  "objectives",
  "openedAt",
  "updatedAt",
  "writtenBy"
] as const;

const declaration = (scope: ProjectVisibility) =>
  sharedResource(WORKSTREAMS_PATTERN, workstreamEntryShape, {
    scope: scope === "private" ? "user" : "org",
    ownerWrites: { param: "owner" },
    // Shared across flows: the project blocks, the lead's worker flow and the
    // create check all read one copy.
    flowIsolation: false,
    // A project's entries are read by one prefix; never loaded whole at request start.
    prefetchMode: "lazy",
    client: { state: { read: true }, content: { read: true }, expose: ENTRY_CLIENT_FIELDS }
  });

const SHARED_ENTRIES = declaration("shared");
const PRIVATE_ENTRIES = declaration("private");

/** A shared project's workstream entries, at org scope. */
export function defineWorkstreamsCollection() {
  return SHARED_ENTRIES;
}

/** A private project's workstream entries, at its owner's user scope. */
export function definePrivateWorkstreamsCollection() {
  return PRIVATE_ENTRIES;
}

/** Both declarations, as one resource map a block or a flow spreads into its `resources`. */
export const WORKSTREAM_RESOURCES = {
  [WORKSTREAMS_RESOURCE]: SHARED_ENTRIES,
  [PRIVATE_WORKSTREAMS_RESOURCE]: PRIVATE_ENTRIES
} as const;

/**
 * A workstream's address: its project's address and its id. Its owner is the
 * user asking, so an address only ever reaches the caller's own entry. Its
 * one-string form is `workstreamRef` (`workstream-ref.ts`).
 */
export const workstreamAddressSchema = z.object({ project: projectAddressSchema, id: z.string().min(1) }).strict();

/** One workstream as the project reads and writes answer it: its entry, with its project, its owner and its id. */
export const workstreamViewSchema = workstreamEntrySchema.extend({
  project: projectAddressSchema,
  id: z.string(),
  owner: z.string()
});

/** @see workstreamViewSchema */
export type WorkstreamView = z.infer<typeof workstreamViewSchema>;

/** Why a workstream id is not usable, or `undefined` when it is: one path segment, not empty. */
export function workstreamIdProblem(id: string): string | undefined {
  if (id.length === 0) return "a workstream id can't be empty";
  if (id.includes("/") || id.includes("\\") || id === "." || id === "..") {
    return `workstream id "${id}" must be one path segment, with no "/"`;
  }
  return undefined;
}

/** The key of `owner`'s entry `workstream` in `project`, relative to the collection. */
export function workstreamEntryKey(project: string, owner: string, workstream: string): Record<string, string> {
  return { project, owner: ownerSegment(owner), workstream };
}

/**
 * The prefix of one project's entries, relative to the collection:
 * `<projectId>/`. The trailing slash keeps `apollo` from reading `apollo2`'s.
 */
export function workstreamEntriesPrefix(project: string): string {
  return `${project}/`;
}

