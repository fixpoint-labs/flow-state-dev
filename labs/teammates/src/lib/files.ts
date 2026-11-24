/**
 * How the page reaches the server outside the client, and a stored file's
 * bytes read that way: the thumbnail of a file a line carries. Read with the
 * page's own fetch rather than a plain `<img src>`, which can't carry the
 * bearer token `fsdev dev` may serve the page with.
 */
import type { ClientFetch } from "@flow-state-dev/client";
import type { FileContent } from "@flow-state-dev/core/items";
import { parseBlobRef } from "@flow-state-dev/core/attachments";

/** How the page reaches the server outside the client: where its API is mounted, and the fetch that authenticates. */
export interface AppConnection {
  basePath?: string;
  fetcher?: ClientFetch;
}

/** A file's bytes through the server's read route, over `connection`; rejects when the server won't serve it. */
export function fileReader({ basePath = "", fetcher = (input, init) => fetch(input, init) }: AppConnection) {
  return async (file: FileContent): Promise<Blob> => {
    const id = parseBlobRef(file.data);
    if (id === undefined) throw new Error(`${file.filename ?? "The file"} is not a stored file.`);
    const response = await fetcher(`${basePath.replace(/\/+$/, "")}/api/flows/blobs/${id}`);
    if (!response.ok) throw new Error(`${file.filename ?? "The file"} couldn't be read (${response.status}).`);
    return await response.blob();
  };
}
