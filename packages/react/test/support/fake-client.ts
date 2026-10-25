/**
 * A fake of the one client for hook tests that fake the client seam.
 *
 * A test hands in the mocks it asserts on, named after the client's own
 * surface (`sessions.state`, `flow.send`, `request.continue`, …), and mocks
 * `createClient` to return `fakeClient(parts)`. A send, continue or resume
 * made with `stream: true` reaches its mock without the flag, so a test
 * asserts on what the hook asked for. The streams a hook opens are handed to
 * (`request.continue` alone gets its options as given, so a test tells a
 * streaming continue from a JSON one.) The streams a hook opens are handed to
 * `requestStream` and `sessionStream` with the route a real client would use
 * (`url`, `sessionId`), so a test can capture and drive them.
 */
import type {
  Client,
  RequestHandle,
  RequestStreamHandle,
  RequestStreamOptions,
  SessionStreamHandle,
  SessionStreamOptions
} from "@flow-state-dev/client";

type Fn = (...args: never[]) => unknown;
type AnyFn = (...args: any[]) => any; // eslint-disable-line @typescript-eslint/no-explicit-any

export type FakeClientParts = {
  userId?: string;
  flows?: AnyFn;
  sessions?: Partial<Record<"list" | "get" | "requests" | "children" | "state" | "updateMetadata" | "delete", AnyFn>>;
  /** Flow-level calls; `send` gets `(action, input, options)` without `stream`, `abort` gets the request id. */
  flow?: Partial<Record<"send" | "abort" | "createSession", AnyFn>>;
  /** Request-level calls, each given the request id first (and the flow address last). */
  request?: Partial<Record<"status" | "continue" | "retry" | "resume", AnyFn>>;
  resources?: Partial<Client["resources"]>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- each test types its own capture
  requestStream?: (options: RequestStreamOptions & { url: string } & Record<string, any>) => RequestStreamHandle;
  sessionStream?: (options: SessionStreamOptions & { sessionId: string }) => SessionStreamHandle;
};

const closed = { close() {}, lastEventId: undefined } as RequestStreamHandle;

function missing(name: string): never {
  throw new Error(`fakeClient: no mock for ${name}`);
}

export function fakeClient(parts: FakeClientParts): Client {
  const call = (fn: AnyFn | undefined, name: string, ...args: unknown[]) =>
    fn === undefined ? missing(name) : fn(...args);

  const handle = (flow: string, id: string): RequestHandle => {
    const self: RequestHandle = {
      id,
      flow,
      status: async () => call(parts.request?.status, "request.status", id),
      wait: async () => call(parts.request?.status, "request.status", id),
      abort: async () => {
        await call(parts.flow?.abort, "flow.abort", id);
      },
      continue: (async (options?: { stream?: boolean; includeTrace?: boolean }) => {
        const result = await call(parts.request?.continue, "request.continue", id, options);
        return options?.stream === true ? result : self;
      }) as RequestHandle["continue"],
      retry: async (options) => {
        const result = (await call(parts.request?.retry, "request.retry", id, options)) as { id: string };
        return handle(flow, result.id);
      },
      resume: (async (body: unknown, options?: { stream?: boolean }) => {
        const result = await call(parts.request?.resume, "request.resume", id, body);
        return options?.stream === true ? result : handle(flow, (result as { requestId: string }).requestId);
      }) as RequestHandle["resume"],
      answer: async () => missing("request.answer"),
      stream: (options) =>
        parts.requestStream?.({
          url: `/api/flows/${encodeURIComponent(flow)}/requests/${encodeURIComponent(id)}/stream${
            options.includeTrace === true ? "?include=trace" : ""
          }`,
          ...options
        }) ?? closed
    };
    return self;
  };

  return {
    userId: parts.userId ?? "devuser",
    flows: async () => call(parts.flows, "flows"),
    capabilities: async () => missing("capabilities"),
    flow: (address: string) => ({
      address,
      send: (async (action: string, input: unknown, options?: Record<string, unknown>) => {
        const result = await call(parts.flow?.send, "flow.send", action, input, stripStream(options));
        if (options?.stream === true) return result;
        const response = result as { request: { id: string } };
        return Object.assign(handle(address, response.request.id), { response });
      }) as never,
      createSession: async (options?: unknown) => call(parts.flow?.createSession, "flow.createSession", options),
      request: (id: string) => handle(address, id)
    }),
    sessions: {
      list: async (...args) => call(parts.sessions?.list, "sessions.list", ...args),
      get: async (...args) => call(parts.sessions?.get, "sessions.get", ...args),
      requests: async (...args) => call(parts.sessions?.requests, "sessions.requests", ...args),
      children: async (...args) => call(parts.sessions?.children, "sessions.children", ...args),
      state: async (...args) => call(parts.sessions?.state, "sessions.state", ...args),
      updateMetadata: async (...args) => call(parts.sessions?.updateMetadata, "sessions.updateMetadata", ...args),
      delete: async (...args) => call(parts.sessions?.delete, "sessions.delete", ...args),
      stream: (sessionId, options = {}) =>
        parts.sessionStream?.({ sessionId, ...options }) ?? { close() {}, lastAt: undefined, stopped: false },
      debug: new Proxy({} as Client["sessions"]["debug"], { get: (_t, name) => () => missing(`debug.${String(name)}`) })
    },
    resources: new Proxy({} as Client["resources"], {
      get: (_t, name: string) =>
        (parts.resources as Record<string, Fn> | undefined)?.[name] ?? (() => missing(`resources.${name}`))
    }),
    requests: { interrupted: async () => missing("requests.interrupted") },
    stream: () => ({ close() {}, lastEventId: undefined }),
    transcribe: async () => missing("transcribe")
  };
}

function stripStream<T extends Record<string, unknown> | undefined>(options: T): T {
  if (options === undefined || !("stream" in options)) return options;
  const { stream: _stream, ...rest } = options;
  return (Object.keys(rest).length === 0 ? undefined : rest) as T;
}
