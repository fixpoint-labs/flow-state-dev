/**
 * What a project's `repository` may hold: a git remote, the address you'd pass
 * to `git clone`, and never a folder on some machine or a secret.
 *
 * One function, in a module of its own, so `createProject` and `setRepository`
 * give the same answer and a test can swap it to prove the writes have no
 * other fence (the `any-repository` control).
 *
 * Two spellings are remotes: a URL (`https://…`, `ssh://…`, `file://…`, any
 * `scheme://`), and git's scp-like form `[user@]host:path`, which git
 * recognises only when no `/` comes before the first `:`. Anything else is a
 * path and is refused. So is a value that starts with `-` (git would read it
 * as an option), one holding a control character, a remote-helper address (`ext::…`), and a credential: a user
 * or password on `http(s)`, or a password on any scheme. An SSH login name
 * (`git@host:org/repo`, `ssh://git@host/org/repo`) is not a credential.
 *
 * The answer never repeats the value: a refused value may carry a token.
 *
 * Which schemes and hosts a host actually reaches is the host's call, made
 * when it provisions a run; this only decides what a row may record.
 */

/** A URL remote: a scheme, then `://`. */
const URL_REMOTE = /^([A-Za-z][A-Za-z0-9+.-]*):\/\//;
/** git's remote-helper syntax, `<transport>::<address>`, such as `ext::sh -c …`. */
const REMOTE_HELPER = /^[A-Za-z][A-Za-z0-9+.-]*::/;

const CREDENTIAL =
  "the repository carries a credential (a user or password in the address). Give the host its credentials instead";
const OPTION = 'a repository can\'t start with "-": git would read it as an option';
const NOT_A_REMOTE =
  "the repository is a path, not a remote. Name the address you'd pass to git clone, such as https://github.com/acme/storefront.git or git@github.com:acme/storefront.git";

/**
 * Why `value` can't be a project's repository, or `undefined` when it can.
 * Never includes `value` itself.
 */
export function repositoryProblem(value: string): string | undefined {
  if (value.length === 0) return "a repository can't be empty. Send null to clear it";
  if (value !== value.trim()) return "a repository can't start or end with whitespace";
  // A URL parser drops a newline or tab silently, so the stored string and the parsed one would differ.
  if (/[\u0000-\u001f\u007f]/.test(value)) return "a repository can't contain control characters";
  if (value.startsWith("-")) return OPTION;
  if (REMOTE_HELPER.test(value)) return "a repository can't be a remote-helper address (transport::address)";

  const url = URL_REMOTE.exec(value);
  if (url !== null) {
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      return "the repository is not a valid URL";
    }
    const scheme = url[1]!.toLowerCase();
    if (parsed.password !== "") return CREDENTIAL;
    if ((scheme === "http" || scheme === "https") && parsed.username !== "") return CREDENTIAL;
    if (parsed.hostname.startsWith("-")) return OPTION;
    if (scheme !== "file" && parsed.hostname === "") return "the repository URL names no host";
    return undefined;
  }

  // scp-like: `[user@]host:path`, only when no `/` comes before the first `:`.
  const colon = value.indexOf(":");
  const slash = value.indexOf("/");
  if (colon <= 0 || (slash !== -1 && slash < colon)) return NOT_A_REMOTE;
  const at = value.indexOf("@");
  if (at !== -1 && value.slice(0, at).includes(":")) return CREDENTIAL;
  const login = value.slice(0, colon);
  const host = login.slice(login.lastIndexOf("@") + 1);
  // `C:\code` or `C:/code`: a Windows drive, not a one-letter host.
  if (/^[A-Za-z]$/.test(login) && /^[\\/]/.test(value.slice(colon + 1))) return NOT_A_REMOTE;
  if (host.length === 0) return "the repository names no host";
  if (host.startsWith("-")) return OPTION;
  if (colon === value.length - 1) return "the repository names no path on its host";
  return undefined;
}
