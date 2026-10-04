/**
 * Which remotes a host may reach, decided before any git process starts.
 *
 * A remote arrives as a string somebody wrote — a member, or a model with a
 * person's approval — and git interprets a remote string generously: a
 * leading `-` is an option, `ext::` runs a command, an ssh host spelled
 * `-oProxyCommand=…` runs another. So the string is parsed and judged here,
 * as data, and git only ever sees one that passed.
 *
 * The operator's allowlist names hosts, reached over `https` or `ssh`, and
 * optionally the word `"file"` to permit `file://` remotes. Nothing else is
 * reachable: no `http`, no `git://`, no transport helper, no bare path.
 */
import { createHash } from "node:crypto";

/** A remote that passed: what git is handed, and what the host keys its clone by. */
export interface AllowedRemote {
  /** The remote exactly as given. Passed to git after `--`. */
  url: string;
  /** The transport git will use. */
  scheme: "https" | "ssh" | "file";
  /**
   * A directory-safe name for this repository's clone. Two spellings of one
   * repository — `https://h/x`, `https://h/x.git`, `git@h:x` — share it.
   */
  cloneKey: string;
}

/** A remote that did not pass, and why. */
export interface RefusedRemote {
  reason: "invalid-remote" | "remote-not-allowed";
  message: string;
}

/** The schemes a host speaks to a listed host. */
const NETWORK_SCHEMES = ["https", "ssh"] as const;

/**
 * The value of `GIT_ALLOW_PROTOCOL` for an allowlist: only the transports a
 * listed entry can reach, so git itself refuses anything this module missed.
 */
export function allowedProtocols(allow: readonly string[]): string {
  const schemes: string[] = [];
  if (allow.some((entry) => entry !== "file")) schemes.push(...NETWORK_SCHEMES);
  if (allow.includes("file")) schemes.push("file");
  // Git reads an EMPTY value as "allow nothing", which is right for an
  // allowlist with nothing on it.
  return schemes.join(":");
}

/**
 * The remote as a person may be shown it: any userinfo removed, so a refusal
 * that names the remote never prints a credential.
 */
export function redactRemote(remote: string): string {
  return remote.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@]*@/i, "$1");
}

/** Judge `remote` against `allow`. Pure: starts nothing, reads nothing. */
export function checkRemote(remote: string, allow: readonly string[]): AllowedRemote | RefusedRemote {
  const shown = redactRemote(remote);
  const invalid = (why: string): RefusedRemote => ({
    reason: "invalid-remote",
    message: `the remote "${shown}" is not a usable git remote: ${why}.`,
  });
  const notAllowed = (what: string): RefusedRemote => ({
    reason: "remote-not-allowed",
    message: `the remote "${shown}" is not allowed on this host: ${what}.`,
  });

  if (remote.startsWith("-")) return invalid("it starts with \"-\", which git reads as an option");
  // Whitespace and control characters have no place in a remote and every
  // place in a smuggled argument.
  if (/[\s\x00-\x1f\x7f]/.test(remote)) return invalid("it contains whitespace or a control character");
  // `<transport>::<address>` hands the address to a helper program; `ext::`
  // runs it as a command line.
  if (/^[a-z][a-z0-9+.-]*::/i.test(remote)) return invalid("transport helpers (\"<name>::\") are never reached");

  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(remote);
  if (hasScheme) {
    let url: URL;
    try {
      url = new URL(remote);
    } catch {
      return invalid("it does not parse as a URL");
    }
    const scheme = url.protocol.slice(0, -1).toLowerCase();
    if (url.password !== "") return invalid("it carries a password");

    if (scheme === "file") {
      if (!allow.includes("file")) return notAllowed("file:// remotes are off unless the host lists \"file\"");
      if (url.hostname !== "" && url.hostname !== "localhost") return invalid("a file:// remote names no host");
      const path = decodeURIComponent(url.pathname);
      return { url: remote, scheme: "file", cloneKey: cloneKeyFor("file", path) };
    }
    if (scheme !== "https" && scheme !== "ssh") {
      return notAllowed(`the host reaches remotes over https or ssh, not ${scheme}`);
    }
    if (scheme === "https" && url.username !== "") return invalid("it carries a credential");
    const host = url.hostname.toLowerCase();
    if (host === "" || host.startsWith("-")) return invalid("its host is missing or starts with \"-\"");
    if (!allow.some((entry) => entry.toLowerCase() === host)) return notAllowed(`"${host}" is not a listed host`);
    return { url: remote, scheme, cloneKey: cloneKeyFor(host, repositoryPath(url.pathname)) };
  }

  // Git's scp-like form, `[user@]host:path`, is ssh — but only when the colon
  // comes before any slash. Anything else without a scheme is a path.
  const scp = /^(?:([^@/:]+)@)?([^/:]+):(.+)$/.exec(remote);
  if (scp !== null) {
    const host = scp[2]!.toLowerCase();
    if (host.startsWith("-")) return invalid("its host starts with \"-\"");
    if (!allow.some((entry) => entry.toLowerCase() === host)) return notAllowed(`"${host}" is not a listed host`);
    return { url: remote, scheme: "ssh", cloneKey: cloneKeyFor(host, repositoryPath(scp[3]!)) };
  }

  return invalid("a bare path is not a remote — spell a local repository as a file:// URL");
}

/**
 * The repository part of a network remote, spelled one way: no leading or
 * trailing `/`, no `.git`.
 *
 * Not applied to a `file://` path, where `x` and `x.git` are two different
 * directories.
 */
function repositoryPath(path: string): string {
  return path.replace(/^\/+/, "").replace(/\/+$/, "").replace(/\.git$/, "");
}

/**
 * A readable, directory-safe clone name with a hash of the identity on the
 * end, so two identities that sanitize alike still get two clones.
 */
function cloneKeyFor(host: string, path: string): string {
  const identity = `${host}/${path}`;
  const readable = identity.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[-.]+/, "").slice(0, 80);
  const hash = createHash("sha256").update(identity).digest("hex").slice(0, 12);
  return `${readable}-${hash}`;
}
