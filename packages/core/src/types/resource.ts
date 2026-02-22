import { z, type ZodTypeAny } from "zod";
import type { BlockContext } from "./block";
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

export type ProjectionValue = string | MessageLike | MessageLike[] | JsonObject | JsonObject[];

export interface ResourceHandle<TState extends JsonObject = JsonObject> {
  name: string;
  scope: ScopeType;
  state: Readonly<TState>;
  patchState(updates: Partial<TState>): Promise<void>;
  setState(nextState: TState): Promise<void>;
  updateState(updater: (state: TState) => TState | Promise<TState>): Promise<void>;
  readContent(): Promise<string>;
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

export type ProjectionContext<
  TRequestState extends JsonObject = JsonObject,
  TSessionState extends JsonObject = JsonObject,
  TUserState extends JsonObject = JsonObject,
  TProjectState extends JsonObject = JsonObject,
  TSessionResources extends Record<string, ResourceHandle<any>> = Record<string, ResourceHandle<any>>,
  TUserResources extends Record<string, ResourceHandle<any>> = Record<string, ResourceHandle<any>>,
  TProjectResources extends Record<string, ResourceHandle<any>> = Record<string, ResourceHandle<any>>
> = {
  request: RequestScopeHandle<TRequestState>;
  session: (SessionScopeHandle<TSessionState, TSessionResources> & {
    resources: TSessionResources;
  }) | null;
  user: (UserScopeHandle<TUserState, TUserResources> & { resources: TUserResources }) | null;
  project: (ProjectScopeHandle<TProjectState, TProjectResources> & {
    resources: TProjectResources;
  }) | null;
};

export type ProjectionComputeFn<
  TRequestState extends JsonObject = JsonObject,
  TSessionState extends JsonObject = JsonObject,
  TUserState extends JsonObject = JsonObject,
  TProjectState extends JsonObject = JsonObject,
  TSessionResources extends Record<string, ResourceHandle<any>> = Record<string, ResourceHandle<any>>,
  TUserResources extends Record<string, ResourceHandle<any>> = Record<string, ResourceHandle<any>>,
  TProjectResources extends Record<string, ResourceHandle<any>> = Record<string, ResourceHandle<any>>
> = (
  ctx: ProjectionContext<
    TRequestState,
    TSessionState,
    TUserState,
    TProjectState,
    TSessionResources,
    TUserResources,
    TProjectResources
  >
) => ProjectionValue | Promise<ProjectionValue>;

export type ProjectionConfig<
  TRequestState extends JsonObject = JsonObject,
  TSessionState extends JsonObject = JsonObject,
  TUserState extends JsonObject = JsonObject,
  TProjectState extends JsonObject = JsonObject,
  TSessionResources extends Record<string, ResourceHandle<any>> = Record<string, ResourceHandle<any>>,
  TUserResources extends Record<string, ResourceHandle<any>> = Record<string, ResourceHandle<any>>,
  TProjectResources extends Record<string, ResourceHandle<any>> = Record<string, ResourceHandle<any>>
> = {
  client: boolean;
  outputSchema?: ZodTypeAny;
  requestStateSchema?: ZodTypeAny;
  sessionStateSchema?: ZodTypeAny;
  userStateSchema?: ZodTypeAny;
  projectStateSchema?: ZodTypeAny;
  sessionResourceSchemas?: ZodTypeAny;
  userResourceSchemas?: ZodTypeAny;
  projectResourceSchemas?: ZodTypeAny;
  compute: ProjectionComputeFn<
    TRequestState,
    TSessionState,
    TUserState,
    TProjectState,
    TSessionResources,
    TUserResources,
    TProjectResources
  >;
};

export type ProjectionShorthand<
  TRequestState extends JsonObject = JsonObject,
  TSessionState extends JsonObject = JsonObject,
  TUserState extends JsonObject = JsonObject,
  TProjectState extends JsonObject = JsonObject,
  TSessionResources extends Record<string, ResourceHandle<any>> = Record<string, ResourceHandle<any>>,
  TUserResources extends Record<string, ResourceHandle<any>> = Record<string, ResourceHandle<any>>,
  TProjectResources extends Record<string, ResourceHandle<any>> = Record<string, ResourceHandle<any>>
> = ProjectionComputeFn<
  TRequestState,
  TSessionState,
  TUserState,
  TProjectState,
  TSessionResources,
  TUserResources,
  TProjectResources
>;

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

export type ProjectionRefOptions = {
  optional?: boolean;
  missing?: "error" | "empty";
  limit?: number | { tokens: number };
  as?: string;
};

export type SlotReference = (
  input: JsonObject,
  ctx: BlockContext
) => ProjectionValue | Promise<ProjectionValue>;

export function defineResource<const TStateSchema extends ZodTypeAny>(
  config: ResourceConfig & { stateSchema: TStateSchema }
): DefinedResource<AsStateObject<TStateSchema["_output"]>> {
  return config as unknown as DefinedResource<AsStateObject<TStateSchema["_output"]>>;
}

export function defineProjection<const TProjection extends ProjectionConfig>(
  config: TProjection
): TProjection {
  return {
    ...config,
    outputSchema: config.outputSchema ?? z.any()
  };
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

function createSlotReference(label: string, options?: ProjectionRefOptions): SlotReference {
  return (_input, _ctx) => {
    const content = toJsonObject({
      ref: label,
      options: options === undefined ? undefined : toJsonObject(options as Record<string, unknown>)
    });

    return {
      role: "system",
      content
    };
  };
}

export function resource(uri: string, options?: ResourceRefOptions): SlotReference {
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

export function projection(uri: string, options?: ProjectionRefOptions): SlotReference {
  return createSlotReference(uri, options);
}

export function projectionText(uri: string, options?: ProjectionRefOptions): SlotReference {
  return createSlotReference(uri, options);
}

export function projectionData(uri: string, options?: ProjectionRefOptions): SlotReference {
  return createSlotReference(uri, options);
}

export function projectionMessages(uri: string, options?: ProjectionRefOptions): SlotReference[] {
  return [createSlotReference(uri, options)];
}
