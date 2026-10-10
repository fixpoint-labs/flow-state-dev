/**
 * The organization's projects.
 *
 * A project belongs to the organization and names no team. Its workstreams
 * come from any team. Each person talks to a project through their own
 * project coordinator (`org/workers/project-coordinator`).
 */
import { defineProjectsCollection } from "@flow-state-dev/workforce";

export default defineProjectsCollection();
