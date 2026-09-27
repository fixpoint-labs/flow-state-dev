"use client";

/**
 * One seat, opened in the rail: its kind, what it handles, and its instructions
 * when they are published.
 *
 * The detail is the package's `SeatDetail`. This decides only which roster row,
 * if any, a seat's instructions are read from. A seat has a public row only when
 * it was hired into the whole organization, at `<org>.<seatId>`, and the row is
 * keyed by that `seatId`. A seat declared in a worker file has no row. A seat a
 * user hired for themselves, at `<org>.~<user>.<seatId>`, has a row the rail
 * may not read, and its `seatId` can equal an org-visible seat's; splitting its
 * address would open the other seat's row. Both are handed over with no topic,
 * so the detail says their instructions are not published and reads nothing.
 *
 * What a declared seat handles is its `WORKER.md`'s `description:`, which the
 * shell carries by address (`SEAT_DESCRIPTIONS`). A seat with none draws none.
 */
import { SeatDetail, type PanelItemSource } from "@flow-state-dev/react";
import { HIRED_ROSTER_RESOURCE, splitSeatAddress } from "@flow-state-dev/workforce/browser";

import { SEAT_DESCRIPTIONS } from "@/lib/workforce-shell";

export interface SeatPaneProps {
  /** The rail's session: the instructions are read through it. */
  sessionId: string;
  /** The organization that session is bound to, from its own record. */
  orgId: string;
  /** The seat's kind, from the navigator row. */
  kind: string;
  /** The seat's flow address, from the navigator row. */
  address: string;
  /** The host's resource client, so the read carries the host's transport. Stable. */
  resourceClient: PanelItemSource;
}

/** The roster topic of a seat hired into the whole organization; `undefined` for any other seat. */
function publicRosterTopic(orgId: string, address: string): string | undefined {
  if (address.startsWith(`${orgId}.~`)) return undefined;
  return splitSeatAddress(orgId, address);
}

export function SeatPane({ sessionId, orgId, kind, address, resourceClient }: SeatPaneProps) {
  const description = (SEAT_DESCRIPTIONS as Record<string, string | undefined>)[address];
  return (
    <div className="space-y-2 pb-1 text-xs" data-testid="seat-pane">
      {description !== undefined && (
        <p className="text-muted-foreground" data-testid="seat-description">
          {description}
        </p>
      )}
      <SeatDetail
        sessionId={sessionId}
        kind={kind}
        seatId={publicRosterTopic(orgId, address)}
        collectionRef={HIRED_ROSTER_RESOURCE}
        resourceClient={resourceClient}
      />
    </div>
  );
}
