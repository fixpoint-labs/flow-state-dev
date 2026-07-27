# UI Prototype

Generate **several radically different UI variants** on a single route, switchable from a floating bottom bar. The user flips between variants in the browser, picks one (or steals bits from each), then throws the rest away.

If the question is about logic / block / capability / state shape rather than what something looks like — wrong branch. Use [LOGIC.md](LOGIC.md).

## When this is the right shape

- "What should this devtool panel look like?"
- "Try a few layouts for the kitchen-sink dashboard."
- "How should this new item type render in the stream?"
- "What would the per-flow status indicator look like?"
- Any time the user would otherwise spend an afternoon picking between three mental mockups.

## Host app

Pick the host based on what's being prototyped:

- **Devtool changes** (`fsdev dev` UI, request inspector, item explorer) → `apps/devtool/src/_prototypes/<name>/`. The devtool app is the source of `@flow-state-dev/devtool`; variants here only land in production once they're deliberately promoted.
- **Kitchen-sink pages or item-type renderers** → `apps/kitchen-sink/components/_prototypes/<name>/` for components, or `apps/kitchen-sink/app/_prototypes/<name>/page.tsx` for whole pages.
- **`@flow-state-dev/react` renderer components** → host the variants in kitchen-sink against real flow output (use a kitchen-sink flow that emits the item type you're rendering). Don't prototype renderer changes in isolation — they're worth nothing without real items in the stream.
- **`@flow-state-dev/ui` registry components** → same as react renderers — host in kitchen-sink against real usage.

## Two sub-shapes — strongly prefer sub-shape A

A UI prototype is much easier to judge when it's **butting up against the rest of the app** — real header, real item stream, real density. A throwaway route on its own is a vacuum: every variant looks fine in isolation. Default to sub-shape A whenever there's a plausible existing page to host the variants. Only reach for sub-shape B if the prototype genuinely has no nearby home.

### Sub-shape A — adjustment to an existing page (preferred)

The route already exists. Variants render **on the same route**, gated by a `?variant=` URL search param. The existing data, flow execution, item stream, layout chrome — all stay. Only the rendered subtree being prototyped swaps. This is the default; pick it unless there's a specific reason not to.

If the prototype is for something that doesn't yet have a page but would naturally live inside one (a new section of the devtool, a new card on a kitchen-sink dashboard, a new step indicator on the request panel) — that's still sub-shape A. Mount the variants inside the host page.

### Sub-shape B — a new page (last resort)

Only use this when the thing being prototyped genuinely has no existing page to live inside — e.g. an entirely new top-level surface, or a flow that can't be embedded anywhere sensible.

Create a throwaway route under `apps/<host>/.../_prototypes/<name>/`, following whatever routing convention the app uses (Next.js App Router for kitchen-sink, Vite for devtool). Name it so it's obviously a prototype — `_prototypes/` already signals that, but keep the route segment recognisable.

Before committing to sub-shape B, sanity-check: is there really no existing page this could be embedded in? An empty route hides design problems that a populated one would expose.

In both sub-shapes the floating bottom bar is identical.

## Process

### 1. State the question and pick N

Default to **3 variants**. More than 5 stops being radically different and starts being noise — cap there.

Write down the plan in one line, in the prototype's location or a top-of-file comment:

> *"Three variants of the request inspector panel, switchable via `?variant=`, embedded in the existing `/devtool/inspector/[requestId]` route."*

Works whether the user is here to push back or not.

### 2. Generate radically different variants

Draft each variant. Hold each one to:

- The page's purpose and the data it has access to (real items from `useSession` / `useRequest`, real `block_output` provenance, real `state_change` events).
- The host app's component library and styling system (shadcn/Tailwind in kitchen-sink and devtool — match it).
- A clear exported component name: `VariantA`, `VariantB`, `VariantC`.

Variants must be **structurally different** — different layout, different information hierarchy, different primary affordance, not just different colours. Three slightly-tweaked card grids isn't a UI prototype, it's wallpaper. If two drafts come out too similar, redo one with explicit "do not use a card grid" guidance.

For renderer prototypes specifically: each variant should differ in *how it surfaces FSD's structure* — e.g. one shows items grouped by `provenance.blockName`, one shows them in a chronological timeline, one shows them in a tree mirroring the sequencer structure. Different mental models, not different paint.

### 3. Wire them together

Create a single switcher on the route. Pseudo-code (adapt to the host's framework):

```tsx
// apps/kitchen-sink/app/.../page.tsx (Next.js App Router)
"use client";
import { useSearchParams } from "next/navigation";

export default function Page() {
  const variant = useSearchParams().get("variant") ?? "A";
  const session = useSession();           // real data
  const items = session.items;

  return (
    <>
      {variant === "A" && <VariantA items={items} />}
      {variant === "B" && <VariantB items={items} />}
      {variant === "C" && <VariantC items={items} />}
      <PrototypeSwitcher variants={["A","B","C"]} current={variant} />
    </>
  );
}
```

For sub-shape A (existing page): keep all the existing data fetching / `useSession` / `useRequest` hooks above the switcher; only the rendered subtree changes per variant.

For sub-shape B (new page): the throwaway route mounts the same switcher.

### 4. Build the floating switcher

A small fixed-position bar at the bottom-centre of the screen:

- **Left arrow** — cycles to the previous variant (wraps around).
- **Variant label** — shows the key plus the variant's exported name when present. e.g. `B — Tree by sequencer structure`.
- **Right arrow** — cycles forward (wraps around).

Behaviour:

- Clicking an arrow updates the URL search param via the framework's router (`router.replace` in Next.js, the equivalent in Vite/React Router) so the variant is shareable and reload-stable.
- Keyboard: `←` and `→` arrow keys also cycle. Don't intercept arrow keys when an `<input>`, `<textarea>`, or `[contenteditable]` is focused.
- Visually distinct from the page (high-contrast pill, subtle shadow) so it's obviously not part of the design being evaluated.
- **Hidden in production builds.** Gate on `process.env.NODE_ENV !== "production"` for Next.js, `import.meta.env.DEV` for Vite. A stray prototype merge must not ship the bar to users running `fsdev dev` against the published devtool.

Put the switcher in a single shared component (e.g. `apps/<host>/components/_prototypes/_PrototypeSwitcher.tsx`) so both sub-shapes can reuse it. The leading underscore matches the prototype convention.

### 5. Hand it over

Surface the URL (and the `?variant=` keys). The user flips through whenever they get to it. The interesting feedback is usually **"I want the header from B with the sidebar from C"** — that's the actual design they want.

### 6. Capture the answer and clean up

Once a variant has won, write down which one and why:

- Commit message — minimum.
- `docs/architecture/<area>.md` if the choice encodes a contract decision (e.g. how `block_output` items get visually grouped).
- `docs/internal/out-of-scope/<name>.md` for the *rejected* variants if any of them represent a recurring temptation that should be documented as deliberately not-chosen (apply the three-way filter from `improve-codebase-architecture`).
- `NOTES.md` next to the prototype if running AFK and the user hasn't responded yet.

Then clean up:

- **Sub-shape A** — delete the losing variants and the switcher; fold the winner into the existing page.
- **Sub-shape B** — promote the winning variant to a real route; delete the `_prototypes/` route and the switcher.

Don't leave variant components or the switcher lying around. They rot fast and confuse the next reader.

## Anti-patterns

- **Variants that differ only in colour or copy.** That's a tweak, not a prototype. Real variants disagree about structure.
- **Sharing too much code between variants.** A shared `<Header>` is fine; a shared `<Layout>` defeats the point. Each variant must be free to throw out the layout.
- **Wiring variants to real mutations.** Read-only prototypes are fine. If a variant needs to dispatch an action, point it at a stub or seed state via `--seed-session` rather than letting it write to a real session. The question is "what should this look like," not "does the backend work."
- **Prototyping renderers against fake items.** If you hand-construct items inside the variant to demo it, the variant doesn't survive contact with real flow output (real provenance, real `block_output` cardinality, real interleaved item types). Always render against items produced by an actual `fsdev run` or a kitchen-sink flow execution.
- **Promoting the prototype directly to production.** The variant code was written under prototype constraints (no tests, minimal accessibility, fake error states). Rewrite it properly when you fold it in, run it through `tdd` for any added logic, and follow BP-007 for doc comments.
