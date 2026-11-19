/**
 * The roster as the screen draws it: workforce's own rows (`RosterEntry`,
 * from its roster view), and what each screen works out from one where it
 * draws it, its name, its role, whether it takes coding tasks, and the
 * settings its file shows. Writes go through workforce's client
 * (`useWorkforce`), over the app's one client.
 */
import { CODER_FLOW } from "@flow-state-dev/harness-manager/browser";
import type { RosterEntry } from "@flow-state-dev/workforce/browser";
import { useAppClient } from "../app";

/** The name the user reads: its own, else its id's last part. */
export const displayName = (w: RosterEntry): string => w.name ?? w.id.slice(w.id.lastIndexOf(".") + 1);

/** Its `WORKER.md` description: the ongoing role. */
export const roleOf = (w: RosterEntry): string => w.description ?? "";

/** Coding tasks run on it: it is not a teammate, so it is off the list and has no conversation. */
export const takesTasks = (w: RosterEntry): boolean => w.flow === CODER_FLOW;

/** A setting its file shows on its row (`icon`, `color`, a coding worker's `harness`), when it is a string. */
export const settingOf = (w: RosterEntry, key: string): string | undefined => (typeof w.settings[key] === "string" ? (w.settings[key] as string) : undefined);

/** Workforce's client over the app's one client, the one a conversation sends and stops through: hire, edit, reset and fire, and the roster's own watch. */
export const useWorkforce = () => useAppClient().workforce;
