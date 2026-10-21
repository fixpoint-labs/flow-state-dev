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
 *
 * The shape rules and the allowlist are two steps. `checkRemote` asks both;
 * `checkRemoteShape` asks only the first, for the upstream of a repository
 * the operator listed on this machine, which listing it already admits.
 */
import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";

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
 *
 * The userinfo runs to the LAST `@` before the path, as a URL parser reads
 * it — a credential may itself hold an `@`, and stopping at the first one
 * would print the rest of it.
 */
export function redactRemote(remote: string): string {
  return remote.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/?#]*@/i, "$1");
}

/**
 * The remote with any credential in it removed, so it can be written down:
 * userinfo that holds a password, or any userinfo in an `http(s)://` URL,
 * where a token is spelled as the user. Other userinfo (`ssh://git@`) names an
 * account, not a secret, and is kept. Unchanged when it holds none. Every
 * remote this changes fails `checkRemoteShape`, so nothing fetched loses
 * anything here.
 */
export function withoutCredential(remote: string): string {
  const userinfo = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)@/i.exec(remote);
  if (userinfo === null) return remote;
  return userinfo[2]!.includes(":") || /^https?$/i.test(userinfo[1]!) ? redactRemote(remote) : remote;
}

/**
 * A remote that passed the shape rules, before any allowlist is asked: what
 * git would be handed, and the host it names (`null` for `file://`). A
 * `scheme` this host never speaks carries no clone key.
 */
type ShapedRemote =
  | { remote: AllowedRemote; host: string | null }
  | { unspoken: string };

/**
 * Judge `remote` against `allow`. Pure: starts nothing, reads nothing.
 * An unspoken scheme is `remote-not-allowed` here; `checkRemoteShape` calls it `invalid-remote`.
 */
export function checkRemote(remote: string, allow: readonly string[]): AllowedRemote | RefusedRemote {
  const shaped = shapeOf(remote);
  if ("reason" in shaped) return shaped;
  const notAllowed = (what: string): RefusedRemote => ({
    reason: "remote-not-allowed",
    message: `the remote "${redactRemote(remote)}" is not allowed on this host: ${what}.`,
  });
  if ("unspoken" in shaped) return notAllowed(`the host reaches remotes over https or ssh, not ${shaped.unspoken}`);
  if (shaped.host === null) {
    return allow.includes("file") ? shaped.remote : notAllowed("file:// remotes are off unless the host lists \"file\"");
  }
  const host = shaped.host;
  return allow.some((entry) => entry.toLowerCase() === host) ? shaped.remote : notAllowed(`"${host}" is not a listed host`);
}

/**
 * Judge a remote by its shape alone, for a URL the operator's own repository
 * configuration names rather than one a run asked for: the same rules as
 * `checkRemote`, with no allowlist asked. An absolute path is read as the
 * `file://` URL it means, and that URL is what the result hands git.
 * An unspoken scheme is `invalid-remote` here; `checkRemote` calls it `remote-not-allowed`.
 */
export function checkRemoteShape(remote: string): AllowedRemote | RefusedRemote {
  const spelled = isAbsolute(remote) ? pathToFileURL(remote).href : remote;
  const shaped = shapeOf(spelled);
  if ("reason" in shaped) return shaped;
  if ("unspoken" in shaped) {
    return invalidRemote(spelled, `the host reaches remotes over https, ssh or file, not ${shaped.unspoken}`);
  }
  return shaped.remote;
}

function invalidRemote(remote: string, why: string): RefusedRemote {
  return { reason: "invalid-remote", message: `the remote "${redactRemote(remote)}" is not a usable git remote: ${why}.` };
}

/** The shape rules every remote is held to, whoever admits it. Pure. */
function shapeOf(remote: string): ShapedRemote | RefusedRemote {
  const invalid = (why: string): RefusedRemote => invalidRemote(remote, why);

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
      if (url.hostname !== "" && url.hostname !== "localhost") return invalid("a file:// remote names no host");
      let path: string;
      try {
        path = decodeURIComponent(url.pathname);
      } catch {
        return invalid("its path holds a malformed %-escape");
      }
      return { remote: { url: remote, scheme: "file", cloneKey: cloneKeyFor("file", path) }, host: null };
    }
    if (scheme !== "https" && scheme !== "ssh") return { unspoken: scheme };
    if (scheme === "https" && url.username !== "") return invalid("it carries a credential");
    const host = url.hostname.toLowerCase();
    if (host === "" || host.startsWith("-")) return invalid("its host is missing or starts with \"-\"");
    // A non-default port is another server, which can hold an unrelated
    // repository at the same path. The URL parser already drops `:443` from
    // https; `:22` is ssh's default and is dropped here, so both spellings of
    // the default stay one clone with the scp-like form.
    const port = scheme === "ssh" && url.port === "22" ? "" : url.port;
    const authority = port === "" ? host : `${host}:${port}`;
    return { remote: { url: remote, scheme, cloneKey: cloneKeyFor(authority, repositoryPath(url.pathname)) }, host };
  }

  // Git's scp-like form, `[user@]host:path`, is ssh — but only when the colon
  // comes before any slash. Anything else without a scheme is a path.
  const scp = /^(?:([^@/:]+)@)?([^/:]+):(.+)$/.exec(remote);
  if (scp !== null) {
    const host = scp[2]!.toLowerCase();
    if (host.startsWith("-")) return invalid("its host starts with \"-\"");
    return { remote: { url: remote, scheme: "ssh", cloneKey: cloneKeyFor(host, repositoryPath(scp[3]!)) }, host };
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
function cloneKeyFor(authority: string, path: string): string {
  const identity = `${authority}/${path}`;
  const readable = identity.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[-.]+/, "").slice(0, 80);
  const hash = createHash("sha256").update(identity).digest("hex").slice(0, 12);
  return `${readable}-${hash}`;
}
