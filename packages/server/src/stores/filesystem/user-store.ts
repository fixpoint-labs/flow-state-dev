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

  async patchField(
    id: string,
    path: string[],
    value: unknown,
    expectedVersion: ExpectedVersion,
    updatedAt: number
  ): Promise<SetResult<UserRecord>> {
    return this.store.patchField(id, path, value, expectedVersion, updatedAt);
  }

  async incField(
    id: string,
    path: string[],
    delta: number,
    expectedVersion: ExpectedVersion,
    updatedAt: number
  ): Promise<SetResult<UserRecord>> {
    return this.store.incField(id, path, delta, expectedVersion, updatedAt);
  }

  async pushToArray(
    id: string,
    path: string[],
    values: unknown[],
    expectedVersion: ExpectedVersion,
    updatedAt: number
  ): Promise<SetResult<UserRecord>> {
    return this.store.pushToArray(id, path, values, expectedVersion, updatedAt);
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
