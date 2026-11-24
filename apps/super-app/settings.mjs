/**
 * The super app's settings, read from the environment, and the starts it
 * refuses. A pure function, so the rules are tested without starting anything;
 * `run.mjs` prints `error` and exits with `exitCode` when one is set.
 */
import { APPS } from "./apps.mjs";

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1"]);

/**
 * @param {"dev"|"serve"} mode
 * @param {Record<string, string|undefined>} env
 * @returns {{ error: string, exitCode: number } | {
 *   error?: undefined, port: number, host: string, apps: import("./apps.mjs").HostedApp[],
 *   credentials?: { username: string, password: string }, secret?: string
 * }}
 */
export function resolveSettings(mode, env) {
  const only = env.SUPER_APP_ONLY?.split(",").map((s) => s.trim()).filter(Boolean);
  const apps = only === undefined ? APPS : APPS.filter((a) => only.includes(a.id));
  if (only !== undefined && apps.length !== only.length) {
    return { error: `SUPER_APP_ONLY names an app that isn't hosted. Hosted: ${APPS.map((a) => a.id).join(", ")}`, exitCode: 2 };
  }

  // `dev` stays off port 80, which needs root on Linux; `serve` is the one meant for the standard port.
  const portText = env.PORT ?? (mode === "serve" ? "80" : "8080");
  const port = Number(portText);
  if (!/^\d+$/.test(portText) || port < 1 || port > 65535) {
    return { error: `PORT must be an integer from 1 to 65535, got "${portText}".`, exitCode: 2 };
  }
  const host = env.HOST ?? (mode === "serve" ? "0.0.0.0" : "127.0.0.1");
  const loopback = LOOPBACK.has(host);

  const username = env.SUPER_APP_USERNAME || undefined;
  const password = env.SUPER_APP_PASSWORD || undefined;
  if ((username === undefined) !== (password === undefined)) {
    return { error: "Set both SUPER_APP_USERNAME and SUPER_APP_PASSWORD, or neither.", exitCode: 3 };
  }
  if (username === undefined && (mode === "serve" || !loopback)) {
    return {
      error:
        `Refusing to ${mode === "serve" ? "serve" : `serve on ${host}`} with no sign-in: these apps run coding agents on this machine.\n` +
        "Set SUPER_APP_USERNAME and SUPER_APP_PASSWORD.",
      exitCode: 3,
    };
  }
  // Off loopback the password and the session cookie cross a network: only over HTTPS, unless the operator says otherwise.
  if (!loopback && env.SUPER_APP_SECURE_COOKIE !== "1" && env.SUPER_APP_ALLOW_HTTP !== "1") {
    return {
      error:
        `Refusing to serve on ${host} over plain HTTP: the password and session cookie would cross the network unencrypted.\n` +
        "Put HTTPS in front and set SUPER_APP_SECURE_COOKIE=1, or set SUPER_APP_ALLOW_HTTP=1 on a network you trust.",
      exitCode: 3,
    };
  }

  return {
    port,
    host,
    apps,
    ...(username === undefined ? {} : { credentials: { username, password } }),
    ...(env.SUPER_APP_SECRET ? { secret: env.SUPER_APP_SECRET } : {}),
  };
}
