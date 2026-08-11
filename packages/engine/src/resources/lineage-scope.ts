/**
 * Where a session-scoped resource STORES, for readers outside execution (FIX-1068).
 *
 * A resource declaring `sharedToWorkstream: true` has one identity across a
 * session lineage: it resolves against the lineage ROOT rather than the running
 * session, so a conversation and the background sessions under it address the
 * same rows. `createExecutionContext` applies that rule on the execution path;
 * the HTTP read/write routes need the same answer, and this module is the one
 * place both derive it from so they cannot disagree.
 *
 * The root comes off the session record (`lineageRootSessionId`), stamped once
 * at child creation. Absent means "I am the root" — every top-level session and
 * every record written before the field existed — so nothing here changes what a
 * lineage that never spawned a child sees (BP-030).
 */
import type { ResourceCollectionConfig } from "@flow-state-dev/core/types";
import { getPatternPrefix } from "@flow-state-dev/core/types";
import { resolveSessionStorageKey } from "../stores/scope-keys";
import { resourceStorageKeys } from "./storage-keys";

/** The session-record fields lineage addressing reads. */
export type LineageSession = {
  /** Tenant-namespaced session storage key — the scopeId for unshared resources. */
  id: string;
  /** Bare id of the lineage root; `null`/absent when this session is the root. */
  lineageRootSessionId?: string | null;
};

/** The declaration fields that decide where a session-scoped resource stores. */
type SharedFlag = { sharedToWorkstream?: boolean };

function isCollection(value: unknown): value is ResourceCollectionConfig {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as ResourceCollectionConfig).pattern === "string"
  );
}

/**
 * Storage `scopeId` for one session-scoped resource or collection.
 *
 * Pass the resource's own declaration — a caller holding a config never needs
 * the key-prefix matching below, and reading the flag directly is exact for
 * collections too (whose accessor is not a key prefix).
 */
export function sessionResourceScopeId(
  session: LineageSession,
  config: SharedFlag | undefined,
  tenantId: string | undefined
): string {
  const root = session.lineageRootSessionId;
  if (config?.sharedToWorkstream !== true || root == null) return session.id;
  return resolveSessionStorageKey(root, tenantId);
}

/**
 * The storage keys and key prefixes a flow's session scope shares with its
 * lineage. Empty when nothing is declared shared, which is the common case.
 */
function sharedAddressing(flowResources: unknown): {
  keys: Set<string>;
  prefixes: string[];
} {
  const keys = new Set<string>();
  const prefixes: string[] = [];
  if (typeof flowResources !== "object" || flowResources === null) {
    return { keys, prefixes };
  }
  const entries = Object.entries(flowResources as Record<string, unknown>).filter(
    ([, def]) => (def as { scope?: string } | null)?.scope === "session"
  );
  const sessionConfigs = Object.fromEntries(entries);
  const storageKeys = resourceStorageKeys(sessionConfigs);
  for (const [accessor, def] of entries) {
    if ((def as SharedFlag).sharedToWorkstream !== true) continue;
    if (isCollection(def)) {
      const prefix = getPatternPrefix(def.pattern);
      prefixes.push(prefix === "" ? "" : `${prefix}/`);
    } else {
      keys.add(storageKeys[accessor] ?? accessor);
    }
  }
  return { keys, prefixes };
}

/**
 * Read a session's whole resource scope the way execution sees it: this
 * session's own rows, with every shared key taken from the lineage root instead.
 *
 * `readAll` is the store read for one scopeId (`getAll` on either the resource
 * state or the content store). It runs once when nothing is shared or this
 * session is the root, and twice otherwise.
 *
 * A shared key is dropped from this session's own rows before the root's are
 * folded in, so a row left at a child address by an earlier declaration cannot
 * shadow the one execution would actually read.
 */
export async function readSessionScopeWithLineage<T>(
  session: LineageSession,
  flowResources: unknown,
  tenantId: string | undefined,
  readAll: (scopeId: string) => Promise<Record<string, T>>
): Promise<Record<string, T>> {
  const root = session.lineageRootSessionId;
  if (root == null) return readAll(session.id);

  const { keys, prefixes } = sharedAddressing(flowResources);
  if (keys.size === 0 && prefixes.length === 0) return readAll(session.id);

  const isShared = (key: string): boolean =>
    keys.has(key) || prefixes.some((p) => p === "" || key.startsWith(p));

  const [own, atRoot] = await Promise.all([
    readAll(session.id),
    readAll(resolveSessionStorageKey(root, tenantId))
  ]);

  const merged: Record<string, T> = {};
  for (const [key, value] of Object.entries(own)) {
    if (isShared(key)) continue;
    merged[key] = value;
  }
  for (const [key, value] of Object.entries(atRoot)) {
    if (isShared(key)) merged[key] = value;
  }
  return merged;
}
