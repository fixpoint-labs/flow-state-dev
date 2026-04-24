import type {
  ExpectedVersion,
  UserListOptions,
  UserRecord,
  UserStore,
  SetResult
} from "../types";
import {
  createFilesystemRecordStore,
  type FilesystemRecordStore
} from "./shared";

export type FilesystemUserStoreOptions = {
  rootDir: string;
};

export class FilesystemUserStore implements UserStore {
  private readonly store: FilesystemRecordStore<UserRecord, UserListOptions>;

  constructor(options: FilesystemUserStoreOptions) {
    this.store = createFilesystemRecordStore<UserRecord, UserListOptions>({
      rootDir: options.rootDir
    });
  }

  async get(id: string): Promise<UserRecord | undefined> {
    return this.store.get(id);
  }

  async set(
    id: string,
    value: UserRecord,
    expectedVersion: ExpectedVersion
  ): Promise<SetResult<UserRecord>> {
    return this.store.set(id, value, expectedVersion);
  }

  async delete(id: string): Promise<void> {
    await this.store.delete(id);
  }

  async list(options?: UserListOptions): Promise<UserRecord[]> {
    return this.store.list(options);
  }
}

export function createFilesystemUserStore(
  options: FilesystemUserStoreOptions
): UserStore {
  return new FilesystemUserStore(options);
}
