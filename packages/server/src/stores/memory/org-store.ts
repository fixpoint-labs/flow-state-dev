import { cloneValue } from "@flow-state-dev/core/helpers";
import type {
  ExpectedVersion,
  OrgListOptions,
  OrgRecord,
  OrgStore,
  SetResult
} from "../types";
import {
  applyOffsetLimit,
  casWriteToMap,
  incFieldInMap,
  patchFieldInMap,
  pushToArrayInMap
} from "./shared";

export class InMemoryProjectStore implements OrgStore {
  private readonly records = new Map<string, OrgRecord>();

  async get(id: string): Promise<OrgRecord | undefined> {
    const record = this.records.get(id);
    return record === undefined ? undefined : cloneValue(record);
  }

  async set(
    id: string,
    value: OrgRecord,
    expectedVersion: ExpectedVersion
  ): Promise<SetResult<OrgRecord>> {
    return casWriteToMap(this.records, id, value, expectedVersion);
  }

  async patchField(
    id: string,
    path: string[],
    value: unknown,
    expectedVersion: ExpectedVersion,
    updatedAt: number
  ): Promise<SetResult<OrgRecord>> {
    return patchFieldInMap(this.records, id, path, value, expectedVersion, updatedAt);
  }

  async incField(
    id: string,
    path: string[],
    delta: number,
    expectedVersion: ExpectedVersion,
    updatedAt: number
  ): Promise<SetResult<OrgRecord>> {
    return incFieldInMap(this.records, id, path, delta, expectedVersion, updatedAt);
  }

  async pushToArray(
    id: string,
    path: string[],
    values: unknown[],
    expectedVersion: ExpectedVersion,
    updatedAt: number
  ): Promise<SetResult<OrgRecord>> {
    return pushToArrayInMap(this.records, id, path, values, expectedVersion, updatedAt);
  }

  async delete(id: string): Promise<void> {
    this.records.delete(id);
  }

  async list(options?: OrgListOptions): Promise<OrgRecord[]> {
    const filtered = Array.from(this.records.values()).filter((record) => {
      if (options?.userId !== undefined && record.userId !== options.userId) {
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

export function createInMemoryProjectStore(): OrgStore {
  return new InMemoryProjectStore();
}
