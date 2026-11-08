/**
 * The one schema of the `routedFrom` session field (`ROUTED_FROM_STATE_KEY`).
 *
 * A worker flow's session declares it, and so does the `work` entry's block
 * that writes it. `defineFlow` merges the two, and a constrained string can
 * only be merged with itself, so both declare this object.
 */
import { z } from "zod";

/** `routedFrom`: the conversation whose routed task this session works, when one does. */
export const routedFromStateSchema = z.string().min(1).optional();
