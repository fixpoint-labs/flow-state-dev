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
 * "Hire another" runs the rail's flow's `hireSeat` action on a session of that
 * flow kept for hires (the host's `hireSessionId`), not on the conversation the
 * person is chatting in. Every session of the flow binds to the same one
 * organization, so the seat lands where every rail read looks. A hire is its
 * own request, followed to its end: inline when the server streams the answer
 * to the POST, or through the request's own stream when it queues the action
 * and answers 202.
 */
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  createClient,
  createSSEClient,
  createSSEClientFromResponse,
  type ExecuteActionResponse,
  type RequestSSECallbacks,
} from "@flow-state-dev/client";
import { SeatDetail, type PanelItemSource } from "@flow-state-dev/react";
import { HIRED_ROSTER_RESOURCE, splitSeatAddress } from "@flow-state-dev/workforce";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { KITCHEN_SINK_USER_ID } from "@/lib/kitchen-sink-principal";
import { SHELL_FLOW_KIND } from "@/lib/workforce-shell";

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
  /**
   * The session a hire runs on, a session of the rail's flow kept apart from
   * the conversations. Called when a hire starts; the host creates it once.
   */
  hireSessionId: () => Promise<string>;
  /** Called once a hire has succeeded. The host refreshes what lists seats. */
  onHired: () => void;
}

/** The roster topic of a seat hired into the whole organization; `undefined` for any other seat. */
function publicRosterTopic(orgId: string, address: string): string | undefined {
  if (address.startsWith(`${orgId}.~`)) return undefined;
  return splitSeatAddress(orgId, address);
}

export function SeatPane({ sessionId, orgId, kind, address, resourceClient, hireSessionId, onHired }: SeatPaneProps) {
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
        <HireForm hireSessionId={hireSessionId} kind={kind} onCancel={() => setIsHiring(false)} onHired={onHired} />
      ) : (
        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setIsHiring(true)}>
          Hire another
        </Button>
      )}
    </div>
  );
}

function HireForm({
  hireSessionId,
  kind,
  onCancel,
  onHired,
}: {
  hireSessionId: () => Promise<string>;
  kind: string;
  onCancel: () => void;
  onHired: () => void;
}) {
  const [seatId, setSeatId] = useState("");
  const [instructions, setInstructions] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The hire in flight, if any. Cancel and unmount stop waiting on it, and an
  // ending that arrives after that is ignored.
  const inFlight = useRef<Hire | null>(null);
  useEffect(() => () => inFlight.current?.cancel(), []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);
    const hire = startHire(hireSessionId, {
      seatId: seatId.trim(),
      flow: kind,
      ...(instructions.trim().length > 0 ? { instructions } : {}),
    });
    inFlight.current = hire;
    try {
      await hire.done;
      if (inFlight.current !== hire) return;
      inFlight.current = null;
      onHired();
    } catch (reason) {
      if (inFlight.current !== hire) return;
      inFlight.current = null;
      setError(reason instanceof Error ? reason.message : String(reason));
      setIsSubmitting(false);
    }
  };

  const cancel = () => {
    inFlight.current?.cancel();
    inFlight.current = null;
    onCancel();
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
        placeholder="What this seat is for (optional)"
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
        <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={cancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** A hire in flight: `done` settles when its request ends; `cancel` stops waiting on it. */
interface Hire {
  done: Promise<void>;
  cancel: () => void;
}

/** The request statuses that end a hire without it. `suspended` does not end a request. */
const FAILED = new Set(["failed", "incomplete", "interrupted", "aborted"]);

/**
 * Post the hire on the hire session and follow its request to the end.
 *
 * `done` rejects with the sequence's own refusal (an id already hired, a kind
 * this app does not carry) when the request fails, and with "The hire did not
 * complete." when its stream ends with no terminal status.
 */
function startHire(
  hireSessionId: () => Promise<string>,
  input: { seatId: string; flow: string; instructions?: string },
): Hire {
  const aborter = new AbortController();
  let stream: { close: () => void } | undefined;
  const cancel = () => {
    aborter.abort();
    stream?.close();
  };

  const done = (async () => {
    const client = createClient({
      flowKind: SHELL_FLOW_KIND,
      userId: KITCHEN_SINK_USER_ID,
      baseUrl: "",
      fetcher: (url, init) => fetch(url, { ...init, signal: aborter.signal }),
    });
    const response = await client.sendActionStream("hireSeat", input, { sessionId: await hireSessionId() });
    // A queued action answers 202 with the request's id instead of its stream.
    const queued = response.headers.get("content-type")?.includes("text/event-stream")
      ? undefined
      : ((await response.json()) as ExecuteActionResponse).request.id;

    await new Promise<void>((resolve, reject) => {
      let refusal: string | undefined;
      let ended = false;
      const end = (error?: Error) => {
        if (ended) return;
        ended = true;
        stream?.close();
        if (error === undefined) resolve();
        else reject(error);
      };
      const notCompleted = () => new Error(refusal ?? "The hire did not complete.");
      const callbacks: RequestSSECallbacks = {
        onItemAdded: (event) => {
          if (event.item.type === "error") refusal = event.item.message;
        },
        onRequestStatus: (event) => {
          if (event.status === "completed") end();
          else if (FAILED.has(event.status)) end(notCompleted());
        },
        onError: (error) => end(error),
        // A stream that ends without saying the request completed did not hire.
        onClose: () => end(notCompleted()),
      };
      stream =
        queued === undefined
          ? createSSEClientFromResponse({ response, ...callbacks })
          : createSSEClient({
              url: `/api/flows/${encodeURIComponent(SHELL_FLOW_KIND)}/requests/${encodeURIComponent(queued)}/stream`,
              baseUrl: "",
              ...callbacks,
            });
      if (ended) stream.close();
    });
  })();

  return { done, cancel };
}
