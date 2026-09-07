/**
 * Four knowledge *uses* on today's three ResourceScopes.
 *
 * ResourceScope is "session" | "user" | "org". There is no "team", no
 * "member", no "agent", and no Knowledge type. Atlas §06 names the mapping;
 * this file is that mapping, not a new store.
 */
import { defineResource, defineResourceCollection } from "@flow-state-dev/core";
import { z } from "zod";

const emptyState = z.object({}).default({});

/** User-private goals. Stored at (userId, ref). Shared across that human's flows. */
export const userGoals = defineResource({
  scope: "user",
  ref: "user-goals",
  stateSchema: emptyState,
});

/** Org-wide lessons. Stored at (orgId, ref). Shared across rosters and flows. */
export const orgLessons = defineResource({
  scope: "org",
  ref: "org-lessons",
  stateSchema: emptyState,
});

/**
 * Team / roster docs — proposed convention, not a scope.
 * Org-scoped collection keyed `rosters/[rosterId]/[doc]`. No `scope: "team"`.
 */
export const teamDocs = defineResourceCollection({
  pattern: "rosters/[rosterId]/[doc]",
  scope: "org",
  stateSchema: emptyState,
});

/**
 * Member-identity proof, not a member scope.
 * `flowIsolation: true` keys at (userId, flowKind, ref). Per kind, not per seat.
 */
export const seatMemory = defineResource({
  scope: "user",
  flowIsolation: true,
  ref: "seat-memory",
  stateSchema: emptyState,
});
