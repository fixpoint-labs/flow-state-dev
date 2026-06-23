/**
 * Inbound transport adapter conformance suite.
 *
 * Every concrete `InboundTransportAdapter` implementation should pass this
 * suite. The HTTP adapter is the first conformer; future MCP, webhook,
 * scheduled, and notification adapters plug into the same harness via
 * `createInboundTransportConformanceTests`.
 *
 * The suite focuses on the adapter→host boundary — envelope construction,
 * principal resolution, source propagation, signal forwarding, and
 * teardown — rather than transport-specific semantics. Per-transport
 * suites live alongside their implementation.
 */
import { describe, it, expect } from "vitest";
import type {
  InboundRequestEnvelope,
  InboundTransportAdapter,
  InboundTransportHost,
  ResolvedPrincipal,
  PrincipalResolutionContext
} from "@flow-state-dev/server";

/**
 * Snapshot of a dispatch call captured by the mock host. Adapters under
 * test typically construct an envelope per request — assertions inspect
 * the captured envelopes rather than poking at the adapter's internals.
 */
export type DispatchCall = {
  envelope: InboundRequestEnvelope;
};

/**
 * Mock host produced by `createMockTransportHost`. Adapters call its
 * `dispatch` and `resolvePrincipal`; tests inspect `dispatchCalls` and
 * `principalCalls` afterward.
 */
export type MockTransportHost = InboundTransportHost & {
  readonly dispatchCalls: DispatchCall[];
  readonly principalCalls: PrincipalResolutionContext[];
};

export type CreateMockTransportHostOptions = {
  /** Resolver invoked for `resolvePrincipal`. Default returns `{ userId: "test-user" }`. */
  resolvePrincipal?: (
    ctx: PrincipalResolutionContext
  ) => Promise<ResolvedPrincipal> | ResolvedPrincipal;
};

/**
 * Build a host suitable for adapter tests. Records every dispatch and
 * principal resolution; returns a no-op `DispatchHandle` so adapters can
 * be exercised without spinning up the runtime.
 */
export function createMockTransportHost(
  options: CreateMockTransportHostOptions = {}
): MockTransportHost {
  const dispatchCalls: DispatchCall[] = [];
  const principalCalls: PrincipalResolutionContext[] = [];

  const resolvePrincipal = options.resolvePrincipal ??
    ((_: PrincipalResolutionContext) => ({ userId: "test-user" }));

  const host: InboundTransportHost = {
    registry: minimalRegistry(),
    stores: minimalStores(),
    middleware: [],
    async validateDispatch() {},
    dispatch(envelope) {
      dispatchCalls.push({ envelope });
      const requestId = envelope.requestId ?? `req_mock_${dispatchCalls.length}`;
      // Use a permissive cast — the stub emitter satisfies the type
      // without standing up the actual streaming runtime.
      const responseEmitter = stubResponseEmitter();
      return {
        requestId,
        responseEmitter,
        liveStream: null,
        finished: Promise.resolve({
          output: undefined,
          items: [],
          durationMs: 0
        })
      };
    },
    async resolvePrincipal(context) {
      principalCalls.push(context);
      return resolvePrincipal(context);
    },
    // Suspend/resume continuation is not exercised by adapter conformance —
    // adapters call `dispatch`, not `continueRequest` (FIX-811). Return a no-op
    // handle bound to the requested id so the type is satisfied without standing
    // up the runtime.
    async continueRequest(opts) {
      return {
        requestId: opts.requestId,
        liveStream: null,
        finished: Promise.resolve({
          output: undefined,
          items: [],
          durationMs: 0
        })
      };
    }
  };

  return Object.assign(host, {
    dispatchCalls,
    principalCalls
  });
}

/**
 * Run the inbound-transport conformance suite against an adapter factory.
 * Pass a factory rather than an adapter so the suite can construct fresh
 * instances per case.
 */
export type ConformanceCaseHelpers = {
  /** Build an envelope through the adapter (transport-specific). */
  buildEnvelope: (
    adapter: InboundTransportAdapter,
    host: MockTransportHost
  ) => Promise<InboundRequestEnvelope>;
  /** Tear down any adapter resources (live connections, polls, timers). */
  teardown?: (adapter: InboundTransportAdapter) => Promise<void> | void;
};

export type CreateInboundTransportConformanceTestsOptions = {
  name: string;
  factory: () => InboundTransportAdapter;
  helpers: ConformanceCaseHelpers;
};

export function createInboundTransportConformanceTests(
  options: CreateInboundTransportConformanceTestsOptions
): void {
  const { name, factory, helpers } = options;

  describe(`InboundTransportAdapter conformance — ${name}`, () => {
    it("declares a non-empty source identifier", () => {
      const adapter = factory();
      expect(typeof adapter.source).toBe("string");
      expect(adapter.source.length).toBeGreaterThan(0);
    });

    it("createBindings returns a TransportBindings object", () => {
      const adapter = factory();
      const host = createMockTransportHost();
      const bindings = adapter.createBindings(host);
      expect(typeof bindings).toBe("object");
      expect(bindings).not.toBeNull();
    });

    it("envelope built by adapter carries the adapter's source", async () => {
      const adapter = factory();
      const host = createMockTransportHost();
      const envelope = await helpers.buildEnvelope(adapter, host);
      expect(envelope.source).toBe(adapter.source);
    });

    it("envelope carries the resolved principal", async () => {
      const adapter = factory();
      const host = createMockTransportHost({
        resolvePrincipal: () => ({ userId: "u_conform" })
      });
      const envelope = await helpers.buildEnvelope(adapter, host);
      expect(envelope.principal).toBeDefined();
      expect(envelope.principal.userId).toBe("u_conform");
    });

    const teardown = helpers.teardown;
    if (teardown !== undefined) {
      it("teardown completes without throwing", async () => {
        const adapter = factory();
        await teardown(adapter);
      });
    }
  });
}

// ---- internal stubs ----

function minimalRegistry(): InboundTransportHost["registry"] {
  return {
    get: () => undefined,
    list: () => [],
    register: () => undefined,
    unregister: () => undefined,
    has: () => false
  } as unknown as InboundTransportHost["registry"];
}

function minimalStores(): InboundTransportHost["stores"] {
  // Permissive cast — the conformance suite never reads from these stores.
  // Adapter-internal tests that need real storage build their own host.
  return {} as InboundTransportHost["stores"];
}

function stubResponseEmitter(): InboundTransportHost extends never
  ? never
  : ReturnType<InboundTransportHost["dispatch"]>["responseEmitter"] {
  return {
    emit: () => undefined,
    emitItemAdded: async () => undefined,
    emitItemDone: async () => undefined,
    emitRequestStatus: async () => undefined,
    setLogCallback: () => undefined,
    addEventObserver: () => undefined,
    getItems: () => []
  } as unknown as ReturnType<InboundTransportHost["dispatch"]>["responseEmitter"];
}
