/**
 * A coordinator's routing record (`coordinator-route`), drawn as a quiet mono
 * note under the line it routed, never as a line of its own: who the post went
 * to, how they were picked, and who was skipped and why.
 */
import type { ComponentItem } from "@flow-state-dev/core/items";

type RoutedDelegate = { worker: string; target?: string; outcome: "delivered" | "skipped" | "failed"; reason?: string };
type RouteRecord = { by?: string; delegates?: RoutedDelegate[]; none?: string };

/** How a record says the delegates were picked. */
const HOW: Record<string, string> = {
  judgment: "by the coordinator",
  held: "still on your last post",
  evaluated: "best fit",
  fallback: "the fallback",
  unplaced: "nobody",
};

export function CoordinatorRoute({ item }: { item: ComponentItem }) {
  const data = (item.data ?? {}) as RouteRecord;
  const delegates = data.delegates ?? [];
  const delivered = delegates.filter((d) => d.outcome === "delivered").map((d) => d.worker);
  const missed = delegates.filter((d) => d.outcome !== "delivered");
  return (
    <div
      className="font-mono text-[11px] text-muted-foreground"
      data-look="route-record"
      data-testid="coordinator-route"
      data-by={data.by ?? ""}
    >
      <p>
        routed · {HOW[data.by ?? ""] ?? data.by}
        {delivered.length > 0 ? ` → ${delivered.join(", ")}` : data.none === undefined ? "" : ` · ${data.none}`}
      </p>
      {missed.map((d) => (
        <p key={`${d.worker}/${d.target ?? ""}/${d.outcome}`} data-testid="coordinator-route-missed">
          {d.worker} {d.outcome}
          {d.reason === undefined ? "" : `: ${d.reason}`}
        </p>
      ))}
    </div>
  );
}
