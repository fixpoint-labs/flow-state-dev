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
import { useMemo, useState, type ReactNode } from "react";
import type { SuspensionRecord, SuspensionStatus } from "@flow-state-dev/client";
import { useListSuspensions } from "../../hooks/use-list-suspensions";
import { useResumeSuspension } from "../../hooks/use-resume-suspension";
import { suspensionOwnerId } from "../../lib/instance-ownership";
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
  { value: "expired", label: "Expired" },
  { value: "stopped", label: "Stopped" },
  { value: "cancelled", label: "Cancelled" }
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
      <div className="px-[18px] py-[22px]">
        <DashedNote title="Suspensions are unavailable">
          Debug endpoints are disabled. Enable them with FSDEV_DEBUG_ENDPOINTS=1 to browse suspensions.
        </DashedNote>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0">
      <div className="flex w-1/2 min-w-0 flex-col border-r border-fs-ink/20">
        <div className="flex items-center gap-2 border-b border-fs-ink/20 px-3 py-2">
          <select
            value={statusFilter}
            onChange={(e) =>
              setStatusFilter(e.target.value as SuspensionStatus | "all")
            }
            className="h-6 px-2 rounded-none border border-fs-ink/35 bg-fs-card text-fs-ink font-fs-mono text-xs focus:border-fs-blue focus:ring-2 focus:ring-fs-blue/20 outline-none"
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
          <p className="px-3 py-2 font-fs-mono text-[11.5px] text-fs-red">{error}</p>
        )}

        {suspensions.length === 0 ? (
          <div className="px-3 py-[22px]">
            <DashedNote title="No suspensions in this session">
              Durable actions that call ctx.suspend() park here until someone approves or rejects them. Open ones are
              marked <NeedsYou>pending</NeedsYou> in this list.
            </DashedNote>
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-fs-ink/20 text-left font-fs-mono text-[10px] uppercase tracking-[.12em] text-fs-ink4">
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
          <p className="px-4 py-[22px] font-fs-mono text-[11.5px] text-fs-ink4">
            Select a suspension to inspect and resolve it.
          </p>
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
      className={`cursor-pointer border-b border-fs-ink/12 align-top ${
        selected ? "bg-fs-blue/8 shadow-[inset_2px_0_0_var(--fs-blue)]" : "hover:bg-fs-ink/5"
      }`}
      onClick={onSelect}
    >
      <td className="px-3 py-2 font-fs-mono text-[11px] text-fs-ink4">
        {new Date(record.createdAt).toLocaleString()}
      </td>
      <td
        className="py-2 pr-2 font-fs-mono text-[11.5px] text-fs-ink"
        title={
          record.flowId != null && record.flowId !== record.flowKind
            ? `Flow instance: ${record.flowId}\nKind: ${record.flowKind}`
            : `Flow instance: ${suspensionOwnerId(record)}`
        }
      >
        {suspensionOwnerId(record)}
      </td>
      <td className="py-2 pr-2 font-fs-mono text-[11.5px] text-fs-ink2">{record.reason}</td>
      <td className="px-3 py-2">
        <SuspensionStatus status={record.status} />
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
        // The record's own owner, not the instance the navigator happens to
        // have open and not the record's kind. This resolves a gate in a run
        // that is still waiting; addressing it to a same-kind peer resumes
        // nothing, or worse, something else.
        flowId: suspensionOwnerId(record),
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
    <div className="flex flex-col gap-3.5 px-4 py-3.5">
      <div className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 truncate font-fs-mono text-[12.5px] font-semibold text-fs-ink">
          {record.suspensionId}
        </span>
        <SuspensionStatus status={record.status} />
      </div>

      <p className="text-[13.5px] text-fs-ink2">{record.message}</p>

      <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1 border-y border-fs-ink/12 py-2 font-fs-mono text-[11.5px]">
        <dt className="text-fs-ink4">Flow</dt>
        <dd className="min-w-0 [overflow-wrap:anywhere] text-fs-ink">{record.flowKind}</dd>
        <dt className="text-fs-ink4">Action</dt>
        <dd className="min-w-0 [overflow-wrap:anywhere] text-fs-ink">{record.actionName}</dd>
        <dt className="text-fs-ink4">Reason</dt>
        <dd className="min-w-0 [overflow-wrap:anywhere] text-fs-ink">{record.reason}</dd>
        <dt className="text-fs-ink4">Request</dt>
        <dd className="min-w-0 [overflow-wrap:anywhere] text-fs-ink">{record.requestId}</dd>
        {record.resolvedBy !== undefined && (
          <>
            <dt className="text-fs-ink4">Resolved by</dt>
            <dd className="min-w-0 [overflow-wrap:anywhere] text-fs-ink">{record.resolvedBy}</dd>
          </>
        )}
      </dl>

      {record.data !== undefined && (
        <section>
          <h4 className={`mb-1.5 ${SECTION_LABEL}`}>
            Data
          </h4>
          <JsonViewer data={record.data} />
        </section>
      )}

      {record.resumeSchema !== undefined && (
        <section>
          <h4 className={`mb-1.5 ${SECTION_LABEL}`}>
            Resume schema
          </h4>
          <JsonViewer data={record.resumeSchema} />
        </section>
      )}

      {isPending ? (
        <section className="flex flex-col gap-2">
          <h4 className={SECTION_LABEL}>
            Resume data (JSON)
          </h4>
          <textarea
            value={dataText}
            onChange={(e) => setDataText(e.target.value)}
            placeholder="{}"
            rows={4}
            className="resize-y px-2.5 py-2 leading-[1.55] placeholder:text-fs-ink4 rounded-none border border-fs-ink/35 bg-fs-card text-fs-ink font-fs-mono text-xs focus:border-fs-blue focus:ring-2 focus:ring-fs-blue/20 outline-none"
          />
          {parseError !== null && (
            <p className="font-fs-mono text-[11.5px] text-fs-red">{parseError}</p>
          )}
          {error !== null && <p className="font-fs-mono text-[11.5px] text-fs-red">{error}</p>}
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
        <p className="font-fs-mono text-[11.5px] text-fs-ink4">
          This suspension is already resolved.
        </p>
      )}
    </div>
  );
}

/** Mono uppercase section label, the brand's app-register heading. */
const SECTION_LABEL = "font-fs-mono text-[10px] font-medium uppercase tracking-[.14em] text-fs-ink3";

/**
 * The highlighter: a suspension that is still pending is waiting on a person,
 * and that is the one thing in this panel the yellow is for.
 */
function NeedsYou({ children }: { children: ReactNode }) {
  return <span className="bg-fs-hl px-1 font-fs-mono text-fs-on-hl">{children}</span>;
}

/** A suspension's status: highlighted while pending, the shared badge otherwise. */
function SuspensionStatus({ status }: { status: SuspensionStatus }) {
  if (status === "pending") {
    return (
      <span className="inline-block bg-fs-hl px-1.5 font-fs-mono text-[10.5px] font-medium text-fs-on-hl">
        {status}
      </span>
    );
  }
  return <StatusBadge status={status} />;
}

/** A dashed, hairline box for an empty or unavailable state. */
function DashedNote({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="max-w-[560px] border border-dashed border-fs-ink/45 px-[18px] pt-[18px] pb-4">
      <div className="text-sm font-semibold text-fs-ink">{title}</div>
      <div className="mt-1.5 font-fs-mono text-[11.5px] leading-[1.7] text-fs-ink3">{children}</div>
    </div>
  );
}
