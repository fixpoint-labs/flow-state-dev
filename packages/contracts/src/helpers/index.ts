/**
 * Pure, dependency-free helper utilities shared across the framework spine.
 * These live in `@flow-state-dev/contracts` so browser packages and the
 * authoring ecosystem can value-import them without a duplicate copy or the
 * heavy `core` runtime. `@flow-state-dev/core/helpers` re-exports them.
 */
export { deepEqual, looseDeepEqual } from "./deep-equal";
export { camelToKebab, normalizeTagName } from "./string-case";
export { mapLimit } from "./concurrency";
