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
  createFilesystemTraceStore,
  FilesystemTraceStore
} from "./filesystem/trace-store";
export type { FilesystemTraceStoreOptions } from "./filesystem/trace-store";
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
  createFilesystemTraceStore,
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
  FilesystemTraceStore,
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

export type FilesystemStoreRegistryOptions = {
  cas?: CASOptions;
  rootDir: string;
  /**
   * Trace store retention. The filesystem trace store doesn't honor the
   * in-memory store's `maxBytesPerRequest` (no heap pressure to mitigate),
   * so the surface here is narrower than `CreateStoreOptions.traceStore`.
   */
  traceStore?: { maxRequests?: number };
};

const DEV_DEFAULT_TRACE_MAX_REQUESTS = 1000;
const PROD_DEFAULT_TRACE_MAX_REQUESTS = 50;

/**
 * Resolve the effective `maxRequests` for a trace store factory.
 *
 * An explicit number passed by the caller always wins. Otherwise, the
 * default depends on `process.env.NODE_ENV`: development gets a wider
 * window so a multi-request `fsdev dev` session doesn't silently evict
 * its own history; everything else keeps the conservative production cap.
 *
 * Read at call time so tests that toggle `NODE_ENV` between cases see
 * the change. The constants intentionally aren't exported — backends
 * keep their own constructor defaults so direct construction stays
 * environment-independent.
 */
export function resolveTraceMaxRequests(explicit?: number): number {
  if (explicit !== undefined) return explicit;
  return process.env.NODE_ENV === "development"
    ? DEV_DEFAULT_TRACE_MAX_REQUESTS
    : PROD_DEFAULT_TRACE_MAX_REQUESTS;
}

export function createInMemoryStores(options: CreateStoreOptions = {}): StoreRegistry {
  return {
    session: createInMemorySessionStore(),
    request: createInMemoryRequestStore(),
    user: createInMemoryUserStore(),
    org: createInMemoryProjectStore(),
    activeRequests: createInMemoryActiveRequestRegistry(),
    content: createInMemoryContentStore(),
    checkpoints: createInMemoryCheckpointStore(),
    traces: createInMemoryTraceStore({
      ...options.traceStore,
      maxRequests: resolveTraceMaxRequests(options.traceStore?.maxRequests)
    })
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
    traces: createFilesystemTraceStore({
      rootDir: path.join(options.rootDir, "traces"),
      maxRequests: resolveTraceMaxRequests(options.traceStore?.maxRequests)
    })
  };
}
