/**
 * The durable store under `statePath` — where a tick's records outlive the
 * process that wrote them.
 *
 * Every record is addressed the way the resource layer addresses one:
 * `(scope, scopeId, key)`. That is not a convention borrowed for flavour, it is
 * the whole reason `src/model/entities.ts` can declare a scope per collection
 * and have it mean something here — an org-scoped registry and a session-scoped
 * ledger differ only in which `scopeId` their address carries, and a query
 * across scope instances is not a primitive (see `./collections`).
 *
 * ```
 * <statePath>/<scope>/<scopeId>/<key>.json    state
 * <statePath>/<scope>/<scopeId>/<key>.md      content
 * ```
 *
 * **One file per key, and a key's segments are directories.** A ledger append is
 * therefore one file write rather than a read-modify-write of a growing
 * document, which is what makes "the row is on disk before the dispatch runs"
 * cheap enough to actually do on every action. It also leaves the state
 * directory readable: `ledger/FIX-1/3.json` is the third transition of FIX-1,
 * and a human debugging a stuck entity can open it.
 *
 * **Writes are atomic and flushed.** A record is written to a temporary file in
 * its final directory, fsynced, then renamed over the target. A torn write can
 * therefore never be read back as a valid-looking record, and a record that a
 * caller has awaited is on the disk rather than in a page cache the kernel may
 * still lose. The directory entry itself is not fsynced — the limit is stated
 * rather than hidden: a machine that loses power in the millisecond after a
 * rename may come back without it.
 *
 * The store knows nothing about conductor: no schemas, no collections, no
 * entity vocabulary. It stores JSON objects and text bodies at addresses.
 * `./collections` is the layer that knows what a collection is.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

/**
 * The scope kinds conductor addresses. A subset of the resource layer's:
 * conductor declares no `user`-scoped collection, and the address resolver
 * refuses one rather than inventing a `userId` it has no business holding.
 */
export type ConductorScope = "session" | "org";

/** One scope instance — the `(scope, scopeId)` half of an address. */
export interface ScopeAddress {
  readonly scope: ConductorScope;
  /** The session id, or the org id. Never derived; always a value read back. */
  readonly scopeId: string;
}

/** A stored state record, before a collection's schema has parsed it. */
export type StateRecord = Record<string, unknown>;

/** One record as `list` reports it: the key it is stored under, and its state. */
export interface StoredRecord {
  readonly key: string;
  readonly state: StateRecord;
}

/** Something in the durable state is not what conductor put there. */
export class ConductorStateError extends Error {
  constructor(
    message: string,
    /** The address and key the failure is about, when it has one. */
    readonly at?: string,
  ) {
    super(message);
    this.name = "ConductorStateError";
  }
}

/**
 * The durable half of a tick, as an interface so a host can back it with
 * something other than a directory — and so the tick's own tests can watch
 * every write.
 */
export interface StateStore {
  /** Read one record's state, or `null` when nothing is stored at the key. */
  read(address: ScopeAddress, key: string): Promise<StateRecord | null>;
  /** Write one record's state, durably, replacing whatever was there. */
  write(address: ScopeAddress, key: string, state: StateRecord): Promise<void>;
  /** Remove one record. Resolves `true` when a record was actually removed. */
  remove(address: ScopeAddress, key: string): Promise<boolean>;
  /**
   * Every record whose key starts with `prefix`, ordered by key.
   *
   * Bounded to one scope instance, deliberately: reading across sessions is not
   * a primitive here any more than it is in the resource layer, and a board
   * spanning several is a fan-out over the registry rather than a wildcard.
   */
  list(address: ScopeAddress, prefix: string): Promise<readonly StoredRecord[]>;
  /** Read a record's content body — the prose half — or `null` when it has none. */
  readContent(address: ScopeAddress, key: string): Promise<string | null>;
  /** Write a record's content body, durably. */
  writeContent(address: ScopeAddress, key: string, content: string): Promise<void>;
}

/** State lives beside its content under the same key, distinguished by suffix. */
const STATE_SUFFIX = ".json";
const CONTENT_SUFFIX = ".md";

