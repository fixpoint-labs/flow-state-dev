---
"@flow-state-dev/vercel": patch
---

The Vercel handler refuses uploads to an on-host blob store only when it runs on Vercel; served by `next dev` or `next start` on a machine, a local blob store takes attachments (FIX-2521).
