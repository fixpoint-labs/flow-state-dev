/**
 * The page's connection to the server, and the files a line carries: the
 * client over the connection `fsdev dev` served the page with, a file the
 * composer attached stored as its reference, and a stored file's bytes.
 */
import { createClient, type Client, type ClientFetch } from "@flow-state-dev/client";
import type { FileContent } from "@flow-state-dev/core/items";
import { parseBlobRef } from "@flow-state-dev/core/attachments";
import { readBasePath, readBearerToken, readUserId, withBearerToken } from "@flow-state-dev/devtool/react";
import type { AttachmentUploader } from "../components/flow-state/attachments";

/** How the page reaches the server outside the client: where its API is mounted, and the fetch that authenticates. */
export interface AppConnection {
  basePath?: string;
  fetcher?: ClientFetch;
}

/** The connection `fsdev dev` served this page with. */
export function pageConnection(): AppConnection {
  return { basePath: readBasePath(), fetcher: withBearerToken(readBearerToken()) };
}

/** The client over the page's connection. */
export function connect(): Client {
  const { basePath, fetcher } = pageConnection();
  return createClient({ userId: readUserId(), baseUrl: basePath, fetcher });
}

/**
 * A file's bytes through the server's read route. Read with the page's own fetch rather than a plain
 * `<img src>`, which can't carry the bearer token `fsdev dev` may serve the page with.
 */
function fileReader({ basePath = "", fetcher = (input, init) => fetch(input, init) }: AppConnection) {
  return async (file: FileContent): Promise<Blob> => {
    const id = parseBlobRef(file.data);
    if (id === undefined) throw new Error(`${file.filename ?? "The file"} is not a stored file.`);
    const response = await fetcher(`${basePath.replace(/\/+$/, "")}/api/flows/blobs/${id}`);
    if (!response.ok) throw new Error(`${file.filename ?? "The file"} couldn't be read (${response.status}).`);
    return await response.blob();
  };
}

/** A line's files: storing one, and reading one back. */
export interface FileCalls {
  /** Store a file the composer attached; resolves to its reference, which a line then carries. */
  upload: AttachmentUploader["upload"];
  /** The bytes of a file a line carries, for its thumbnail; rejects when the server won't serve it. */
  readFile(file: FileContent): Promise<Blob>;
}

/** {@link FileCalls} over one client; `connection` is where it reads a line's files. */
export function fileCalls(client: Client, connection: AppConnection): FileCalls {
  return {
    upload: (request) => client.upload(request),
    readFile: fileReader(connection),
  };
}
