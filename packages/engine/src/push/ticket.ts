/**
 * The push ticket (FIX-2428 D1): a short-lived, signed statement that the
 * mint checked a caller and granted it some topics.
 *
 * The mint signs one after it has run each topic through its scope's route
 * check on the caller's own request; the socket accepts topics only from a
 * ticket whose signature, expiry and user all check out. It is stateless: a
 * process that shares the secret can check a ticket another one signed.
 *
 * Format: `<payload>.<signature>`, both base64url. The payload is the JSON
 * claims; the signature is HMAC-SHA256 over the encoded payload.
 */
import { createHmac } from "node:crypto";
import type { WireTopic } from "@flow-state-dev/core";
import type { BusTopic } from "../bus/types";
import { constantTimeStringEqual } from "../transports/auth/constant-time";

/** How long a minted ticket is good for. */
export const PUSH_TICKET_TTL_MS = 30_000;

/** One granted topic: as the client named it, and as the bus names it. */
export type GrantedTopic = { wire: WireTopic; bus: BusTopic };

/** What a ticket says. */
export type PushTicketClaims = {
  /** The user the mint checked; the socket's path must name the same one. */
  sub: string;
  /** Expiry, epoch ms. */
  exp: number;
  topics: GrantedTopic[];
};

/** Why a ticket was refused, for the log line. */
export type PushTicketRefusal = "malformed" | "signature" | "expired" | "user";

const VERSION = 1;

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

/** Sign `claims` with `secret`. */
export function signPushTicket(claims: PushTicketClaims, secret: string): string {
  const payload = Buffer.from(JSON.stringify({ v: VERSION, ...claims }), "utf8").toString("base64url");
  return `${payload}.${sign(payload, secret)}`;
}

/**
 * Check a ticket: its signature under `secret`, that it has not expired at
 * `now`, and that it was minted for `userId`. Returns its claims, or why it
 * was refused.
 */
export function verifyPushTicket(
  ticket: unknown,
  secret: string,
  userId: string,
  now: number = Date.now()
): { ok: true; claims: PushTicketClaims } | { ok: false; reason: PushTicketRefusal } {
  if (typeof ticket !== "string") return { ok: false, reason: "malformed" };
  const dot = ticket.indexOf(".");
  if (dot <= 0 || dot !== ticket.lastIndexOf(".")) return { ok: false, reason: "malformed" };
  const payload = ticket.slice(0, dot);
  if (!constantTimeStringEqual(ticket.slice(dot + 1), sign(payload, secret))) return { ok: false, reason: "signature" };
  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!isClaims(claims)) return { ok: false, reason: "malformed" };
  if (claims.exp <= now) return { ok: false, reason: "expired" };
  if (claims.sub !== userId) return { ok: false, reason: "user" };
  return { ok: true, claims: { sub: claims.sub, exp: claims.exp, topics: claims.topics } };
}

function isClaims(value: unknown): value is PushTicketClaims & { v: number } {
  if (typeof value !== "object" || value === null) return false;
  const claims = value as Record<string, unknown>;
  return (
    claims.v === VERSION &&
    typeof claims.sub === "string" &&
    typeof claims.exp === "number" &&
    Array.isArray(claims.topics)
  );
}
