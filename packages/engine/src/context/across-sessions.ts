/**
 * `ctx.resources.acrossSessions()`: a run's session-scoped collections read
 * across every session its owner has, one store query a page.
 *
 * - **The owner rule is split at the query.** The store's query joins the
 *   rows to the sessions table on the whole owner (user, organization and
 *   tenant, `ResourceStateStore.listAcrossSessions`). What a query can't
 *   decide runs per row after it: the admission `ctx.resources.at` makes
 *   (`namedRecordAdmission`), on the session columns the query read, so a page
 *   costs no session read. A session it refuses is left out as though it held
 *   nothing.
 * - **Paging is the pending-suspensions read's.** A page reads one row past
 *   its size; `next` marks the last row the store returned, never the last
 *   one shown, so a page can be short, even empty, while `next` is set, and a
 *   listing ends only when `next` is absent.
 * - **Nothing names a dropped row.** A dropped row's session is in the rows
 *   read, and the cursor marks the last of them. So the cursor is sealed:
 *   encrypted and authenticated, bound to the owner, the collection and the
 *   filter, under a key derived from the host's sealing secret (or this
 *   process's own key, with none set). The caller can't read it, and it opens
 *   only where the same key is held.
 * - **A filter is the row's key or a declared index.** Either is answered in
 *   the store's query; a field with no declared index is refused, never
 *   filtered after the read. Every row an index filter returns is checked
 *   against the index, as `findBy` checks each hit: a session whose index is
 *   not built yet answers every row.
 * - **The fence.** A turn a webhook delivery started can't call it.
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import {
  canonicalIndexValue,
  canonicalIndexValues,
  declaredIndexes,
  getPatternPrefix,
  matchesPattern,
  type AcrossSessionsCollection,
  type AcrossSessionsListQuery,
  type DeclaredResourceIndex,
  type AcrossSessionsPage,
  type AcrossSessionsEntry,
  type JsonObject,
  type ResourceCollectionConfig
} from "@flow-state-dev/core/types";
import { cloneValue } from "@flow-state-dev/core/helpers";
import type { DeliveryOrigin } from "../execution/delivery-origin";
import { FlowStateConfigError } from "../errors/flow-error";
import { ownerKeyAdmits } from "../resources/owner-private";
import { findIndexedKeys } from "../resources/resource-indexes";
import { toBareSessionId } from "../stores/scope-keys";
import type { AcrossSessionsOwner, AcrossSessionsQuery, ResourceStateStore } from "../stores/types";
import { namedRecordAdmission, UntrustedReachError, type NamedSessionAdmission } from "./named-session";

/** The most rows a page answers. */
const ACROSS_SESSIONS_PAGE = 50;

/** What one run's read across sessions is built from: every field from the run, never a payload. */
export type AcrossSessionsInputs = {
  /** The run's session-scoped stored collections, by accessor. */
  configs: Readonly<Record<string, ResourceCollectionConfig>>;
  store: ResourceStateStore;
  /** The admission `ctx.resources.at` makes, for this run. */
  admission: NamedSessionAdmission;
  /** The run's owner: its principal's user, organization and tenant. */
  owner: AcrossSessionsOwner;
  /** Who reads, for an owner-private collection's fence. */
  actorUserId: string;
  /** The run's delivery origin: a fenced run can't read across sessions. */
  origin: DeliveryOrigin | undefined;
  /** The host's sealing secret (`RuntimeConfig.sealingSecret`); absent, this process's own key. */
  sealingSecret?: string;
  /** Whether rows under `prefix` are kept per lineage, not per session. */
  sharesLineage: (prefix: string) => boolean;
  /** In a view: record the read of `config`, so its watchers hear the owner's change topic for it. */
  record?: (config: ResourceCollectionConfig) => void;
};

/** A cursor that this read did not hand back, or that this process can't open. */
export class AcrossSessionsCursorError extends Error {
  constructor(options?: { cause?: unknown }) {
    super("This `after` is not a cursor this read handed back here. Start the listing again without it.", options);
    this.name = "AcrossSessionsCursorError";
  }
}

// ---------------------------------------------------------------------------
// The sealed cursor
// ---------------------------------------------------------------------------

/**
 * The key cursors are sealed with when the host sets no sealing secret: one
 * per process, shared by every copy of the engine in it (`Symbol.for`), never
 * written anywhere. Such a cursor opens only in the process that sealed it.
 */
