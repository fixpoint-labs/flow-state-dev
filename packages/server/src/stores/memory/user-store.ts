import type {
  UserListOptions,
  UserRecord,
  UserStore
} from "../types";
import { applyOffsetLimit, cloneValue } from "./shared";

export class InMemoryUserStore implements UserStore {
  private readonly records = new Map<string, UserRecord>();

  async get(id: string): Promise<UserRecord | undefined> {
    const record = this.records.get(id);
    return record === undefined ? undefined : cloneValue(record);
  }

  async set(id: string, value: UserRecord): Promise<void> {
    this.records.set(id, cloneValue(value));
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
