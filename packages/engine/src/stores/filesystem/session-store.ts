import type {
  ExpectedVersion,
  SessionListOptions,
  SessionRecord,
  SessionStore,
  SetResult
} from "../types";
import {
  createFilesystemRecordStore,
  type FilesystemRecordStore
} from "./shared";
import { matchesParentageFilter, matchesTenantFilter } from "../scope-keys";

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

        if (!matchesTenantFilter(listOptions, record.tenantId)) {
          return false;
        }

        if (!matchesParentageFilter(listOptions, record.parentSessionId)) {
          return false;
        }

        return true;
      }
    });
  }

  async get(id: string): Promise<SessionRecord | undefined> {
    return this.store.get(id);
  }

  async set(
    id: string,
    value: SessionRecord,
    expectedVersion: ExpectedVersion
  ): Promise<SetResult<SessionRecord>> {
    return this.store.set(id, value, expectedVersion);
  }

  /**
   * Delta verbs (`patchField`/`incField`/`pushToArray`) delegate to the shared
   * CAS record store, which mutates one depth-1 `state` field in place under
   * the per-id lock instead of rewriting the whole record. Per-verb semantics
   * are documented on `FilesystemRecordStore`.
   */
  async patchField(
    id: string,
    path: string[],
    value: unknown,
    expectedVersion: ExpectedVersion,
    updatedAt: number
  ): Promise<SetResult<SessionRecord>> {
    return this.store.patchField(id, path, value, expectedVersion, updatedAt);
  }

  async incField(
    id: string,
    path: string[],
    delta: number,
    expectedVersion: ExpectedVersion,
    updatedAt: number
  ): Promise<SetResult<SessionRecord>> {
    return this.store.incField(id, path, delta, expectedVersion, updatedAt);
  }

  async pushToArray(
    id: string,
    path: string[],
    values: unknown[],
    expectedVersion: ExpectedVersion,
    updatedAt: number
  ): Promise<SetResult<SessionRecord>> {
    return this.store.pushToArray(id, path, values, expectedVersion, updatedAt);
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
