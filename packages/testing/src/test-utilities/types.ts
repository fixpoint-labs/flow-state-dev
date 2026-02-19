import type { OutputItem } from "@flow-state-dev/core/items";
import type { BlockDefinition, FlowInstance } from "@flow-state-dev/core/types";
import type { MockGeneratorInstance } from "../mocks/mockGenerator";

export type TestStateSeed = {
  request?: Record<string, unknown>;
  session?: Record<string, unknown>;
  user?: Record<string, unknown>;
  project?: Record<string, unknown>;
};

export type TestTargetSeed = {
  state: Record<string, unknown>;
};

export type TestBlockOptions<TInput> = {
  input: TInput;
  request?: { state?: Record<string, unknown> };
  session?: { state?: Record<string, unknown>; resources?: Record<string, unknown> };
  user?: { state?: Record<string, unknown> };
  project?: { state?: Record<string, unknown> };
  targets?: Record<string, TestTargetSeed>;
  tools?: Record<string, (...args: any[]) => Promise<any> | any>;
  generators?: Record<string, MockGeneratorInstance>;
  unmockedGeneratorPolicy?: "error" | "warn" | "allow";
};

export type StateChange = {
  scope: "request" | "session" | "user" | "project";
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
};

export type TestFlowResult = {
  status: "completed" | "failed" | "incomplete";
  requestId: string;
  output?: unknown;
  error?: Error;
  items: OutputItem[];
};

export type TestableBlock<TInput, TOutput> = BlockDefinition<TInput, TOutput>;
