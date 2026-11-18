# Design system

The look of Shift Manager, the Labs' app: three themes (day, evening and night) over the tokens FSD's components
already read. It holds values only. There are no components here; the app gets those from
`@flow-state-dev/react` and the `@flow-state-dev/ui` registry, unedited.

```css
@import "@flow-state-dev/design-system/shift-manager.css";
```

Import it after the stylesheet that holds the registry's `tokens` defaults. Day applies by default.
Put `data-theme="evening"` (or `class="evening"`) on the root element for evening, or `class="dark"` on an ancestor for night. The same stylesheet points
the navigator's and panels' `--fsd-nav-*` and `--fsd-panel-*` properties at the tokens, so they
match the cards.

It also sets two values no FSD token covers: `--sidebar`, the app's navigation column, and
`--inspector`, its right-hand panel. Both are a step darker than the page. An app that doesn't
use them can ignore them.

Yellow (`attention`) means only that a person must act. Corners are square.

Fonts come with it: Space Grotesk for the interface and headings, IBM Plex Mono for labels
and ids. The stylesheet imports their Latin faces from the `@fontsource` packages, so your bundler
serves the font files with your app and no page fetches them from a font CDN. That needs a
CSS pipeline that rebases `url()`s inside imported stylesheets; in Vite, run Tailwind as
`@tailwindcss/vite` rather than through PostCSS.

Nothing in FSD's own packages may carry one of these values; `pnpm --filter
@flow-state-dev/design-system test` fails if one does. The values come from the final Claude
Design hand-back, kept with the epic spec at `specs/epics/FIX-1649/assets/design/v2/`.

The goal check `goals/design-system/skins-reused-components-from-one-token-set/` installs the
registry into a fresh app, loads this stylesheet and reads what a browser paints.

## The type scale

`type.css` gives Tailwind's text steps their sizes for the Labs. Each lab imports it after the
look; `shift-manager.css` does not, so Kitchen Sink and the docs keep Tailwind's own sizes.

```css
@import "@flow-state-dev/design-system/type.css";
```

Components keep writing the steps, and in the Labs each step is a role:

- `text-xs`, 12px on a 16px line: meta, labels, timestamps, counts, mono ids. The floor.
- `text-sm`, 14 on 20: controls, lists, tables, code.
- `text-base`, 16 on 26: the feed's body and the composer.
- `text-lg`, `text-xl`, `text-2xl`, 18, 22 and 26: headings.

A step's line height comes with it; a `leading-*` class still overrides. Change a size here and
every lab moves. A hard-coded size (`text-[11px]`, `[font-size:…]`, `fontSize` in a style) fails
the `fsd/no-hardcoded-text-size` lint in the labs, Shift Manager and the registry; a glyph drawn
to fit a fixed box takes a reasoned `eslint-disable-next-line` on its line. The goal check
`goals/design-system/labs-read-one-type-scale/` reads the sizes each lab's browser computes.

## The page register

`shift-manager.css` is the app register. `page.css` is the page register, for brand pages
drawn in the Drafting System: paper and four inks, hairlines at .45 and .25, the 24px grid, a
`.label` rule, sheet headings (`.sheets h2`), framed and numbered figures (`.figure`), and the
drawing classes an inline SVG figure reads (`.drawing`). Colour marks emphasis, never category:
ink by default, the highlighter for a figure's one focus, red for an exception.

```css
@import "@flow-state-dev/design-system/page.css";
```

Paper is the default. Night applies under `data-theme="dark"` (or `"night"`) on the root, or
under the OS dark setting when the root has no `data-theme`. The docs ship Paper and Night;
other brand pages stay Paper.
