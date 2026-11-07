import type { RuntimeItem as TestItem } from "@flow-state-dev/core/internal";
import type { SuspensionItem } from "@flow-state-dev/core/items";
import type { BlockInput, BlockOutput, FlowInstance, FlowStateSettings, ModelResolver, ResumeAction } from "@flow-state-dev/core/types";
import type { StoreRegistry } from "@flow-state-dev/engine";
import type {
  MockGeneratorInstance,
  UnmockedDefault,
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
  /**
   * The flow copy's create-time config bag, read by the block under test as
   * `ctx.flow.config`. Frozen, like production. Omit it and the block reads a
   * frozen empty object — never `undefined`.
   *
   * Ignored when `flow` is supplied: that instance carries its own bag.
   */
  flowConfig?: Record<string, unknown>;
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
  /** Real resolver to route generation through; overrides the mock resolver when set. */
  modelResolver?: ModelResolver;
  /** Fallback script for unmocked generators when policy is "default". */
  unmockedDefault?: UnmockedDefault;
  /**
   * The signal the block runs under, as `ctx.signal`. Abort it to stop the
   * run the way a host does (a deadline, a user's stop). Omit it and the
   * block runs under a signal that never fires.
   */
  signal?: AbortSignal;
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
  /**
   * The block's resolved resource registry, after the run.
   *
   * `state` covers the scope records; this covers the other half — resource
   * collections a block declares and writes into. Without it a test that
   * asserts on written ROWS has to build its own context and dispatch the
   * block's `execute` callback by hand, which skips the execution wrapping
   * every consumer goes through. Reading rows and running the block the real
   * way stop being mutually exclusive.
   *
   * Keyed by the accessor names in the block's `declaredResources`, which
   * `testBlock` already wires into the synthetic flow. `{}` for a block that
   * declares none.
   */
  resources: Record<string, unknown>;
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
  phase: "main" | "sideChain";
  skipped: boolean;
};

export type SideChainTrace = {
  blockName: string;
  output: unknown;
  error: Error | null;
  items: TestItem[];
};

export type TestSequencerResult<TOutput> = TestBlockResult<TOutput> & {
  steps: StepTrace[];
  sideChainResults: SideChainTrace[];
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
   * Fallback script for unmocked generators when `unmockedGeneratorPolicy` is
   * `"default"` — yields this instead of throwing or emitting empty output.
   */
  unmockedDefault?: UnmockedDefault;
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
  /**
   * Run with durable execution, as a host whose stores persist does. Default
   * `true`: a step that calls `ctx.suspendForUser` or `ctx.suspend` stops the
   * run with status `suspended`. `false` runs without it, where such a step
   * fails the run.
   */
  durable?: boolean;
};

export type TestFlowResult = {
  status: "completed" | "failed" | "incomplete" | "interrupted" | "aborted" | "suspended";
  requestId: string;
  output?: unknown;
  error?: Error;
  items: TestItem[];
  /** The stop the run is waiting on, as a screen sees it. Absent when nothing waits. */
  suspension?: SuspensionItem;
  /**
   * Answers a user's stop (`ctx.suspendForUser`) through the engine's answer
   * route, as a screen does, and returns the run that followed: its status
   * and the items emitted after the stop. A refusal the route gives a screen
   * (an action the stop doesn't allow, a second answer, data that fails its
   * schema) throws a `StopRefusedError` with the route's status and message.
   */
  answer(answer: TestFlowAnswer): Promise<TestFlowResult>;
  /**
   * Continues a run stopped by a developer's own `ctx.suspend` through the
   * engine's resume route, and returns the run that followed.
   */
  resume(answer: TestFlowAnswer): Promise<TestFlowResult>;
};

/** An answer to a stop, as `run.answer` and `run.resume` take it. */
export type TestFlowAnswer = {
  action: ResumeAction;
  data?: unknown;
  /** The stop to answer. Defaults to the run's one pending stop; required when it has several. */
  suspensionId?: string;
  /**
   * Headers for the route call, for a flow with its own sign-in: what its
   * `authentication.resolvePrincipal` reads, so it resolves the test's user
   * and the org the run ran in.
   */
  headers?: Record<string, string>;
};

export type { BlockInput, BlockOutput };
