/**
 * TranscriptPane — left pane.
 *
 * Reads `session.items` and dispatches each item to the right sub-renderer:
 *   - `container` items with `component: "analyst-phase"` (and any later
 *     `phase-*` component) → `TxPhase` divider.
 *   - `tool_output` items → `TxTool` row, with FIXTURE/LIVE pill drawn
 *     from the output's `source` field.
 *   - `message` items from sub-agents or primary agents → `TxSpeak` row.
 *   - `component` items with `component: "thesis-card"` from an emitting agent
 *     in `{researchManager, trader, portfolioManager, thesisValidator}`
 *     (Phase 2+) → `TxStruct` collapsible. Phase 1 analyst structured outputs
 *     are intentionally suppressed from the transcript per the design — they
 *     surface only in the right pane.
 *
 * The item → row projection itself is pure and lives in `transcript-rows.ts`,
 * shared with `ThesesPane` so the memo header's jump control and this pane
 * agree on which agents actually have an event (FIX-1062).
 *
 * Auto-scrolls to the bottom on new items if the user is near the bottom.
 * A `jumpTo` request from a memo header scrolls to that agent's first row
 * instead, and stops the auto-follow so a live run doesn't yank it back.
 */
"use client";

import { useEffect, useMemo, useRef, type ReactElement } from "react";
import type { SessionView } from "@flow-state-dev/react";
import type { OutputItem } from "@flow-state-dev/core/items";
import { TxPhase } from "./tx-phase";
import { TxTool } from "./tx-tool";
import { TxSpeak } from "./tx-speak";
import { TxStruct } from "./tx-struct";
import {
  buildTranscriptRows,
  TX_AGENT_ANCHOR_ATTR,
  type TranscriptRow,
} from "./transcript-rows";
import type { AgentName } from "@/flows/analysis/registry";
import { cn } from "@/lib/utils";

/** A request to scroll the transcript to one agent's originating event.
 *  `nonce` makes a repeat click on the same memo a new request, so the jump
 *  re-fires instead of being deduped away by referential equality. */
export type TranscriptJump = {
  agent: AgentName;
  nonce: number;
};

type Props = {
  session: SessionView;
  jumpTo?: TranscriptJump | null;
  /** Called once this pane has acted on `jumpTo`, so the owner can clear the
   *  request. A jump is an EVENT: left standing, it replays on every remount
   *  (a mobile tab switch away and back, a desktop desk→reports→desk trip),
   *  stealing scroll and focus with no click behind it. */
  onJumpHandled?: () => void;
};

export function TranscriptPane({
  session,
  jumpTo,
  onJumpHandled,
}: Props): ReactElement {
  const items = session.items as OutputItem[];
  const sessionId = session.sessionId;
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);

  // Track whether the user is near the bottom; only auto-scroll while sticky.
  // This is a side effect on a DOM-derived value (scroll position) — `useEffect`
  // is the right tool, not `useMemo`.
  useEffect(() => {
    const el = scrollRef.current;
    if (el === null) return;
    const handleScroll = () => {
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      stickToBottomRef.current = distanceFromBottom < 80;
    };
    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
  }, []);

  // A new session gets a fresh transcript, so it gets fresh auto-follow. This
  // pane stays mounted across a session switch on desktop, so without the reset
  // a jump taken in the previous report would leave the NEXT live run refusing
  // to follow its own output until the user scrolled to the bottom by hand.
  // Declared before the jump effect so a same-commit jump still wins.
  useEffect(() => {
    stickToBottomRef.current = true;
  }, [sessionId]);

  // Auto-scroll on new items if the user has not scrolled away.
  useEffect(() => {
    const el = scrollRef.current;
    if (el === null) return;
    if (stickToBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [items.length]);

  const rows = useMemo(() => buildTranscriptRows(items), [items]);

  // Cross-pane jump (FIX-1062). Runs after commit, so on mobile — where this
  // pane mounts only once the tab switches — the DOM is already there. A
  // missing anchor is a silent no-op: the header only offers the control when
  // `agentsWithTranscriptRows` says there is one, so this is belt-and-braces
  // for the mid-stream case where the memo publishes before its row lands.
  // The request is consumed whether or not a target was found: a jump that
  // cannot land is spent, not queued. Both shells render (CSS picks one), so
  // both panes act on the same request in one commit before the clear lands —
  // the hidden one's scroll and focus are no-ops on a `display: none` subtree.
  useEffect(() => {
    if (jumpTo === null || jumpTo === undefined) return;
    const container = scrollRef.current;
    if (container === null) return;
    const target = container.querySelector<HTMLElement>(
      `[${TX_AGENT_ANCHOR_ATTR}="${jumpTo.agent}"]`,
    );
    if (target !== null) {
      // The user navigated deliberately; a streaming run must not drag them back.
      stickToBottomRef.current = false;
      target.scrollIntoView({ block: "start", behavior: "smooth" });
      // Move the reading position too, so the jump means something to a screen
      // reader / keyboard user and not only to a sighted one.
      target.focus({ preventScroll: true });
    }
    onJumpHandled?.();
  }, [jumpTo, onJumpHandled]);

  return (
    <section
      className={cn(
        "flex flex-col overflow-hidden",
        "border-l border-r border-[color:var(--c-border)] bg-[color:var(--c-bg)]",
      )}
      aria-label="Transcript"
    >
      <div className="border-b border-[color:var(--c-border)] px-4 py-2.5">
        <h2 className="font-mono text-[10.5px] uppercase tracking-wider text-[color:var(--c-fg-faint)]">
          transcript
        </h2>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto py-2">
        {rows.length === 0 ? (
          <p className="px-6 pt-8 text-center text-[12px] leading-relaxed text-[color:var(--c-fg-faint)]">
            Run an analysis to populate the transcript. Phase dividers, tool
            calls, and analyst speak rows will stream in live.
          </p>
        ) : (
          rows.map((row) =>
            row.isAgentAnchor && row.agent !== null ? (
              <div
                key={row.key}
                {...{ [TX_AGENT_ANCHOR_ATTR]: row.agent }}
                tabIndex={-1}
                className="outline-none"
              >
                {renderRow(row)}
              </div>
            ) : (
              <div key={row.key}>{renderRow(row)}</div>
            ),
          )
        )}
      </div>
    </section>
  );
}

function renderRow(row: TranscriptRow): ReactElement {
  switch (row.kind) {
    case "phase":
      return <TxPhase label={row.label} />;
    case "tool":
      return <TxTool {...row.props} />;
    case "speak":
      return <TxSpeak {...row.props} />;
    case "struct":
      return <TxStruct {...row.props} />;
  }
}
