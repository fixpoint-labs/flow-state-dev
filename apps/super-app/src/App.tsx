import { useEffect, useState } from "react";
import { DevToolPanel, readSessionAddress, readUserId } from "@flow-state-dev/devtool/react";

import { parseInjectedConfig, type InjectedConfig } from "./injected-config.mjs";

/** One app the proxy hosts, as `/devtool/apps.json` lists it. */
interface HostedApp {
  id: string;
  title: string;
  /** Where the app is reached on this server, no trailing slash. Its flow API is `<prefix>/api/flows`. */
  prefix: string;
  status: "starting" | "running" | "stopped";
  /** The one user the app runs as, when it names one in the apps list rather than in its pages. */
  userId?: string;
}

/** How often the apps' status is re-read, so a started or stopped app shows without a reload. */
const STATUS_POLL_MS = 5000;

/** The `?app=` the page was opened with, and the `?session=` that goes with it. Read once. */
const OPENED_WITH = {
  app: new URLSearchParams(window.location.search).get("app"),
  session: readSessionAddress(),
};

/**
 * The hosted apps, kept current: `apps` is `undefined` until the first answer,
 * and `failed` says the last read didn't get one (the list on screen, if any,
 * is the last good one). A failed read is tried again at the next poll.
 */
function useApps(): { apps: HostedApp[] | undefined; failed: boolean } {
  const [apps, setApps] = useState<HostedApp[]>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    const read = () =>
      fetch("/devtool/apps.json", { cache: "no-store" })
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json() as Promise<HostedApp[]>;
        })
        .then((next) => {
          if (!live) return;
          setApps(next);
          setFailed(false);
        })
        .catch(() => live && setFailed(true));
    void read();
    const timer = setInterval(read, STATUS_POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);
  return { apps, failed };
}

/**
 * The user (and token) to open `app` as: the user the app lists, else what its
 * own pages declare. `undefined` while that page is being read; `{}` when it
 * declares none, which leaves the panel's own user editor in charge.
 */
function useConnection(app: HostedApp | undefined, running: boolean): InjectedConfig | undefined {
  const [read, setRead] = useState<{ id: string; config: InjectedConfig }>();
  const id = app?.id;
  const listedUser = app?.userId;
  const prefix = app?.prefix;
  useEffect(() => {
    if (id === undefined || prefix === undefined || !running || listedUser !== undefined) return;
    let live = true;
    fetch(`${prefix}/`, { headers: { accept: "text/html" } })
      .then((res) => (res.ok ? res.text() : ""))
      .then((html) => live && setRead({ id, config: parseInjectedConfig(html) }))
      .catch(() => live && setRead({ id, config: {} }));
    return () => {
      live = false;
    };
  }, [id, prefix, running, listedUser]);
  if (listedUser !== undefined) return { userId: listedUser };
  return read !== undefined && read.id === id ? read.config : undefined;
}

export function App() {
  const { apps, failed } = useApps();
  const [picked, setPicked] = useState(OPENED_WITH.app);
  const app = apps?.find((a) => a.id === picked) ?? apps?.find((a) => a.status === "running") ?? apps?.[0];
  const running = app?.status === "running";
  const connection = useConnection(app, running);

  const pick = (id: string) => {
    setPicked(id);
    // The session in the address belongs to the app it was opened with.
    window.history.replaceState(null, "", `${window.location.pathname}?app=${encodeURIComponent(id)}`);
  };
  // An `?app=` that names no hosted app falls back to another: the tabs and the address follow it, rather than disagree.
  const fallbackId = picked !== null && apps !== undefined && app !== undefined && app.id !== picked ? app.id : undefined;
  useEffect(() => {
    if (fallbackId !== undefined) pick(fallbackId);
  }, [fallbackId]);

  return (
    <div className="shell">
      <nav className="bar" role="tablist" aria-label="Apps">
        <a className="home" href="/">
          ← Apps
        </a>
        {apps?.map((a) => (
          <button
            key={a.id}
            type="button"
            role="tab"
            className="tab"
            aria-selected={a.id === app?.id}
            onClick={() => pick(a.id)}
          >
            <span className={`dot ${a.status}`} role="img" aria-label={a.status} />
            {a.title}
          </button>
        ))}
      </nav>
      <div className="stage">
        {apps === undefined ? (
          <p className="notice">{failed ? "Couldn't read the list of apps from this server. Trying again…" : "Loading…"}</p>
        ) : app === undefined ? (
          <p className="notice">No apps are hosted.</p>
        ) : !running ? (
          <p className="notice">
            {app.title} is {app.status}. Its DevTool opens once it is running.
          </p>
        ) : connection === undefined ? (
          <p className="notice">Connecting to {app.title}…</p>
        ) : (
          <DevToolPanel
            // A new app is a new connection: nothing from the last one carries over.
            key={app.id}
            baseUrl={app.prefix}
            // With none declared, the user the panel's own editor last chose.
            userId={connection.userId ?? readUserId()}
            bearerToken={connection.bearerToken}
            userIdControl={app.userId === undefined ? "internal" : "host"}
            autoRecoverInterrupted
            {...(OPENED_WITH.session !== undefined && app.id === OPENED_WITH.app ? { openSessionId: OPENED_WITH.session } : {})}
          />
        )}
      </div>
    </div>
  );
}
