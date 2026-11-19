// FIX-2522.
/**
 * How Shift Manager shows a stored file: where the Lab's read route is, and a
 * reader that fetches a thumbnail's bytes with the connection's bearer token,
 * as every other read carries it (a plain `<img>` request can't). A file is
 * read only through the Lab's read route, which serves it to a caller who can
 * read its owner: a conversation, or a user's own scope for a task's brief.
 */
import type { FileContent } from "@flow-state-dev/core/items";
import { readConnection } from "./connection";
import { withBearerToken } from "@flow-state-dev/devtool/react";

/** Where the Lab's API is mounted, for a file's read address: the page's base path. */
export function fileReadBase(): string {
  return readConnection().baseUrl ?? "";
}

/** A stored file's bytes, read with the connection's credential. Rejects on any answer but 200. */
export async function readStoredFile(_file: FileContent, url: string): Promise<Blob> {
  const fetcher = withBearerToken(readConnection().bearerToken) ?? fetch;
  const response = await fetcher(url);
  if (!response.ok) throw new Error(`The file couldn't be read (${response.status}).`);
  return response.blob();
}
