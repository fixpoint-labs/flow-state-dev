// FIX-2522.
/**
 * How Shift Manager shows a stored file: where the Lab's read route is, and a
 * reader that fetches a thumbnail's bytes with the connection's bearer token,
 * as every other read carries it (a plain `<img>` request can't). A file is
 * read only through the Lab's read route, which serves it to a caller who can
 * read its owner: a conversation, or a user's own scope for a task's brief.
 */
import type { FileContent } from "@flow-state-dev/core/items";
import { parseBlobRef } from "@flow-state-dev/core/attachments";
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

/** The stored files a row's field holds, in order: each a file part whose `data` is a stored file's reference. Anything else is left out. */
export function storedFiles(value: unknown): FileContent[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): FileContent[] => {
    const file = entry as Partial<FileContent> | null;
    if (file?.type !== "file" || typeof file.mediaType !== "string" || typeof file.data !== "string") return [];
    if (parseBlobRef(file.data) === undefined) return [];
    return [{ type: "file", mediaType: file.mediaType, data: file.data, ...(typeof file.filename === "string" ? { filename: file.filename } : {}) }];
  });
}
