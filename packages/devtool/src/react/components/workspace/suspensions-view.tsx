/**
 * Suspensions view (FIX-141 operator UI).
 *
 * Lists the durable-execution suspensions for the active session and lets an
 * operator approve or reject a pending one. A status filter narrows the list;
 * the detail pane shows the selected suspension's fields and `resumeSchema`,
 * plus a free-form JSON textarea for the resume `data` (the schema is raw JSON
 * Schema, not a typed form definition, so a textarea + parse is the honest
 * minimal input here).
 *
 * Reads via `useListSuspensions` (client debug endpoint) and resolves via
 * `useResumeSuspension` (client recovery endpoint). No transport lives here.
 */
import { useMemo, useState } from "react";
import { PauseCircle } from "lucide-react";
import type { SuspensionRecord, SuspensionStatus } from "@flow-state-dev/client";
import { useListSuspensions } from "../../hooks/use-list-suspensions";
import { useResumeSuspension } from "../../hooks/use-resume-suspension";
import { EmptyState } from "../shared/empty-state";
import { StatusBadge } from "../shared/status-badge";
import { JsonViewer } from "../shared/json-viewer";
import { Button } from "../ui/button";

type Props = {
  sessionId: string | null;
  /**
   * Called after a suspension is resolved (approve/reject), with the request id
   * that just resumed. The panel uses it to re-attach its live stream to the
   * continued (same-id) request so its progress to terminal shows without a
   * manual page refresh (FIX-811).
   */
  onResumed?: (requestId: string) => void;
};

const STATUS_FILTERS: Array<{ value: SuspensionStatus | "all"; label: string }> = [
  { value: "all", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "timed_out", label: "Timed out" },
  { value: "expired", label: "Expired" }
];

/**
 * Top-level suspensions panel. Owns the status filter and the selected-row
 * state; delegates fetching to `useListSuspensions`.
 */
