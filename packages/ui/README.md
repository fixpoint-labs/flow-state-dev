# @flow-state-dev/ui

First-party component registry for Flow State UI.

This package is intentionally **not** a runtime dependency. Components are distributed in shadcn-compatible registry format so developers copy component source into their own apps.

## Structure

- `registry/registry.json`: top-level component manifest
- `registry/components/*`: installable React component sources
- `registry/hooks/*`: optional hook helpers
- `api/registry/*.json`: install targets for per-component and `all` bundles

## Install (target UX)

```bash
fsdev ui add message
fsdev ui add all
```

Or via shadcn directly:

```bash
npx shadcn@latest add https://ui.flow-state.dev/api/registry/message.json
```
