/**
 * Reaching a project by its address: which collections its row, its files and
 * its workstream entries live in, and the row itself.
 *
 * A shared project's row is the organization's `projects/<id>`; a private
 * one's is the same key in the caller's own user scope. So a private address
 * names only the caller's own projects: another user's private project is not
 * there to find, and is refused exactly as a project that doesn't exist is.
 *
 * The accessors take the narrowest context they read, `{ resources }`, so a
 * block passes its own typed context as it is. A typed context can't widen to
 * `BlockContext`: its `resources` registry carries a `get` method typed to its
 * own declarations, which `BlockContext`'s index signature
 * (`Record<string, AnyResourceRef>`) refuses.
 */

import type { JsonObject, ResourceCollectionRef, ResourceRef } from "@flow-state-dev/core/types";
import {
  defineProjectFilesCollection,
  definePrivateProjectFilesCollection,
  definePrivateProjectsCollection,
  defineProjectsCollection,
  PRIVATE_PROJECT_FILES_RESOURCE,
  PRIVATE_PROJECTS_RESOURCE,
  PROJECT_FILES_RESOURCE,
  PROJECTS_RESOURCE,
  type ProjectAddress,
  type ProjectFile,
  type ProjectRow,
  type ProjectVisibility
} from "./collections";
import { ProjectRefusedError } from "./project-refusal";
import { workstreamsAccessor, type WorkstreamEntry } from "./workstream-collections";

/** The project rows at both visibilities, as one resource map a block spreads into its `resources`. */
export const PROJECT_ROW_RESOURCES = {
  [PROJECTS_RESOURCE]: defineProjectsCollection(),
  [PRIVATE_PROJECTS_RESOURCE]: definePrivateProjectsCollection()
} as const;

/** The project files at both visibilities, as one resource map. */
export const PROJECT_FILE_RESOURCES = {
  [PROJECT_FILES_RESOURCE]: defineProjectFilesCollection(),
  [PRIVATE_PROJECT_FILES_RESOURCE]: definePrivateProjectFilesCollection()
} as const;

/** The accessor a project's rows are declared under at `visibility`. */
export function projectRowsAccessor(visibility: ProjectVisibility): string {
  return visibility === "private" ? PRIVATE_PROJECTS_RESOURCE : PROJECTS_RESOURCE;
}

/** The accessor a project's files are declared under at `visibility`. */
export function projectFilesAccessor(visibility: ProjectVisibility): string {
  return visibility === "private" ? PRIVATE_PROJECT_FILES_RESOURCE : PROJECT_FILES_RESOURCE;
}

/** The slice of a block's context the accessors read: the resources it declared. */
export type ResourcesContext = { readonly resources?: object };

/** The error a missing declaration throws: which collection, and what installs it. */
export type MissingCollection = (accessor: string) => string;

const spreadProjectResources: MissingCollection = (accessor) =>
  `This block reads projects but does not declare "${accessor}". Spread PROJECT_ROW_RESOURCES and ` +
  `PROJECT_FILE_RESOURCES into its \`resources\`.`;

const spreadWorkstreamResources: MissingCollection = (accessor) =>
  `This block reads workstreams but does not declare "${accessor}". Spread WORKSTREAM_RESOURCES into its \`resources\`.`;

/**
 * The collection a block declared under `accessor`, typed by the caller, or a
 * loud error saying what installs it (`missing`). The one place a declared
 * collection is read by name: the registry is keyed by the block's own
 * declarations, so a name chosen at run time is read as `unknown` and typed here.
 */
export function collectionAt<TState extends JsonObject = JsonObject>(
  ctx: ResourcesContext,
  accessor: string,
  missing: MissingCollection = spreadProjectResources
): ResourceCollectionRef<TState> {
  const ref = (ctx.resources as Record<string, unknown> | undefined)?.[accessor];
  if (ref === undefined) throw new Error(missing(accessor));
  return ref as ResourceCollectionRef<TState>;
}

/** The project rows at `visibility`, as the calling block declared them. */
export function projectRowsAt(
  ctx: ResourcesContext,
  visibility: ProjectVisibility,
  missing?: MissingCollection
): ResourceCollectionRef<ProjectRow> {
  return collectionAt<ProjectRow>(ctx, projectRowsAccessor(visibility), missing);
}

/** The project files at `visibility`, as the calling block declared them. */
export function projectFilesAt(
  ctx: ResourcesContext,
  visibility: ProjectVisibility,
  missing?: MissingCollection
): ResourceCollectionRef<ProjectFile> {
  return collectionAt<ProjectFile>(ctx, projectFilesAccessor(visibility), missing);
}

/** The workstream entries at `visibility`, as the calling block declared them. */
export function workstreamsAt(
  ctx: ResourcesContext,
  visibility: ProjectVisibility,
  missing: MissingCollection = spreadWorkstreamResources
): ResourceCollectionRef<WorkstreamEntry> {
  return collectionAt<WorkstreamEntry>(ctx, workstreamsAccessor(visibility), missing);
}

/**
 * The row `address` names, or a `no-such-project` refusal. A private address
 * is read in the caller's own user scope only.
 */
export async function projectAt(ctx: ResourcesContext, address: ProjectAddress): Promise<ResourceRef<ProjectRow>> {
  const row = await projectRowsAt(ctx, address.visibility).getOptional(address.id);
  if (row === undefined) {
    throw new ProjectRefusedError(
      "no-such-project",
      address.visibility === "private"
        ? `you have no private project "${address.id}".`
        : `this organization has no project "${address.id}".`
    );
  }
  return row;
}
