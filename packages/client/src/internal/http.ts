/**
 * Shared HTTP helpers for client request/session/stream transport modules.
 */
import type { ClientFetch, QueryValue } from "../types";
import { ClientHttpError } from "../types";

/**
 * Resolves the fetch implementation used by the client transport.
 */
export function resolveFetch(fetcher?: ClientFetch): ClientFetch {
  if (fetcher !== undefined) {
    return fetcher;
  }

  if (typeof globalThis.fetch !== "function") {
    throw new Error(
      "No fetch implementation is available. Provide a fetcher in client options."
    );
  }

  return globalThis.fetch.bind(globalThis);
}

/**
 * Builds an `/api/flows` URL with optional base URL and query params.
 */
export function buildFlowApiUrl(options: {
  path: string;
  baseUrl?: string;
  query?: Record<string, QueryValue>;
}): string {
  const normalizedPath = options.path.startsWith("/")
    ? options.path
    : `/${options.path}`;
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value === undefined) {
      continue;
    }

    searchParams.set(key, String(value));
  }

  const querySuffix = searchParams.size > 0 ? `?${searchParams.toString()}` : "";
  const normalizedBase = normalizeBaseUrl(options.baseUrl);
  return `${normalizedBase}${normalizedPath}${querySuffix}`;
}

/**
 * Performs an HTTP request expecting JSON and throws `ClientHttpError` on non-2xx.
 */
export async function requestJson<TValue>(options: {
  fetcher: ClientFetch;
  url: string;
  init?: RequestInit;
}): Promise<TValue> {
  const response = await options.fetcher(options.url, {
    ...options.init,
    headers: {
      accept: "application/json",
      ...(options.init?.headers ?? {})
    }
  });

  const parsed = await readBody(response);
  if (!response.ok) {
    throw new ClientHttpError(
      `Request failed (${response.status}) ${response.statusText || ""}`.trim(),
      {
        status: response.status,
        body: parsed
      }
    );
  }

  return parsed as TValue;
}

function normalizeBaseUrl(baseUrl: string | undefined): string {
  if (baseUrl === undefined || baseUrl.trim().length === 0) {
    return "";
  }

  return baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.trim().length === 0) {
    return undefined;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
