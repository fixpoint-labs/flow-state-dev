import type { JumpToLatest } from "@flow-state-dev/react";

/**
 * The arrow at the foot of a scrolling feed while there is more below. New content never moves
 * the view ({@link JumpToLatest}), so this is how the reader gets to it. Put it last in the
 * scrolling element; it takes no height, so showing it never moves the feed either.
 */
export function JumpToLatestButton({ feed }: { feed: JumpToLatest }) {
  return (
    <div className="pointer-events-none sticky bottom-0 flex h-0 flex-none justify-center">
      {feed.atEnd ? null : (
        <button
          type="button"
          aria-label="Jump to latest"
          title="Jump to latest"
          onClick={feed.jump}
          className="pointer-events-auto flex size-8 translate-y-[calc(-100%-0.75rem)] items-center justify-center rounded-full border border-border bg-card text-sm shadow hover:bg-accent"
        >
          <span aria-hidden>↓</span>
        </button>
      )}
    </div>
  );
}
