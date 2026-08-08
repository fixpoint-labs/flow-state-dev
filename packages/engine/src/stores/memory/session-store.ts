import { cloneValue } from "@flow-state-dev/core/helpers";
import type {
  ExpectedVersion,
  SessionListOptions,
  SessionRecord,
  SessionStore,
  SetResult
} from "../types";
import {
  applyOffsetLimit,
  casWriteToMap,
  deleteFieldInMap,
  incFieldInMap,
  patchFieldInMap,
  pushToArrayInMap
} from "./shared";
import { matchesParentageFilter, matchesTenantFilter } from "../scope-keys";

export class InMemorySessionStore implements SessionStore {
  private readonly records = new Map<string, SessionRecord>();

  async get(id: string): Promise<SessionRecord | undefined> {
    const record = this.records.get(id);
    return record === undefined ? undefined : cloneValue(record);
  }

  async set(
    id: string,
    value: SessionRecord,
    expectedVersion: ExpectedVersion
  ): Promise<SetResult<SessionRecord>> {
    return casWriteToMap(this.records, id, value, expectedVersion);
  }

  async patchField(
    id: string,
    path: string[],
    value: unknown,
    expectedVersion: ExpectedVersion,
    updatedAt: number
  ): Promise<SetResult<SessionRecord>> {
    return patchFieldInMap(this.records, id, path, value, expectedVersion, updatedAt);
  }

  async incField(
    id: string,
    path: string[],
    delta: number,
    expectedVersion: ExpectedVersion,
    updatedAt: number
  ): Promise<SetResult<SessionRecord>> {
    return incFieldInMap(this.records, id, path, delta, expectedVersion, updatedAt);
  }

  async pushToArray(
    id: string,
    path: string[],
    values: unknown[],
    expectedVersion: ExpectedVersion,
    updatedAt: number
  ): Promise<SetResult<SessionRecord>> {
    return pushToArrayInMap(this.records, id, path, values, expectedVersion, updatedAt);
  }

  async deleteField(
    id: string,
    path: string[],
    expectedVersion: ExpectedVersion,
    updatedAt: number
  ): Promise<SetResult<SessionRecord>> {
    return deleteFieldInMap(this.records, id, path, expectedVersion, updatedAt);
  }

  async delete(id: string): Promise<void> {
    this.records.delete(id);
  }

  async list(options?: SessionListOptions): Promise<SessionRecord[]> {
    const filtered = Array.from(this.records.values()).filter((record) => {
      if (options?.flowKind !== undefined && record.flowKind !== options.flowKind) {
        return false;
      }

      if (options?.userId !== undefined && record.userId !== options.userId) {
        return false;
      }

      if (!matchesTenantFilter(options, record.tenantId)) {
        return false;
      }

      if (!matchesParentageFilter(options, record.parentSessionId)) {
        return false;
      }

      return true;
    });

    filtered.sort((left, right) => right.updatedAt - left.updatedAt);
    return applyOffsetLimit(filtered, options).map((record) =>
      cloneValue(record)
    );
  }
}

export function createInMemorySessionStore(): SessionStore {
  return new InMemorySessionStore();
}