export function SuspensionsView({ sessionId, onResumed }: Props) {
  const [statusFilter, setStatusFilter] = useState<SuspensionStatus | "all">(
    "all"
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { suspensions, isLoading, error, disabled, refresh } =
    useListSuspensions(
      sessionId,
      statusFilter === "all" ? undefined : statusFilter
    );

  const selected = useMemo(
    () => suspensions.find((s) => s.suspensionId === selectedId) ?? null,
    [suspensions, selectedId]
  );

  if (disabled) {
    return (
      <EmptyState
        icon={<PauseCircle className="h-8 w-8" aria-hidden />}
        message="Debug endpoints are disabled. Enable them with FSDEV_DEBUG_ENDPOINTS=1 to browse suspensions."
      />
    );
  }

  return (
    <div className="flex h-full min-h-0">
      <div className="flex w-1/2 min-w-0 flex-col border-r border-slate-800">
        <div className="flex items-center gap-2 border-b border-slate-800 px-3 py-2">
          <select
            value={statusFilter}
            onChange={(e) =>
              setStatusFilter(e.target.value as SuspensionStatus | "all")
            }
            className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-300"
          >
            {STATUS_FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
          <Button
            variant="outline"
            size="xs"
            onClick={() => void refresh()}
            disabled={isLoading}
          >
            {isLoading ? "Loading…" : "Refresh"}
          </Button>
        </div>

        {error !== null && (
          <p className="px-3 py-2 text-xs text-red-400">{error}</p>
        )}

        {suspensions.length === 0 ? (
          <EmptyState
            icon={<PauseCircle className="h-8 w-8" aria-hidden />}
            message="No suspensions in this session. Durable actions that call ctx.suspend() appear here for approval."
          />
        ) : (
          <div className="min-h-0 flex-1 overflow-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-left text-[10px] uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-1.5 font-medium">Created</th>
                  <th className="py-1.5 font-medium">Flow</th>
                  <th className="py-1.5 font-medium">Reason</th>
                  <th className="px-3 py-1.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {suspensions.map((s) => (
                  <SuspensionRow
                    key={s.suspensionId}
                    record={s}
                    selected={s.suspensionId === selectedId}
                    onSelect={() => setSelectedId(s.suspensionId)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="min-h-0 w-1/2 flex-1 overflow-auto">
        {selected === null ? (
          <EmptyState message="Select a suspension to inspect and resolve it." />
        ) : (
          // key forces a clean remount per selection so one suspension's
          // unsubmitted resume JSON / parse error never carries to another.
          <SuspensionDetail
            key={selected.suspensionId}
            record={selected}
            onResolved={refresh}
            onResumed={onResumed}
          />
        )}
      </div>
    </div>
  );
}

function SuspensionRow({
  record,
  selected,
  onSelect
}: {
  record: SuspensionRecord;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <tr
      className={`cursor-pointer border-b border-slate-800/50 align-top hover:bg-slate-900/40 ${
        selected ? "bg-slate-800/40" : ""
      }`}
      onClick={onSelect}
    >
      <td className="px-3 py-1.5 text-[11px] text-slate-400">
        {new Date(record.createdAt).toLocaleString()}
      </td>
      <td className="py-1.5 pr-2 font-mono text-[11px] text-slate-300">
        {record.flowKind}
      </td>
      <td className="py-1.5 pr-2 text-slate-300">{record.reason}</td>
      <td className="px-3 py-1.5">
        <StatusBadge status={record.status} />
      </td>
    </tr>
  );
}

/**
 * Detail pane for one suspension: metadata, raw fields, resume schema, and the
 * approve/reject controls. Pending suspensions get a JSON-data textarea and
 * action buttons; resolved ones render read-only.
 */
function SuspensionDetail({
  record,
  onResolved,
  onResumed
}: {
  record: SuspensionRecord;
  onResolved: () => Promise<void>;
  onResumed?: (requestId: string) => void;
}) {
  const { resume, isResuming, error } = useResumeSuspension();
  const [dataText, setDataText] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);

  const isPending = record.status === "pending";

  const handleResolve = async (action: "approve" | "reject") => {
    setParseError(null);
    let data: unknown;
    const trimmed = dataText.trim();
    if (trimmed.length > 0) {
      try {
        data = JSON.parse(trimmed);
      } catch {
        setParseError("Resume data is not valid JSON.");
        return;
      }
    }
    try {
      await resume({
        flowKind: record.flowKind,
        requestId: record.requestId,
        suspensionId: record.suspensionId,
        action,
        data
      });
      await onResolved();
      // Same-request continuation (FIX-811): the resolved request now resumes
      // under its own id. Hand it to the panel so it re-attaches its live stream
      // and follows the continuation to terminal — otherwise the request's
      // status only updates on a manual refresh.
      onResumed?.(record.requestId);
    } catch {
      // `error` from the hook surfaces the failure inline; swallow here so a
      // rejected resume (404/409/422) doesn't bubble as an unhandled rejection.
    }
  };

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex items-center gap-2">
        <span className="font-mono text-xs text-slate-200">
          {record.suspensionId}
        </span>
        <StatusBadge status={record.status} />
      </div>

      <p className="text-sm text-slate-300">{record.message}</p>

      <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-[11px]">
        <dt className="text-slate-500">Flow</dt>
        <dd className="font-mono text-slate-300">{record.flowKind}</dd>
        <dt className="text-slate-500">Action</dt>
        <dd className="font-mono text-slate-300">{record.actionName}</dd>
        <dt className="text-slate-500">Reason</dt>
        <dd className="text-slate-300">{record.reason}</dd>
        <dt className="text-slate-500">Request</dt>
        <dd className="font-mono text-slate-300">{record.requestId}</dd>
        {record.resolvedBy !== undefined && (
          <>
            <dt className="text-slate-500">Resolved by</dt>
            <dd className="text-slate-300">{record.resolvedBy}</dd>
          </>
        )}
      </dl>

      {record.data !== undefined && (
        <section>
          <h4 className="mb-1 text-[10px] uppercase tracking-wide text-slate-500">
            Data
          </h4>
          <JsonViewer data={record.data} />
        </section>
      )}

      {record.resumeSchema !== undefined && (
        <section>
          <h4 className="mb-1 text-[10px] uppercase tracking-wide text-slate-500">
            Resume schema
          </h4>
          <JsonViewer data={record.resumeSchema} />
        </section>
      )}

      {isPending ? (
        <section className="flex flex-col gap-2">
          <h4 className="text-[10px] uppercase tracking-wide text-slate-500">
            Resume data (JSON)
          </h4>
          <textarea
            value={dataText}
            onChange={(e) => setDataText(e.target.value)}
            placeholder="{}"
            rows={4}
            className="rounded border border-slate-700 bg-slate-950 p-2 font-mono text-xs text-slate-300"
          />
          {parseError !== null && (
            <p className="text-xs text-red-400">{parseError}</p>
          )}
          {error !== null && <p className="text-xs text-red-400">{error}</p>}
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => void handleResolve("approve")}
              disabled={isResuming}
            >
              {isResuming ? "Resolving…" : "Approve"}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => void handleResolve("reject")}
              disabled={isResuming}
            >
              Reject
            </Button>
          </div>
        </section>
      ) : (
        <p className="text-xs italic text-slate-500">
          This suspension is already resolved.
        </p>
      )}
    </div>
  );
}
