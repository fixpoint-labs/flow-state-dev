/**
 * The Inventory tab — the organization's registered seats, channels and
 * memberships, read from one session.
 *
 * Shown on any session whose flow declares at least one of the three inventory
 * collections as browser-readable (a channel built with the inventory on
 * declares all three; a seat carrying the hire tools declares only the seat
 * collection). One section per collection; a collection the flow does not
 * declare reads *not installed on this flow*, which is never drawn as an empty
 * table.
 *
 * Every request — the manifest and every page of every collection — goes
 * through the DevTool's shared `resourceClient`, so it carries the bearer
 * token like every other panel. The read is the production collection route,
 * never the debug one, so the tab works with the debug endpoints off. The
 * organization is the session's, decided by the server; the tab names none
 * and offers no picker.
 *
 * **Words.** Everything here says *registered*. A row is written once and never
 * removed, so it means *registered in this organization*, not *working now*;
 * the tab must not use a word that says otherwise. The view renders what the
 * rows hold and nothing more: no filtering, no reconciling a channel's
 * `members` against the membership rows, no liveness.
 *
 * Mounted inside the workspace-keyed subtree (see `DevToolPanel`), so the
 * remount on a workspace switch retires its reads; each effect also drops a
 * response that lands after its session changed.
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Boxes } from "lucide-react";
import { useDevTool } from "../../context/devtool-context";
import {
  INVENTORY_COLLECTIONS,
  channelsBySeat,
  findInventoryCollections,
  hasReadableInventory,
  readEveryPage,
  toChannelRow,
  toMembershipRow,
  toSeatRow,
  type InventoryCollection,
  type InventoryDeclarations,
  type InventoryRead,
} from "../../lib/inventory";
import { TabsContent, TabsTrigger } from "../ui/tabs";

/** The tab's value in the workspace `Tabs`. */
const INVENTORY_TAB = "inventory";

const InventoryContext = createContext<InventoryDeclarations | null>(null);

/**
 * Read the session's resource manifest once and share which inventory
 * collections its flow declares. Renders its children immediately; the tab
 * trigger and content appear once the manifest says they belong.
 *
 * A manifest read that fails shows no tab: without the manifest there is no
 * telling which collections exist, and the session's other panels report the
 * same failure on their own reads.
 */
export function InventoryProvider({ sessionId, children }: { sessionId: string | null; children: ReactNode }) {
  const { resourceClient } = useDevTool();
  const [declarations, setDeclarations] = useState<InventoryDeclarations | null>(null);

  useEffect(() => {
    setDeclarations(null);
    if (sessionId === null) return;
    let cancelled = false;
    resourceClient
      .getResourceManifest(sessionId)
      .then((manifest) => {
        if (!cancelled) setDeclarations(findInventoryCollections(manifest));
      })
      .catch(() => {
        if (!cancelled) setDeclarations(null);
      });
    return () => {
      cancelled = true;
    };
  }, [resourceClient, sessionId]);

  return <InventoryContext.Provider value={declarations}>{children}</InventoryContext.Provider>;
}

/** The declarations, when the manifest lists a readable inventory collection; otherwise `null`. */
function useReadableInventory(): InventoryDeclarations | null {
  const declarations = useContext(InventoryContext);
  return declarations !== null && hasReadableInventory(declarations) ? declarations : null;
}

/** The tab's trigger, rendered only on a session that declares a readable inventory collection. */
export function InventoryTabTrigger() {
  return useReadableInventory() === null ? null : <TabsTrigger value={INVENTORY_TAB}>Inventory</TabsTrigger>;
}

/** The tab's panel. Reads only while the tab is open (an inactive panel unmounts). */
export function InventoryTabContent({ sessionId }: { sessionId: string | null }) {
  const declarations = useReadableInventory();
  if (declarations === null || sessionId === null) return null;
  return (
    <TabsContent value={INVENTORY_TAB} className="flex-1 min-h-0 m-0 overflow-auto">
      <InventoryView sessionId={sessionId} declarations={declarations} />
    </TabsContent>
  );
}

type Reads = Record<InventoryCollection, InventoryRead> | null;

/**
 * The three sections, for a session whose declarations are already known.
 */
