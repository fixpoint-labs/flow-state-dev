import type { ZodTypeAny } from "zod";
import type {
  ProjectScopeHandle,
  RequestScopeHandle,
  ScopeType,
  SessionScopeHandle,
  UserScopeHandle
} from "./scope";
import type { JsonObject, JsonValue } from "../schema/common";

export type ResourceConfig = {
  stateSchema: ZodTypeAny;
  default?: JsonValue;
  content?: string;
  contentFile?: string;
  render?: (content: string, state: JsonObject) => string | Promise<string>;
  llmReadable?: boolean;
  llmWritable?: boolean;
  dynamic?: boolean;
  writable?: boolean;
  allowedExtensions?: string[];
  metadata?: Record<string, unknown>;
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

export interface ResourceHandle<TState extends JsonObject = JsonObject> {
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

export type ResourceRegistry<
  TResources extends Record<string, ResourceHandle<any>> = Record<string, ResourceHandle<any>>
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
  TSessionResources extends Record<string, ResourceHandle<any>> = Record<string, ResourceHandle<any>>
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
