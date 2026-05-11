/**
 * Raw / Client / Diff toggle for one resource state.
 *
 * The three modes:
 *
 *  - **Raw**: the server-side state with per-top-level-field projection
 *    badges (✓ if the same dot-path appears in `clientView.value` with the
 *    same leaf value, ✗ if `client.data` dropped it). Badges are suppressed
 *    when the client view is not applicable.
 *  - **Client**: renders `clientView.value` as the primary tree. When
 *    `clientView.ok === false`, shows an explanatory inline message.
 *  - **Diff**: side-by-side raw/client panes with a tiny structural-subset
 *    pairing — paired = same dot-path + deep-equal leaf value in both;
 *    everything else is footnoted. Deliberately simple.
 */
import { useMemo, useState } from "react";
import type { DebugClientView } from "@flow-state-dev/client";
import { JsonViewer } from "../shared/json-viewer";
import { deepEqual } from "../../lib/utils";

type Mode = "raw" | "client" | "diff";

type ResourceStateViewProps = {
  state: Record<string, unknown> | null | undefined;
  clientView: DebugClientView | undefined;
};

export function ResourceStateView({ state, clientView }: ResourceStateViewProps) {
  const [mode, setMode] = useState<Mode>("raw");

  const clientApplicable = clientView !== null && clientView !== undefined;
  const clientOk = clientApplicable && clientView!.ok === true;
  const clientValue: unknown = clientOk
    ? (clientView as { ok: true; value: unknown }).value
    : null;

  // Precompute the set of dot-paths present (with matching leaf values) in
  // both raw and client trees. Used by all three modes.
  const pairing = useMemo(() => computePairing(state, clientValue), [state, clientValue]);

  return (
    <div className="space-y-2">
      <ModeTabs mode={mode} setMode={setMode} hasClient={clientApplicable} />
      {!clientOk && clientApplicable && mode !== "raw" && (
        <ClientUnavailableNotice view={clientView!} />
      )}
      {mode === "raw" && (
        <RawView state={state} pairing={pairing} clientApplicable={clientOk} />
      )}
      {mode === "client" && (
        <ClientView clientView={clientView} />
      )}
      {mode === "diff" && (
        <DiffView state={state} clientValue={clientValue} pairing={pairing} clientOk={clientOk} />
      )}
    </div>
  );
}

