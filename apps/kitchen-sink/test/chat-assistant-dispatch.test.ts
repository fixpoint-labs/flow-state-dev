/**
 * Regression for the S9 registry-drift revert (FIX-1477 PR #2019, Cursor
 * Bugbot finding): `chat-assistant.tsx` registers `routedSpecialists` in the
 * `component` renderer map, but the `routedSpecialists` pattern sequencer
 * (`packages/patterns/src/routedSpecialists/index.ts`) declares
 * `container: { component: "routedSpecialists" }` — it emits a top-level
 * `container` item, not a `component` item (see `docs/architecture/items.md`
 * → "container"). A renderer registered under the wrong map never resolves
 * (`resolveRenderer` looks up `container[key]` for a `container` item), so
 * the item falls through to the raw-JSON dev fallback instead of rendering.
 *
 * `RoutedSpecialists` itself (`components/flow-state/routed-specialists.tsx`)
 * already declares `{ item: ContainerItem }` and reads its data via
 * `useContainerItems` — the same shape `EventedActors` and `Debate` use for
 * their own container-emitting patterns (`packages/patterns/src/eventActors`,
 * `packages/patterns/src/debate`), which stayed correctly registered under
 * `container` through S9. `routedSpecialists` is the one outlier.
 *
 * This asserts on the real, exported `chatAssistantRenderers` registry
 * object at the exact keys `resolveRenderer` reads at render time
 * (`packages/react/src/registry/block-renderers.ts`: a `container` item
 * resolves via `renderers.container?.[item.component]`, a `component` item
 * via `renderers.component?.[item.component]`) — not a synthetic registry,
 * and not a type-level assertion.
 */
import { describe, expect, it } from "vitest";
import { chatAssistantRenderers } from "../components/flow-state/chat-assistant";
import { RoutedSpecialists } from "../components/flow-state/routed-specialists";

describe("chat-assistant renderer dispatch (FIX-1477 S9 Bugbot fix)", () => {
  it("resolves routedSpecialists as a container renderer, matching the pattern's own container config", () => {
    // The routedSpecialists sequencer emits `container: { component: "routedSpecialists" }`
    // (packages/patterns/src/routedSpecialists/index.ts) — a `container`-typed item, so
    // dispatch must find it under `renderers.container`, not `renderers.component`.
    expect(chatAssistantRenderers.container?.routedSpecialists).toBe(RoutedSpecialists);
  });

  it("does not leave routedSpecialists registered under the component map (that item type never arrives)", () => {
    expect(chatAssistantRenderers.component?.routedSpecialists).toBeUndefined();
  });
});
