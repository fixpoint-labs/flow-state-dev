// FIX-2750.
/**
 * The opaque key a ledger partition goes to a browser as: on a board-insert
 * notice (`WireNotice.partition`) and in the partitions a view's answer read
 * (`ViewHearing.partitions`), so the client skips a row filed in a partition
 * its board never read without either side naming the partition.
 *
 * A partition is often a session id (a conversation's board), and the user
 * topic an insert goes out on spans the user's orgs, so the key must name
 * nothing: an HMAC-SHA256 under the router's push secret, over the tenant and
 * the partition. Why that key:
 *
 * - **Keyed, not a plain hash.** A plain digest of a session id can be
 *   matched by hashing guessed ids. Without the secret no one can make a key
 *   to compare, so a key reveals nothing and can't be reversed or matched.
 * - **The push secret, not a new one.** Push is the only way a notice reaches
 *   a browser, and its secret is already the one every process behind an
 *   address must share (a ticket minted on one is checked on another). The
 *   view route and the socket key with it at the moment a partition leaves the
 *   server, so the bus and the run carry the raw partition, and a process with
 *   no push (a worker) needs no secret to publish one.
 * - **Not minted per partition, as a lineage id is.** A minted key would need
 *   a stored record per partition and a read on every filing; a keyed digest
 *   is computed where it's needed, and every process holding the secret agrees.
 * - **The tenant in the input**, so one tenant's keys can't be compared with
 *   another's.
 *
 * A host with no push has no secret: its answers name no partition, and
 * every board notice wakes every board, as before partitions.
 */
import { createHmac } from "node:crypto";
import { assertSecret } from "../transports/auth/assert-secret";
import type { ViewHearing } from "@flow-state-dev/core";

/** Separates this digest from every other the secret signs (push tickets sign base64url JSON). */
const DOMAIN = "fsd-board-partition\u0000";

/** The key `partition` goes to a browser as, under `secret`, in `tenantId` (`""` for a single-tenant app). */
export function boardPartitionKey(secret: string, tenantId: string, partition: string): string {
  assertSecret(secret, "boardPartitionKey");
  return createHmac("sha256", secret).update(`${DOMAIN}${tenantId}\u0000${partition}`).digest("base64url");
}

/**
 * A view answer's hearings as a browser gets them: each raw partition keyed
 * under `secret`, or, with no secret (a host with no push), every partition
 * left out, so the hearing hears every board notice.
 */
export function keyHearingPartitions(hears: readonly ViewHearing[], secret: string | undefined, tenantId: string): ViewHearing[] {
  return hears.map((hearing) => {
    if (hearing.partitions === undefined) return hearing;
    const { partitions, ...rest } = hearing;
    return secret === undefined ? rest : { ...rest, partitions: partitions.map((partition) => boardPartitionKey(secret, tenantId, partition)) };
  });
}