function InventoryView({
  sessionId,
  declarations,
}: {
  sessionId: string;
  declarations: InventoryDeclarations;
}) {
  const { resourceClient } = useDevTool();
  const [reads, setReads] = useState<Reads>(null);

  useEffect(() => {
    setReads(null);
    let cancelled = false;
    void Promise.all(
      INVENTORY_COLLECTIONS.map(async (name): Promise<[InventoryCollection, InventoryRead]> => {
        const declared = declarations[name];
        if (declared === undefined) return [name, { status: "not-installed" }];
        return [name, await readEveryPage(resourceClient, sessionId, declared.ref)];
      }),
    ).then((entries) => {
      if (!cancelled) setReads(Object.fromEntries(entries) as Record<InventoryCollection, InventoryRead>);
    });
    return () => {
      cancelled = true;
    };
  }, [resourceClient, sessionId, declarations]);

  if (reads === null) {
    return <p className="p-3 text-xs text-slate-500">Reading the inventory…</p>;
  }

  const loaded = INVENTORY_COLLECTIONS.map((name) => reads[name]).filter(
    (read): read is Extract<InventoryRead, { status: "loaded" }> => read.status === "loaded",
  );
  const nothingRegistered =
    INVENTORY_COLLECTIONS.every((name) => reads[name].status !== "failed") &&
    loaded.every((read) => read.rows.length === 0);

  const memberships = reads.memberships.status === "loaded" ? reads.memberships.rows.map(toMembershipRow) : [];
  const seatChannels = channelsBySeat(memberships);

  return (
    <div className="flex flex-col gap-3 p-3" data-inventory-view="">
      <p className="text-[11px] text-slate-500">
        Everything registered in this session's organization. A row stays once it is written: a seat
        that was fired, or a channel a seat has left, is still listed as registered.
      </p>
      {nothingRegistered && (
        <p className="rounded-md border border-slate-800 px-3 py-2 text-xs text-slate-300" role="status">
          Nothing is registered in this organization yet. An app registers its seats and channels by
          calling <code>openInventory</code> at boot.
        </p>
      )}

      <Section name="seats" title="Registered seats" read={reads.seats} noun="seats">
        {(rows) => (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-800 text-left text-[10px] uppercase tracking-wide text-slate-500">
                <th className="px-3 py-1.5 font-medium">Id</th>
                <th className="py-1.5 font-medium">Kind</th>
                {reads.memberships.status !== "not-installed" && (
                  <th className="py-1.5 pr-3 font-medium">Channels</th>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map(toSeatRow).map((seat) => (
                <tr key={seat.id} className="border-b border-slate-800/50 align-top">
                  <td className="px-3 py-1.5 font-mono text-[11px] text-slate-300">{seat.id}</td>
                  <td className="py-1.5 pr-2 text-slate-300">{seat.kind ?? "unknown"}</td>
                  {reads.memberships.status !== "not-installed" && (
                    <td className="py-1.5 pr-3 text-slate-300">
                      {reads.memberships.status === "failed"
                        ? "unknown (the membership read failed)"
                        : (seatChannels.get(seat.id) ?? []).join(", ") || "none"}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section name="channels" title="Registered channels" read={reads.channels} noun="channels">
        {(rows) => (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-800 text-left text-[10px] uppercase tracking-wide text-slate-500">
                <th className="px-3 py-1.5 font-medium">Id</th>
                <th className="py-1.5 font-medium">Kind</th>
                <th className="py-1.5 font-medium">Members</th>
                <th className="py-1.5 pr-3 font-medium">Registered</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(toChannelRow).map((channel) => (
                <tr key={channel.id} className="border-b border-slate-800/50 align-top">
                  <td className="px-3 py-1.5 font-mono text-[11px] text-slate-300">{channel.id}</td>
                  <td className="py-1.5 pr-2 text-slate-300">{channel.kind ?? "unknown"}</td>
                  <td className="py-1.5 pr-2 text-slate-300">
                    {channel.members.length === 0 ? "none" : channel.members.join(", ")}
                  </td>
                  <td className="py-1.5 pr-3 font-mono text-[11px] text-slate-400">
                    {channel.registeredAt ?? "unknown"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section name="memberships" title="Registered memberships" read={reads.memberships} noun="memberships">
        {(rows) => (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-800 text-left text-[10px] uppercase tracking-wide text-slate-500">
                <th className="px-3 py-1.5 font-medium">Seat</th>
                <th className="py-1.5 pr-3 font-medium">Channel</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(toMembershipRow).map((row) => (
                <tr key={`${row.seatId}/${row.channelId}`} className="border-b border-slate-800/50 align-top">
                  <td className="px-3 py-1.5 font-mono text-[11px] text-slate-300">{row.seatId}</td>
                  <td className="py-1.5 pr-3 font-mono text-[11px] text-slate-300">{row.channelId}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
    </div>
  );
}

/**
 * One collection's section. The three outcomes render three different ways,
 * and none of them as another: absent, failed and empty each say what they are.
 */
function Section({
  name,
  title,
  read,
  noun,
  children,
}: {
  name: InventoryCollection;
  title: string;
  read: InventoryRead;
  noun: string;
  children: (rows: unknown[]) => ReactNode;
}) {
  return (
    <section
      className="rounded-md border border-slate-800 bg-slate-900/40"
      data-inventory-section={name}
      data-inventory-status={read.status}
    >
      <h3 className="flex items-center gap-1.5 border-b border-slate-800 px-3 py-2 text-xs font-medium text-slate-200">
        <Boxes className="h-3.5 w-3.5 text-emerald-400" aria-hidden />
        {title}
        {read.status === "loaded" && <span className="text-[10px] font-normal text-slate-500">{read.rows.length}</span>}
      </h3>
      {read.status === "not-installed" ? (
        <p className="px-3 py-2 text-xs italic text-slate-500">Not installed on this flow.</p>
      ) : read.status === "failed" ? (
        <p className="px-3 py-2 text-xs text-rose-300" role="alert">
          {read.httpStatus === 403
            ? `The ${noun} read was refused (403): ${read.message}.`
            : read.httpStatus === 404
              ? `The ${noun} collection was not found (404): ${read.message}.`
              : `The ${noun} read failed${read.httpStatus === undefined ? "" : ` (${read.httpStatus})`}: ${read.message}.`}
          {read.pagesRead > 0 &&
            ` ${read.pagesRead} page${read.pagesRead === 1 ? "" : "s"} (${read.rowsRead} rows) were read before it failed; none are shown, because a partial list would read as the whole one.`}
          {" "}This is not an empty organization.
        </p>
      ) : read.rows.length === 0 ? (
        <p className="px-3 py-2 text-xs text-slate-500">No {noun} registered.</p>
      ) : (
        children(read.rows)
      )}
    </section>
  );
}
