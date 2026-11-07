#!/usr/bin/env -S tsx
/**
 * `pnpm registry:refresh`: copy every registry component Kitchen Sink installs
 * from `packages/ui/registry/components` into `components/flow-state/`, with
 * the same options the drift test checks (`scripts/registry-copies.ts`).
 */
import { refreshRegistryCopies } from "../../../packages/ui/scripts/registry-drift";
import { KITCHEN_SINK_REGISTRY_COPIES } from "./registry-copies";

const written = refreshRegistryCopies(KITCHEN_SINK_REGISTRY_COPIES);
console.log(`refreshed ${written.length} registry copies in components/flow-state/`);
