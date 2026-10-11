/**
 * The Inventory tab — the organization's registered workers, read from one
 * session.
 *
 * Shown on any session whose flow declares the worker inventory as
 * browser-readable (a worker carrying the hire tools declares it). A flow that
 * does not declare it shows no tab, never an empty table.
 *
 * Every request — the manifest and every page of the collection — goes
 * through the DevTool's shared `resourceClient`, so it carries the bearer
 * token like every other panel. The read is the production collection route,
 * never the debug one, so the tab works with the debug endpoints off. The
 * organization is the session's, decided by the server; the tab names none
 * and offers no picker.
 *
 * **Words.** Everything here says *registered*. A row is written once and never
 * removed, so it means *registered in this organization*, not *working now*;
 * the tab must not use a word that says otherwise. The view renders what the
 * rows hold and nothing more: no filtering, no liveness.
 *
 * Mounted inside the workspace-keyed subtree (see `DevToolPanel`), so the
 * remount on a workspace switch retires its reads; each effect also drops a
 * response that lands after its session changed.
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Boxes } from "lucide-react";
import { useDevTool } from "../../context/devtool-context";
import { readEveryPage, workerInventoryRef, toWorkerRow, type InventoryRead } from "../../lib/inventory";
import { TabsContent, TabsTrigger } from "../ui/tabs";

/** The tab's value in the workspace `Tabs`. */
const INVENTORY_TAB = "inventory";

/** The worker inventory's ref, once the manifest says the tab belongs. `null` while loading, or when it does not. */
const InventoryContext = createContext<string | null>(null);

/**
 * Read the session's resource manifest once and share the worker inventory's
 * ref. Renders its children immediately; the tab trigger and content appear
 * once the manifest says they belong.
 *
 * A manifest read that fails shows no tab: without the manifest there is no
 * telling whether the collection exists, and the session's other panels report
 * the same failure on their own reads.
 */
export function InventoryProvider({ sessionId, children }: { sessionId: string | null; children: ReactNode }) {
  const { resourceClient } = useDevTool();
  const [ref, setRef] = useState<string | null>(null);

  useEffect(() => {
    setRef(null);
    if (sessionId === null) return;
    let cancelled = false;
    resourceClient
      .getResourceManifest(sessionId)
      .then((manifest) => {
        if (!cancelled) setRef(workerInventoryRef(manifest) ?? null);
      })
      .catch(() => {
        if (!cancelled) setRef(null);
      });
    return () => {
      cancelled = true;
    };
  }, [resourceClient, sessionId]);

  return <InventoryContext.Provider value={ref}>{children}</InventoryContext.Provider>;
}

/** The tab's trigger, rendered only on a session that declares a readable worker inventory. */
export function InventoryTabTrigger() {
  return useContext(InventoryContext) === null ? null : <TabsTrigger value={INVENTORY_TAB}>Inventory</TabsTrigger>;
}

/** The tab's panel. Reads only while the tab is open (an inactive panel unmounts). */
export function InventoryTabContent({ sessionId }: { sessionId: string | null }) {
  const ref = useContext(InventoryContext);
  if (ref === null || sessionId === null) return null;
  return (
    <TabsContent value={INVENTORY_TAB} className="flex-1 min-h-0 m-0 overflow-auto">
      <InventoryView sessionId={sessionId} inventoryRef={ref} />
    </TabsContent>
  );
}

/** The worker section, for a session whose inventory ref is already known. */
function InventoryView({ sessionId, inventoryRef }: { sessionId: string; inventoryRef: string }) {
  const { resourceClient } = useDevTool();
  const [read, setRead] = useState<InventoryRead | null>(null);

  useEffect(() => {
    setRead(null);
    let cancelled = false;
    void readEveryPage(resourceClient, sessionId, inventoryRef).then((next) => {
      if (!cancelled) setRead(next);
    });
    return () => {
      cancelled = true;
    };
  }, [resourceClient, sessionId, inventoryRef]);

  if (read === null) {
    return <p className="p-3 text-xs text-slate-500">Reading the inventory…</p>;
  }

  return (
    <div className="flex flex-col gap-3 p-3" data-inventory-view="">
      <p className="text-[11px] text-slate-500">
        Everything registered in this session's organization. A row stays once it is written: a worker
        that was fired is still listed as registered.
      </p>
      {read.status === "loaded" && read.rows.length === 0 && (
        <p className="rounded-md border border-slate-800 px-3 py-2 text-xs text-slate-300" role="status">
          Nothing is registered in this organization yet. An app registers its workers by calling{" "}
          <code>openInventory</code> at boot.
        </p>
      )}

      <Section name="workers" title="Registered workers" read={read} noun="workers">
        {(rows) => (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-800 text-left text-[10px] uppercase tracking-wide text-slate-500">
                <th className="px-3 py-1.5 font-medium">Id</th>
                <th className="py-1.5 pr-3 font-medium">Kind</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(toWorkerRow).map((worker) => (
                <tr key={worker.id} className="border-b border-slate-800/50 align-top">
                  <td className="px-3 py-1.5 font-mono text-[11px] text-slate-300">{worker.id}</td>
                  <td className="py-1.5 pr-3 text-slate-300">{worker.kind ?? "unknown"}</td>
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
 * The worker section. Failed, empty and a table render three different ways,
 * and none of them as another.
 */
function Section({
  name,
  title,
  read,
  noun,
  children,
}: {
  name: string;
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
      {read.status === "failed" ? (
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
