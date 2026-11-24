/**
 * Pieces only FSD's own harness packages share: the per-account private temp
 * folder Cursor's short links and Codex's per-turn images live in, and the
 * harness manager's marking of a held checkout lock as live. Not a public
 * API.
 *
 * @internal
 */
export { refreshLock } from "./lock";
export { privateTempRoot } from "./private-temp";
