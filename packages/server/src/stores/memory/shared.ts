export { applyOffsetLimit } from "../shared";

import { cloneValue as clone } from "@flow-state-dev/core/helpers";
import type { ExpectedVersion, SetResult } from "../types";

/**
 * CAS-aware write against an in-memory Map. Returns the new version on
 * success or the current value/version on conflict. When `expectedVersion`
 * is "any" the write is unconditional (used for creates and system writes).
 */
export function casWriteToMap<TRecord extends { version: number }>(
  records: Map<string, TRecord>,
  id: string,
  value: TRecord,
  expectedVersion: ExpectedVersion
): SetResult<TRecord> {
  const current = records.get(id);
  if (expectedVersion !== "any") {
    const currentVersion = current?.version ?? 0;
    if (currentVersion !== expectedVersion) {
      return {
        ok: false,
        conflict: {
          currentValue: current === undefined ? undefined : clone(current),
          currentVersion
        }
      };
    }
  }

  records.set(id, clone(value));
  return { ok: true, version: value.version };
}

type DeltaRecord = {
  version: number;
  updatedAt: number;
  state?: Record<string, unknown>;
};

function conflict<TRecord>(
  current: TRecord | undefined,
  currentVersion: number
): SetResult<TRecord> {
  return {
    ok: false,
    conflict: {
      currentValue: current === undefined ? undefined : clone(current),
      currentVersion
    }
  };
}

function checkVersion<TRecord extends { version: number }>(
  current: TRecord | undefined,
  expectedVersion: ExpectedVersion
): SetResult<TRecord> | undefined {
  if (current === undefined) {
    return conflict<TRecord>(undefined, 0);
  }
  if (expectedVersion !== "any" && current.version !== expectedVersion) {
    return conflict(current, current.version);
  }
  return undefined;
}

function assertDepthOne(path: string[], verb: string): void {
  // Callers should pre-route deep paths to set. If one slips through,
  // surface it rather than silently doing the wrong thing. Internal callers
  // (createScopePersist via the CASMutationHint tuple) cannot trigger this;
  // direct adapter API consumers can.
  if (path.length !== 1) {
    throw new Error(
      `${verb} only supports depth-1 paths in v1; received path of length ${path.length}`
    );
  }
}

/**
 * Apply a single-field replacement to the `state` slice of an in-memory
 * record. The new record is cloned into the map (so callers cannot mutate
 * the stored state through retained references) and the version is bumped
 * by one. Returns the new version on success or conflict info on stale
 * `expectedVersion`.
 *
 * `path` must be depth-1 in v1 — the createScopePersist router only emits
 * single-key hints. Deeper paths short-circuit to the `set` fallback before
 * reaching this helper.
 */
export function patchFieldInMap<TRecord extends DeltaRecord>(
  records: Map<string, TRecord>,
  id: string,
  path: string[],
  value: unknown,
  expectedVersion: ExpectedVersion,
  updatedAt: number
): SetResult<TRecord> {
  const current = records.get(id);
  const conflictResult = checkVersion(current, expectedVersion);
  if (conflictResult !== undefined) return conflictResult;
  assertDepthOne(path, "patchField");

  const next = clone(current as TRecord);
  const newVersion = (current as TRecord).version + 1;
  next.state = {
    ...((current as TRecord).state ?? {}),
    [path[0]]: value
  };
  next.version = newVersion;
  next.updatedAt = updatedAt;
  records.set(id, next);
  return { ok: true, version: newVersion };
}

export function incFieldInMap<TRecord extends DeltaRecord>(
  records: Map<string, TRecord>,
  id: string,
  path: string[],
  delta: number,
  expectedVersion: ExpectedVersion,
  updatedAt: number
): SetResult<TRecord> {
  const current = records.get(id);
  const conflictResult = checkVersion(current, expectedVersion);
  if (conflictResult !== undefined) return conflictResult;
  assertDepthOne(path, "incField");

  const next = clone(current as TRecord);
  const newVersion = (current as TRecord).version + 1;
  const existing = (current as TRecord).state?.[path[0]];
  const baseline = typeof existing === "number" ? existing : 0;
  next.state = {
    ...((current as TRecord).state ?? {}),
    [path[0]]: baseline + delta
  };
  next.version = newVersion;
  next.updatedAt = updatedAt;
  records.set(id, next);
  return { ok: true, version: newVersion };
}

export function pushToArrayInMap<TRecord extends DeltaRecord>(
  records: Map<string, TRecord>,
  id: string,
  path: string[],
  values: unknown[],
  expectedVersion: ExpectedVersion,
  updatedAt: number
): SetResult<TRecord> {
  const current = records.get(id);
  const conflictResult = checkVersion(current, expectedVersion);
  if (conflictResult !== undefined) return conflictResult;
  assertDepthOne(path, "pushToArray");

  const existing = (current as TRecord).state?.[path[0]];
  if (existing !== undefined && !Array.isArray(existing)) {
    // Match the Postgres adapter, which raises a `||` operator error on
    // non-array JSONB. Silently overwriting would mask state-shape bugs in
    // dev that surface only on a Postgres deploy.
    throw new Error(
      `pushToArray target at path[${path[0]}] is not an array (got ${typeof existing})`
    );
  }

  const next = clone(current as TRecord);
  const newVersion = (current as TRecord).version + 1;
  const baseline = Array.isArray(existing) ? existing : [];
  next.state = {
    ...((current as TRecord).state ?? {}),
    [path[0]]: [...baseline, ...values]
  };
  next.version = newVersion;
  next.updatedAt = updatedAt;
  records.set(id, next);
  return { ok: true, version: newVersion };
}
