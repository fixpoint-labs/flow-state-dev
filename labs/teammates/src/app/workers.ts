/**
 * The roster: the workers on it, hiring, editing and firing your teammates,
 * and whether each one is busy. Every change reaches every open tab through
 * the workforce client's `watchRoster()`.
 */
import { topic, type SessionRequestSummary } from "@flow-state-dev/client";
import type { RosterEntry } from "@flow-state-dev/workforce/browser";
import { CODER_FLOW } from "@flow-state-dev/harness-manager/browser";
import { isRequest, logFailedRead, POLL_MS, QUIET_ACTIONS, type Unsubscribe } from "./reads";
import type { AppState } from "./state";

/** One worker on the roster. */
export interface AppWorker {
  /** The worker's address on the roster, e.g. `teammates.chief-of-staff`. */
  id: string;
  /** The name the user reads. */
  name: string;
  /** Its `WORKER.md` description: the ongoing role. */
  role: string;
  /** Coding tasks run on it: it is not a teammate, so it is off the list and has no conversation. */
  takesTasks?: boolean;
  /** The user hired it, so they can fire it. The files' workers can't be fired. */
  own?: boolean;
  /** A file's worker the user has edited: they have their own copy, and can reset it to the file's. */
  edited?: boolean;
  /** For a coding worker, its file's `harness:`, from the roster row's shown settings. */
  harness?: string;
  /** Its file's `icon:`, from the roster row's shown settings. */
  icon?: string;
  /** Its file's `color:`, a name from the lab's palette, from the roster row's shown settings. */
  color?: string;
}

/** What an edit changes: a name, instructions, or both. */
export interface TeammateEdit {
  /** Its new name; blank clears it, so the list shows its id. */
  name?: string;
  /** Its new instructions, in full. */
  instructions?: string;
}

/** A teammate to hire from the page. */
export interface NewTeammate {
  /** Its name, which is its id on the roster: one word, lowercase. */
  name: string;
  /** One line on what it does: Lead reads it to know who to ask. */
  role: string;
  instructions: string;
}

/** Whether a worker is busy, read from its conversation's requests. */
export interface Activity {
  /** A request is running in the worker's conversation. */
  running: boolean;
  /** When its last request ended or started, in ms. */
  lastActiveAt: number;
}

/** A roster entry as the screen lists it. */
function toAppWorker(w: RosterEntry): AppWorker {
  return {
    id: w.id,
    name: w.name ?? w.id.slice(w.id.lastIndexOf(".") + 1),
    role: w.description ?? "",
    ...(w.flow === CODER_FLOW ? { takesTasks: true } : {}),
    ...(w.standard ? {} : { own: true }),
    ...(w.edited ? { edited: true } : {}),
    ...(typeof w.settings?.harness === "string" ? { harness: w.settings.harness } : {}),
    ...(typeof w.settings?.icon === "string" ? { icon: w.settings.icon } : {}),
    ...(typeof w.settings?.color === "string" ? { color: w.settings.color } : {}),
  };
}

/** Who a worker's conversation's requests say it is: answering now, and when it last did anything. */
function activityOf(requests: readonly SessionRequestSummary[]): Activity {
  const answering = requests.filter((r) => !QUIET_ACTIONS.has(r.actionName));
  return {
    running: answering.some((r) => r.status === "in_progress"),
    lastActiveAt: Math.max(0, ...answering.map((r) => r.completedAtMs ?? r.failedAtMs ?? r.startedAtMs ?? 0)),
  };
}

/** The roster's reads and changes. */
export interface WorkerCalls {
  /**
   * The roster's rows, and again each time a hire, an edit or a fire, from
   * any tab or any worker's turn, changes them. `onError` hears a failed read;
   * the next read that lands reports the rows.
   */
  watchWorkers(onChange: (workers: AppWorker[]) => void, onError?: (error: unknown) => void): Unsubscribe;
  listWorkers(): Promise<AppWorker[]>;
  watchActivity(worker: string, onChange: (activity: Activity) => void): Unsubscribe;
  /** Hire a teammate onto the user's roster, on the built-in agent flow. */
  hire(teammate: NewTeammate): Promise<AppWorker>;
  /**
   * Rename a teammate or replace its instructions, from its next turn on. Any
   * teammate: the first edit of a file's teammate makes the user's own copy
   * of it, under the same id.
   */
  editTeammate(worker: string, edit: TeammateEdit): Promise<void>;
  /** Put a file's teammate the user edited back as the file has it, from its next turn on. */
  resetTeammate(worker: string): Promise<void>;
  /** Fire one of the user's own teammates: it leaves the roster, and its conversation stays readable. */
  fire(worker: string): Promise<void>;
}

/** {@link WorkerCalls} over the app's shared state. */
export function workerCalls(state: AppState): WorkerCalls {
  const { client, workforce, conversations, conversationOpened } = state;
  return {
    watchWorkers(onChange, onError) {
      return workforce.watchRoster(
        (roster) => {
          state.workerIds = new Set(roster.map((w) => w.id));
          state.harnesses = new Map(roster.flatMap((w) => (typeof w.settings?.harness === "string" ? [[w.id, w.settings.harness] as const] : [])));
          onChange(roster.map(toAppWorker));
        },
        onError === undefined ? undefined : { onError },
      );
    },
    async listWorkers() {
      const roster = await workforce.roster();
      state.workerIds = new Set(roster.map((w) => w.id));
      state.harnesses = new Map(roster.flatMap((w) => (typeof w.settings?.harness === "string" ? [[w.id, w.settings.harness] as const] : [])));
      return roster.map(toAppWorker);
    },
    watchActivity(worker, onChange) {
      // A worker that takes tasks only has no conversation: it is idle here. One that has one is
      // watched from the moment it opens, on its conversation's request notices.
      let live = true;
      let stopRead: Unsubscribe | undefined;
      const follow = () => {
        const known = conversations.get(worker);
        if (!live || known === undefined || stopRead !== undefined) return;
        stopRead = client.live([topic.session(known.sessionId)], {
          read: async () => activityOf(await client.sessions.requests(known.sessionId, { limit: 20 })),
          onValue: onChange,
          hear: isRequest,
          pollIntervalMs: POLL_MS,
          onError: logFailedRead,
        }).close;
      };
      if (conversations.has(worker)) follow();
      else onChange({ running: false, lastActiveAt: 0 });
      conversationOpened.add(follow);
      return () => {
        live = false;
        conversationOpened.delete(follow);
        stopRead?.();
      };
    },
    async hire({ name, role, instructions }) {
      const written = await workforce.hire({ id: name, description: role, instructions });
      const hired = (await workforce.roster()).find((w) => w.id === written.id && !w.standard);
      if (hired === undefined) throw new Error(`teammates: "${name}" was hired but isn't on the roster`);
      state.workerIds.add(hired.id);
      return toAppWorker(hired);
    },
    async editTeammate(worker, { name, instructions }) {
      await workforce.edit({
        id: worker,
        ...(name !== undefined ? { name: name.trim() === "" ? null : name.trim() } : {}),
        ...(instructions !== undefined ? { instructions } : {}),
      });
    },
    async resetTeammate(worker) {
      await workforce.reset(worker);
    },
    async fire(worker) {
      await workforce.fire(worker);
      conversations.delete(worker);
    },
  };
}
