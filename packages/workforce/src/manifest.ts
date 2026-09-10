/**
 * The worker record — the shape both halves of the on-disk workforce agree on.
 *
 * Declared once here, node-free, so the loader (which reads folders) and the
 * seat factory (which reads nothing) never hold two spellings of one record.
 */

/**
 * One worker, as declared on disk or hand-built. Declared once, in this module; the loader
 * returns this type rather than a second one of its own.
 */
export interface WorkerManifest {
  /**
   * Team-qualified identity, "<teamId>.<name>" — e.g. "engineering.lead". The whole
   * identity and the flow address.
   * Dot-joined, not slash-joined: a "/" here is unroutable (decision 2).
   * Minted once, by the loader, in one helper — and the record's only identity field.
   */
  id: string;
  /** Frontmatter exactly as written — keys as the file spelled them, values uninterpreted. */
  declared: Record<string, unknown>;
  /**
   * The worker's instructions: Markdown body verbatim, frontmatter removed.
   * Empty for a thin seat; reaches a hired flow as `config.persona`.
   */
  body: string;
  /** Present when the folder holds a `worker.ts`. Recorded by the loader, never imported. */
  codePath?: string;
}
