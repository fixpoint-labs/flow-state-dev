import path from "node:path";
import type { CASOptions } from "@flow-state-dev/core/types";
import { ConcurrentModificationError, runWithCAS } from "./cas";
import { ResourceAlreadyExistsError, ResourceDeletedError } from "./resource-cas";
import { createFilesystemActiveRequestRegistry } from "./filesystem/active-request-registry";
import { createFilesystemCheckpointStore } from "./filesystem/checkpoint-store";
import { createFilesystemContentStore } from "./filesystem/content-store";
import { createFilesystemResourceStateStore } from "./filesystem/resource-state-store";
import { createFilesystemProjectStore } from "./filesystem/org-store";
import { createFilesystemRequestStore } from "./filesystem/request-store";
import { createFilesystemSessionStore } from "./filesystem/session-store";
import { createFilesystemTraceStore } from "./filesystem/trace-store";
export type { FilesystemTraceStoreOptions } from "./filesystem/trace-store";
import { createFilesystemSuspensionStore } from "./filesystem/suspension-store";
import { createFilesystemLeaseStore } from "./filesystem/lease-store";
import { createFilesystemUserStore } from "./filesystem/user-store";
import { createInMemoryActiveRequestRegistry } from "./memory/active-request-registry";
import { createInMemoryCheckpointStore } from "./memory/checkpoint-store";
import { createInMemoryContentStore } from "./memory/content-store";
import { createInMemoryResourceStateStore } from "./memory/resource-state-store";
import { toBareState, toBareStates } from "./resource-state-views";
export type {
  ResourceStateConflict,
  ResourceStateRow
} from "./resource-state-predicate";
import { createInMemoryProjectStore } from "./memory/org-store";
import { createInMemoryRequestStore } from "./memory/request-store";
import { createInMemorySessionStore } from "./memory/session-store";
import {
  createInMemoryTraceStore,
  type InMemoryTraceStoreOptions
} from "./memory/trace-store";
import { createInMemoryUserStore } from "./memory/user-store";
import { createInMemorySuspensionStore } from "./memory/suspension-store";
import { createInMemoryLeaseStore } from "./memory/lease-store";
import { ScopeMutationTimeoutError } from "./scope-lock";
import { createScopeStateOps, createStateContainer } from "./state-container";
import type { PersistErrorHandler, StoreRegistry } from "./types";
import type { StoreAdapter } from "./store-adapter";

export type {
  ActiveRequestEntry,
  ActiveRequestRegistry,
  CheckpointStore,
  ContentScopeType,
  ContentStore,
  LeaseStore,
  ResourceStateStore,
  VersionedResourceState,
  ExpectedVersion,
  OrgListOptions,
  OrgRecord,
  OrgStore,
  PersistErrorHandler,
  PersistErrorInfo,
  RequestListOptions,
  RequestRecord,
  RequestStatus,
  RequestStore,
  ScopeRecordBase,
  SessionListOptions,
  SessionParentage,
  SessionRecord,
  SessionStore,
  SetResult,
  StoreRegistry,
  SuspensionStore,
  SubscribeToEventsOptions,
  TraceEvent,
  TraceStore,
  UserListOptions,
  UserRecord,
  UserStore
} from "./types";

export {
  mintStorageGeneration,
  resolveOrgStorageKey,
  resolveSessionResourceScopeId,
  resolveUserStorageKey
} from "./scope-keys";
export type { IsolationFlow } from "./scope-keys";

export type {
  StoreAdapter,
  CapabilitySlot,
  CapabilitySlotMap,
  StoresConfig
} from "./store-adapter";

