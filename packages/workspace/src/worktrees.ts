/**
 * The user's list of worktrees: one row per worktree a workspace host made,
 * readable by every session and agent of that user, and written only here.
 *
 * A row is the one owner of a worktree's facts: its name, path, branch,
 * repository, the commit it was cut at, who owns it and who is attached to
 * it, its state, and the pull requests on its branch. A session's state
 * points at a row by key; it never copies these.
 *
 * **Only this module writes rows.** The host calls it where it changes a
 * worktree (provision, attach, the turn-end checkout read, remove), and
 * `recordBranchPullRequests` calls it to add pull requests. Nothing a client
 * or a model sends writes a row: the collection is readable by both, and
 * writable by neither.
 *
 * The collection is user-scoped and resolves per request, so a caller hands
 * it in (a block declares `worktreesCollection` and reads it off
 * `ctx.resources`). A host given none writes nothing.
 *
 * Rows are never deleted here: a removed worktree's row says `removed`, so a
 * page still shows where the work was.
 */
import { createHash } from "node:crypto";
import { defineResourceCollection, planKeySegment } from "@flow-state-dev/core";
import type { ResourceCollectionRef } from "@flow-state-dev/core/types";
import { z } from "zod";

/** Accessor key AND storage prefix for the worktree rows. */
export const WORKTREES = "worktrees" as const;

/** Where a worktree is in its life. */
export const worktreeStateSchema = z.enum(["provisioning", "ready", "removed", "lost"]);

/** Where a worktree is in its life: being made, ready, removed by its owner, or gone from disk. */
export type WorktreeState = z.infer<typeof worktreeStateSchema>;

/** Who owns a worktree: the session or the board run it was made for. */
export const worktreeOwnerSchema = z.object({
  kind: z.enum(["session", "run"]),
  id: z.string(),
});

/** Who owns a worktree. */
export type WorktreeOwner = z.infer<typeof worktreeOwnerSchema>;

/**
 * A session or run working in a worktree beside its owner, and when its last
 * turn there ended. A bare string, which no released row holds, reads as a
 * session never yet read at a turn's end.
 */
export const worktreeAttachedSchema = z.preprocess(
  (value) => (typeof value === "string" ? { kind: "session", id: value } : value),
  z.object({
    kind: z.enum(["session", "run"]),
    id: z.string(),
    lastTurnAt: z.number().nullable().default(null),
  }),
);

/** One entry of a row's `attached`. */
export type WorktreeAttached = z.infer<typeof worktreeAttachedSchema>;

/** A pull request on a worktree's branch, as last seen. The session's `observed-pull-requests` rows are the full record. */
export const worktreePullRequestSchema = z.object({
  url: z.string(),
  number: z.number().int().nullable().default(null),
  state: z.string().nullable().default(null),
  title: z.string().nullable().default(null),
});

/** A pull request on a worktree's branch. */
export type WorktreePullRequest = z.infer<typeof worktreePullRequestSchema>;

/**
 * One worktree. Every field is nullable or defaulted, so a row written by an
 * older or newer shape still parses (BP-023, BP-030).
 */
export const worktreeRowSchema = z.object({
  /** The row's own key, as {@link worktreeKey} made it. */
  key: z.string().nullable().default(null),
  /** A name a person reads: `<slug>-<6 hex>`. Written on the first write, never recomputed. */
  name: z.string().nullable().default(null),
  /** The worktree's directory, where the worker runs. */
  path: z.string().nullable().default(null),
  /** The branch checked out, as last read; `null` for a detached HEAD. */
  branch: z.string().nullable().default(null),
  /** The remote the worktree's repository was cut from, credentials removed. */
  repo: z.string().nullable().default(null),
  /** The commit the branch was cut at, or the tip it was checked out at. */
  baseCommit: z.string().nullable().default(null),
  /** The session or run it was made for. Only the owner removes it. */
  owner: worktreeOwnerSchema.nullable().default(null),
  /** The sessions and runs working in it beside the owner (`start: { worktreeOf }`), each once, with its last turn's end. */
  attached: z.array(worktreeAttachedSchema).default([]),
  /** Where it is in its life. */
  state: worktreeStateSchema.nullable().default(null),
  /** Commits on `branch` past `baseCommit`, as last read. `null` is unknown, never 0. */
  commits: z.number().int().nullable().default(null),
  /** Epoch millis of the last turn-end read. */
  lastTurnAt: z.number().nullable().default(null),
  /** The pull requests found on its branch, each once. */
  pullRequests: z.array(worktreePullRequestSchema).default([]),
});

