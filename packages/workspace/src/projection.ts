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
import { PlaceUnreadableError } from "./types";
import { isMetadataKey, normalizePath, routePath } from "./routing";
import { sharedClaimRegistry, type ClaimRegistry } from "./claims";

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
  /**
   * Where this projection arbitrates writes against other live projections.
   *
   * Defaults to a process-wide registry, which is what makes two projections
   * nobody wired together still arbitrate. Pass your own to scope arbitration
   * to a subset — a test, or one tenant's runs.
   */
  claims?: ClaimRegistry;
}

/**
 * Build a projection over `mounts` and `place`.
 *
 * Holds no I/O of its own beyond what the place and the collections provide,
 * which is what lets the whole of §10's behaviour set run against an
 * in-memory place with no sandbox, no harness and no model.
 */
export function createProjection({
  mounts,
  place,
  claims = sharedClaimRegistry,
}: ProjectionOptions): Projection {
  /** This projection's identity, and nothing else's. */
  const holder: symbol = Symbol("projection");

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
        // Hydrate has to agree with flush about who owns a path. Flush routes
        // by longest prefix, so with nested mounts (`artifacts` and
        // `artifacts/drafts`) a bare write here would let whichever mount came
        // last in the array put its content at a path the other one owns — and
        // the next flush would attribute it to the owner.
        if (routePath(mounts, path)?.mount !== mount) continue;
        await place.write(path, content);
        // Only a WRITABLE mount's paths enter the baseline. A read-only mount
        // is projected and then never written or deleted, so a baseline for it
        // buys nothing — and `ownedPaths()` answers "is another run holding
        // this?", where claiming immutable reference files refuses an overlap
        // that was always safe.
        if (mount.writable) baseline.set(path, hashContent(content));
      }
    }
  }

  /**
   * How many of this projection's operations are writing right now.
   *
   * `releaseAll` drops everything one HOLDER holds, and `flush` and `put` are
   * two operations sharing one. Releasing at the end of whichever finishes
   * first would drop the claims the other is still relying on — a `put`
   * returning mid-flush hands every path that flush is committing to the next
   * run that asks. Both consumers can have the two in flight at once, so the
   * release waits for the last one out.
   */
  let writing = 0;

  /**
   * Run one claiming operation, releasing this projection's claims only once
   * no other one is still in flight.
   */
  async function claiming<T>(operation: () => Promise<T>): Promise<T> {
    writing += 1;
    try {
      return await operation();
    } finally {
      writing -= 1;
      // Held for the operation and no longer. A claim outliving it would need
      // a release call at the end of every run, on every path a run can end —
      // and one missed leaves a path claimed by a projection nobody will use
      // again, refusing every later run. The race this exists to stop is two
      // flushes interleaving at their awaits, which is exactly this long.
      // Writes that do NOT overlap in time are already covered: the second
      // finds the collection changed and reports a conflict.
      if (writing === 0) claims.releaseAll(holder);
    }
  }

  async function flush(): Promise<FlushReport> {
    return await claiming(flushOnce);
  }

  async function flushOnce(): Promise<FlushReport> {
    // Before anything else: an unreadable place must abort the whole flush,
    // because the delete pass below reads "absent from the place" as "deleted
    // by the run".
    //
    // Wrapped, and only here, so a caller can tell this failure from every
    // other one a flush can reject with. They call for opposite handling: a
    // walk that failed decided nothing, so swallowing it loses nothing, while
    // a collection write that failed means the run's work never left the
    // place — and a caller that catches both alike reports success for it.
    let listed: readonly string[];
    try {
      listed = await place.list(prefixes);
    } catch (err) {
      throw new PlaceUnreadableError(
        `the workspace could not be listed: ${(err as Error)?.message ?? String(err)}`,
        { cause: err },
      );
    }
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
      // Vanished between the listing and the read. Not this flush's business:
      // the run may not have removed it — a concurrent process, an editor, a
      // temp file being replaced — and this flush saw a moment it cannot
      // describe.
      //
      // It therefore stays in `present`, which is what makes the delete pass
      // skip it. Removing it here reads as "the run deleted this" and DELETES
      // THE COLLECTION ENTRY — the exact opposite of the sentence above, and
      // the way this was first written.
      if (local === null) continue;

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

      // A delete is a write. Same claim, same refusal.
      if (claims.claim(path, holder) !== holder) {
        outcomes.push({ kind: "contested", path });
        continue;
      }

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
      contested: outcomes.filter(
        (o): o is Extract<FlushOutcome, { kind: "contested" }> => o.kind === "contested",
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

    if (now === base) return { kind: "unchanged", path };

    // The claim is taken HERE, and the ordering either side of it is the
    // whole point.
    //
    // After the no-op branch, because claiming a path we are not about to
    // touch would refuse a run that merely read it unchanged. That branch
    // needs no collection read, so nothing is lost by deciding it first.
    //
    // But BEFORE the collection read, because the read is what the write
    // trusts. Read first and another projection can commit its whole write
    // and release inside the await; this one then resumes with a snapshot
    // that predates it, is granted a claim proving nothing, and overwrites
    // work it never saw — with both writers told they succeeded. The claim
    // has to cover the read-compare-write, not just the write.
    if (claims.claim(path, holder) !== holder) {
      return { kind: "contested", path };
    }

    const theirs = await theirContent(mount, key);
    const theirHash = theirs === null ? undefined : hashContent(theirs);

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
    return await claiming(() => decide(mount, key, path, content));
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
