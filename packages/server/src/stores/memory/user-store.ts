import type {
  ExpectedVersion,
  UserListOptions,
  UserRecord,
  UserStore,
  SetResult
} from "../types";
import {
  applyOffsetLimit,
  casWriteToMap,
  cloneValue,
  incFieldInMap,
  patchFieldInMap,
  pushToArrayInMap
} from "./shared";

export class InMemoryUserStore implements UserStore {
  private readonly records = new Map<string, UserRecord>();

  async get(id: string): Promise<UserRecord | undefined> {
    const record = this.records.get(id);
    return record === undefined ? undefined : cloneValue(record);
  }

  async set(
    id: string,
    value: UserRecord,
    expectedVersion: ExpectedVersion
  ): Promise<SetResult<UserRecord>> {
    return casWriteToMap(this.records, id, value, expectedVersion);
  }

  async patchField(
    id: string,
    path: string[],
    value: unknown,
    expectedVersion: ExpectedVersion,
    updatedAt: number
  ): Promise<SetResult<UserRecord>> {
    return patchFieldInMap(this.records, id, path, value, expectedVersion, updatedAt);
  }

  async incField(
    id: string,
    path: string[],
    delta: number,
    expectedVersion: ExpectedVersion,
    updatedAt: number
  ): Promise<SetResult<UserRecord>> {
    return incFieldInMap(this.records, id, path, delta, expectedVersion, updatedAt);
  }

  async pushToArray(
    id: string,
    path: string[],
    values: unknown[],
    expectedVersion: ExpectedVersion,
    updatedAt: number
  ): Promise<SetResult<UserRecord>> {
    return pushToArrayInMap(this.records, id, path, values, expectedVersion, updatedAt);
  }

  async delete(id: string): Promise<void> {
    this.records.delete(id);
  }

  async list(options?: UserListOptions): Promise<UserRecord[]> {
    const all = Array.from(this.records.values());
    all.sort((left, right) => right.updatedAt - left.updatedAt);
    return applyOffsetLimit(all, options).map((record) => cloneValue(record));
  }
}

export function createInMemoryUserStore(): UserStore {
  return new InMemoryUserStore();
}
