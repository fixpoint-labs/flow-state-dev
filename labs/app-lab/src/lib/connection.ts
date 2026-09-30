/**
 * Who App Lab reads the Lab as, and the clients every read goes through.
 *
 * The user and credential are read exactly as the DevTool shell reads them:
 * the connection config the start script's host injects into the page
 * (`window.__FSD_DEVTOOL_CONFIG__`, from the Lab config's `devtool` block),
 * falling back to the operator's saved user id. The bearer token is never
 * stored; it rides on every request through one fetcher, so a read, a live
 * stream and a resume all carry the same credential.
 *
 * `baseUrl` is empty in the browser: App Lab's pages and the Lab's API come
 * from the same origin. Tests pass the served Lab's origin.
 */
import {
  createClient,
  createRecoveryClient,
  createResourceClient,
  createSessionClient,
  type Client,
  type ClientFetch,
  type RecoveryClient,
  type ResourceClient,
  type SessionClient,
} from "@flow-state-dev/client";
import { readBearerToken, readUserId } from "@flow-state-dev/devtool/react";

/** What a connection is made from. */
export type Connection = {
  /** The person the Lab's routes are read as. */
  userId: string;
  /** The Lab's bearer token, when its config declares one. */
  bearerToken?: string;
  /** Where the Lab answers; empty for same-origin. */
  baseUrl?: string;
};

/** The clients one connection reads and writes through. */
export type LabClients = {
  readonly userId: string;
  readonly baseUrl: string | undefined;
  readonly fetcher: ClientFetch;
  readonly sessions: SessionClient;
  readonly resources: ResourceClient;
  readonly recovery: RecoveryClient;
  /** An action client for one flow kind, as this user. */
  actions(flowKind: string): Client;
};

/** The connection this page was served with. */
export function readConnection(): Connection {
  const bearerToken = readBearerToken();
  return { userId: readUserId(), ...(bearerToken === undefined ? {} : { bearerToken }) };
}

/** The page meta the start script writes the `--devtool` address into. */
const DEVTOOL_META = "app-lab-devtool";

/**
 * The devtool App Lab was started with (`--devtool <url>`), or `undefined`.
 * Only an http(s) address is taken.
 */
export function readDevtoolUrl(): string | undefined {
  const value = document.querySelector<HTMLMetaElement>(`meta[name="${DEVTOOL_META}"]`)?.content.trim();
  return value !== undefined && /^https?:\/\//.test(value) ? value : undefined;
}

/** `fetch`, with the Lab's bearer token on every request when there is one. */
export function bearerFetcher(bearerToken: string | undefined): ClientFetch {
  if (bearerToken === undefined) return (input, init) => fetch(input, init);
  return (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set("authorization", `Bearer ${bearerToken}`);
    return fetch(input, { ...init, headers });
  };
}

/** Build the clients for one connection. */
export function createLabClients(connection: Connection): LabClients {
  const fetcher = bearerFetcher(connection.bearerToken);
  const baseUrl = connection.baseUrl;
  return {
    userId: connection.userId,
    baseUrl,
    fetcher,
    sessions: createSessionClient({ baseUrl, fetcher }),
    resources: createResourceClient({ baseUrl, fetcher }),
    recovery: createRecoveryClient({ baseUrl, fetcher }),
    actions: (flowKind) => createClient({ baseUrl, fetcher, flowKind, userId: connection.userId }),
  };
}
