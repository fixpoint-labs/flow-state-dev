/**
 * The relay coordinate a delivery carries, and the **one** reader that is
 * allowed to trust it (FIX-1230).
 *
 * A relay delivery rides `metadata.relay`, exactly as a webhook rides
 * `metadata.webhook` and a chat event rides `metadata.chat`. And exactly like
 * those, **the coordinate is not authority**: `metadata` is the caller's own
 * free-form bag, spread verbatim into the dispatch envelope by the HTTP action
 * route, so a public action invoked over HTTP with
 * `{ metadata: { relay: { … } } }` presents as a relay delivery to anything that
 * reads the bag directly.
 *
 * What makes it trustworthy is the trusted **`source`**, which the transport
 * seam stamps and no caller can set: the HTTP action route hard-codes
 * `source: "http"`, and nothing anywhere derives `source` from a request body,
 * query or params. So every consumer goes through {@link readRelayStamp}, which
 * checks the source first and hands back `undefined` otherwise. One reader
 * rather than a check per consumer, for the reason the arbiter already gives
 * about `metadata.webhook`: a rule applied at three call sites is a rule the
 * fourth call site skips.
 *
 * That has already been the shape of a real defect on this feature: the
 * `metadata`-is-the-caller's-bag argument was made correctly for the door and
 * then not applied to the reply one section later. A principle written down is
 * not the same as a principle applied, which is why it is a function here rather
 * than a convention.
 */
import type { RelayDoorForm } from "./relay-door";
import { RELAY_SOURCE } from "./transport-sources";

/**
 * The coordinate the relay send seam stamps onto a delivery.
 *
 * Everything here is **server-assembled**: the sender's identity comes off the
 * running request's request-host closure, the door form off the preflight, and
 * the recipient incarnation off the record the preflight read. None of it is
 * copied from the sender's message except `kind`, which is a locator rather than
 * an authority (§ the deliberate BP-031 exception — the recipient *address* and
 * the message *kind* are what a caller is supposed to choose).
 */
export type RelayDispatchStamp = {
  /** The message kind the sender addressed — the `relay.on` key, or an action name. */
  readonly kind: string;
  /**
   * Which door the send resolved. The worker routes on this rather than
   * recomputing, because it has neither session kind at the moment it routes.
   */
  readonly door: RelayDoorForm;
  /** The sending session's bare id. */
  readonly from: string;
  /**
   * The sending session's lineage at send time.
   *
   * Half of the persisted authorization relation a later status lookup reads.
   * Persisted rather than recomputed because by then the sending session may be
   * gone entirely — and a session id is recyclable, so authorizing on the id
   * alone would let a replacement conversation read the deliveries of the one
   * before it.
   */
  readonly fromLineageId: string;
  /**
   * The recipient incarnation the preflight approved.
   *
   * Acceptance and execution are not the same moment — a delivery can be
   * accepted, sit behind a held concurrency key, and run later, in a plain
   * single-process deployment. A recipient deleted and recreated under the same
   * id in that window gets a new lineage, and nothing downstream re-checks. This
   * is what the incarnation guard compares against.
   */
  readonly recipientLineageId: string;
  /**
   * Minted per send when the sender is waiting for a reply. Absent for
   * fire-and-forget, which is the only mode that ships today.
   */
  readonly correlationId?: string;
};

/** The shape a dispatch envelope's `metadata` has when it carries a relay stamp. */
type RelayDispatchMetadata = { relay?: unknown };

/**
 * Read the relay coordinate off a dispatch, **only** when the runtime stamped
 * the relay source.
 *
 * Returns `undefined` for every other source, including a caller who wrote a
 * perfectly-shaped `metadata.relay` into an HTTP request body. A mismatching
 * forged value would only refuse the forger's own request; the danger this
 * closes is a forger supplying the *correct* value and having it believed.
 *
 * @param source The dispatch's transport source, as stamped by the seam.
 * @param metadata The dispatch's metadata bag.
 */
export function readRelayStamp(
  source: string | undefined,
  metadata: unknown
): RelayDispatchStamp | undefined {
  if (source !== RELAY_SOURCE) return undefined;
  const relay = (metadata as RelayDispatchMetadata | undefined)?.relay;
  if (relay === null || typeof relay !== "object") return undefined;

  const candidate = relay as Partial<RelayDispatchStamp>;
  // Shape-checked rather than cast. This bag has survived a store round-trip and
  // may have been written by an older release, so a missing field is a real
  // state (BP-030) — and every consumer of a stamp treats "no stamp" as "not a
  // relay delivery", which is the safe reading in all three of them.
  if (
    typeof candidate.kind !== "string" ||
    (candidate.door !== "declared" && candidate.door !== "action") ||
    typeof candidate.from !== "string" ||
    typeof candidate.fromLineageId !== "string" ||
    typeof candidate.recipientLineageId !== "string"
  ) {
    return undefined;
  }

  return candidate as RelayDispatchStamp;
}
