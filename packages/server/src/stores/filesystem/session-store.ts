import type {
  SessionListOptions,
  SessionRecord,
  SessionStore
} from "../types";
import {
  createFilesystemRecordStore,
  type FilesystemRecordStore
} from "./shared";

export type FilesystemSessionStoreOptions = {
  rootDir: string;
};

export class FilesystemSessionStore implements SessionStore {
  private readonly store: FilesystemRecordStore<
    SessionRecord,
    SessionListOptions
  >;

  constructor(options: FilesystemSessionStoreOptions) {
    this.store = createFilesystemRecordStore<SessionRecord, SessionListOptions>({
      rootDir: options.rootDir,
      filter: (record, listOptions): boolean => {
        if (
          listOptions?.flowKind !== undefined &&
          record.flowKind !== listOptions.flowKind
        ) {
          return false;
        }

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

  async get(id: string): Promise<SessionRecord | undefined> {
    return this.store.get(id);
  }

  async set(id: string, value: SessionRecord): Promise<void> {
    await this.store.set(id, value);
  }

  async delete(id: string): Promise<void> {
    await this.store.delete(id);
  }

  async list(options?: SessionListOptions): Promise<SessionRecord[]> {
    return this.store.list(options);
  }
}

export function createFilesystemSessionStore(
  options: FilesystemSessionStoreOptions
): SessionStore {
  return new FilesystemSessionStore(options);
}
