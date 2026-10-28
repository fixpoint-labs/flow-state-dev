/**
 * Renders the privileged debug resource tree.
 *
 * Entries are grouped by scope (session, user, org — in that order, empty
 * groups omitted), each group a hairline card list with one `<ResourceRow>`
 * per `DebugResourceEntry`. Single resources expand
 * inline to a `<ResourceStateView>`. Collections expand to a paginated list
 * of items (`useDebugCollectionItems`) with per-item state views.
 *
 * A row whose resource cannot be written at all carries a read-only mark
 * beside its scope badge, and both permission settings are in the row's
 * detail (FIX-1481). See {@link ReadOnlyBadge} for what the mark means and
 * {@link PermissionsLine} for the question it deliberately does not answer.
 */
import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Download, Lock } from "lucide-react";
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
      <div className="py-3 text-[11px] italic text-fs-ink4">
        No resources declared on this flow.
      </div>
    );
  }
  // Known scopes first in a fixed order, then any scope this build doesn't
  // know yet, so an entry is never dropped from the tree.
  const scopes = [
    ...SCOPE_ORDER,
    ...new Set(resources.map((entry) => entry.scope).filter((scope) => !SCOPE_ORDER.includes(scope))),
  ];
  const groups = scopes
    .map((scope) => ({ scope, entries: resources.filter((entry) => entry.scope === scope) }))
    .filter((group) => group.entries.length > 0);
  return (
    <div>
      {groups.map((group) => (
        <div key={group.scope}>
          <div className="mb-1 mt-2.5 flex items-center gap-2 font-fs-mono text-[10px] font-medium uppercase tracking-[.12em] text-fs-ink4">
            <span>{group.scope} scope</span>
            <span className="h-px flex-1 bg-fs-ink/15" aria-hidden />
            <span>{group.entries.length}</span>
          </div>
          <div className="flex flex-col divide-y divide-fs-ink/10 border border-fs-ink/20 bg-fs-card">
            {group.entries.map((entry) => (
              <ResourceRow
                key={entry.definitionId}
                sessionId={sessionId}
                entry={entry}
                reloadTick={reloadTick}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

const SCOPE_ORDER: ReadonlyArray<DebugResourceEntry["scope"]> = ["session", "user", "org"];

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
    <div>
      <button
        type="button"
        className={`flex w-full items-center gap-1.5 px-2 py-1.5 text-left hover:bg-fs-ink/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-fs-blue/40 ${
          open ? "bg-fs-blue/8 shadow-[inset_2px_0_0_var(--fs-blue)]" : ""
        }`}
        onClick={() => setOpen(!open)}
      >
        {open ? (
          <ChevronDown className="h-3 w-3 shrink-0 text-fs-ink3" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0 text-fs-ink3" />
        )}
        <span className="min-w-0 truncate font-fs-mono text-[12px] font-medium text-fs-ink">
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
                className="border border-dashed border-fs-ink/45 px-1 font-fs-mono text-[9.5px] text-fs-ink3"
              >
                {alias}
              </span>
            ))}
          </span>
        )}
        <ScopeBadge scope={entry.scope} />
        {entry.writable === false && <ReadOnlyBadge />}
        {entry.isCollection ? (
          <CollectionCountBadge entry={entry} />
        ) : entry.hasContent ? (
          <span className="font-fs-mono text-[10.5px] text-fs-ink3">+content</span>
        ) : null}
        <span className="flex-1" />
        <ClientConfigInline config={entry.clientConfig} />
      </button>
      {open && (
        <div className="border-t border-fs-ink/12 bg-fs-surface px-2.5 py-2">
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
  // Scopes are told apart by label, not hue; session (the narrowest, per
  // conversation) takes the dashed secondary tag.
  const line = scope === "session" ? "border-dashed" : "border-solid";
  return (
    <span
      className={`shrink-0 border ${line} border-fs-ink/45 px-1 font-fs-mono text-[9.5px] uppercase tracking-[.08em] text-fs-ink3`}
    >
      {scope}
    </span>
  );
}

/**
 * The seal: the store refuses writes to this resource's state and content.
 *
 * Shown on `writable === false` and on nothing else, because that is the one
 * condition the store checks. It is deliberately NOT derived from
 * `llmWritable`, which asks a different question (is a model offered a write
 * tool) and is opt-in, so a mark taken from it would brand most of the tree
 * and stop distinguishing anything. Nor from where the resource was loaded: a
 * `references/` document and a document held under a worker's read-only grant
 * are sealed two different ways and arrive as the same setting, and a
 * folder-derived mark would be silent about the second.
 *
 * **What it does not claim.** An earlier version said "immutable to everyone",
 * which is false in two supported cases: a `writable: false` COLLECTION still
 * permits `create` / `getOrCreate` / `delete`, none of which consult the flag,
 * and the flag lives on the definition rather than the storage cell, so a
 * worker's read-only grant (a shallow copy with both doors shut) leaves the same
 * shared org or user cell writable through any other flow's own definition.
 *
 * The tooltip therefore scopes itself to what this handle refuses and stops
 * there — a tooltip cannot carry the two exceptions without becoming a
 * paragraph, and `debug-vs-client-state.md` is one click away and carries them
 * correctly.
 */
function ReadOnlyBadge() {
  return (
    <span
      className="flex shrink-0 items-center gap-0.5 border border-fs-ink px-1 font-fs-mono text-[9.5px] uppercase tracking-[.08em] text-fs-ink"
      title="writable is false — this handle refuses state and content writes, from your code and from a model alike. It is not a claim about the underlying data."
    >
      <Lock className="h-2.5 w-2.5" aria-hidden />
      read-only
    </span>
  );
}

/**
 * Both permission settings, in the row's detail — each shown only where the
 * server declared it.
 *
 * The mark above answers one question. This answers both, so a reader who
 * needs the distinction between *cannot be written* and *a model is not
 * offered a write tool* can get it without the mark pretending to cover the
 * second. An undeclared setting is left out rather than printed as a default:
 * absent means writable, and a server that predates these settings sends
 * neither, in which case this renders nothing at all.
 */
function PermissionsLine({ entry }: { entry: DebugResourceEntry }) {
  const parts: string[] = [];
  if (entry.writable !== undefined) parts.push(`writable: ${entry.writable}`);
  if (entry.llmWritable !== undefined) {
    parts.push(`llmWritable: ${entry.llmWritable}`);
  }
  if (parts.length === 0) return null;
  return (
    <div
      className="font-fs-mono text-[10.5px] text-fs-ink3"
      title="writable decides whether the store accepts state and content writes through this handle; llmWritable only whether a model is offered a write tool"
    >
      {parts.join(" · ")}
    </div>
  );
}

function CollectionCountBadge({ entry }: { entry: DebugResourceEntry }) {
  const count = entry.itemCount ?? 0;
  const label = `${count} ${count === 1 ? "item" : "items"}`;
  return (
    <span
      className="shrink-0 font-fs-mono text-[10.5px] text-fs-ink3"
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
      className={`truncate whitespace-nowrap font-fs-mono text-[10px] ${config.hasClient ? "text-fs-ink2" : "text-fs-ink4"}`}
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
      <PermissionsLine entry={entry} />
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
  }, [refresh, reloadTick]);

  // Hide the filter input until the collection has enough items to make
  // filtering worthwhile. Threshold uses the unfiltered total so the input
  // doesn't disappear mid-filter as results narrow.
  const showFilter = (entry.itemCount ?? 0) > 10;

  return (
    <div className="space-y-2">
      <PermissionsLine entry={entry} />
      {showFilter && (
        <div className="flex items-center gap-2">
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter topic…"
            className="h-7 text-[11px]"
          />
          <span className="font-fs-mono text-[10px] text-fs-ink4">
            {entry.storagePrefix ?? ""}
          </span>
        </div>
      )}
      {error && (
        <div className="font-fs-mono text-[11px] text-fs-red">{error}</div>
      )}
      {items.length === 0 && !isLoading && (
        <div className="text-[11px] italic text-fs-ink4">No items.</div>
      )}
      <div className="flex flex-col divide-y divide-fs-ink/10 border border-fs-ink/20 bg-fs-card empty:hidden">
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
    <div>
      <button
        type="button"
        className={`flex w-full items-center gap-1.5 px-2 py-1 text-left hover:bg-fs-ink/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-fs-blue/40 ${
          open ? "bg-fs-blue/8 shadow-[inset_2px_0_0_var(--fs-blue)]" : ""
        }`}
        onClick={() => setOpen(!open)}
      >
        {open ? (
          <ChevronDown className="h-2.5 w-2.5 shrink-0 text-fs-ink3" />
        ) : (
          <ChevronRight className="h-2.5 w-2.5 shrink-0 text-fs-ink3" />
        )}
        <span className="truncate font-fs-mono text-[11px] text-fs-ink2">{item.topic}</span>
        {item.hasContent && (
          <span className="shrink-0 font-fs-mono text-[10.5px] text-fs-ink3">+content</span>
        )}
      </button>
      {open && (
        <div className="space-y-2 border-t border-fs-ink/12 bg-fs-surface px-2 py-2">
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
    <div className="border border-fs-ink/20 bg-fs-card p-2">
      <div className="mb-1 flex items-center gap-2 font-fs-mono text-[10.5px] text-fs-ink3">
        <span>content</span>
        {contentType && <span>{contentType}</span>}
        {byteLength !== undefined && <span>{byteLength}B</span>}
        {visibleToClient === false && (
          <span
            className="border border-dashed border-fs-ink/45 px-1 text-[9.5px] uppercase tracking-[.08em] text-fs-ink3"
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
      {error && <div className="font-fs-mono text-[11px] text-fs-red">{error}</div>}
      {content !== null && isText && (
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words border-t border-fs-ink/12 bg-fs-surface p-2 font-fs-mono text-[11px] leading-[1.55] text-fs-ink2">
          {content}
        </pre>
      )}
      {content !== null && !isText && (
        <div className="text-[11px] italic text-fs-ink4">
          Binary content fetched ({byteLength ?? content.length}B). Use Download to save.
        </div>
      )}
    </div>
  );
}
