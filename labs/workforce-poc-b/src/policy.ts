/**
 * Layer-2 reply-storm policy. Pure convention — no new L1 lock type.
 *
 * A wake is not a turn. Default quiet unless addressed. One claim per post
 * is enforced by `TaskCollectionRef.claim`, not by this function.
 */

/** Who the post names, if anyone. */
export type Address = string | undefined;

export type PolicyDecision =
  | { action: "quiet"; reason: "unaddressed" | "not-addressed-to-me" }
  | { action: "claim"; reason: "addressed-to-me" | "open-claim" };

/**
 * First `@name` token in a post body. Parsing is convention: the post action
 * stamps `addressedTo` onto the task input before anyone wakes.
 */
export function parseAddress(body: string): string | undefined {
  const match = /(?:^|\s)@([a-zA-Z0-9._-]+)/.exec(body);
  return match?.[1];
}

/**
 * Decide whether this subscriber may attempt a claim. Does not claim.
 *
 * - Addressed to me → attempt the one claim for this post.
 * - Addressed to someone else → stay quiet.
 * - Unaddressed + `needsReply` → attempt the one claim (open broadcast).
 * - Unaddressed, no `needsReply` → stay quiet (default).
 */
export function decideReply(args: {
  subscriberId: string;
  addressedTo: Address;
  needsReply?: boolean;
}): PolicyDecision {
  const addressedTo = args.addressedTo;
  if (addressedTo !== undefined) {
    return addressedTo === args.subscriberId
      ? { action: "claim", reason: "addressed-to-me" }
      : { action: "quiet", reason: "not-addressed-to-me" };
  }
  if (args.needsReply === true) {
    return { action: "claim", reason: "open-claim" };
  }
  return { action: "quiet", reason: "unaddressed" };
}
