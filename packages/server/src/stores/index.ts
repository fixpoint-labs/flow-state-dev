import path from "node:path";
import type { CASOptions } from "@flow-state-dev/core/types";
import { ConcurrentModificationError, runWithCAS } from "./cas";
import {
  createFilesystemActiveRequestRegistry,
  FilesystemActiveRequestRegistry
} from "./filesystem/active-request-registry";
import {
  createFilesystemCheckpointStore,
  FilesystemCheckpointStore
} from "./filesystem/checkpoint-store";
import {
  createFilesystemContentStore,
  FilesystemContentStore
} from "./filesystem/content-store";
import {
  createFilesystemProjectStore,
  FilesystemProjectStore
} from "./filesystem/org-store";
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
  createInMemoryCheckpointStore,
  InMemoryCheckpointStore
} from "./memory/checkpoint-store";
import {
  createInMemoryContentStore,
  InMemoryContentStore
} from "./memory/content-store";
import {
  createInMemoryProjectStore,
  InMemoryProjectStore
} from "./memory/org-store";
import {
  createInMemoryRequestStore,
  InMemoryRequestStore
} from "./memory/request-store";
import {
  createInMemorySessionStore,
  InMemorySessionStore
} from "./memory/session-store";
import {
  createInMemoryTraceStore,
  InMemoryTraceStore,
  type InMemoryTraceStoreOptions
} from "./memory/trace-store";
import {
  createInMemoryUserStore,
  InMemoryUserStore
} from "./memory/user-store";
import { ScopeMutationTimeoutError } from "./scope-lock";
import {
  createScopeStateOps,
  createStateContainer,
  MemoryStateContainer
} from "./state-container";
import type { StoreRegistry } from "./types";

export type {
  ActiveRequestEntry,
  ActiveRequestRegistry,
  CheckpointStore,
  ContentScopeType,
  ContentStore,
  ExpectedVersion,
  OrgListOptions,
  OrgRecord,
  OrgStore,
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
  TraceEvent,
  TraceStore,
  UserListOptions,
  UserRecord,
  UserStore
} from "./types";

export {
  resolveUserStorageKey,
  resolveOrgStorageKey
} from "./scope-keys";
export type { IsolationFlow } from "./scope-keys";

export {
  ConcurrentModificationError,
  ScopeMutationTimeoutError,
  createScopeStateOps,
  createStateContainer,
  createFilesystemActiveRequestRegistry,
  createFilesystemCheckpointStore,
  createFilesystemContentStore,
  createFilesystemProjectStore,
  createFilesystemRequestStore,
  createFilesystemSessionStore,
  createFilesystemUserStore,
  createInMemoryActiveRequestRegistry,
  createInMemoryCheckpointStore,
  createInMemoryContentStore,
  createInMemoryProjectStore,
  createInMemoryRequestStore,
  createInMemorySessionStore,
  createInMemoryTraceStore,
  createInMemoryUserStore,
  FilesystemActiveRequestRegistry,
  FilesystemCheckpointStore,
  FilesystemContentStore,
  FilesystemProjectStore,
  FilesystemRequestStore,
  FilesystemSessionStore,
  FilesystemUserStore,
  InMemoryActiveRequestRegistry,
  InMemoryCheckpointStore,
  InMemoryContentStore,
  InMemoryProjectStore,
  InMemoryRequestStore,
  InMemorySessionStore,
  InMemoryTraceStore,
  InMemoryUserStore,
  MemoryStateContainer,
  runWithCAS
};

export type CreateStoreOptions = {
  cas?: CASOptions;
  traceStore?: InMemoryTraceStoreOptions;
};

export type FilesystemStoreRegistryOptions = CreateStoreOptions & {
  rootDir: string;
};

export function createInMemoryStores(options: CreateStoreOptions = {}): StoreRegistry {
  return {
    session: createInMemorySessionStore(),
    request: createInMemoryRequestStore(),
    user: createInMemoryUserStore(),
    org: createInMemoryProjectStore(),
    activeRequests: createInMemoryActiveRequestRegistry(),
    content: createInMemoryContentStore(),
    checkpoints: createInMemoryCheckpointStore(),
    traces: createInMemoryTraceStore(options.traceStore)
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
    org: createFilesystemProjectStore({
      rootDir: path.join(options.rootDir, "projects")
    }),
    activeRequests: createFilesystemActiveRequestRegistry({
      directory: options.rootDir
    }),
    content: createFilesystemContentStore(options.rootDir),
    checkpoints: createFilesystemCheckpointStore(options.rootDir),
    // Filesystem trace persistence is out of scope for FIX-506; the in-memory
    // store satisfies the registry contract until a durable variant lands.
    traces: createInMemoryTraceStore(options.traceStore)
  };
}
