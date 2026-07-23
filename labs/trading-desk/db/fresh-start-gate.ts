/**
 * Fresh-start rollout gate decision (FIX-895), factored out of `scripts/migrate.ts`
 * so it is unit-testable without a real Postgres. The lot-identity fingerprint
 * recipe (`|lk|ck|`, now unconditional) is only safe on a CLEARED ledger, so the
 * deploy migrator refuses to proceed when legacy rows remain and the wipe marker
 * (stamped by `ledger-reset`) is absent. Pure — the caller supplies the two facts.
 */

/**
 * Throw when the new fingerprint recipe would activate against un-wiped legacy
 * data. A genuinely fresh deploy (`ledgerCount === 0`) passes; a post-wipe ledger
 * (`hasMarker`) passes; only legacy-rows-without-marker is refused.
 */
export function assertFreshStartRollout(ledgerCount: number, hasMarker: boolean): void {
  if (ledgerCount > 0 && !hasMarker) {
    throw new Error(
      `Refusing to activate the FIX-895 lot-identity fingerprint against an un-wiped ledger ` +
        `(${ledgerCount} legacy ledger_events rows, no fresh-start marker). Run ` +
        `\`pnpm --filter @flow-state-dev/trading-desk ledger-reset\` to clear the ledger-derived ` +
        `tables first, then re-deploy.`,
    );
  }
}
