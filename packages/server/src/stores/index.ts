import path from "node:path";
import type { CASOptions } from "@flow-state-dev/core/types";
import { ConcurrentModificationError, runWithCAS } from "./cas";
import {
  createFilesystemActiveRequestRegistry,
  FilesystemActiveRequestRegistry
} from "./filesystem/active-request-registry";
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
  createFilesystemProjectStore,
  createFilesystemRequestStore,
  createFilesystemSessionStore,
  createFilesystemUserStore,
  createInMemoryActiveRequestRegistry,
  createInMemoryProjectStore,
  createInMemoryRequestStore,
  createInMemorySessionStore,
  createInMemoryUserStore,
  FilesystemActiveRequestRegistry,
  FilesystemProjectStore,
  FilesystemRequestStore,
  FilesystemSessionStore,
  FilesystemUserStore,
  InMemoryActiveRequestRegistry,
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
    activeRequests: createInMemoryActiveRequestRegistry()
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
    })
  };
}
