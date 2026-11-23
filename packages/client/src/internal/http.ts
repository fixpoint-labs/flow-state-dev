/**
 * The one transport a client holds: its route builder, its fetcher, and the
 * one way a failure becomes a `ClientHttpError`.
 *
 * `createClient` builds exactly one of these and every namespace, handle and
 * stream it returns goes through it. Nothing else in the package calls a
 * fetcher.
 */
import type { ClientFetch, QueryValue } from "../types";
import { ClientHttpError } from "../types";

/** The mount every client route is written against, and the server's default. */
const DEFAULT_API_PATH = "/api/flows";

/** What one transport is built from. */
export type TransportOptions = {
  baseUrl?: string;
  apiPath?: string;
  fetcher?: ClientFetch;
};

/**
 * How long a call may wait for the server's answer to start, and what its
 * refusal says when none comes. Only the wait for the response headers is
 * timed: a stream that has started is never cut off.
 */
export type AnswerLimit = { ms: number; message: string };

/** The one transport: route URLs, a JSON call, and a raw call. */
export type Transport = {
  readonly fetcher: ClientFetch;
  /** The URL of a route, written against `/api/flows`, with its query. */
  url(path: string, query?: Record<string, QueryValue>): string;
  /** Call a route expecting JSON; a non-2xx answer throws `ClientHttpError`. */
  json<TValue>(
    path: string,
    init?: RequestInit,
    query?: Record<string, QueryValue>,
    limit?: AnswerLimit
  ): Promise<TValue>;
  /**
   * Call a route and return its `Response`; a non-2xx answer throws
   * `ClientHttpError`. With `limit`, no answer in time throws one with status 0.
   */
  raw(path: string, init?: RequestInit, query?: Record<string, QueryValue>, limit?: AnswerLimit): Promise<Response>;
};

/**
 * Builds the one transport for a client.
 *
 * `baseUrl` is required without a fetcher (an empty string means the page's
 * own origin). With a fetcher and no `baseUrl`, routes stay relative: a
 * credential wrapper hands them to the browser's `fetch`, which resolves them
 * against the page, and `createInProcessFetch` reads only the path.
 */
export function createTransport(options: TransportOptions): Transport {
  const fetcher = resolveFetch(options.fetcher);
  const baseUrl =
    options.baseUrl !== undefined
      ? options.baseUrl
      : options.fetcher !== undefined
        ? ""
        : clientError("createClient requires baseUrl, or a fetcher");
  const url = (path: string, query?: Record<string, QueryValue>): string =>
    buildFlowApiUrl({ path, baseUrl, apiPath: options.apiPath, query });

  const raw = async (
    path: string,
    init?: RequestInit,
    query?: Record<string, QueryValue>,
    limit?: AnswerLimit
  ): Promise<Response> => {
    const response =
      limit === undefined || limit.ms <= 0
        ? await fetcher(url(path, query), init)
        : await fetchWithin(fetcher, url(path, query), init, limit);
    if (!response.ok) {
      throw new ClientHttpError(
        `Request failed (${response.status}) ${response.statusText || ""}`.trim(),
        // The body is only a diagnostic here: an unreadable one must not hide the status.
        { status: response.status, body: parseBody(await response.text().catch(() => "")) }
      );
    }
    return response;
  };

  const json = async <TValue>(
    path: string,
    init?: RequestInit,
    query?: Record<string, QueryValue>,
    limit?: AnswerLimit
  ): Promise<TValue> => {
    const response = await raw(
      path,
      { ...init, headers: { accept: "application/json", ...(init?.headers ?? {}) } },
      query,
      limit
    );
    // A body that fails to arrive rejects: read as empty, it would pass for an absent record.
    return parseBody(await response.text()) as TValue;
  };

  return { fetcher, url, json, raw };
}

/**
 * One fetch that must answer within `limit.ms`. Past it, the request is
 * aborted and the call rejects with status 0, even when the fetcher ignores
 * the abort (a half-open connection, a dying proxy, an in-process fetcher).
 * The timer stops once the headers arrive, so the body reads as long as it
 * takes.
 */
