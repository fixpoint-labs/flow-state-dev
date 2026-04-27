import type {
  ExpectedVersion,
  OrgListOptions,
  OrgRecord,
  OrgStore,
  SetResult
} from "../types";
import {
  createFilesystemRecordStore,
  type FilesystemRecordStore
} from "./shared";

export type FilesystemProjectStoreOptions = {
  rootDir: string;
};

export class FilesystemProjectStore implements OrgStore {
  private readonly store: FilesystemRecordStore<
    OrgRecord,
    OrgListOptions
  >;

  constructor(options: FilesystemProjectStoreOptions) {
    this.store = createFilesystemRecordStore<OrgRecord, OrgListOptions>({
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

  async get(id: string): Promise<OrgRecord | undefined> {
    return this.store.get(id);
  }

  async set(
    id: string,
    value: OrgRecord,
    expectedVersion: ExpectedVersion
  ): Promise<SetResult<OrgRecord>> {
    return this.store.set(id, value, expectedVersion);
  }

  async delete(id: string): Promise<void> {
    await this.store.delete(id);
  }

  async list(options?: OrgListOptions): Promise<OrgRecord[]> {
    return this.store.list(options);
  }
}

export function createFilesystemProjectStore(
  options: FilesystemProjectStoreOptions
): OrgStore {
  return new FilesystemProjectStore(options);
}
