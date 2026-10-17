---
---

Internal: replace Vercel's per-push git auto-deploys with on-demand,
label-gated previews. `git.deploymentEnabled: false` in each project's
`vercel.json` turns off automatic builds; a new `Preview Deploy` GitHub
Action deploys `apps/kitchen-sink`, `apps/docs`, or `packages/ui` (Storybook)
when the matching `preview/*` label is applied to a PR, and posts the
deployment URL as a sticky PR comment. See
`docs/contributing/preview-deployments.md`.
