# apps/build-site

The landing page for **flow-state.build**, the everyday-user door to Flow State. Its developer counterpart is the docs site home page at flow-state.dev (`apps/docs`); each page links to the other through the "For everyone / For developers" switch in its nav.

It is one static page with no build step:

| File | What it holds |
|------|---------------|
| `public/index.html` | Markup, plus a small script that plays the hero demo and handles the waitlist form |
| `public/styles.css` | Styles, in the same paper, ink and highlighter system as flow-state.dev |
| `serve.mjs` | A dependency-free local preview server |

## Preview

```bash
pnpm --filter @flow-state-dev/build-site dev   # http://localhost:3002
```

## Deploy

Host `public/` as a static site (on Vercel: root directory `apps/build-site`, no build command, output directory `public`).

## Not wired up yet

The waitlist form validates the email and shows a note, but stores nothing. Point it at a signup service before launch.
