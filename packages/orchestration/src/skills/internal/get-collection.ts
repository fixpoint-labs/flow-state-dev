/**
 * Skills-runtime resolver for a resource collection ref from `ctx.resources`.
 *
 * The lookup now lives at the tasks layer (`resolveResourceCollection`) so the
 * durable task-board capability shares it without importing from `skills`.
 * This module keeps the `getCollection` name its four in-package callers use.
 */

import { resolveResourceCollection } from "../../tasks";

/** Resolve a resource collection ref from the unified resource registry. */
export const getCollection = resolveResourceCollection;
