import type {
  UserListOptions,
  UserRecord,
  UserStore
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

  async set(id: string, value: UserRecord): Promise<void> {
    await this.store.set(id, value);
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
