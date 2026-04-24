import type {
  ExpectedVersion,
  ProjectListOptions,
  ProjectRecord,
  ProjectStore,
  SetResult
} from "../types";
import {
  createFilesystemRecordStore,
  type FilesystemRecordStore
} from "./shared";

export type FilesystemProjectStoreOptions = {
  rootDir: string;
};

export class FilesystemProjectStore implements ProjectStore {
  private readonly store: FilesystemRecordStore<
    ProjectRecord,
    ProjectListOptions
  >;

  constructor(options: FilesystemProjectStoreOptions) {
    this.store = createFilesystemRecordStore<ProjectRecord, ProjectListOptions>({
      rootDir: options.rootDir,
      filter: (record, listOptions): boolean => {
        if (
          listOptions?.userId !== undefined &&
          record.userId !== listOptions.userId
        ) {
          return false;
        }

        return true;
      }
    });
  }

  async get(id: string): Promise<ProjectRecord | undefined> {
    return this.store.get(id);
  }

  async set(
    id: string,
    value: ProjectRecord,
    expectedVersion: ExpectedVersion
  ): Promise<SetResult<ProjectRecord>> {
    return this.store.set(id, value, expectedVersion);
  }

  async delete(id: string): Promise<void> {
    await this.store.delete(id);
  }

  async list(options?: ProjectListOptions): Promise<ProjectRecord[]> {
    return this.store.list(options);
  }
}

export function createFilesystemProjectStore(
  options: FilesystemProjectStoreOptions
): ProjectStore {
  return new FilesystemProjectStore(options);
}
