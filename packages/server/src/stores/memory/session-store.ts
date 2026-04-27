import type {
  ExpectedVersion,
  SessionListOptions,
  SessionRecord,
  SessionStore,
  SetResult
} from "../types";
import { applyOffsetLimit, casWriteToMap, cloneValue } from "./shared";

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