/**
 * Encode one key or scope-id segment for use as a directory name.
 *
 * Ids reach conductor from a tracker, a git remote, and a session record, and
 * none of those is a place to hold a path traversal. `encodeURIComponent`
 * handles the separator and every reserved character, but leaves `.` alone —
 * so `.` and `..` are rejected outright rather than encoded, and an empty
 * segment is rejected because it would collapse the path silently.
 */
function encodeSegment(segment: string, whole: string): string {
  if (segment === "" || segment === "." || segment === "..") {
    throw new ConductorStateError(
      `${JSON.stringify(whole)} is not a usable state key: the segment ` +
        `${JSON.stringify(segment)} cannot name a directory.`,
      whole,
    );
  }
  return encodeURIComponent(segment);
}

/** The path a key's record lives at, under one scope instance. */
function fileFor(root: string, address: ScopeAddress, key: string, suffix: string): string {
  const scopeDir = path.join(
    root,
    address.scope,
    encodeSegment(address.scopeId, address.scopeId),
  );
  const segments = key.split("/").map((segment) => encodeSegment(segment, key));
  return path.join(scopeDir, ...segments) + suffix;
}

/** Turn a path back into the key it was written under. */
function keyFor(scopeDir: string, file: string, suffix: string): string {
  return path
    .relative(scopeDir, file.slice(0, -suffix.length))
    .split(path.sep)
    .map((segment) => decodeURIComponent(segment))
    .join("/");
}

/** Read a file, treating an absent one as `null` rather than as a failure. */
async function readIfPresent(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/**
 * Write a file so that a reader sees either the previous contents or the new
 * ones, never a prefix of either, and so that a crash after the call returns
 * still finds the new ones. See the file header for the one limit this does not
 * cover.
 */
async function writeAtomically(file: string, body: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  const handle = await fs.open(temporary, "w");
  try {
    await handle.writeFile(body, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(temporary, file);
}

/** Every file under `dir` with the given suffix, recursively. */
async function walk(dir: string, suffix: string): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  const found: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await walk(full, suffix)));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(suffix)) found.push(full);
  }
  return found;
}

/**
 * Open the durable state under a directory.
 *
 * @param statePath Absolute or relative directory conductor's records live in.
 *   Created on first write; an empty or absent directory is an empty store,
 *   which is what a first run reads.
 * @returns A store addressed by `(scope, scopeId, key)`.
 */
export function fileStateStore(statePath: string): StateStore {
  const root = path.resolve(statePath);

  const parse = (body: string, file: string): StateRecord => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch (error) {
      throw new ConductorStateError(
        `${file} is not valid JSON, so conductor cannot read the record it holds: ` +
          `${(error as Error).message}`,
        file,
      );
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new ConductorStateError(`${file} does not hold a state record.`, file);
    }
    return parsed as StateRecord;
  };

  return {
    async read(address, key) {
      const file = fileFor(root, address, key, STATE_SUFFIX);
      const body = await readIfPresent(file);
      return body === null ? null : parse(body, file);
    },

    async write(address, key, state) {
      await writeAtomically(
        fileFor(root, address, key, STATE_SUFFIX),
        `${JSON.stringify(state, null, 2)}\n`,
      );
    },

    async remove(address, key) {
      try {
        await fs.unlink(fileFor(root, address, key, STATE_SUFFIX));
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
        throw error;
      }
    },

    async list(address, prefix) {
      const scopeDir = path.join(
        root,
        address.scope,
        encodeSegment(address.scopeId, address.scopeId),
      );
      const from =
        prefix === ""
          ? scopeDir
          : path.join(scopeDir, ...prefix.split("/").map((s) => encodeSegment(s, prefix)));
      const files = await walk(from, STATE_SUFFIX);

      const records: StoredRecord[] = [];
      for (const file of files) {
        const body = await readIfPresent(file);
        if (body === null) continue;
        records.push({ key: keyFor(scopeDir, file, STATE_SUFFIX), state: parse(body, file) });
      }
      return records.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    },

    readContent(address, key) {
      return readIfPresent(fileFor(root, address, key, CONTENT_SUFFIX));
    },

    writeContent(address, key, content) {
      return writeAtomically(fileFor(root, address, key, CONTENT_SUFFIX), content);
    },
  };
}