async function fetchWithin(
  fetcher: ClientFetch,
  url: string,
  init: RequestInit | undefined,
  limit: AnswerLimit
): Promise<Response> {
  const controller = new AbortController();
  // The caller's own signal still cancels the request.
  const own = init?.signal;
  if (own) {
    if (own.aborted) controller.abort(own.reason);
    else own.addEventListener("abort", () => controller.abort(own.reason), { once: true });
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      // Refuse before aborting: a fetcher that rejects on abort (the platform fetch does) must not win the race.
      reject(new ClientHttpError(limit.message, { status: 0, body: { error: limit.message } }));
      controller.abort();
    }, limit.ms);
  });
  try {
    return await Promise.race([fetcher(url, { ...init, signal: controller.signal }), late]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The client's one required-value check: a non-empty string, trimmed. Throws
 * a `ClientHttpError` with status 0 (nothing was sent) otherwise.
 */
export function requireValue(value: string | undefined, name: string): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (trimmed.length === 0) clientError(`${name} is required`);
  return trimmed;
}

/**
 * Throw a failure the client found before sending anything: a
 * `ClientHttpError` with status 0, so a caller handles every client failure
 * as one type.
 */
export function clientError(message: string): never {
  throw new ClientHttpError(message, { status: 0, body: { error: message } });
}

/** Encode one path segment. */
export function seg(value: string): string {
  return encodeURIComponent(value);
}

/**
 * Encode a collection topic as one path segment, its `/` included. The item
 * routes share a `*topic` wildcard and the content route is the state route
 * plus `/content`, so exposed slashes would send topic `a/content`'s state
 * read to item `a`'s content. The engine decodes `%2F` back into the topic.
 */
export function topicPath(topic: string): string {
  return encodeURIComponent(topic);
}

/**
 * The given fetcher, else the global `fetch`, looked up on each call so a
 * `fetch` installed or wrapped after the client was built is the one used.
 */
function resolveFetch(fetcher?: ClientFetch): ClientFetch {
  if (fetcher !== undefined) return fetcher;
  if (typeof globalThis.fetch !== "function") {
    clientError("No fetch implementation is available. Pass a fetcher to createClient.");
  }
  return (input, init) => globalThis.fetch(input, init);
}

/**
 * Builds a flow-API URL with optional base URL, API mount and query params.
 *
 * `path` is written against the default `/api/flows` mount. When `apiPath` is
 * given, that leading mount is swapped for it, so a server mounted elsewhere
 * (the Node host's `basePath`) is reached at the same route.
 */
function buildFlowApiUrl(options: {
  path: string;
  baseUrl?: string;
  apiPath?: string;
  query?: Record<string, QueryValue>;
}): string {
  const rootedPath = options.path.startsWith("/") ? options.path : `/${options.path}`;
  const normalizedPath = remount(rootedPath, options.apiPath);
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value === undefined) continue;
    searchParams.set(key, String(value));
  }

  const querySuffix = searchParams.size > 0 ? `?${searchParams.toString()}` : "";
  return `${normalizeBaseUrl(options.baseUrl)}${normalizedPath}${querySuffix}`;
}

function remount(path: string, apiPath: string | undefined): string {
  if (apiPath === undefined) return path;
  const atMount = path === DEFAULT_API_PATH || path.startsWith(`${DEFAULT_API_PATH}/`);
  if (!atMount) return path;
  const trimmed = apiPath.endsWith("/") ? apiPath.slice(0, -1) : apiPath;
  const mount = trimmed.length === 0 || trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return `${mount}${path.slice(DEFAULT_API_PATH.length)}`;
}

function normalizeBaseUrl(baseUrl: string | undefined): string {
  if (baseUrl === undefined || baseUrl.trim().length === 0) return "";
  return baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
}

function parseBody(text: string): unknown {
  if (text.trim().length === 0) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
