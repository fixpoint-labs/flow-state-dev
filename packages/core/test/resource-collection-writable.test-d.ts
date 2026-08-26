/**
 * Compile-time assertion that `writable` is a declared field on
 * `ResourceCollectionConfig`, not an excess property the naked
 * `defineResourceCollection` generic would silently accept.
 *
 * `tsconfig.test-d.json` compiles every `.test-d.ts` file in this package's
 * `test` directory. Drop the field and `ResourceCollectionConfig["writable"]`
 * is a type error, which is itself the red this file exists to catch.
 */
import { z } from "zod";
import { defineResourceCollection } from "@flow-state-dev/core";
import type { ResourceCollectionConfig } from "@flow-state-dev/core";

/** Control: omitting the flag still compiles. Default is writable. */
export const acceptedDefault = defineResourceCollection({
  pattern: "notes/*",
  scope: "session",
  stateSchema: z.object({ body: z.string() }),
});

/** Declaring the collection read-only is a real config key, not a typo. */
export const acceptedReadOnly = defineResourceCollection({
  pattern: "notes/*",
  scope: "session",
  stateSchema: z.object({ body: z.string() }),
  writable: false,
});

type WritableOnConfig = ResourceCollectionConfig["writable"];
export const writableIsOptionalBoolean: WritableOnConfig = false;
export const writableMayBeOmitted: WritableOnConfig = undefined;
