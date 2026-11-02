/**
 * Who Shift Manager reads the Lab as, and the one client every read goes through.
 *
 * The user and credential are read exactly as the DevTool shell reads them:
 * the connection config `fsdev dev` injects into the page
 * (`window.__FSD_DEVTOOL_CONFIG__`, from the Lab config's `devtool` block),
 * falling back to the operator's saved user id. The bearer token is never
 * stored; it rides on every request through the client's one fetcher, so a
 * read, a live stream and a resume all carry the same credential.
 *
 * `baseUrl` is empty in the browser: Shift Manager's pages and the Lab's API come
 * from the same origin. Tests pass the served Lab's origin.
 */
import { createClient, type Client } from "@flow-state-dev/client";
import { readBearerToken, readUserId, withBearerToken } from "@flow-state-dev/devtool/react";

/** What a connection is made from. */
export type Connection = {
  /** The user the Lab's routes are read as. */
  userId: string;
  /** The Lab's bearer token, when its config declares one. */
  bearerToken?: string;
  /** Where the Lab answers; empty for same-origin. */
  baseUrl?: string;
};

/** The connection this page was served with. */
export function readConnection(): Connection {
  const bearerToken = readBearerToken();
  return { userId: readUserId(), ...(bearerToken === undefined ? {} : { bearerToken }) };
}

/** The one client for a connection: its user, its origin, and its bearer token on every call and stream. */
export function connect(connection: Connection): Client {
  return createClient({
    userId: connection.userId,
    baseUrl: connection.baseUrl ?? "",
    fetcher: withBearerToken(connection.bearerToken),
  });
}
