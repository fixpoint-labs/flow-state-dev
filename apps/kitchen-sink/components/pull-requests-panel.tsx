"use client";

/**
 * The pull requests a session opened, read live from core's pull-request
 * record (`observed-pull-requests`): repository, number, title, state, link,
 * and the turn that opened each one. A row the turn-end branch check found,
 * rather than a create call in the turn, says so.
 *
 * Read-only, and it names no harness: the harness modes show it beside the
 * plan, and Flow State mode in its session sidebar. A flow that declares no
 * record shows nothing.
 */
import { useMemo } from "react";
import { useResourceCollectionList, useResourceManifest, type SessionView } from "@flow-state-dev/react";
import { OBSERVED_PULL_REQUESTS, type ObservedPullRequestState } from "@flow-state-dev/core/types";

/** The pattern the record is declared under. */
const PATTERN = `${OBSERVED_PULL_REQUESTS}/**`;

/** The most rows read: the list route's ceiling. */
const ROW_LIMIT = 200;

export interface PullRequestsPanelProps {
  readonly session: SessionView;
  /** Each turn's number by its request id, for "opened in turn N". Absent where a session has no turns to number. */
  readonly turnsByRequest?: ReadonlyMap<string, number>;
}

/** The session's pull requests, or nothing when its flow keeps no record. */
export function PullRequestsPanel({ session, turnsByRequest }: PullRequestsPanelProps) {
  const { manifest } = useResourceManifest(session);
  const ref = useMemo(
    () =>
      manifest?.resources.find((r) => r.kind === "collection" && r.pattern === PATTERN && r.client.state?.read === true)?.ref,
    [manifest],
  );
  if (ref === undefined) return null;
  return <PullRequestRows session={session} recordRef={ref} turnsByRequest={turnsByRequest} />;
}

function PullRequestRows({
  session,
  recordRef,
  turnsByRequest,
}: {
  session: SessionView;
  recordRef: string;
  turnsByRequest?: ReadonlyMap<string, number>;
}) {
  const rows = useResourceCollectionList<Partial<ObservedPullRequestState>>(session, recordRef, { limit: ROW_LIMIT });
  const sorted = useMemo(
    () =>
      rows.items
        .map((item) => ({ topic: item.topic, row: item.clientData ?? {} }))
        .sort((a, b) => (a.row.firstSeenAt ?? 0) - (b.row.firstSeenAt ?? 0)),
    [rows.items],
  );
  return (
    <section className="mt-4" aria-label="Pull requests" data-testid="pull-requests-panel">
      <h2 className="mb-2 text-sm font-medium">
        Pull requests{sorted.length > 0 ? ` · ${sorted.length}` : ""}
      </h2>
      {rows.error !== undefined ? (
        <p className="text-sm text-destructive">The pull requests can't be read: {rows.error.message}</p>
      ) : sorted.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="pull-requests-empty">
          {rows.isLoading ? "Loading…" : "None opened in this session."}
        </p>
      ) : (
        <ol className="space-y-2 text-sm">
          {sorted.map(({ topic, row }) => {
            const turn = row.requestId == null ? undefined : turnsByRequest?.get(row.requestId);
            return (
              <li
                key={topic}
                className="min-w-0 break-words"
                data-testid="pull-request-row"
                data-url={row.url ?? undefined}
                data-repository={row.repository ?? undefined}
                data-number={row.number ?? undefined}
                data-source={row.source ?? undefined}
              >
                <a href={row.url ?? undefined} target="_blank" rel="noreferrer" className="font-mono hover:underline">
                  {row.repository ?? "?"} #{row.number ?? "?"}
                </a>{" "}
                <span>{row.title ?? ""}</span>
                <span className="ml-2 text-xs text-muted-foreground">
                  {[row.state, turn === undefined ? null : `opened in turn ${turn}`, row.source === "branch" ? "found on the branch" : null]
                    .filter((part) => part != null)
                    .join(" · ")}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
