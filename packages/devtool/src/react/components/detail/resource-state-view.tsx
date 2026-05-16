/**
 * Server / Client view for one resource state.
 *
 * Renders a single JSON tree when the client value is identical to the
 * server state (the common case — no `client.data` declared means identity
 * passthrough at runtime). When the projection diverges, falls back to a
 * two-tab Server/Client toggle so the difference is visible.
 *
 * The `client.state.read: false` and `client.data threw` cases still render
 * the Client tab with an explanatory notice — those are genuine "client
 * cannot see this" or "projection is broken" states.
 */
import { useMemo, useState } from "react";
import type { DebugClientView } from "@flow-state-dev/client";
import { JsonViewer } from "../shared/json-viewer";
import { deepEqual } from "../../lib/utils";

type Mode = "server" | "client";

type ResourceStateViewProps = {
  state: Record<string, unknown> | null | undefined;
  clientView: DebugClientView | undefined;
};

export function ResourceStateView({ state, clientView }: ResourceStateViewProps) {
  const resolved = useMemo(() => resolveClientValue(state, clientView), [state, clientView]);
  const [mode, setMode] = useState<Mode>("server");

  if (!resolved.diverges) {
    return <div><ServerPane state={state} /></div>;
  }

  return (
    <div className="space-y-2">
      <ModeTabs mode={mode} setMode={setMode} />
      {mode === "client" && resolved.notice && (
        <ClientNotice message={resolved.notice} />
      )}
      {mode === "server" && <ServerPane state={state} />}
      {mode === "client" && <ClientPane value={resolved.clientValue} hasValue={resolved.hasClientValue} />}
    </div>
  );
}

function ModeTabs({ mode, setMode }: { mode: Mode; setMode: (m: Mode) => void }) {
  const tabs: Array<{ id: Mode; label: string }> = [
    { id: "server", label: "Server" },
    { id: "client", label: "Client" }
  ];
  return (
    <div className="inline-flex gap-1 rounded-md bg-slate-900/40 p-0.5 text-[10px]">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => setMode(tab.id)}
          className={`rounded px-2 py-0.5 font-mono uppercase transition-colors ${
            mode === tab.id
              ? "bg-slate-700 text-slate-100"
              : "text-slate-500 hover:text-slate-300"
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

function ClientNotice({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-amber-900/40 bg-amber-950/30 px-2 py-1 text-[11px] text-amber-300">
      {message}
    </div>
  );
}

function ServerPane({ state }: { state: Record<string, unknown> | null | undefined }) {
  if (state === null || state === undefined) {
    return <span className="text-[11px] italic text-slate-500">No state persisted.</span>;
  }
  return <JsonViewer data={state} />;
}

function ClientPane({ value, hasValue }: { value: unknown; hasValue: boolean }) {
  if (!hasValue) {
    return <span className="text-[11px] italic text-slate-500">— no client value —</span>;
  }
  return <JsonViewer data={value} />;
}

// ---------------------------------------------------------------------------
// Client-value resolution
// ---------------------------------------------------------------------------

type ResolvedClient = {
  /** True when the client value differs from the server state and warrants tabs. */
  diverges: boolean;
  /** The value to render in the Client tab. */
  clientValue: unknown;
  /** Whether a renderable client value exists (false for gated / broken cases). */
  hasClientValue: boolean;
  /** Notice text to render above the Client tab for degraded cases. */
  notice: string | null;
};

/**
 * Reduce the debug client-view sum type to a single rendering decision.
 *
 * - `no_client_data` is identity passthrough at runtime (see
 *   `resolveClientProjection`), so the client value equals the server state
 *   and no tabs are needed.
 * - `ok: true` with a deep-equal value collapses to the same single-pane case.
 * - `ok: true` with a divergent value opens the two-tab view.
 * - `state_read_false` and `threw` keep the Client tab visible with a notice.
 */
function resolveClientValue(
  state: Record<string, unknown> | null | undefined,
  view: DebugClientView | undefined
): ResolvedClient {
  if (view === null || view === undefined) {
    return { diverges: false, clientValue: state, hasClientValue: state !== null && state !== undefined, notice: null };
  }
  if (view.ok === true) {
    const matches = deepEqual(state ?? null, view.value ?? null);
    return {
      diverges: !matches,
      clientValue: view.value,
      hasClientValue: view.value !== null && view.value !== undefined,
      notice: null
    };
  }
  if (view.reason === "no_client_data") {
    return { diverges: false, clientValue: state, hasClientValue: state !== null && state !== undefined, notice: null };
  }
  if (view.reason === "state_read_false") {
    return {
      diverges: true,
      clientValue: null,
      hasClientValue: false,
      notice: "client.state.read is false — production clients cannot read this resource's state."
    };
  }
  return {
    diverges: true,
    clientValue: null,
    hasClientValue: false,
    notice: `client.data threw: ${view.error ?? "(no message)"}`
  };
}
