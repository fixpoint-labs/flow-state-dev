/**
 * The names Windows reserves for DOS devices — the one copy of the list in the
 * repository. Every place that turns a name into a file or folder reads it
 * through {@link isWindowsReservedName}; `scripts/validate-reserved-names.mjs`
 * fails CI if a second copy appears.
 */

/**
 * `con`, `prn`, `aux`, `nul`, `com1`–`com9`, `lpt1`–`lpt9`, in lowercase.
 *
 * The numbered devices run **1–9, not 0–9**: `COM0` and `LPT0` are ordinary
 * names on Windows, so refusing them would cost callers two portable names for
 * nothing.
 */
const WINDOWS_RESERVED_NAMES: ReadonlySet<string> = new Set([
  "con",
  "prn",
  "aux",
  "nul",
  ...Array.from({ length: 9 }, (_, i) => `com${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `lpt${i + 1}`),
]);

/**
 * True when `name` is a name Windows reserves for a device, in any letter case.
 *
 * Whole-name match only. Windows refuses these names **with any extension** —
 * `con.txt` is as unopenable as `con` — so a caller checking a file passes its
 * basename without the extension. A name authored on macOS or Linux that fails
 * this check produces a repository or store that cannot be checked out or
 * opened on Windows.
 */
export function isWindowsReservedName(name: string): boolean {
  return WINDOWS_RESERVED_NAMES.has(name.toLowerCase());
}