/** One row of {@link worktreesCollection}. */
export type WorktreeRow = z.infer<typeof worktreeRowSchema>;

/** Every field of a row, which a page and an agent may both read. */
const WORKTREE_FIELDS = [
  "key",
  "name",
  "path",
  "branch",
  "repo",
  "baseCommit",
  "owner",
  "attached",
  "state",
  "commits",
  "lastTurnAt",
  "pullRequests",
] as const;

/**
 * The user's worktree rows.
 *
 * User-scoped and shared across flows (BP-027), so a board run's worktree and
 * a session's are in one list. Lazy: a writer upserts by exact key and never
 * lists. `llmReadable`, so an agent reads the list with core's resource tools;
 * `live`, so an open page sees a row change mid-turn. No client write, and no
 * model write.
 */
export const worktreesCollection = defineResourceCollection({
  pattern: `${WORKTREES}/**`,
  scope: "user",
  prefetchMode: "lazy",
  stateSchema: worktreeRowSchema,
  llmReadable: true,
  client: {
    state: { read: true },
    expose: [...WORKTREE_FIELDS],
    live: true,
  },
});

/** The collection as a block reads it off `ctx.resources`. */
export type WorktreeCollection = ResourceCollectionRef<WorktreeRow>;

/**
 * A row's key: the host's id, then the place's segments, each escaped. The
 * host derives it from a place, so no caller looks a key up. Injective: no
 * escaped segment holds a `/`.
 */
export function worktreeKey(hostId: string, place: readonly string[]): string {
  return [hostId, ...place].map(planKeySegment).join("/");
}

/** How long a name's slug may be. */
const MAX_SLUG = 32;

/** A row's name: a slug of `label` (or the last place segment), then 6 hex of the key's hash. */
export function worktreeName(key: string, label: string | undefined, place: readonly string[]): string {
  const slugOf = (text: string) =>
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, MAX_SLUG)
      .replace(/-+$/g, "");
  const slug = slugOf(label ?? "") || slugOf(place[place.length - 1] ?? "") || "worktree";
  return `${slug}-${createHash("sha256").update(key, "utf8").digest("hex").slice(0, 6)}`;
}

/** What a caller hands the host so a provision writes the worktree's row. */
export interface WorktreeRecording {
  /** The user's rows, off the request's `ctx.resources`. */
  readonly collection: WorktreeCollection;
  /** The session or run the worktree is made for. */
  readonly owner: WorktreeOwner;
  /** What the name's slug is made from: a task's or session's title. */
  readonly label?: string;
}

async function current(collection: WorktreeCollection, key: string): Promise<WorktreeRow | undefined> {
  return (await collection.getOptional(key))?.state as WorktreeRow | undefined;
}

/**
 * Mark a worktree being made: before `git worktree add`, so a provision that
 * fails never leaves a row saying `ready`. A row already `ready` is left as
 * it is: a hand-back is not a new worktree.
 */
export async function markWorktreeProvisioning(
  recording: WorktreeRecording,
  key: string,
  place: readonly string[],
): Promise<void> {
  const prior = await current(recording.collection, key);
  if (prior?.state === "ready") return;
  await recording.collection.upsert(
    key,
    { key, state: "provisioning", owner: prior?.owner ?? recording.owner },
    { name: worktreeName(key, recording.label, place) },
  );
}

/** What a provision made, for {@link markWorktreeReady}. */
export interface MadeWorktree {
  readonly path: string;
  readonly branch: string | null;
  readonly repo: string | null;
  /** The commit it was cut or checked out at, when this provision knows it. */
  readonly baseCommit: string | null;
  /**
   * Whether this provision cut the branch. A fresh branch takes this
   * provision's base; a handed-back one keeps the base already on the row.
   */
  readonly fresh: boolean;
}

/**
 * Mark a worktree ready, with what the provision made. The name and the
 * owner are kept, and so is the base unless this provision cut a new branch:
 * a hand-back does not change what the worktree is.
 */
