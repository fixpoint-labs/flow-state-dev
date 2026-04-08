# Kitchen Sink Example

Demo app showcasing all `@flow-state-dev` building blocks.

## UI Components: Upstream-First Convention

The `components/flow-state/` directory contains components installed from the `@flow-state-dev/ui` registry (`packages/ui/registry/components/`). These are **copies** — the kitchen-sink owns them, but the registry is the upstream source.

**When modifying any component in `components/flow-state/`:**

1. Make the change in `packages/ui/registry/components/` first (the upstream source)
2. Then apply the same change to the kitchen-sink copy in `components/flow-state/`

This ensures the registry stays in sync and other consumers get the fix when they next install.
