/**
 * `entryState` / `createState` may add fields. They may not return the three
 * the projection owns. An unused `@ts-expect-error` means the ban slipped.
 */
import type { ProjectedEntryExtra } from "../src/types";

const extra: ProjectedEntryExtra = { title: "notes" };

// @ts-expect-error path belongs to the projection
const withPath: ProjectedEntryExtra = { path: "notes.md" };

// @ts-expect-error hash belongs to the projection
const withHash: ProjectedEntryExtra = { hash: "abc" };

// @ts-expect-error updatedAt belongs to the projection
const withUpdatedAt: ProjectedEntryExtra = { updatedAt: "2026-01-01T00:00:00.000Z" };

// @ts-expect-error extra fields are JSON values
const withDate: ProjectedEntryExtra = { notedAt: new Date() };

void extra;
void withPath;
void withHash;
void withUpdatedAt;
void withDate;
