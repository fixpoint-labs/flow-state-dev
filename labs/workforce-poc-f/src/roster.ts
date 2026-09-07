/**
 * Lab-local keyed roster. Not a Team type. Not a Workforce export.
 *
 * Address-the-team is the intake seat's static DM. Helpers take a roster
 * key from day one — a singleton with no key is the cut Atlas names.
 */

export interface Seat {
  /** Roster row id. */
  seat: string;
  /** Worker flow kind. One flow per worker kind. */
  flowKind: string;
  /** Static DM session id. Opened via create_session. */
  sessionId: string;
}

export interface Roster {
  id: string;
  /** Seat that owns the inbox. The intake *is* a worker. */
  intakeSeat: string;
  seats: Record<string, Seat>;
}

export const INTAKE_KIND = "intake";
export const MEMBER_KIND = "member";

export const ENGINEERING: Roster = {
  id: "engineering",
  intakeSeat: "intake",
  seats: {
    intake: {
      seat: "intake",
      flowKind: INTAKE_KIND,
      sessionId: "talk-to-eng",
    },
    alice: { seat: "alice", flowKind: MEMBER_KIND, sessionId: "dm-alice" },
    bob: { seat: "bob", flowKind: MEMBER_KIND, sessionId: "dm-bob" },
    cara: { seat: "cara", flowKind: MEMBER_KIND, sessionId: "dm-cara" },
  },
};

export const MARKETING: Roster = {
  id: "marketing",
  intakeSeat: "intake",
  seats: {
    intake: {
      seat: "intake",
      flowKind: INTAKE_KIND,
      sessionId: "talk-to-mkt",
    },
  },
};

/** Keyed map. One roster in the map is fine. A singleton with no key is not. */
export const ROSTERS: Record<string, Roster> = {
  [ENGINEERING.id]: ENGINEERING,
  [MARKETING.id]: MARKETING,
};

/**
 * Proposed `openTeamInbox({ roster })` — lookup, then openDm of that seat.
 * Not a TeamFlow. Not a team address type. Address stays the session id.
 */
export function openTeamInbox(rosterId: string): Seat {
  const roster = ROSTERS[rosterId];
  if (roster === undefined) {
    throw new Error(`unknown roster "${rosterId}"`);
  }
  const seat = roster.seats[roster.intakeSeat];
  if (seat === undefined) {
    throw new Error(`roster "${rosterId}" has no intake seat`);
  }
  return seat;
}

export function memberSeats(roster: Roster): Seat[] {
  return Object.values(roster.seats).filter(
    (seat) => seat.seat !== roster.intakeSeat,
  );
}

/** First @name that names a member seat on this roster. */
export function parseAddress(body: string, roster: Roster): string | undefined {
  const match = /(?:^|\s)@([a-zA-Z0-9._-]+)/.exec(body);
  const name = match?.[1];
  if (name === undefined) return undefined;
  const seat = roster.seats[name];
  if (seat === undefined || seat.seat === roster.intakeSeat) return undefined;
  return name;
}

export type RouteKind = "claim" | "ordered" | "fan-out";

export function parseRoute(body: string, roster: Roster): RouteKind {
  if (/^\s*ordered(?:\s|:)/i.test(body)) return "ordered";
  if (parseAddress(body, roster) !== undefined) return "claim";
  return "fan-out";
}
