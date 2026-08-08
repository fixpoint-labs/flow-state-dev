export { applyOffsetLimit } from "../shared";

import { cloneValue as clone } from "@flow-state-dev/core/helpers";
import type { ExpectedVersion, SetResult } from "../types";
import {
  assertDeltaExpectedVersion,
  checkScopeWriteVersion
} from "../scope-write-predicate";

/**
 * CAS-aware write against an in-memory Map. Returns the new version on
 * success or the current value/version on conflict. When `expectedVersion`
 * is "any" the write is unconditional (used for creates and system writes);
 * when it is "absent" the write lands only if no record exists at `id`.
 *
 * The single-threaded event loop is what makes "absent" atomic here: nothing
 * yields between the read and the `Map.set` below.
 */
export function casWriteToMap<TRecord extends { version: number }>(
  records: Map<string, TRecord>,
  id: string,
  value: TRecord,
  expectedVersion: ExpectedVersion
): SetResult<TRecord> {
  const current = records.get(id);
  const refused = checkScopeWriteVersion(current, expectedVersion);
  if (refused !== undefined) {
    return {
      ok: false,
      conflict: {
        currentValue: current === undefined ? undefined : clone(current),
        currentVersion: refused.currentVersion
      }
    };
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

/**
 * Version gate shared by the four delta verbs. Throws on `"absent"` before
 * anything else — a delta verb updates an existing record, so the value is a
 * call-site error rather than a lost race (see `assertDeltaExpectedVersion`).
 */
function checkVersion<TRecord extends { version: number }>(
  current: TRecord | undefined,
  expectedVersion: ExpectedVersion,
  verb: string
): SetResult<TRecord> | undefined {
  assertDeltaExpectedVersion(expectedVersion, verb);
  if (current === undefined) {
    return conflict<TRecord>(undefined, 0);
  }
  if (expectedVersion !== "any" && current.version !== expectedVersion) {
    return conflict(current, current.version);
  }
  return undefined;
}

function assertMaxDepthTwo(path: string[], verb: string): void {
  if (path.length < 1 || path.length > 2) {
    throw new Error(
      `${verb} supports depth-1 or depth-2 paths; received path of length ${path.length}`
    );
  }
}

export function patchFieldInMap<TRecord extends DeltaRecord>(
  records: Map<string, TRecord>,
  id: string,
  path: string[],
  value: unknown,
  expectedVersion: ExpectedVersion,
  updatedAt: number
): SetResult<TRecord> {
  const current = records.get(id);
  const conflictResult = checkVersion(current, expectedVersion, "patchField");
  if (conflictResult !== undefined) return conflictResult;
  assertMaxDepthTwo(path, "patchField");

  const next = clone(current as TRecord);
  const newVersion = (current as TRecord).version + 1;
  const currentState = (current as TRecord).state ?? {};

  if (path.length === 2) {
    const parentRecord = (currentState[path[0]] as Record<string, unknown>) ?? {};
    next.state = {
      ...currentState,
      [path[0]]: { ...parentRecord, [path[1]]: value }
    };
  } else {
    next.state = { ...currentState, [path[0]]: value };
  }

  next.version = newVersion;
  next.updatedAt = updatedAt;
  records.set(id, next);
  return { ok: true, version: newVersion, record: clone(next) };
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
  const conflictResult = checkVersion(current, expectedVersion, "incField");
  if (conflictResult !== undefined) return conflictResult;
  if (path.length !== 1) {
    throw new Error(`incField only supports depth-1 paths; received path of length ${path.length}`);
  }

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
  return { ok: true, version: newVersion, record: clone(next) };
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
  const conflictResult = checkVersion(current, expectedVersion, "pushToArray");
  if (conflictResult !== undefined) return conflictResult;
  if (path.length !== 1) {
    throw new Error(`pushToArray only supports depth-1 paths; received path of length ${path.length}`);
  }

  const existing = (current as TRecord).state?.[path[0]];
  if (existing !== undefined && !Array.isArray(existing)) {
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
  return { ok: true, version: newVersion, record: clone(next) };
}

export function deleteFieldInMap<TRecord extends DeltaRecord>(
  records: Map<string, TRecord>,
  id: string,
  path: string[],
  expectedVersion: ExpectedVersion,
  updatedAt: number
): SetResult<TRecord> {
  const current = records.get(id);
  const conflictResult = checkVersion(current, expectedVersion, "deleteField");
  if (conflictResult !== undefined) return conflictResult;
  assertMaxDepthTwo(path, "deleteField");

  const next = clone(current as TRecord);
  const newVersion = (current as TRecord).version + 1;
  const currentState = { ...((current as TRecord).state ?? {}) };

  if (path.length === 2) {
    const parentRecord = { ...((currentState[path[0]] as Record<string, unknown>) ?? {}) };
    delete parentRecord[path[1]];
    currentState[path[0]] = parentRecord;
  } else {
    delete currentState[path[0]];
  }

  next.state = currentState;
  next.version = newVersion;
  next.updatedAt = updatedAt;
  records.set(id, next);
  return { ok: true, version: newVersion, record: clone(next) };
}
