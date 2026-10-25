/**
 * The Inventory tab's model: the ref of the organization's worker inventory,
 * when a session's flow declares it as browser-readable, and every row it
 * holds, read through the production collection read.
 *
 * The DevTool takes no dependency on the package that defines the collection.
 * It finds it by its published key pattern in the session's resource
 * manifest, and uses whatever ref the flow gave it. The pattern is the
 * contract; a ref is only the name one flow chose.
 *
 * No readable collection means no tab. A read that runs is one of two
 * outcomes, kept apart because a reader must never confuse them:
 *
 *  - **loaded** — every page was read. Zero rows is a real answer: the
 *    collection is there and nothing is registered in it.
 *  - **failed** — a page was refused or errored. Named with its status and how
 *    far the read got, and never shown as an empty list.
 *
 * Nothing here filters, joins against another registry, or decides what is
 * *live*. A row means *registered in this organization*, and the view says so.
 */
import type { ResourceManifest, ResourcesApi } from "@flow-state-dev/client";
import { ClientHttpError, CollectionReadStoppedError, readEveryCollectionPage } from "@flow-state-dev/client";

/** The worker inventory's published key pattern. */
export const WORKER_INVENTORY_PATTERN = "inventory/workers/*";

/** Page size for every read — the collection route's maximum. */
const INVENTORY_PAGE_SIZE = 200;

/**
 * The ref of the browser-readable worker inventory on this flow.
 *
 * The manifest lists only collections with some client affordance, so one
 * declared with no browser read at all is indistinguishable here from one not
 * declared. Either way there is no tab.
 */
export function workerInventoryRef(manifest: ResourceManifest): string | undefined {
  const entry = manifest.resources.find(
    (resource) =>
      resource.kind === "collection" &&
      resource.pattern === WORKER_INVENTORY_PATTERN &&
      resource.client.state?.read === true,
  );
  return entry?.ref;
}

/** The outcome of reading the worker inventory. See the module header. */
export type InventoryRead =
  | { status: "loaded"; rows: unknown[] }
  | {
      status: "failed";
      /** The HTTP status, when the server answered at all. */
      httpStatus?: number;
      /** What the server or the network said. */
      message: string;
      /** Pages fully read before the failure. */
      pagesRead: number;
      /** Rows those pages held. They are not shown: a partial list reads as the whole one. */
      rowsRead: number;
    };

/** The server's own error text, when it sent one; otherwise the client's. */
function describeFailure(error: unknown): { httpStatus?: number; message: string } {
  if (error instanceof ClientHttpError) {
    const body = error.body as { error?: unknown } | undefined;
    const serverSaid = typeof body?.error === "string" ? body.error : undefined;
    return { httpStatus: error.status, message: serverSaid ?? error.message };
  }
  return { message: error instanceof Error ? error.message : String(error) };
}

/**
 * Read every page of one collection through the production route.
 *
 * Cursor-paged to the end through the client's shared
 * `readEveryCollectionPage`: an organization bigger than one page is shown
 * whole, never silently cut. A failure on any page, a server that keeps
 * returning cursors past the shared page ceiling, or one that repeats a
 * cursor, returns `failed` with how far the read got, rather than the rows
 * read so far.
 */
export async function readEveryPage(
  client: Pick<ResourcesApi, "listCollectionItems">,
  sessionId: string,
  ref: string,
): Promise<InventoryRead> {
  let pagesRead = 0;
  let rowsRead = 0;
  const counted: Pick<ResourcesApi, "listCollectionItems"> = {
    listCollectionItems: async (...args) => {
      const page = await client.listCollectionItems(...args);
      pagesRead += 1;
      rowsRead += page.items.length;
      return page;
    },
  };
  try {
    const items = await readEveryCollectionPage(counted, sessionId, ref, { limit: INVENTORY_PAGE_SIZE });
    return { status: "loaded", rows: items.map((item) => item.clientData) };
  } catch (error) {
    const said = error instanceof CollectionReadStoppedError ? { message: error.message } : describeFailure(error);
    return { status: "failed", ...said, pagesRead, rowsRead };
  }
}

/** A worker row as the tab shows it. */
export type WorkerRow = { id: string; kind: string | null };

function field(row: unknown, key: string): unknown {
  return typeof row === "object" && row !== null ? (row as Record<string, unknown>)[key] : undefined;
}

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** A worker row's fields, as stored. A missing kind reads as unknown, never throws. */
export function toWorkerRow(row: unknown): WorkerRow {
  return { id: text(field(row, "id")) ?? "", kind: text(field(row, "kind")) };
}
