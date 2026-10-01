# Design system

The look of Shift Manager, the Labs' app: a light (day) and a dark (night) theme over the tokens FSD's components
already read. It holds values only. There are no components here; the app gets those from
`@flow-state-dev/react` and the `@flow-state-dev/ui` registry, unedited.

```css
@import "@flow-state-dev/design-system/shift-manager.css";
```

Import it after the stylesheet that holds the registry's `tokens` defaults. The light theme
applies by default. Put `class="dark"` on an ancestor for the dark one. The same stylesheet points
the navigator's and panels' `--fsd-nav-*` and `--fsd-panel-*` properties at the tokens, so they
match the cards.

Two rules the values keep. Yellow (`attention`) means only that a person must act. Corners are
square.

Fonts are named, not bundled: Space Grotesk for the interface and headings, IBM Plex Mono
for labels and ids. Load them in your app, or the system fallbacks show.

Nothing in FSD's own packages may carry one of these values; `pnpm --filter
@flow-state-dev/design-system test` fails if one does. The values come from the final Claude
Design hand-back, kept with the epic spec at `specs/epics/FIX-1649/assets/design/v2/`.

The goal check `goals/design-system/skins-reused-components-from-one-token-set/` installs the
registry into a fresh app, loads this stylesheet and reads what a browser paints.
