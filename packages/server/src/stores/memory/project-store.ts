import type {
  ProjectListOptions,
  ProjectRecord,
  ProjectStore
} from "../types";
import { applyOffsetLimit, cloneValue } from "./shared";

export class InMemoryProjectStore implements ProjectStore {
  private readonly records = new Map<string, ProjectRecord>();

  async get(id: string): Promise<ProjectRecord | undefined> {
    const record = this.records.get(id);
    return record === undefined ? undefined : cloneValue(record);
  }

  async set(id: string, value: ProjectRecord): Promise<void> {
    this.records.set(id, cloneValue(value));
  }

  async delete(id: string): Promise<void> {
    this.records.delete(id);
  }

  async list(options?: ProjectListOptions): Promise<ProjectRecord[]> {
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

export function createInMemoryProjectStore(): ProjectStore {
  return new InMemoryProjectStore();
}
