/**
 * Whether the Lab lets Shift Manager in: the organization it acts in for this
 * user, from workforce's `organization()`, the roster flow's identity read
 * under its sign-in. Shift Manager never draws a Lab under an unknown
 * organization (ER-4), so every other read waits behind this one.
 *
 * - a 401 or 403, a Lab that serves no roster flow, or an identity read that
 *   names no organization is the refusal;
 * - anything else (a 5xx, the network) is the Lab not being reached, which
 *   Retry reads again.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ROSTER_FLOW } from "@flow-state-dev/workforce/browser";
import { useLab } from "./lab-data";
import { describeFailure, type Failure } from "./failure";
import { useWorkforce } from "./workforce";

/** Where the gate stands: reading, in under an organization, refused, or the Lab not reached. */
export type Gate = { state: "reading" } | { state: "in"; orgId: string } | { state: "refused"; failure: Failure } | { state: "unreachable"; failure: Failure };

/**
 * What the Lab answers a call on a flow it doesn't serve, for the roster
 * flow's identity read: the engine's unknown-flow message. Matched exactly, so
 * any other 404 is the Lab answering, not "no roster".
 */
const NO_ROSTER_FLOW = `Unknown flow "${ROSTER_FLOW}"`;

/** Why a Lab is refused when it says nothing about which organization the user is in. */
function noOrganization(userId: string, why = "it serves no roster flow to ask it under"): string {
  return `The Lab names no organization for ${userId}: ${why}. Shift Manager asks the roster flow's identity read which organization the Lab puts them in; its README lists what a Lab serves.`;
}

/** The gate for `userId`, from one organization read's outcome. */
export function gateOf(userId: string, read: { orgId: unknown } | { error: unknown }): Exclude<Gate, { state: "reading" }> {
  if ("error" in read) {
    const failure = describeFailure(read.error);
    if (failure.httpStatus === 404 && failure.message === NO_ROSTER_FLOW) return { state: "refused", failure: { message: noOrganization(userId) } };
    return failure.httpStatus === 401 || failure.httpStatus === 403 ? { state: "refused", failure } : { state: "unreachable", failure };
  }
  if (typeof read.orgId !== "string" || read.orgId.length === 0) return { state: "refused", failure: { message: noOrganization(userId, "its identity read names none") } };
  return { state: "in", orgId: read.orgId };
}

/**
 * The gate, read once per connection; `retry` reads it again after a refusal
 * or an unreachable Lab. The workforce client keeps a good answer and forgets
 * a failed one, so a retry asks the Lab anew.
 */
export function useGate(): { gate: Gate; retry: () => void } {
  const { client } = useLab();
  // The connection decides the read; its workforce client is the one built over it.
  const current = useWorkforce();
  const workforce = useRef(current);
  workforce.current = current;
  const [read, setRead] = useState<{ client: unknown; gate: Gate }>({ client, gate: { state: "reading" } });
  const [tries, setTries] = useState(0);
  useEffect(() => {
    let closed = false;
    workforce.current.organization().then(
      (orgId) => !closed && setRead({ client, gate: gateOf(client.userId, { orgId }) }),
      (error: unknown) => !closed && setRead({ client, gate: gateOf(client.userId, { error }) }),
    );
    return () => {
      closed = true;
    };
  }, [client, tries]);
  const retry = useCallback(() => setTries((n) => n + 1), []);
  // A read for another connection is never this one's answer.
  return { gate: read.client === client ? read.gate : { state: "reading" }, retry };
}
