/**
 * The projection: collections in, a place out, and a baseline in between that
 * turns a contested write from silent loss into a reported conflict.
 *
 * ## Why a baseline at all
 *
 * Flush is a read-compare-write, and nothing underneath makes it atomic —
 * `ContentStore.set` takes no version and overwrites unconditionally. So the
 * comparison has to happen here, and it needs three values, not two: what the
 * collection holds now (`theirs`), what the place holds now (`ours`), and
 * **what this projection last put there** (`base`).
 *
 * Two-value comparison is what the machinery this replaces did, and it cannot
 * tell "I changed this" from "somebody else changed this". With `base` the
 * question becomes answerable: if the collection still holds what we left, our
 * write is safe; if it does not, two writers touched one path and neither of
 * them should win by arriving second.
 *
 * ## What the baseline is not
 *
 * It is **not a snapshot of hydrate**. It tracks what this projection last
 * committed, so it moves on every clean outcome — including the one that
 * writes nothing. It is also what makes a path *ours*: a file this run created
 * and flushed was never hydrated and is still ours, because we know exactly
 * what we put there. That is why the delete pass walks the baseline rather
 * than the hydrate-time set.
 *
 * ## Scope
 *
 * Per-projection, discarded at teardown, never persisted. A resumed session
 * holding no baseline owns nothing: it writes only where the collection is
 * untouched and deletes nothing at all. That degrades safely, which is the
 * property that made persisting it a follow-up rather than a requirement.
 */
import { createHash } from "node:crypto";
import type { FlushOutcome, FlushReport, Mount, Place, ProjectedEntryState } from "./types";
import { isMetadataKey, normalizePath, routePath } from "./routing";

/** A hex SHA-256 of `content`. The only comparison the projection makes. */
export function hashContent(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex");
}

/** A live projection over one place. */
export interface Projection {
  /**
   * Lay every mounted collection's entries into the place, recording a
   * baseline for each.
   */
  hydrate(): Promise<void>;
  /**
   * Reconcile the place back into the collections.
   *
   * Resolves with everything it decided. Rejects only if the place cannot be
   * read — see `Place.list`.
   */
  flush(): Promise<FlushReport>;
  /**
   * Commit one path the caller has already written, through the same
   * three-way check a flush applies.
   *
   * For a consumer whose write channel bypasses the place — a tool call that
   * writes one named file and already knows which — a full flush is both
   * wasteful and wrong. Wasteful because it walks everything to learn one
   * thing; wrong because a projection holding no baseline would report every
   * pre-existing file in the place as new. `put` narrows the decision to the
   * one path, and advances the baseline so the next flush reads the write as
   * ours rather than as somebody else's.
   *
   * Resolves `undefined` when the path is nothing for this projection to
   * decide: a read-only mount, or a collection's own metadata. The same two
   * cases a flush passes over without recording an outcome.
   */
  put(path: string, content: string): Promise<FlushOutcome | undefined>;
  /**
   * The paths this projection currently owns. Exposed for the consumers that
   * have to answer "is another run holding this?" without reaching inside.
   */
  ownedPaths(): readonly string[];
}

export interface ProjectionOptions {
  mounts: readonly Mount[];
  place: Place;
}

/**
 * Build a projection over `mounts` and `place`.
 *
 * Holds no I/O of its own beyond what the place and the collections provide,
 * which is what lets the whole of §10's behaviour set run against an
 * in-memory place with no sandbox, no harness and no model.
 */