export async function markWorktreeReady(
  recording: WorktreeRecording,
  key: string,
  place: readonly string[],
  made: MadeWorktree,
): Promise<void> {
  const fields = (prior: WorktreeRow | undefined): Partial<WorktreeRow> => ({
    key,
    state: "ready",
    path: made.path,
    branch: made.branch,
    repo: made.repo,
    baseCommit: made.fresh ? made.baseCommit : (prior?.baseCommit ?? made.baseCommit),
    owner: prior?.owner ?? recording.owner,
    ...(prior?.name == null ? { name: worktreeName(key, recording.label, place) } : {}),
  });
  const ref = await recording.collection.getOptional(key);
  if (ref === undefined) {
    await recording.collection.upsert(key, fields(undefined));
    return;
  }
  // Against the stored row, atomically. The host calls this under the place's
  // lock, the one removal takes, so no removal lands between the two writes.
  await ref.updateState((row) => ({ ...row, ...fields(row) }) as WorktreeRow);
}

const same = (a: WorktreeOwner | null | undefined, b: WorktreeOwner) => a != null && a.kind === b.kind && a.id === b.id;

/** Add a session or run to the worktree's attached list, once; never its owner. `false` when the key has no row. */
export async function attachToWorktree(collection: WorktreeCollection, key: string, by: WorktreeOwner): Promise<boolean> {
  const prior = await current(collection, key);
  if (prior === undefined) return false;
  if (same(prior.owner, by)) return true;
  if ((prior.attached ?? []).some((entry) => same(entry, by))) return true;
  await collection.upsert(key, { attached: [...(prior.attached ?? []), { kind: by.kind, id: by.id, lastTurnAt: null }] });
  return true;
}

/** What the turn-end read found in the worktree. */
export type CheckoutSnapshot =
  | { readonly present: true; readonly branch: string | null; readonly commits: number | null; readonly at: number }
  | { readonly present: false; readonly at: number };

/**
 * Write the turn-end read: branch and count together, in one upsert, so the
 * row never shows one read's branch beside another's count. A directory that
 * is gone marks the row `lost`. A row already `removed` stays removed. `by`,
 * when it is attached, has its own `lastTurnAt` set too.
 */
export async function recordWorktreeCheckout(
  collection: WorktreeCollection,
  key: string,
  snapshot: CheckoutSnapshot,
  by?: WorktreeOwner,
): Promise<void> {
  const prior = await current(collection, key);
  if (prior === undefined) return;
  const attached =
    by !== undefined && (prior.attached ?? []).some((entry) => same(entry, by))
      ? { attached: prior.attached.map((entry) => (same(entry, by) ? { ...entry, lastTurnAt: snapshot.at } : entry)) }
      : {};
  if (!snapshot.present) {
    if (prior.state !== "removed") await collection.upsert(key, { state: "lost", lastTurnAt: snapshot.at, ...attached });
    return;
  }
  await collection.upsert(key, { branch: snapshot.branch, commits: snapshot.commits, lastTurnAt: snapshot.at, ...attached });
}

/** Mark a worktree removed. Its row stays: it is the record of where the work was. */
export async function markWorktreeRemoved(collection: WorktreeCollection, key: string): Promise<void> {
  const prior = await current(collection, key);
  if (prior === undefined) return;
  await collection.upsert(key, { state: "removed" });
}

/**
 * Add pull requests to a worktree's row, each once by link; a known one takes
 * the newer state and title. `refreshed` only updates pull requests the row
 * already lists, so a later turn can record that one merged or closed.
 */
export async function addWorktreePullRequests(
  collection: WorktreeCollection,
  key: string,
  pullRequests: readonly WorktreePullRequest[],
  refreshed: readonly WorktreePullRequest[] = [],
): Promise<void> {
  if (pullRequests.length === 0 && refreshed.length === 0) return;
  const ref = await collection.getOptional(key);
  if (ref === undefined) return;
  // Merged against the stored row, atomically, so two turns ending together
  // both keep what they found.
  await ref.updateState((row) => {
    const merged = [...((row as WorktreeRow).pullRequests ?? [])];
    let changed = false;
    const apply = (pr: WorktreePullRequest, add: boolean) => {
      const at = merged.findIndex((known) => known.url === pr.url);
      if (at === -1) {
        if (!add) return;
        merged.push(pr);
        changed = true;
        return;
      }
      const known = merged[at]!;
      const next = { ...known, state: pr.state ?? known.state, title: pr.title ?? known.title };
      if (next.state !== known.state || next.title !== known.title) {
        merged[at] = next;
        changed = true;
      }
    };
    for (const pr of pullRequests) apply(pr, true);
    for (const pr of refreshed) apply(pr, false);
    return changed ? { ...row, pullRequests: merged } : row;
  });
}
