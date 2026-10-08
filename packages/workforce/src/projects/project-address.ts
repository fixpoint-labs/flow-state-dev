/**
 * Reaching a project by its address: which collections its row and its files
 * live in, and the row itself.
 *
 * A shared project's row is the organization's `projects/<id>`; a private
 * one's is the same key in the caller's own user scope. So a private address
 * names only the caller's own projects: another user's private project is not
 * there to find, and is refused exactly as a project that doesn't exist is.
 */

import type { BlockContext, ResourceCollectionRef, ResourceRef } from "@flow-state-dev/core/types";
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

/** The collection a block declared under `accessor`, or a loud error naming what to install. */
function collectionOn(ctx: BlockContext, accessor: string): ResourceCollectionRef {
  const ref = (ctx.resources as Record<string, unknown> | undefined)?.[accessor];
  if (ref === undefined) {
    throw new Error(
      `This block reads projects but does not declare "${accessor}". Spread PROJECT_ROW_RESOURCES and ` +
        `PROJECT_FILE_RESOURCES into its \`resources\`.`
    );
  }
  return ref as ResourceCollectionRef;
}

/** The project rows at `visibility`, as the calling block declared them. */
export function projectRowsAt(ctx: BlockContext, visibility: ProjectVisibility): ResourceCollectionRef<ProjectRow> {
  return collectionOn(ctx, projectRowsAccessor(visibility)) as unknown as ResourceCollectionRef<ProjectRow>;
}

/** The project files at `visibility`, as the calling block declared them. */
export function projectFilesAt(ctx: BlockContext, visibility: ProjectVisibility): ResourceCollectionRef<ProjectFile> {
  return collectionOn(ctx, projectFilesAccessor(visibility)) as unknown as ResourceCollectionRef<ProjectFile>;
}

/** Where `address` lives, in words, for a refusal. */
export function describeAddress(address: ProjectAddress): string {
  return address.visibility === "private" ? `private project "${address.id}"` : `project "${address.id}"`;
}

/**
 * The row `address` names, or a `no-such-project` refusal. A private address
 * is read in the caller's own user scope only.
 */
export async function projectAt(ctx: BlockContext, address: ProjectAddress): Promise<ResourceRef<ProjectRow>> {
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
