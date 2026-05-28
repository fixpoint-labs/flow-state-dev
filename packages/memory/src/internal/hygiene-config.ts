/**
 * Internal: hygiene-config resolution.
 *
 * Resolves the user-facing `HygieneConfig` union (`true` / `false` / object)
 * into the concrete `ResolvedHygieneConfig` the janitor block and recall
 * ranking consume. Shared between `createMemoryCapability` (recall ranking
 * via `confidenceDecay.halfLife`) and `system()` (janitor scheduling) so the
 * validation lives in one place. Internal-only — not re-exported from the
 * package index.
 */

import type { ResolvedHygieneConfig } from '../janitor-blocks.js'
import { DEFAULT_HYGIENE_CONFIG } from '../janitor.js'
import type { HygieneConfig } from '../memory-system.js'

/**
 * Resolve user-supplied hygiene config into the concrete shape the janitor
 * block expects. Validates `halfLife > 0` and `cullFloor` in `[0, 1]` at
 * construction time so misconfiguration fails fast.
 *
 * Returns `false` when hygiene is explicitly disabled (`hygiene: false`) so
 * downstream call sites can skip every branch with one check.
 */
export function resolveHygieneConfig(
  input: HygieneConfig | true | false | undefined,
): false | ResolvedHygieneConfig {
  if (input === false) return false

  const userConfig: HygieneConfig = input === true || input == null ? {} : input
  const defaults = DEFAULT_HYGIENE_CONFIG

  let confidenceDecay: ResolvedHygieneConfig['confidenceDecay']
  if (userConfig.confidenceDecay === false) {
    confidenceDecay = false
  } else {
    const cd = userConfig.confidenceDecay === true || userConfig.confidenceDecay == null
      ? {}
      : userConfig.confidenceDecay
    const halfLife = cd.halfLife ?? defaults.confidenceDecay.halfLife
    const cullFloor = cd.cullFloor ?? defaults.confidenceDecay.cullFloor
    if (!(halfLife > 0)) {
      throw new Error(`hygiene.confidenceDecay.halfLife must be > 0, got ${halfLife}`)
    }
    if (!(cullFloor >= 0 && cullFloor < 1)) {
      throw new Error(`hygiene.confidenceDecay.cullFloor must be in [0, 1), got ${cullFloor}`)
    }
    confidenceDecay = { halfLife, cullFloor }
  }

  let episodicTTL: ResolvedHygieneConfig['episodicTTL']
  if (userConfig.episodicTTL === false) {
    episodicTTL = false
  } else {
    const et = userConfig.episodicTTL === true || userConfig.episodicTTL == null
      ? {}
      : userConfig.episodicTTL
    episodicTTL = {
      persistentTurns: et.persistentTurns ?? defaults.episodicTTL.persistentTurns,
      persistentDays: et.persistentDays ?? defaults.episodicTTL.persistentDays,
      operator: et.operator ?? defaults.episodicTTL.operator,
      permanentStaleDays: et.permanentStaleDays ?? defaults.episodicTTL.permanentStaleDays,
    }
    // Bounds-check every threshold. A value of `0` is a footgun:
    // `ageDays >= 0` is true on the first run for every episode encoded so
    // far, so the janitor would wipe the persistent store and mark every
    // permanent episode stale before any user-visible action.
    if (!(episodicTTL.persistentTurns > 0)) {
      throw new Error(`hygiene.episodicTTL.persistentTurns must be > 0, got ${episodicTTL.persistentTurns}`)
    }
    if (!(episodicTTL.persistentDays > 0)) {
      throw new Error(`hygiene.episodicTTL.persistentDays must be > 0, got ${episodicTTL.persistentDays}`)
    }
    if (!(episodicTTL.permanentStaleDays > 0)) {
      throw new Error(`hygiene.episodicTTL.permanentStaleDays must be > 0, got ${episodicTTL.permanentStaleDays}`)
    }
  }

  return {
    confidenceDecay,
    episodicTTL,
    schedule: userConfig.schedule ?? defaults.schedule,
  }
}
