/**
 * Renders the privileged debug resource tree.
 *
 * One `<ResourceRow>` per `DebugResourceEntry`. Single resources expand
 * inline to a `<ResourceStateView>`. Collections expand to a paginated list
 * of items (`useDebugCollectionItems`) with per-item state views.
 */
import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Download } from "lucide-react";
import type {
  DebugClientView,
  DebugResourceEntry,
  DebugResourceClientConfig
} from "@flow-state-dev/client";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { useDebugCollectionItems } from "../../hooks/use-debug-collection-items";
import { useDebugResourceContent } from "../../hooks/use-debug-resource-content";
import { ResourceStateView } from "./resource-state-view";

type ResourcesTreeProps = {
  sessionId: string;
  resources: DebugResourceEntry[];
  /**
   * Bumps when the parent panel re-fetches the resource tree. Expanded
   * collection bodies key off this to refresh their item lists in step.
   */
  reloadTick?: number;
};

export function ResourcesTree({ sessionId, resources, reloadTick = 0 }: ResourcesTreeProps) {
  if (resources.length === 0) {
    return (
      <div className="px-2 py-3 text-[11px] italic text-slate-500">
        No resources declared on this flow.
      </div>
    );
  }
  return (
    <div className="space-y-1">
      {resources.map((entry) => (
        <ResourceRow
          key={entry.definitionId}
          sessionId={sessionId}
          entry={entry}
          reloadTick={reloadTick}
        />
      ))}
    </div>
  );
}

function ResourceRow({
  sessionId,
  entry,
  reloadTick
}: {
  sessionId: string;
  entry: DebugResourceEntry;
  reloadTick: number;
}) {
  const [open, setOpen] = useState(false);
  const otherAliases = entry.aliases.filter((a) => a !== entry.primaryName);
  return (
    <div className="rounded-md border border-slate-800/60 bg-slate-900/30">
      <button
        type="button"
        className="flex w-full items-center gap-1.5 px-2 py-1 text-left hover:bg-slate-800/30"
        onClick={() => setOpen(!open)}
      >
        {open ? (
          <ChevronDown className="h-3 w-3 shrink-0 text-slate-500" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0 text-slate-500" />
        )}
        <span className="truncate font-mono text-[11px] text-slate-300">
          {entry.primaryName}
        </span>
        {otherAliases.length > 0 && (
          <span
            className="flex items-center gap-0.5"
            title={`same underlying resource, registered under ${entry.aliases.length} names`}
          >
            {otherAliases.map((alias) => (
              <span
                key={alias}
                className="rounded-full bg-slate-800/60 px-1.5 text-[9px] font-mono text-slate-400"
              >
                {alias}
              </span>
            ))}
          </span>
        )}
        <ScopeBadge scope={entry.scope} />
        {entry.isCollection ? (
          <CollectionCountBadge entry={entry} />
        ) : entry.hasContent ? (
          <span className="rounded-full bg-slate-800/40 px-1.5 text-[9px] font-mono text-slate-500">
            +content
          </span>
        ) : null}
        <span className="flex-1" />
        <ClientConfigInline config={entry.clientConfig} />
      </button>
      {open && (
        <div className="border-t border-slate-800/60 px-2 py-2">
          {entry.isCollection ? (
            <CollectionBody sessionId={sessionId} entry={entry} reloadTick={reloadTick} />
          ) : (
            <SingleBody sessionId={sessionId} entry={entry} />
          )}
        </div>
      )}
    </div>
  );
}

function ScopeBadge({ scope }: { scope: "session" | "user" | "org" }) {
  const color =
    scope === "session"
      ? "text-sky-400 bg-sky-900/30"
      : scope === "user"
        ? "text-violet-400 bg-violet-900/30"
        : "text-amber-400 bg-amber-900/30";
  return (
    <span className={`rounded-full px-1.5 text-[9px] font-mono uppercase ${color}`}>
      {scope}
    </span>
  );
}

function CollectionCountBadge({ entry }: { entry: DebugResourceEntry }) {
  const count = entry.itemCount ?? 0;
  const label = `${count} ${count === 1 ? "item" : "items"}`;
  return (
    <span
      className="rounded-full bg-slate-800/60 px-1.5 text-[9px] font-mono text-slate-400"
      title={entry.itemCountTruncated ? "Truncated to 1000" : undefined}
    >
      {label}
      {entry.itemCountTruncated ? "+" : ""}
    </span>
  );
}

function ClientConfigInline({ config }: { config: DebugResourceClientConfig }) {
  const parts: string[] = [];
  parts.push(config.hasClient ? "client" : "no-client");
  if (config.data) parts.push("data");
  if (config.stateRead) parts.push("state.read");
  if (config.contentRead) parts.push("content.read");
  if (config.prefetchWindow !== null) parts.push(`prefetch:${config.prefetchWindow}`);
  return (
    <span
      className="text-[9px] font-mono text-slate-600"
      title="client config snapshot"
    >
      {parts.join(" · ")}
    </span>
  );
}

function SingleBody({
  sessionId,
  entry
}: {
  sessionId: string;
  entry: DebugResourceEntry;
}) {
  return (
    <div className="space-y-2">
      <ResourceStateView state={entry.state ?? null} clientView={entry.clientView} />
      {entry.hasContent && (
        <ContentFetcher
          sessionId={sessionId}
          resourceRef={entry.primaryName}
          topic={null}
          contentType={entry.contentType}
          byteLength={entry.contentByteLength}
          visibleToClient={entry.contentVisibleToClient}
        />
      )}
    </div>
  );
}