export function createProjection({ mounts, place }: ProjectionOptions): Projection {
  /** path → the hash of what we last committed there. */
  const baseline = new Map<string, string>();

  const prefixes = mounts.map((m) => normalizePath(m.prefix));

  /**
   * A ref's full storage key (`artifacts/foo.md`) as the bare key its own
   * collection is addressed by (`foo.md`).
   */
  const stripPrefix = (key: string, prefix: string): string =>
    prefix && key.startsWith(`${prefix}/`) ? key.slice(prefix.length + 1) : key;

  /** The place-side path for a collection entry. */
  const placePath = (mount: Mount, key: string): string =>
    normalizePath(key === "" ? mount.prefix : `${mount.prefix}/${key}`);

  /** What the collection holds at `key`, or `null`. */
  async function theirContent(mount: Mount, key: string): Promise<string | null> {
    const existing = await mount.collection.getOptional(key);
    if (existing === undefined) return null;
    return await existing.readContent();
  }

  async function hydrate(): Promise<void> {
    for (const mount of mounts) {
      for (const entry of await mount.collection.list()) {
        // The ref's own storage path, not `state.path`. State is the
        // application's — a collection written by anything other than a
        // projection may carry no `path` field at all, and hydrating off it
        // would silently lay down nothing.
        const key = stripPrefix(entry.path, normalizePath(mount.prefix));
        if (isMetadataKey(key)) continue;
        const content = await entry.readContent();
        if (content === null) continue;
        const path = placePath(mount, key);
        await place.write(path, content);
        baseline.set(path, hashContent(content));
      }
    }
  }

  async function flush(): Promise<FlushReport> {
    // Before anything else, and deliberately not inside a `try`: an
    // unreadable place must abort the whole flush, because the delete pass
    // below reads "absent from the place" as "deleted by the run".
    const listed = await place.list(prefixes);
    const present = new Set(listed.map(normalizePath));

    const outcomes: FlushOutcome[] = [];

    for (const raw of listed) {
      const path = normalizePath(raw);
      const routed = routePath(mounts, path);
      if (routed === undefined) {
        outcomes.push({ kind: "orphan", path });
        continue;
      }
      const { mount, key } = routed;
      // A read-only mount is hydrated and then left alone. Not an orphan:
      // we know exactly who owns it, and the answer is "not us to write".
      if (!mount.writable) continue;
      if (isMetadataKey(key)) continue;

      const local = await place.read(path);
      // Vanished between the listing and the read. Leaving it to the delete
      // pass would be wrong — the run may not have deleted it — so it is
      // simply not this flush's business.
      if (local === null) {
        present.delete(path);
        continue;
      }

      outcomes.push(await decide(mount, key, path, local));
    }

    // The delete pass walks what we OWN, not what we hydrated. A path this
    // run created and then removed is ours to delete; a path we never laid
    // down is not ours to touch, however absent it looks.
    for (const [path, base] of [...baseline.entries()]) {
      if (present.has(path)) continue;
      const routed = routePath(mounts, path);
      if (routed === undefined || !routed.mount.writable) continue;
      const { mount, key } = routed;

      const theirs = await theirContent(mount, key);
      const theirHash = theirs === null ? undefined : hashContent(theirs);

      if (theirHash === base) {
        await mount.collection.delete(key);
        baseline.delete(path);
        outcomes.push({ kind: "deleted", path });
        continue;
      }
      if (theirHash === undefined) {
        // Already gone. Nothing to delete and nothing contested — somebody
        // removed it and we agree with the result.
        baseline.delete(path);
        outcomes.push({ kind: "deleted", path });
        continue;
      }
      // Somebody changed it while we removed it. This is the half a first fix
      // is recorded getting wrong, and it is a conflict rather than a quiet
      // no-op precisely because quiet leaves deleted files in the collection
      // forever with nobody told.
      outcomes.push({
        kind: "conflict",
        path,
        base,
        theirs: theirHash,
        ours: null,
      });
    }

    return {
      outcomes,
      conflicts: outcomes.filter(
        (o): o is Extract<FlushOutcome, { kind: "conflict" }> => o.kind === "conflict",
      ),
    };
  }

  /**
   * The write decision for one path whose local content is already in hand.
   *
   * Shared by `flush` and `put` deliberately: they are two producers of the
   * same invariant — never overwrite evidence you do not hold — and the way
   * that invariant gets broken is one producer growing a branch the other
   * never sees.
   */
  async function decide(
    mount: Mount,
    key: string,
    path: string,
    local: string,
  ): Promise<FlushOutcome> {
    const now = hashContent(local);
    const base = baseline.get(path);
    const theirs = await theirContent(mount, key);
    const theirHash = theirs === null ? undefined : hashContent(theirs);

    if (now === base) return { kind: "unchanged", path };
    if (base === undefined && theirHash === undefined) {
      await commit(mount, key, local, now);
      baseline.set(path, now);
      return { kind: "created", path };
    }
    if (theirHash === base) {
      await commit(mount, key, local, now);
      baseline.set(path, now);
      return { kind: "written", path };
    }
    if (now === theirHash) {
      // The collection already holds what we would write. Writing is
      // pointless, but ADVANCING IS NOT: leave `base` where hydrate put it
      // and the next local edit is compared against a version the collection
      // no longer holds, reporting a conflict that is not one.
      baseline.set(path, now);
      return { kind: "converged", path };
    }
    return {
      kind: "conflict",
      path,
      base: base ?? null,
      theirs: theirHash ?? null,
      ours: now,
    };
  }

  async function put(rawPath: string, content: string): Promise<FlushOutcome | undefined> {
    const path = normalizePath(rawPath);
    const routed = routePath(mounts, path);
    if (routed === undefined) return { kind: "orphan", path };
    const { mount, key } = routed;
    if (!mount.writable) return undefined;
    if (isMetadataKey(key)) return undefined;
    return await decide(mount, key, path, content);
  }

  /** Write content back to the collection, keeping its state in step. */
  async function commit(
    mount: Mount,
    key: string,
    content: string,
    hash: string,
  ): Promise<void> {
    const updatedAt = new Date().toISOString();
    const extra = mount.entryState?.(key) ?? {};
    const state = { path: key, hash, updatedAt, ...extra } as Partial<ProjectedEntryState>;
    const ref = await mount.collection.getOrCreate(key, state);
    // `getOrCreate` applies its initial state only when it creates, so an
    // entry that already existed reaches its new hash — and the mount's own
    // fields — through the patch instead.
    if (ref.state.hash !== hash) {
      await ref.patchState(state);
    }
    await ref.writeContent(content);
  }

  return {
    hydrate,
    flush,
    put,
    ownedPaths: () => [...baseline.keys()],
  };
}
