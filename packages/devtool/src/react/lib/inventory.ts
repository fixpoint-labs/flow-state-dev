/**
 * The Inventory tab's model: which of the organization's three inventory
 * collections a session's flow declares, and every row each one holds, read
 * through the production collection read.
 *
 * The DevTool takes no dependency on the package that defines these
 * collections. It finds them by their three published key patterns in the
 * session's resource manifest, and uses whatever ref the flow gave each one.
 * The patterns are the contract; a ref is only the name one flow chose.
 *
 * Three outcomes per collection, kept apart on purpose because a reader must
 * never confuse them:
 *
 *  - **not installed** — the manifest lists no collection with that pattern.
 *  - **loaded** — every page was read. Zero rows is a real answer: the
 *    collection is there and nothing is registered in it.
 *  - **failed** — a page was refused or errored. Named with its status and how
 *    far the read got, and never shown as an empty list.
 *
 * Nothing here filters, joins against another registry, or decides what is
 * *live*. A row means *registered in this organization*, and the view says so.
 */
import type { ResourceClient, ResourceManifest } from "@flow-state-dev/client";
import { ClientHttpError, CollectionReadStoppedError, readEveryCollectionPage } from "@flow-state-dev/client";

/** The three published key patterns, by the section each one fills. */
export const INVENTORY_PATTERNS = {
  seats: "inventory/seats/*",
  mailboxes: "inventory/mailboxes/*",
  memberships: "inventory/members/**",
} as const;

/** One of the three inventory collections. */
export type InventoryCollection = keyof typeof INVENTORY_PATTERNS;

/** The three, in the order the tab shows them. */
export const INVENTORY_COLLECTIONS: readonly InventoryCollection[] = ["seats", "mailboxes", "memberships"];

/** Where one collection sits on this session's flow: its ref, and whether the browser may read it. */
export type InventoryDeclaration = { ref: string; readable: boolean };

/** Each collection's declaration on this flow, or `undefined` when the flow does not declare it. */
export type InventoryDeclarations = Record<InventoryCollection, InventoryDeclaration | undefined>;

/** Page size for every read — the collection route's maximum. */
const INVENTORY_PAGE_SIZE = 200;

/**
 * Find the three collections in a session's manifest, by pattern.
 *
 * The manifest lists only collections with some client affordance, so one
 * declared with no browser read at all is indistinguishable here from one not
 * declared, and reads as not installed.
 */
export function findInventoryCollections(manifest: ResourceManifest): InventoryDeclarations {
  const found = {} as InventoryDeclarations;
  for (const name of INVENTORY_COLLECTIONS) {
    const entry = manifest.resources.find(
      (resource) => resource.kind === "collection" && resource.pattern === INVENTORY_PATTERNS[name],
    );
    found[name] =
      entry === undefined ? undefined : { ref: entry.ref, readable: entry.client.state?.read === true };
  }
  return found;
}

/** Whether the tab belongs on this session: any one of the three is readable. */
export function hasReadableInventory(declarations: InventoryDeclarations): boolean {
  return INVENTORY_COLLECTIONS.some((name) => declarations[name]?.readable === true);
}

/** The outcome of reading one collection. See the module header. */
export type InventoryRead =
  | { status: "not-installed" }
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
  client: Pick<ResourceClient, "listCollectionItems">,
  sessionId: string,
  ref: string,
): Promise<InventoryRead> {
  let pagesRead = 0;
  let rowsRead = 0;
  const counted: Pick<ResourceClient, "listCollectionItems"> = {
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

/** A seat row as the tab shows it. */
export type SeatRow = { id: string; kind: string | null };
/** A mailbox row as the tab shows it. `members` is empty and `registeredAt` null on a row that predates them. */
export type MailboxRow = { id: string; kind: string | null; members: string[]; registeredAt: string | null };
/** A membership row as the tab shows it. */
export type MembershipRow = { seatId: string; mailboxId: string };

function field(row: unknown, key: string): unknown {
  return typeof row === "object" && row !== null ? (row as Record<string, unknown>)[key] : undefined;
}

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** A seat row's fields, as stored. A missing kind reads as unknown, never throws. */
export function toSeatRow(row: unknown): SeatRow {
  return { id: text(field(row, "id")) ?? "", kind: text(field(row, "kind")) };
}

/**
 * A mailbox row's fields, as stored. A row written before `members` or
 * `openedAt` existed reads as no members and an unknown time (BP-030).
 */
export function toMailboxRow(row: unknown): MailboxRow {
  const members = field(row, "members");
  return {
    id: text(field(row, "id")) ?? "",
    kind: text(field(row, "kind")),
    members: Array.isArray(members) ? members.filter((m): m is string => typeof m === "string") : [],
    registeredAt: text(field(row, "openedAt")),
  };
}

/** A membership row's fields, as stored. */
export function toMembershipRow(row: unknown): MembershipRow {
  return { seatId: text(field(row, "seatId")) ?? "", mailboxId: text(field(row, "mailboxId")) ?? "" };
}

/**
 * The mailboxes each seat's membership rows name, keyed by seat id.
 *
 * Read off the membership collection alone. A mailbox row's own `members` is
 * never consulted, so when the two disagree the tab shows both and the
 * mismatch stays visible.
 */
export function mailboxesBySeat(memberships: readonly MembershipRow[]): Map<string, string[]> {
  const bySeat = new Map<string, string[]>();
  for (const row of memberships) {
    const mailboxes = bySeat.get(row.seatId) ?? [];
    mailboxes.push(row.mailboxId);
    bySeat.set(row.seatId, mailboxes);
  }
  return bySeat;
}