function CollectionBody({
  sessionId,
  entry,
  reloadTick
}: {
  sessionId: string;
  entry: DebugResourceEntry;
  reloadTick: number;
}) {
  const [filter, setFilter] = useState("");
  const { items, isLoading, error, hasMore, loadMore, refresh } = useDebugCollectionItems(
    sessionId,
    entry.primaryName,
    { topicFilter: filter, pageSize: 50 }
  );

  // Initial load when the collection is first expanded; re-fires when the
  // topic filter changes (the hook resets accumulation on filter change so
  // we just fire one fresh page) and when the parent bumps `reloadTick`
  // after a streamed mutation or manual refresh.
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, entry.primaryName, filter, reloadTick]);

  // Hide the filter input until the collection has enough items to make
  // filtering worthwhile. Threshold uses the unfiltered total so the input
  // doesn't disappear mid-filter as results narrow.
  const showFilter = (entry.itemCount ?? 0) > 10;

  return (
    <div className="space-y-2">
      {showFilter && (
        <div className="flex items-center gap-2">
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter topic…"
            className="h-7 text-[11px]"
          />
          <span className="text-[10px] font-mono text-slate-600">
            {entry.storagePrefix ?? ""}
          </span>
        </div>
      )}
      {error && (
        <div className="text-[11px] text-red-400">{error}</div>
      )}
      {items.length === 0 && !isLoading && (
        <div className="text-[11px] italic text-slate-500">No items.</div>
      )}
      <div className="space-y-1">
        {items.map((item) => (
          <CollectionItemRow
            key={item.storageKey}
            sessionId={sessionId}
            resourceRef={entry.primaryName}
            item={item}
          />
        ))}
      </div>
      {hasMore && (
        <Button
          variant="ghost"
          size="xs"
          onClick={() => void loadMore()}
          disabled={isLoading}
        >
          {isLoading ? "Loading…" : "Load more"}
        </Button>
      )}
    </div>
  );
}

function CollectionItemRow({
  sessionId,
  resourceRef,
  item
}: {
  sessionId: string;
  resourceRef: string;
  item: {
    topic: string;
    storageKey: string;
    state: Record<string, unknown> | null;
    clientView: DebugClientView;
    hasContent: boolean;
    contentByteLength?: number;
    contentType?: string;
    contentVisibleToClient: boolean;
  };
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-md border border-slate-800/40 bg-slate-950/30">
      <button
        type="button"
        className="flex w-full items-center gap-1.5 px-2 py-1 text-left hover:bg-slate-800/30"
        onClick={() => setOpen(!open)}
      >
        {open ? (
          <ChevronDown className="h-2.5 w-2.5 shrink-0 text-slate-600" />
        ) : (
          <ChevronRight className="h-2.5 w-2.5 shrink-0 text-slate-600" />
        )}
        <span className="truncate font-mono text-[11px] text-slate-300">{item.topic}</span>
        {item.hasContent && (
          <span className="rounded-full bg-slate-800/40 px-1.5 text-[9px] font-mono text-slate-500">
            +content
          </span>
        )}
      </button>
      {open && (
        <div className="border-t border-slate-800/40 px-2 py-2 space-y-2">
          <ResourceStateView state={item.state} clientView={item.clientView} />
          {item.hasContent && (
            <ContentFetcher
              sessionId={sessionId}
              resourceRef={resourceRef}
              topic={item.topic}
              contentType={item.contentType}
              byteLength={item.contentByteLength}
              visibleToClient={item.contentVisibleToClient}
            />
          )}
        </div>
      )}
    </div>
  );
}

function ContentFetcher({
  sessionId,
  resourceRef,
  topic,
  contentType,
  byteLength,
  visibleToClient
}: {
  sessionId: string;
  resourceRef: string;
  topic: string | null;
  contentType: string | undefined;
  byteLength: number | undefined;
  visibleToClient: boolean | undefined;
}) {
  const { content, isLoading, error, fetch } = useDebugResourceContent(sessionId, resourceRef, topic);
  const isText = (contentType ?? "text/plain").startsWith("text/");

  const handleDownload = () => {
    if (content === null) return;
    const blob = new Blob([content], { type: contentType ?? "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = topic ?? resourceRef;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="rounded-md border border-slate-800/40 bg-slate-950/30 p-2">
      <div className="mb-1 flex items-center gap-2 text-[10px] font-mono text-slate-500">
        <span>content</span>
        {contentType && <span>{contentType}</span>}
        {byteLength !== undefined && <span>{byteLength}B</span>}
        {visibleToClient === false && (
          <span
            className="rounded-full bg-slate-800/60 px-1.5 text-[9px] text-slate-500"
            title="client.content.read is false — production clients can't read this content"
          >
            server-only
          </span>
        )}
        <span className="flex-1" />
        {content === null ? (
          <Button
            variant="ghost"
            size="xs"
            onClick={() => void fetch()}
            disabled={isLoading}
          >
            {isLoading ? "Loading…" : "View content"}
          </Button>
        ) : !isText ? (
          <Button variant="ghost" size="xs" onClick={handleDownload}>
            <Download className="h-3 w-3" /> Download
          </Button>
        ) : null}
      </div>
      {error && <div className="text-[11px] text-red-400">{error}</div>}
      {content !== null && isText && (
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-slate-950 p-2 font-mono text-[11px] text-slate-300">
          {content}
        </pre>
      )}
      {content !== null && !isText && (
        <div className="text-[11px] italic text-slate-500">
          Binary content fetched ({byteLength ?? content.length}B). Use Download to save.
        </div>
      )}
    </div>
  );
}
