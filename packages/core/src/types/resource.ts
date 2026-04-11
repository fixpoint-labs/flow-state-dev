import type { ZodTypeAny } from "zod";
import type {
  ProjectScopeHandle,
  RequestScopeHandle,
  ScopeType,
  SessionScopeHandle,
  UserScopeHandle
} from "./scope";
import type { JsonObject, JsonValue } from "../schema/common";
import type { ResourceCollectionRef } from "./resource-collection";

/**
 * Client-side content access permissions for a single resource.
 * Only `read` and `prefetch` are valid on single resources.
 */
export type ResourceClientContentConfig = {
  /** Allow clients to fetch the rendered content body via the content endpoint. */
  read?: boolean;
  /** When true, content is included inline in the snapshot response (for small, always-needed resources). */
  prefetch?: boolean;
};

/**
 * Client-side content access permissions for a collection resource.
 * Extends single-resource permissions with CRUD mutation flags.
 */
export type CollectionClientContentConfig = ResourceClientContentConfig & {
  /** Allow clients to create new collection items via POST. */
  create?: boolean;
  /** Allow clients to update existing collection item content via PATCH. */
  update?: boolean;
  /** Allow clients to delete collection items via DELETE. */
  delete?: boolean;
};

/**
 * Client visibility configuration for a single resource.
 * Controls what data is exposed to the client and how.
 */
export type ResourceClientConfig = {
  /** Content access permissions — governs access to the rendered content body. */
  content?: ResourceClientContentConfig;
};

/**
 * Client visibility configuration for a collection resource.
 * Controls what data is exposed to the client and how.
 */
export type CollectionClientConfig = {
  /** Content access permissions — governs access to rendered content bodies and CRUD operations. */
  content?: CollectionClientContentConfig;
};

/**
 * A compute function that derives client-visible data from a single resource's state.
 * Analogous to scope-level clientData, but scoped to the resource.
 */
export type ResourceClientDataFn<TState extends JsonObject = JsonObject> =
  (state: Readonly<TState>) => JsonValue | Promise<JsonValue>;

export type ResourceConfig = {
  stateSchema: ZodTypeAny;
  default?: JsonValue;
  content?: string;
  /** Path to a file on disk to load as the content body template. Mutually exclusive with `content`.
   * Resolved relative to `process.cwd()` — use absolute paths for predictable behavior. */
  contentFile?: string;
  render?: (content: string, state: JsonObject) => string | Promise<string>;
  llmReadable?: boolean;
  llmWritable?: boolean;
  dynamic?: boolean;
  writable?: boolean;
  allowedExtensions?: string[];
  metadata?: Record<string, unknown>;
  /** Client visibility configuration. Omit to keep the resource invisible to clients. */
  client?: ResourceClientConfig;
  /** Derives client-visible metadata from the resource's state. Appears under `resources[ref].clientData` in the snapshot. */
  clientData?: ResourceClientDataFn;
};

export type ResourceContext<TState extends JsonObject = JsonObject> = {
  state: Readonly<TState>;
  patchState(updates: Partial<TState>): Promise<void>;
  setState(nextState: TState): Promise<void>;
  updateState(updater: (state: TState) => TState | Promise<TState>): Promise<void>;
};

export type DefinedResource<TState extends JsonObject = JsonObject> = ResourceConfig & {
  StateType: TState;
  ContextType: ResourceContext<TState>;
};

export type MessageLike = {
  role: "system" | "developer" | "user" | "assistant" | "tool";
  content: string | JsonObject | JsonObject[];
};

export interface ResourceRef<TState extends JsonObject = JsonObject> {
  name: string;
  scope: ScopeType;
  state: Readonly<TState>;
  patchState(updates: Partial<TState>): Promise<void>;
  setState(nextState: TState): Promise<void>;
  updateState(updater: (state: TState) => TState | Promise<TState>): Promise<void>;
  readContent(): Promise<string | null>;
  readContentRaw(): Promise<string | null>;
  writeContent(content: string): Promise<void>;
  contentType?: string;
  extension?: string;
  config: Readonly<ResourceConfig>;
}



/** @deprecated Use ResourceRef instead. */
export type ResourceHandle<TState extends JsonObject = JsonObject> = ResourceRef<TState>;

/** Union of handle types that can appear in a resource registry. */
export type AnyResourceRef = ResourceRef<any> | ResourceCollectionRef<any>;

export type ResourceRegistry<
  TResources extends Record<string, AnyResourceRef> = Record<string, AnyResourceRef>
> = TResources & {
  get<TKey extends keyof TResources>(name: TKey): TResources[TKey];
  list(): Array<TResources[keyof TResources]>;
};

export type StateOf<T> = T extends { stateSchema: infer S extends ZodTypeAny }
  ? S["_output"]
  : T extends ZodTypeAny
    ? T["_output"]
    : never;

type AsStateObject<T> = T extends JsonObject ? T : JsonObject;

export type ContextOf<
  T,
  TKind extends "resource" | "request" | "session" | "user" | "project" = "resource",
  TSessionResources extends Record<string, ResourceRef<any>> = Record<string, ResourceRef<any>>
> = TKind extends "resource"
  ? ResourceContext<AsStateObject<StateOf<T>>>
  : TKind extends "session"
    ? SessionScopeHandle<AsStateObject<StateOf<T>>, TSessionResources> & {
        resources: TSessionResources;
      }
    : TKind extends "request"
      ? RequestScopeHandle<AsStateObject<StateOf<T>>>
      : TKind extends "user"
        ? UserScopeHandle<AsStateObject<StateOf<T>>>
        : ProjectScopeHandle<AsStateObject<StateOf<T>>>;

export type ResourceRefOptions = {
  optional?: boolean;
  as?: string;
};

export function defineResource<
  const TStateSchema extends ZodTypeAny,
  const TConfig extends ResourceConfig & { stateSchema: TStateSchema }
>( 
  config: TConfig
): TConfig & DefinedResource<AsStateObject<TStateSchema["_output"]>> {
  if (config.content !== undefined && config.contentFile !== undefined) {
    throw new Error("defineResource() accepts either content or contentFile, not both");
  }

  return config as unknown as TConfig & DefinedResource<AsStateObject<TStateSchema["_output"]>>;
}

function toJsonObject(value: Record<string, unknown>): JsonObject {
  const out: JsonObject = {};

  for (const [key, entry] of Object.entries(value)) {
    if (entry === undefined) {
      continue;
    }

    out[key] = entry as JsonValue;
  }

  return out;
}

/**
 * Slot helper for declaring resource dependencies in generator context slots.
 * Returns a function compatible with `GeneratorSlotReference` that resolves a
 * resource reference at execution time.
 */
export function resource(uri: string, options?: ResourceRefOptions): (input: JsonObject, ctx: unknown) => MessageLike {
  return (_input, _ctx) => {
    const content = toJsonObject({
      ref: uri,
      options: options === undefined ? undefined : toJsonObject(options as Record<string, unknown>)
    });

    return {
      role: "system",
      content
    };
  };
}
