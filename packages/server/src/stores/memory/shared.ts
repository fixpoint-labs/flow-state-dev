export { applyOffsetLimit } from "../shared";
export { cloneValue } from "../../utils/clone";

import { cloneValue as clone } from "../../utils/clone";
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
