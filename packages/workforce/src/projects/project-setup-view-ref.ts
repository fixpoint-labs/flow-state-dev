// FIX-2775 D3.
/**
 * The client's handle on the projects flow's `projectSetup` view: which worker
 * each user's project coordinator runs as, asked with no session. Holds no
 * block, so it is safe in a browser bundle.
 */
import { viewRef } from "@flow-state-dev/client";
import { PROJECT_SETUP_VIEW, PROJECTS_FLOW } from "./project-keys";
import type { ProjectSetupView } from "./project-coordinator";

/** The project setup, for `client.view(projectSetupView, {})` or `useView(projectSetupView, {})`. */
export const projectSetupView = viewRef<ProjectSetupView>(PROJECTS_FLOW, PROJECT_SETUP_VIEW);
