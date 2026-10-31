# apps/build-site

The landing page for **flow-state.build**, the everyday-user door to Flow State. Its developer counterpart is the docs site home page at flow-state.dev (`apps/docs`); each page links to the other through the "For everyone / For developers" switch in its nav.

It is one static page with no build step:

| File | What it holds |
|------|---------------|
| `public/index.html` | Markup, plus a small script that plays the hero demo and posts the waitlist form |
| `public/styles.css` | Styles, in the same paper, ink and highlighter system as flow-state.dev |
| `api/waitlist.js` | Vercel Function at `/api/waitlist`: adds the signup as a Resend contact |
| `serve.mjs` | A dependency-free local preview server |

## Preview

```bash
pnpm --filter @flow-state-dev/build-site dev   # http://localhost:3002
```

## Deploy

Host `public/` as a static site. On Vercel, set the root directory to `apps/build-site`; `vercel.json` skips the install and build (the page and `api/waitlist.js` need no dependencies, and a workspace-wide install would compile every package's native modules) and serves `public/`. Packaging `api/waitlist.js` still runs a workspace install, so `engines` pins Node 22, where `better-sqlite3` has a prebuilt binary instead of a native compile.

Set these environment variables on the Vercel project:

| Variable | What it is |
|----------|------------|
| `RESEND_API_KEY` | A Resend API key with full access (contacts need it) |
| `RESEND_SEGMENT_ID` | Optional. The Resend segment new signups join; leave unset to add them as plain contacts |

## Waitlist

Signups land in Resend under **Audience → Contacts**, ready for a launch broadcast. The form has a hidden `company` field as a bot trap; anything that fills it gets a success response and is dropped.

`serve.mjs` serves only static files, so the form can't reach `/api/waitlist` in that preview. To try the signup locally, run `vercel dev` from this directory with the env vars in `.env.local`.
