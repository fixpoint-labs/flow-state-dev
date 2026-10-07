# Claude Design exports

Reference material for Shift Manager's look. Nothing here is imported or built, and nothing here is authoritative: the values Shift Manager ships are in `labs/design-system/shift-manager.css`, and the retained design record for the shell is `specs/epics/FIX-1649/assets/design/` (v2 is its final hand-back).

| File | What it is |
|---|---|
| `Shift Manager v4.dc.html` | Claude Design export, v4, exported 2026-10-07. An **exploratory reference** for the themes work (FIX-1800), not a successor hand-back: it adds a Schedule view that v2's seven screens don't have, and nothing has adopted it. If a v4 screen is built, that is an epic amendment (FIX-1649, ER-10) and the export moves under `assets/design/`. |
| `support.js` | The runtime the export loads (`dc-runtime`). Generated; don't edit. |

## Opening it

The page needs a network. `support.js` loads React 18.3.1, ReactDOM and Babel standalone from unpkg, and the page loads IBM Plex Mono and Space Grotesk from Google Fonts. Serve the folder over HTTP (`npx serve .designs`) rather than opening the file directly. Shipped Shift Manager doesn't use either CDN: its fonts come from `@fontsource` through the design system.

## Adding an export

Keep each export's runtime beside it, note the design version and date here, and leave the files as handed back.
