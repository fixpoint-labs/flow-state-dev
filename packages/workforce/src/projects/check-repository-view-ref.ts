// FIX-2624.
/**
 * The client's handle on the projects flow's `checkRepository` view: whether a
 * coding run on a repository would get a checkout on the host, asked with no
 * session. Holds no block, so it is safe in a browser bundle.
 */
import { viewRef } from "@flow-state-dev/client";
import { CHECK_REPOSITORY_VIEW, PROJECTS_FLOW } from "./project-keys";
import type { CheckRepositoryView } from "./project-writes";

/** The repository check, for `client.view(checkRepositoryView, { repository })`. */
export const checkRepositoryView = viewRef<CheckRepositoryView>(PROJECTS_FLOW, CHECK_REPOSITORY_VIEW);
