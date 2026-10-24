/**
 * `createInProcessFetch(app, options)` — the one function that turns a Web
 * `Request` into a flow API router call.
 *
 * It returns a fetch-shaped function. Hand it to a client as its `fetcher` and
 * every call and stream reaches the engine in this process, with no web
 * server. `@flow-state-dev/node`'s `createServerApp` dispatches through it
 * too, so a request takes the same path in process and over HTTP: the router
 * sees `source: "http"` and authenticates from the request's headers either
 * way. There is no in-process trust shortcut.
 */
import { isFlowState } from "../flowstate/createFlowState";
import type { FlowState } from "../flowstate/types";
import type { FlowApiRouter } from "./createFlowApiRouter";
import { decodePathSegments } from "./parseFlowRoute";
import { jsonResponse } from "./route-utils";

/** Options for {@link createInProcessFetch}. */
export interface InProcessFetchOptions {
  /**
   * The mount prefix the router is addressed under. Default `"/api/flows"`,
   * the default of `createFlowApiRouter` and of every host. A path outside
   * it answers 404.
   */
  basePath?: string;
}

/**
 * A fetch-shaped function over the engine in this process. Its signature is
 * the client's `ClientFetch`, so it is passed straight to a client's
 * `fetcher` option. Only the URL's path is read; its origin is ignored.
 */
export type InProcessFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const DEFAULT_BASE_PATH = "/api/flows";

/**
 * Origin for a relative input. `Request` needs an absolute URL, and only the
 * path is read, so the origin is never seen by the router as an address.
 */
const INTERNAL_ORIGIN = "http://in-process.invalid";

/** Escape a string for safe use as a literal inside a `RegExp`. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * True for a `Request` from any class: an object carrying a string `url` and
 * `method`. A `URL` or string has no `url` field, so it is never mistaken for one.
 */
function isRequestLike(input: RequestInfo | URL): input is Request {
  return (
    typeof input === "object" &&
    typeof (input as Request).url === "string" &&
    typeof (input as Request).method === "string"
  );
}

/**
 * Decoded segments after the mount prefix, e.g. `/api/flows/chat/send` →
 * `["chat","send"]`, or `null` when `pathname` is not under the prefix.
 * `pathname` is the raw URL path; each segment is decoded once, the same shape
 * Next hands the router as `params.path`. The prefix is matched in its
 * encoded form, the one `URL.pathname` carries, so a basePath holding a space
 * or other escaped character still comes off.
 */
function pathSegments(pathname: string, basePath: string): string[] | null {
  const encodedBase = new URL(basePath, INTERNAL_ORIGIN).pathname.replace(/\/+$/, "");
  const prefix = new RegExp(`^${escapeRegExp(encodedBase)}(?:/|$)`);
  if (!prefix.test(pathname)) return null;
  return decodePathSegments(pathname.replace(prefix, ""));
}

/**
 * Build a fetch-shaped function that dispatches to `app` (a `FlowState` or a
 * raw `FlowApiRouter`) in this process.
 *
 * Per call: wait for the router (a `FlowState` initializes its stores on
 * first use; a failed init answers 500 `{ error: "Server failed to
 * initialize" }`), pick the router's handler by HTTP method (405 for any
 * other, HEAD included: a GET handler would run its side effects to discard
 * the body), take the path from the URL under `basePath` (404 outside it), and
 * call the handler with the `Request` unchanged, so SSE response bodies stream
 * and an abort signal on `init` reaches the route.
 *
 * Router resolution starts when this is called, as a host's does, so the
 * first request does not pay for store init alone.
 */
export function createInProcessFetch(
  app: FlowState | FlowApiRouter,
  options: InProcessFetchOptions = {}
): InProcessFetch {
  const basePath = options.basePath ?? DEFAULT_BASE_PATH;
  const routerPromise: Promise<FlowApiRouter> = isFlowState(app)
    ? app.getRouter()
    : Promise.resolve(app);
  // A rejection is answered per call below; don't report it as unhandled
  // before the first call arrives.
  routerPromise.catch(() => {});

  return async (input, init) => {
    // A Request with nothing to add is passed through as is: a host hands over
    // its runtime's own Request (`@hono/node-server`'s lightweight one), which
    // must reach the router untouched, body stream included. It is recognized
    // by shape, not `instanceof`: the host's Request class need not be this
    // realm's global one (a test that installs DOM globals replaces it).
    // With init, it is rebuilt as `new Request(request, init)` would: init's
    // fields win, the rest come from the Request. Never taken for a string.
    const request =
      init === undefined && isRequestLike(input)
        ? input
        : input instanceof Request
          ? new Request(input, init)
          : isRequestLike(input)
            ? new Request(input.url, {
                method: input.method,
                headers: input.headers,
                body: input.body,
                signal: input.signal,
                // Required by Node to send a stream body; ignored elsewhere.
                duplex: "half",
                ...init
              } as RequestInit)
            : new Request(new URL(String(input), INTERNAL_ORIGIN), init);

    let router: FlowApiRouter;
    try {
      router = await routerPromise;
    } catch {
      return jsonResponse(500, { error: "Server failed to initialize" });
    }
    const method = request.method.toUpperCase() as keyof FlowApiRouter;
    const handler = Object.hasOwn(router, method) ? router[method] : undefined;
    if (handler === undefined) {
      return jsonResponse(405, { error: "Method not allowed" });
    }
    // From the raw URL, not a framework's decoded path.
    const path = pathSegments(new URL(request.url).pathname, basePath);
    if (path === null) return jsonResponse(404, { error: "Not found" });
    return handler(request, { params: { path } });
  };
}