function ModeTabs({
  mode,
  setMode,
  hasClient
}: {
  mode: Mode;
  setMode: (m: Mode) => void;
  hasClient: boolean;
}) {
  const tabs: Array<{ id: Mode; label: string; disabled?: boolean }> = [
    { id: "raw", label: "Raw" },
    { id: "client", label: "Client", disabled: !hasClient },
    { id: "diff", label: "Diff", disabled: !hasClient }
  ];
  return (
    <div className="inline-flex gap-1 rounded-md bg-slate-900/40 p-0.5 text-[10px]">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          disabled={tab.disabled}
          onClick={() => setMode(tab.id)}
          className={`rounded px-2 py-0.5 font-mono uppercase transition-colors ${
            mode === tab.id
              ? "bg-slate-700 text-slate-100"
              : "text-slate-500 hover:text-slate-300 disabled:text-slate-700 disabled:hover:text-slate-700"
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

function ClientUnavailableNotice({ view }: { view: Exclude<DebugClientView, null> }) {
  if (view.ok === true) return null;
  const msg =
    view.reason === "no_client_data"
      ? "No client.data projection — production clients see nothing for this resource."
      : view.reason === "state_read_false"
        ? "client.state.read is false — production clients see nothing for this resource."
        : `client.data threw: ${view.error ?? "(no message)"}`;
  return (
    <div className="rounded-md border border-amber-900/40 bg-amber-950/30 px-2 py-1 text-[11px] text-amber-300">
      {msg}
    </div>
  );
}

function RawView({
  state,
  pairing,
  clientApplicable
}: {
  state: Record<string, unknown> | null | undefined;
  pairing: PairingResult;
  clientApplicable: boolean;
}) {
  if (state === null || state === undefined) {
    return <span className="text-[11px] italic text-slate-500">No state persisted.</span>;
  }
  const entries = Object.entries(state);
  if (entries.length === 0) {
    return <JsonViewer data={state} />;
  }
  return (
    <div className="space-y-1">
      {entries.map(([key, value]) => {
        const inClient = pairing.matchedTopLevel.has(key);
        const droppedInClient = pairing.rawOnlyTopLevel.has(key);
        return (
          <div key={key} className="rounded-md border border-slate-800/60 bg-slate-950/40 p-1.5">
            <div className="mb-0.5 flex items-center gap-1.5">
              <span className="font-mono text-[11px] text-slate-300">{key}</span>
              {clientApplicable && inClient && (
                <span
                  className="rounded-full bg-emerald-900/30 px-1.5 text-[9px] font-mono text-emerald-400"
                  title="Same dot-path with same leaf value visible in client view"
                >
                  ✓ in client
                </span>
              )}
              {clientApplicable && droppedInClient && (
                <span
                  className="rounded-full bg-red-900/30 px-1.5 text-[9px] font-mono text-red-400"
                  title="Dropped by client.data — not visible to production clients"
                >
                  ✗ dropped
                </span>
              )}
            </div>
            <JsonViewer data={value} />
          </div>
        );
      })}
    </div>
  );
}

function ClientView({ clientView }: { clientView: DebugClientView | undefined }) {
  if (clientView === null || clientView === undefined) {
    return <span className="text-[11px] italic text-slate-500">No client view available.</span>;
  }
  if (clientView.ok !== true) {
    // Notice already rendered above; show an empty placeholder for visual
    // balance.
    return <span className="text-[11px] italic text-slate-500">— no client value —</span>;
  }
  return <JsonViewer data={clientView.value} />;
}

function DiffView({
  state,
  clientValue,
  pairing,
  clientOk
}: {
  state: Record<string, unknown> | null | undefined;
  clientValue: unknown;
  pairing: PairingResult;
  clientOk: boolean;
}) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <div className="mb-1 text-[10px] font-medium uppercase text-slate-500">Raw (server)</div>
          {state ? (
            <JsonViewer data={state} />
          ) : (
            <span className="text-[11px] italic text-slate-500">No state.</span>
          )}
        </div>
        <div>
          <div className="mb-1 text-[10px] font-medium uppercase text-slate-500">Client</div>
          {clientOk ? (
            <JsonViewer data={clientValue} />
          ) : (
            <span className="text-[11px] italic text-slate-500">No client value.</span>
          )}
        </div>
      </div>
      {(pairing.rawOnlyTopLevel.size > 0 || pairing.clientOnlyTopLevel.size > 0) && (
        <div className="space-y-1 text-[10px] text-slate-500">
          {pairing.rawOnlyTopLevel.size > 0 && (
            <div>
              <span className="font-medium text-slate-400">Server-only fields:</span>{" "}
              <span className="font-mono">
                {Array.from(pairing.rawOnlyTopLevel).join(", ")}
              </span>{" "}
              <span className="italic">— transformed or dropped in client view.</span>
            </div>
          )}
          {pairing.clientOnlyTopLevel.size > 0 && (
            <div>
              <span className="font-medium text-slate-400">Client-only fields:</span>{" "}
              <span className="font-mono">
                {Array.from(pairing.clientOnlyTopLevel).join(", ")}
              </span>{" "}
              <span className="italic">— computed from server state.</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Structural pairing helper
// ---------------------------------------------------------------------------

type PairingResult = {
  /** Top-level keys with deep-equal values on both sides. */
  matchedTopLevel: Set<string>;
  /** Top-level keys present on raw but not represented unchanged on client. */
  rawOnlyTopLevel: Set<string>;
  /** Top-level keys present on client but not represented unchanged on raw. */
  clientOnlyTopLevel: Set<string>;
};

/**
 * Compare top-level fields by key + deep equality. Anything more elaborate
 * (per-subfield, computed projections) is deliberately out of scope: the
 * caller renders an "unpaired fields" footnote rather than trying to align
 * shapes that don't match.
 */
function computePairing(
  raw: Record<string, unknown> | null | undefined,
  client: unknown
): PairingResult {
  const result: PairingResult = {
    matchedTopLevel: new Set(),
    rawOnlyTopLevel: new Set(),
    clientOnlyTopLevel: new Set()
  };
  const rawObj =
    raw !== null && raw !== undefined && typeof raw === "object" ? raw : null;
  const clientObj =
    client !== null && client !== undefined && typeof client === "object" && !Array.isArray(client)
      ? (client as Record<string, unknown>)
      : null;
  if (rawObj === null && clientObj === null) return result;
  const rawKeys = new Set(rawObj ? Object.keys(rawObj) : []);
  const clientKeys = new Set(clientObj ? Object.keys(clientObj) : []);
  for (const key of rawKeys) {
    if (clientKeys.has(key) && deepEqual(rawObj![key], clientObj![key])) {
      result.matchedTopLevel.add(key);
    } else {
      result.rawOnlyTopLevel.add(key);
    }
  }
  for (const key of clientKeys) {
    if (!result.matchedTopLevel.has(key)) {
      result.clientOnlyTopLevel.add(key);
    }
  }
  return result;
}
