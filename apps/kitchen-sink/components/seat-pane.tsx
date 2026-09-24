"use client";

/**
 * One seat, opened in the rail: its kind and instructions, and "Hire another".
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
 * "Hire another" runs the rail's flow's `hireSeat` action on the rail's own
 * session, so the seat lands in the organization that session is bound to,
 * the one every rail read uses. It is posted on its own request rather than
 * through the assistant's `useSession`, whose `sendAction` would close the
 * assistant's live stream; the POST's own event stream says how the hire ended.
 */
import { useState, type FormEvent } from "react";
import { createClient, createSSEClientFromResponse } from "@flow-state-dev/client";
import { SeatDetail, type PanelItemSource } from "@flow-state-dev/react";
import { HIRED_ROSTER_RESOURCE, splitSeatAddress } from "@flow-state-dev/workforce";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { KITCHEN_SINK_USER_ID } from "@/lib/kitchen-sink-principal";
import { SHELL_FLOW_KIND } from "@/lib/workforce-shell";

export interface SeatPaneProps {
  /** The rail's session: every read and the hire go through it. */
  sessionId: string;
  /** The organization that session is bound to, from its own record. */
  orgId: string;
  /** The seat's kind, from the navigator row. */
  kind: string;
  /** The seat's flow address, from the navigator row. */
  address: string;
  /** The host's resource client, so the read carries the host's transport. Stable. */
  resourceClient: PanelItemSource;
  /** Called once a hire has succeeded. The host refreshes what lists seats. */
  onHired: () => void;
}

/** The roster topic of a seat hired into the whole organization; `undefined` for any other seat. */
function publicRosterTopic(orgId: string, address: string): string | undefined {
  if (address.startsWith(`${orgId}.~`)) return undefined;
  return splitSeatAddress(orgId, address);
}

export function SeatPane({ sessionId, orgId, kind, address, resourceClient, onHired }: SeatPaneProps) {
  const [isHiring, setIsHiring] = useState(false);
  return (
    <div className="space-y-2 pb-1 text-xs" data-testid="seat-pane">
      <SeatDetail
        sessionId={sessionId}
        kind={kind}
        seatId={publicRosterTopic(orgId, address)}
        collectionRef={HIRED_ROSTER_RESOURCE}
        resourceClient={resourceClient}
      />
      {isHiring ? (
        <HireForm sessionId={sessionId} kind={kind} onCancel={() => setIsHiring(false)} onHired={onHired} />
      ) : (
        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setIsHiring(true)}>
          Hire another
        </Button>
      )}
    </div>
  );
}

function HireForm({
  sessionId,
  kind,
  onCancel,
  onHired,
}: {
  sessionId: string;
  kind: string;
  onCancel: () => void;
  onHired: () => void;
}) {
  const [seatId, setSeatId] = useState("");
  const [instructions, setInstructions] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);
    try {
      await hireSeat(sessionId, {
        seatId: seatId.trim(),
        flow: kind,
        ...(instructions.trim().length > 0 ? { instructions } : {}),
      });
      onHired();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setIsSubmitting(false);
    }
  };

  return (
    <form className="space-y-1.5" onSubmit={(event) => void submit(event)} aria-label={`Hire another ${kind}`}>
      <Input
        aria-label="Seat id"
        placeholder="support.pat"
        className="h-7 text-xs"
        value={seatId}
        onChange={(event) => setSeatId(event.target.value)}
        required
      />
      <Textarea
        aria-label="Instructions"
        placeholder="What this seat is for"
        className="min-h-16 text-xs"
        value={instructions}
        onChange={(event) => setInstructions(event.target.value)}
      />
      {error !== null && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      <div className="flex gap-1">
        <Button type="submit" size="sm" className="h-7 text-xs" disabled={isSubmitting || seatId.trim().length === 0}>
          {isSubmitting ? "Hiring…" : "Hire"}
        </Button>
        <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={onCancel} disabled={isSubmitting}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/**
 * Post the hire and wait for its request to end.
 *
 * @throws With the sequence's own refusal (an id already hired, a kind this app
 *   does not carry) when the request fails.
 */
async function hireSeat(
  sessionId: string,
  input: { seatId: string; flow: string; instructions?: string },
): Promise<void> {
  const client = createClient({ flowKind: SHELL_FLOW_KIND, userId: KITCHEN_SINK_USER_ID, baseUrl: "" });
  const response = await client.sendActionStream("hireSeat", input, { sessionId });
  await new Promise<void>((resolve, reject) => {
    let refusal: string | undefined;
    const fail = () => reject(new Error(refusal ?? "The hire did not complete."));
    createSSEClientFromResponse({
      response,
      onItemAdded: (event) => {
        if (event.item.type === "error") refusal = event.item.message;
      },
      onRequestStatus: (event) => {
        if (event.status === "completed") resolve();
        else if (event.status !== "in_progress") fail();
      },
      onError: reject,
      // A stream that ends without saying the request completed did not hire.
      onClose: fail,
    });
  });
}
