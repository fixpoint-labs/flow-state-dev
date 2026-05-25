import type { RuntimeItem as TestItem } from "@flow-state-dev/core/items/internal";
import type { BlockInput, BlockOutput, FlowInstance, FlowStateSettings } from "@flow-state-dev/core/types";
import type { StoreRegistry } from "@flow-state-dev/server";
import type {
  MockGeneratorInstance,
  UnmockedGeneratorPolicy
} from "../mocks/mockGenerator";

export type TestRequestSeed = {
  state?: Record<string, unknown>;
};

export type TestScopeSeed = {
  state?: Record<string, unknown>;
  resources?: Record<string, unknown>;
};

export type TestStateSeed = {
  request?: TestRequestSeed;
  session?: TestScopeSeed;
  user?: TestScopeSeed;
  org?: TestScopeSeed;
};

export type TestTargetSeed = {
  state: Record<string, unknown>;
};

export type TestSequencerSeed = TestTargetSeed & {
  name?: string;
};

export type TestBlockOptions<TInput> = {
  input: TInput;
  /** Optional flow instance. When provided, its resource configs (including
   *  resource collections) are used instead of the auto-generated ones. */
  flow?: FlowInstance;
  request?: TestRequestSeed;
  session?: TestScopeSeed;
  user?: TestScopeSeed;
  org?: TestScopeSeed;
  sequencer?: TestSequencerSeed;
  targets?: Record<string, TestTargetSeed>;
  tools?: Record<string, (...args: any[]) => Promise<any> | any>;
  generators?: Record<string, MockGeneratorInstance>;
  models?: Record<string, MockGeneratorInstance>;
  unmockedGeneratorPolicy?: UnmockedGeneratorPolicy;
};

export type StateChange = {
  scope: "request" | "session" | "user" | "org" | "block_instance";
  operation:
    | "patchState"
    | "setState"
    | "incState"
    | "pushState"
    | "setStateRecord"
    | "deleteStateRecord"
    | "atomicState";
  args: unknown[];
  resultingState: Record<string, unknown>;
  targetName?: string;
  targetInstanceId?: string;
};

export type TestBlockResult<TOutput> = {
  output: TOutput;
  error: Error | null;
  items: TestItem[];
  state: {
    request: Record<string, unknown>;
    session: Record<string, unknown>;
    user: Record<string, unknown>;
    org: Record<string, unknown>;
    sequencer: Record<string, unknown>;
  };
  stateChanges: StateChange[];
  meta: {
    durationMs: number;
    blockName: string;
    retryAttempts: number;
  };
};

export type StepTrace = {
  stepName: string;
  blockName: string;
  input: unknown;
  output: unknown;
  error: Error | null;
  items: TestItem[];
  durationMs: number;
  phase: "main" | "work";
  skipped: boolean;
};

export type WorkTrace = {
  blockName: string;
  output: unknown;
  error: Error | null;
  items: TestItem[];
};

export type TestSequencerResult<TOutput> = TestBlockResult<TOutput> & {
  steps: StepTrace[];
  workResults: WorkTrace[];
  loopIterations: number;
};

export type TestRouterResult<TOutput> = TestBlockResult<TOutput> & {
  selectedRoute: string;
};

export type TestFlowOptions<TInput = unknown> = {
  flow: FlowInstance;
  action: string;
  input: TInput;
  sessionId?: string;
  userId: string;
  seed?: TestStateSeed;
  generators?: Record<string, MockGeneratorInstance>;
  models?: Record<string, MockGeneratorInstance>;
  unmockedGeneratorPolicy?: UnmockedGeneratorPolicy;
  /**
   * Instance-level settings exposed to blocks via `ctx.settings`. Mirrors
   * `createFlowState({ settings })` so tests can exercise settings-dependent
   * behavior without standing up a full FlowState.
   */
  settings?: FlowStateSettings;
  /**
   * Reuse an existing in-memory store registry instead of creating a fresh
   * one. Lets multiple `testFlow` calls share session, user, org, and
   * request state — the foundation for session-resume scenarios. Seeding
   * is idempotent, so repeated runs against the same registry preserve
   * journal entries and resource state from prior calls.
   */
  stores?: StoreRegistry;
};

export type TestFlowResult = {
  status: "completed" | "failed" | "incomplete" | "interrupted" | "aborted";
  requestId: string;
  output?: unknown;
  error?: Error;
  items: TestItem[];
};

export type { BlockInput, BlockOutput };
