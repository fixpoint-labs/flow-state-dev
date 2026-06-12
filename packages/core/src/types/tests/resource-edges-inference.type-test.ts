import { z } from "zod";
import { defineResource } from "../resource";
import type { Edge } from "../../graph";

/**
 * Type test: the `edges` slot folds an `edges: Edge[]` field into a resource's
 * resolved StateType when declared, and does NOT inject the strongly-typed
 * field when `edges` is absent or `false`. Compile-time only — never executed.
 *
 * Note: resource StateType carries a JSON index signature, so a bare
 * "has key" check is not discriminating. The meaningful assertion is that the
 * `edges` field is narrowed to *exactly* `Edge[]` when (and only when) declared.
 */

type Expect<T extends true> = T;
/** Mutual assignability — robust to the JSON index-signature merge on StateType. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

// edges: true → StateType.edges is exactly Edge[].
const withEdges = defineResource({
  scope: "session",
  edges: true,
  stateSchema: z.object({ facts: z.array(z.string()) }),
});
type _WithEdgesIsEdgeArray = Expect<Same<typeof withEdges.StateType["edges"], Edge[]>>;

// edges object config → same exact-Edge[] injection.
const withEdgesConfig = defineResource({
  scope: "session",
  edges: { vocabulary: ["drives"], maxEdges: 10 },
  stateSchema: z.object({ facts: z.array(z.string()) }),
});
type _WithEdgesConfigIsEdgeArray = Expect<
  Same<typeof withEdgesConfig.StateType["edges"], Edge[]>
>;

// edges: false / unset → EdgesField resolves to `{}`, so the strongly-typed
// field is NOT injected. (StateType carries a JSON index signature, so this is
// asserted on the EdgesField helper-equivalent shape rather than on
// StateType["edges"], whose index-signature value type is non-discriminating.
// The runtime no-injection guarantee — schema and default left untouched — is
// covered by packages/core/test/resource.test.ts.)
const noEdges = defineResource({
  scope: "session",
  edges: false,
  stateSchema: z.object({ facts: z.array(z.string()) }),
});
void noEdges;

const unsetEdges = defineResource({
  scope: "session",
  stateSchema: z.object({ facts: z.array(z.string()) }),
});
void unsetEdges;

// the live ref/context exposes an optional `.edges` API.
withEdges.ContextType.edges?.all();

export const resourceEdgesInferenceTypeSmoke = true;
