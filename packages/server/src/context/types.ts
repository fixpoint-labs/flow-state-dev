import type {
  BlockContext,
  FlowInstance,
  JsonObject,
  ModelResolver,
  ResponseEmitterHandle
} from "@flow-state-dev/core/types";
import type { StoreRegistry } from "../stores/types";

export type RequestRuntime = {
  requestId: string;
  actionName: string;
  status: "in_progress" | "completed" | "incomplete" | "failed";
  startedAtMs: number;
  completedAtMs?: number;
  failedAtMs?: number;
  metadata?: Record<string, unknown>;
};

export type ExecutionContext<
  TRequestState extends JsonObject = JsonObject,
  TSessionState extends JsonObject = JsonObject,
  TUserState extends JsonObject = JsonObject,
  TProjectState extends JsonObject = JsonObject
> = BlockContext<TRequestState, TSessionState, TUserState, TProjectState> & {
  flow: FlowInstance;
  actionName: string;
  requestRuntime: RequestRuntime;
  stores: StoreRegistry;
};

export type CreateExecutionContextOptions<
  TRequestState extends JsonObject = JsonObject,
  TSessionState extends JsonObject = JsonObject,
  TUserState extends JsonObject = JsonObject,
  TProjectState extends JsonObject = JsonObject
> = {
  flow: FlowInstance;
  actionName: string;
  requestId: string;
  userId?: string;
  sessionId?: string;
  projectId?: string;
  requestState?: TRequestState;
  sessionState?: TSessionState;
  userState?: TUserState;
  projectState?: TProjectState;
  metadata?: Record<string, unknown>;
  input?: unknown;
  signal?: AbortSignal;
  response?: ResponseEmitterHandle;
  modelResolver?: ModelResolver;
  stores: StoreRegistry;
};
