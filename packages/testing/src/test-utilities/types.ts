import type { OutputItem } from "@flow-state-dev/core/items";
import type { BlockInput, BlockOutput, FlowInstance } from "@flow-state-dev/core/types";
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
  project?: TestScopeSeed;
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
  project?: TestScopeSeed;
  sequencer?: TestSequencerSeed;
  targets?: Record<string, TestTargetSeed>;
  tools?: Record<string, (...args: any[]) => Promise<any> | any>;
  generators?: Record<string, MockGeneratorInstance>;
  models?: Record<string, MockGeneratorInstance>;
  unmockedGeneratorPolicy?: UnmockedGeneratorPolicy;
};

export type StateChange = {
  scope: "request" | "session" | "user" | "project" | "block_instance";
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
  items: OutputItem[];
  state: {
    request: Record<string, unknown>;
    session: Record<string, unknown>;
    user: Record<string, unknown>;
    project: Record<string, unknown>;
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
  items: OutputItem[];
  durationMs: number;
  phase: "main" | "work";
  skipped: boolean;
};

export type WorkTrace = {
  blockName: string;
  output: unknown;
  error: Error | null;
  items: OutputItem[];
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
};

export type TestFlowResult = {
  status: "completed" | "failed" | "incomplete";
  requestId: string;
  output?: unknown;
  error?: Error;
  items: OutputItem[];
};

export type { BlockInput, BlockOutput };