export {
  ConcurrentModificationError,
  ResourceAlreadyExistsError,
  ResourceDeletedError,
  ScopeMutationTimeoutError,
  createScopeStateOps,
  createStateContainer,
  createFilesystemActiveRequestRegistry,
  createFilesystemCheckpointStore,
  createFilesystemContentStore,
  createFilesystemResourceStateStore,
  createFilesystemProjectStore,
  createFilesystemRequestStore,
  createFilesystemSessionStore,
  createFilesystemSuspensionStore,
  createFilesystemLeaseStore,
  createFilesystemTraceStore,
  createFilesystemUserStore,
  createInMemoryActiveRequestRegistry,
  createInMemoryCheckpointStore,
  createInMemoryContentStore,
  createInMemoryResourceStateStore,
  toBareState,
  toBareStates,
  createInMemoryProjectStore,
  createInMemoryRequestStore,
  createInMemorySessionStore,
  createInMemoryTraceStore,
  createInMemoryUserStore,
  createInMemorySuspensionStore,
  createInMemoryLeaseStore,
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
  /**
   * Fired when any filesystem adapter's background write fails, before the
   * adapter's safety-net log. The structured channel operators wire to alert
   * on persistence loss (FIX-406 6B). When unset, failures are still logged.
   */
  onPersistError?: PersistErrorHandler;
  /**
   * Acknowledge that the filesystem store is for local development only
   * (FIX-406 6A). Its O(N²) event persistence collapses under production
   * load — use `createSQLiteStores` (`@flow-state-dev/store-sqlite`) for any
   * real workload. When this is not `true`, construction logs a one-time
   * warning. The flag changes no behavior; it only records intent and
   * silences the warning.
   */
  developmentOnly?: boolean;
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
    resourceState: createInMemoryResourceStateStore(),
    checkpoints: createInMemoryCheckpointStore(),
    traces: createInMemoryTraceStore({
      ...options.traceStore,
      maxRequests: resolveTraceMaxRequests(options.traceStore?.maxRequests)
    }),
    suspensions: createInMemorySuspensionStore(),
    leases: createInMemoryLeaseStore()
  };
}

/**
 * Process-wide guard so the filesystem-store production warning logs at most
 * once, regardless of how many registries a host constructs.
 */
let warnedFilesystemStoreUnsafe = false;

export function createFilesystemStores(
  options: FilesystemStoreRegistryOptions
): StoreRegistry {
  const { onPersistError } = options;

  // FIX-406 6A: steer operators off the filesystem store for production unless
  // they explicitly acknowledge it's development-only. Warn once per process.
  if (options.developmentOnly !== true && !warnedFilesystemStoreUnsafe) {
    warnedFilesystemStoreUnsafe = true;
    console.warn(
      "[flow-state] createFilesystemStores: the filesystem store's O(N^2) " +
        "event persistence is unsuitable for production load. Use " +
        "createSQLiteStores from @flow-state-dev/store-sqlite, or pass " +
        "{ developmentOnly: true } to acknowledge local-only use and silence " +
        "this warning."
    );
  }
  return {
    session: createFilesystemSessionStore({
      rootDir: path.join(options.rootDir, "sessions")
    }),
    request: createFilesystemRequestStore({
      rootDir: path.join(options.rootDir, "requests"),
      onPersistError
    }),
    user: createFilesystemUserStore({
      rootDir: path.join(options.rootDir, "users")
    }),
    org: createFilesystemProjectStore({
      rootDir: path.join(options.rootDir, "projects")
    }),
    activeRequests: createFilesystemActiveRequestRegistry({
      directory: options.rootDir,
      onPersistError
    }),
    content: createFilesystemContentStore(options.rootDir),
    resourceState: createFilesystemResourceStateStore(options.rootDir),
    checkpoints: createFilesystemCheckpointStore(options.rootDir),
    traces: createFilesystemTraceStore({
      rootDir: path.join(options.rootDir, "traces"),
      maxRequests: resolveTraceMaxRequests(options.traceStore?.maxRequests),
      onPersistError
    }),
    suspensions: createFilesystemSuspensionStore(path.join(options.rootDir, "suspensions")),
    leases: createFilesystemLeaseStore(path.join(options.rootDir, "leases"))
  };
}

/**
 * In-memory store adapter for `createFlowState`. Backs the `primary`
 * capability slot with ephemeral stores — the default for local dev and
 * tests. Memoizes the registry so repeated resolution returns one instance.
 */
export function inMemoryStores(options: CreateStoreOptions = {}): StoreAdapter {
  let registry: StoreRegistry | undefined;
  return {
    capabilities: ["primary"],
    resolve() {
      registry ??= createInMemoryStores(options);
      return Promise.resolve(registry);
    }
  };
}

/**
 * Filesystem store adapter for `createFlowState`. Backs the `primary`
 * capability slot with `.fsdev/data`-style on-disk persistence.
 */
export function filesystemStores(
  options: FilesystemStoreRegistryOptions
): StoreAdapter {
  let registry: StoreRegistry | undefined;
  return {
    capabilities: ["primary"],
    resolve() {
      registry ??= createFilesystemStores(options);
      return Promise.resolve(registry);
    }
  };
}