const PROCESS_CURSOR_KEY: Buffer = (() => {
  const key = Symbol.for("@flow-state-dev/engine.across-sessions.cursor-key");
  const holder = globalThis as { [key]?: Buffer };
  return (holder[key] ??= randomBytes(32));
})();

/** What this use of the sealing secret is, so the key it derives serves no other. */
const CURSOR_KEY_INFO = "flow-state-dev/across-sessions-cursor/v1";

/** Keys derived per secret, so a page doesn't run HKDF again. */
const derivedKeys = new Map<string, Buffer>();

/**
 * The key a cursor is sealed with: derived from the host's sealing secret by
 * HKDF-SHA256 under {@link CURSOR_KEY_INFO}, so every process holding the
 * secret opens what another sealed; else this process's own.
 */
function cursorKey(secret: string | undefined): Buffer {
  if (secret === undefined) return PROCESS_CURSOR_KEY;
  let key = derivedKeys.get(secret);
  if (key === undefined) {
    key = Buffer.from(hkdfSync("sha256", secret, Buffer.alloc(0), CURSOR_KEY_INFO, 32));
    derivedKeys.set(secret, key);
  }
  return key;
}

/** The position a cursor seals: the last stored row a page read. */
type CursorPosition = { sessionKey: string; key: string };

