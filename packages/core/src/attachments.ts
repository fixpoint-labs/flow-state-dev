/**
 * Re-export shim: the attachments limits set and the `fsd-blob:` reference
 * helper live in `@flow-state-dev/contracts/attachments`. Exposed here so the
 * engine and other server packages read the one set through `core`, as they
 * read the item taxonomy. See packages/contracts.
 */
export * from "@flow-state-dev/contracts/attachments";
