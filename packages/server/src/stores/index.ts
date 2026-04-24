import path from "node:path";
import type { CASOptions } from "@flow-state-dev/core/types";
import { ConcurrentModificationError, runWithCAS } from "./cas";
import {
  createFilesystemActiveRequestRegistry,
  FilesystemActiveRequestRegistry
} from "./filesystem/active-request-registry";
import {
  createFilesystemContentStore,
  FilesystemContentStore
} from "./filesystem/content-store";
import {
  createFilesystemProjectStore,
  FilesystemProjectStore
} from "./filesystem/project-store";
import {
  createFilesystemRequestStore,
  FilesystemRequestStore
} from "./filesystem/request-store";
import {
  createFilesystemSessionStore,
  FilesystemSessionStore
} from "./filesystem/session-store";
import {
  createFilesystemUserStore,
  FilesystemUserStore
} from "./filesystem/user-store";
import {
  createInMemoryActiveRequestRegistry,
  InMemoryActiveRequestRegistry
} from "./memory/active-request-registry";
import {
  createInMemoryContentStore,
  InMemoryContentStore
} from "./memory/content-store";
import {
  createInMemoryProjectStore,
  InMemoryProjectStore
} from "./memory/project-store";
import {
  createInMemoryRequestStore,
  InMemoryRequestStore
} from "./memory/request-store";
import {
  createInMemorySessionStore,
  InMemorySessionStore
} from "./memory/session-store";
import {
  createInMemoryUserStore,
  InMemoryUserStore
} from "./memory/user-store";
import {
  createScopeStateOps,
  createStateContainer,
  MemoryStateContainer
} from "./state-container";
import type { StoreRegistry } from "./types";

export type {
  ActiveRequestEntry,
  ActiveRequestRegistry,
  ContentScopeType,
  ContentStore,
  ExpectedVersion,
  ProjectListOptions,
  ProjectRecord,
  ProjectStore,
  RequestListOptions,
  RequestRecord,
  RequestStatus,
  RequestStore,
  ScopeRecordBase,
  SessionListOptions,
  SessionRecord,
  SessionStore,
  SetResult,
  StoreRegistry,
  UserListOptions,
  UserRecord,
  UserStore
} from "./types";

export {
  ConcurrentModificationError,
  createScopeStateOps,
  createStateContainer,
  createFilesystemActiveRequestRegistry,
  createFilesystemContentStore,
  createFilesystemProjectStore,
  createFilesystemRequestStore,
  createFilesystemSessionStore,
  createFilesystemUserStore,
  createInMemoryActiveRequestRegistry,
  createInMemoryContentStore,
  createInMemoryProjectStore,
  createInMemoryRequestStore,
  createInMemorySessionStore,
  createInMemoryUserStore,
  FilesystemActiveRequestRegistry,
  FilesystemContentStore,
  FilesystemProjectStore,
  FilesystemRequestStore,
  FilesystemSessionStore,
  FilesystemUserStore,
  InMemoryActiveRequestRegistry,
  InMemoryContentStore,
  InMemoryProjectStore,
  InMemoryRequestStore,
  InMemorySessionStore,
  InMemoryUserStore,
  MemoryStateContainer,
  runWithCAS
};

export type CreateStoreOptions = {
  cas?: CASOptions;
};

export type FilesystemStoreRegistryOptions = CreateStoreOptions & {
  rootDir: string;
};

export function createInMemoryStores(): StoreRegistry {
  return {
    session: createInMemorySessionStore(),
    request: createInMemoryRequestStore(),
    user: createInMemoryUserStore(),
    project: createInMemoryProjectStore(),
    activeRequests: createInMemoryActiveRequestRegistry(),
    content: createInMemoryContentStore()
  };
}

export function createFilesystemStores(
  options: FilesystemStoreRegistryOptions
): StoreRegistry {
  return {
    session: createFilesystemSessionStore({
      rootDir: path.join(options.rootDir, "sessions")
    }),
    request: createFilesystemRequestStore({
      rootDir: path.join(options.rootDir, "requests")
    }),
    user: createFilesystemUserStore({
      rootDir: path.join(options.rootDir, "users")
    }),
    project: createFilesystemProjectStore({
      rootDir: path.join(options.rootDir, "projects")
    }),
    activeRequests: createFilesystemActiveRequestRegistry({
      directory: options.rootDir
    }),
    content: createFilesystemContentStore(options.rootDir)
  };
}