/** `position`, sealed for reads bound to `binding` (owner, collection, filter). */
function sealCursor(position: CursorPosition, binding: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(binding, "utf8"));
  const body = Buffer.concat([cipher.update(JSON.stringify([position.sessionKey, position.key]), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}

/** The position `cursor` seals, when it was sealed under `sealingKey` for `binding`. */
function openCursor(cursor: unknown, binding: string, sealingKey: Buffer): CursorPosition {
  if (typeof cursor !== "string" || cursor.length === 0) throw new AcrossSessionsCursorError();
  try {
    const raw = Buffer.from(cursor, "base64url");
    const decipher = createDecipheriv("aes-256-gcm", sealingKey, raw.subarray(0, 12));
    decipher.setAAD(Buffer.from(binding, "utf8"));
    decipher.setAuthTag(raw.subarray(12, 28));
    const plain = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
    const [sessionKey, key] = JSON.parse(plain) as [unknown, unknown];
    if (typeof sessionKey !== "string" || typeof key !== "string") throw new AcrossSessionsCursorError();
    return { sessionKey, key };
  } catch (error) {
    if (error instanceof AcrossSessionsCursorError) throw error;
    // Why it didn't open (a bad tag, bad base64, bad JSON) stays as the cause.
    throw new AcrossSessionsCursorError({ cause: error });
  }
}

// ---------------------------------------------------------------------------
// The read
// ---------------------------------------------------------------------------

type Filter =
  | { kind: "none" }
  | { kind: "key"; key: string }
  | {
      kind: "index";
      name: string;
      stored: string;
      declared: DeclaredResourceIndex;
      value: string | undefined;
      check: (key: string, state: JsonObject) => boolean;
    };

/** The filter `where` asks for, checked against `config`'s declarations. */
function filterOf(config: ResourceCollectionConfig, where: AcrossSessionsListQuery["where"]): Filter {
  if (where === undefined) return { kind: "none" };
  if ("key" in where) {
    if (typeof where.key !== "string" || where.key.length === 0) throw new TypeError("`where.key` is an entry's key, as an entry read across sessions names it");
    return { kind: "key", key: where.key };
  }
  const index = declaredIndexes(config).find((declared) => declared.name === where.index);
  if (index === undefined) {
    throw new Error(
      `Collection "${config.pattern}" declares no index "${String(where.index)}": a read across sessions filters only by ` +
        "the row's key or a declared index. Declare it in the collection's `indexes` to filter on it."
    );
  }
  const value = canonicalIndexValue(where.value);
  return {
    kind: "index",
    name: index.name,
    stored: index.stored,
    declared: index,
    value,
    check: (key, state) => value !== undefined && canonicalIndexValues(index.value(key, state as never)).includes(value)
  };
}

/** The reads one run makes across its owner's sessions, by accessor. */
export function createAcrossSessions(inputs: AcrossSessionsInputs): Record<string, AcrossSessionsCollection> {
  const admit = namedRecordAdmission(inputs.admission);
  const handles: Record<string, AcrossSessionsCollection> = Object.create(null);
  for (const [accessor, config] of Object.entries(inputs.configs)) {
    handles[accessor] = { list: (query) => listPage(inputs, admit, config, query) };
  }
  return handles;
}

async function listPage(
  inputs: AcrossSessionsInputs,
  admit: ReturnType<typeof namedRecordAdmission>,
  config: ResourceCollectionConfig,
  query: AcrossSessionsListQuery | undefined
): Promise<AcrossSessionsPage<JsonObject>> {
  if (inputs.origin !== undefined) throw new UntrustedReachError();
  const filter = filterOf(config, query?.where);
  const rawPrefix = getPatternPrefix(config.pattern);
  const keyPrefix = rawPrefix === "" ? "" : `${rawPrefix}/`;
  if (inputs.sharesLineage(keyPrefix)) {
    throw new Error(
      `Collection "${config.pattern}" keeps rows per lineage, not per session, so it can't be read across sessions.`
    );
  }
  const read = inputs.store.listAcrossSessions;
  if (read === undefined) {
    throw new FlowStateConfigError("This app's resource-state store can't read across sessions: it has no `listAcrossSessions`.");
  }
  // Heard however few rows it answers: a row filed later, in any session, is a change to it.
  inputs.record?.(config);
  if (filter.kind === "index" && filter.value === undefined) return { entries: [] };
  const { owner } = inputs;
  const binding = JSON.stringify([owner.userId, owner.orgId ?? null, owner.tenantId ?? null, config.pattern, filter.kind === "key" ? filter.key : filter.kind === "index" ? [filter.stored, filter.value] : null]);
  const key = cursorKey(inputs.sealingSecret);
  const after = query?.after === undefined ? undefined : openCursor(query.after, binding, key);
  const request: AcrossSessionsQuery = {
    owner,
    keyPrefix,
    ...(filter.kind === "key" ? { key: filter.key } : {}),
    ...(filter.kind === "index" ? { index: { collection: config.pattern, index: filter.stored, value: filter.value! } } : {}),
    ...(after !== undefined ? { after } : {}),
    limit: ACROSS_SESSIONS_PAGE + 1
  };
  const stored = await read.call(inputs.store, request);
  const page = stored.slice(0, ACROSS_SESSIONS_PAGE);
  // One admission per session the page holds, never per row.
  const verdicts = new Map<string, Promise<boolean>>();
  const admitted = (sessionKey: string, session: (typeof page)[number]["session"]): Promise<boolean> => {
    let verdict = verdicts.get(sessionKey);
    if (verdict === undefined) {
      verdict = admit(toBareSessionId(sessionKey, owner.tenantId), { id: sessionKey, ...session });
      verdicts.set(sessionKey, verdict);
    }
    return verdict;
  };
  const entries: AcrossSessionsEntry<JsonObject>[] = [];
  for (const read of page) {
    if (!matchesPattern(config.pattern, read.key)) continue;
    if (!ownerKeyAdmits(config, read.key, inputs.actorUserId)) continue;
    if (filter.kind === "index" && !filter.check(read.key, read.state)) continue;
    if (!(await admitted(read.sessionKey, read.session))) continue;
    entries.push(
      Object.freeze({
        session: toBareSessionId(read.sessionKey, owner.tenantId),
        key: read.key,
        value: Object.freeze(cloneValue(read.state)) as JsonObject
      })
    );
  }
  // A session whose index isn't built answered every entry as a candidate:
  // build it now, once, as a lookup would, so later pages and reads are
  // answered by the index. A build that a racing write cleared is built again
  // by the next read that meets it.
  const indexes = inputs.store.indexes;
  if (filter.kind === "index" && indexes !== undefined) {
    const unbuilt = new Set<string>();
    for (const met of page) if (met.indexBuilt === false) unbuilt.add(met.sessionKey);
    for (const sessionKey of unbuilt) {
      await findIndexedKeys(
        { store: inputs.store, indexes, scopeType: "session", scopeId: sessionKey, collection: config.pattern, keyPrefix },
        filter.declared,
        filter.value!
      );
    }
  }
  // `next` marks the last row the store returned, never the last one shown,
  // so paging neither stalls on dropped rows nor skips the rows after them.
  const last = page.at(-1);
  return stored.length > ACROSS_SESSIONS_PAGE && last !== undefined
    ? { entries, next: sealCursor({ sessionKey: last.sessionKey, key: last.key }, binding, key) }
    : { entries };
}
