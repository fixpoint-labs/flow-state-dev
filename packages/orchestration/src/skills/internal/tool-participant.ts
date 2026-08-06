/**
 * Shared resolution + validation for `tool:` board participants (FIX-925).
 *
 * A `tool:` entry on a skill's `agents:` map names a `ToolCatalog` key that the
 * delegation board dispatches directly — no model turn. Two call sites resolve
 * that key and must agree on what counts as a legal one: `library.ts` at
 * build time for a statically-active skill, and `materializeWorker` at
 * materialization for a runtime activation. The judgement lives here once; each
 * caller keeps only its own error framing.
 *
 * Both checks are **loud on failure, always** — unlike an agent's `tools:`
 * array (additive, warn-and-skip), a participant that silently vanished would
 * leave the coordinator assigning work to a node the board can't route.
 */
import type { BlockDefinition, ToolCatalog } from "@flow-state-dev/core";

/**
 * Resolve a `tool:` key against the catalog, or throw.
 *
 * BP-031: the catalog is a plain object, so an inherited `Object.prototype`
 * member (`constructor`, `toString`, …) is truthy and would pass a falsity-only
 * guard. Own-property check, matching `resolveTools`.
 */
export function resolveToolParticipant(
  agentKey: string,
  toolKey: string,
  catalog: ToolCatalog,
  where: string,
): BlockDefinition<never, never> {
  if (!Object.hasOwn(catalog, toolKey)) {
    const known = Object.keys(catalog).join(", ") || "(none)";
    throw new Error(
      `${where} participant "${agentKey}" declares tool "${toolKey}", which is not in ` +
        `the catalog. Available tools: ${known}.`,
    );
  }
  return catalog[toolKey] as unknown as BlockDefinition<never, never>;
}

/**
 * Reject a `tool:` participant that would take a model turn (Decision 7).
 *
 * `ToolCatalog` holds arbitrary `BlockDefinition`s, so a catalog key could point
 * at a `generator` — which would make this participant kind's whole promise
 * ("deterministic, no LLM turn") false. The check runs at the block's
 * **directly-detectable surface**, and deliberately no further:
 *
 *   - `kind === "generator"` — rejected outright.
 *   - a `router` — rejected when its `config.routes` (which core *does* expose)
 *     contains a generator branch.
 * Nothing deeper is walked. A generator nested inside a `sequencer`'s steps, or
 * behind a route of a route, is not detected: `createSequencer` closes its steps
 * into the block's `execute` and exposes no enumeration API, so a deep guarantee
 * would need an unscoped public-traversal API to be earned. A catalog block
 * registered as a `tool:` participant is the author's to keep model-free below
 * this surface; FIX-925 makes no claim there.
 */
export function assertDeterministicTool(
  agentKey: string,
  toolKey: string,
  block: BlockDefinition<never, never>,
  where: string,
): void {
  const kind = (block as { kind?: string }).kind;
  if (kind === "generator") {
    throw new Error(
      `${where} participant "${agentKey}" declares tool "${toolKey}", which is a ` +
        `generator. A tool participant runs deterministically with no model turn — ` +
        `a node that needs one is an agent (use \`prompt\`/\`prompt-ref\`/\`agent-ref\`).`,
    );
  }
  if (kind !== "router") return;
  const routes = (block as { config?: { routes?: Array<{ kind?: string; config?: { name?: string } }> } })
    .config?.routes;
  const modelRoute = routes?.find((route) => route.kind === "generator");
  if (modelRoute) {
    throw new Error(
      `${where} participant "${agentKey}" declares tool "${toolKey}", a router with a ` +
        `generator branch ("${modelRoute.config?.name ?? "unnamed"}"). A tool participant ` +
        `runs deterministically with no model turn — a node that needs one is an agent ` +
        `(use \`prompt\`/\`prompt-ref\`/\`agent-ref\`).`,
    );
  }
}
