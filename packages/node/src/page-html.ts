/**
 * The HTML a host writes into every page it serves: extra `<meta>` tags, an
 * inline script, and the DevTool connection config
 * (`window.__FSD_DEVTOOL_CONFIG__`).
 *
 * `serve()` applies it to the `index.html`, any other `.html` file, and the SPA
 * fallback under `staticDir`. A page handler that renders its own index (a dev
 * server's middleware, say) applies the same transform, so there is one writer
 * and one loopback rule for the credential.
 */
import type { DevToolConnectionConfig } from "@flow-state-dev/engine";
import { isLoopbackHost } from "./bind-guard";
import { injectDevtoolConfig, insertBeforeHeadClose } from "./devtool-config-injection";

/** Options for {@link createPageHtmlTransform}. */
export interface PageHtmlOptions {
  /** The host the server binds. The DevTool config is written only for a loopback host. */
  host: string;
  /** DevTool connection config (userId / bearer token). Loopback hosts only. */
  devtoolConfig?: DevToolConnectionConfig;
  /** `<meta name content>` tags, written on any host. Not for secrets. */
  pageMeta?: Record<string, string>;
  /** Inline script body, written after the meta tags on any host. Not for secrets. */
  pageScript?: string;
}

/**
 * Build the transform a host applies to each HTML page it serves, or
 * `undefined` when there is nothing to write: no `pageMeta` entries, no
 * `pageScript`, and no `devtoolConfig` or a non-loopback `host`. A host that
 * gets `undefined` serves its HTML byte for byte.
 *
 * The meta tags go just before `</head>`, then the page script (so it can read
 * them), then the config script. Meta names and values are attribute-escaped;
 * a `</` in the script is written `<\/` so it can't close the element.
 */
export function createPageHtmlTransform(
  options: PageHtmlOptions,
): ((html: string) => string) | undefined {
  const { devtoolConfig, pageMeta, pageScript } = options;
  const config = devtoolConfig !== undefined && isLoopbackHost(options.host) ? devtoolConfig : undefined;
  const metaTags = Object.entries(pageMeta ?? {})
    .map(([name, content]) => `<meta name="${escapeAttribute(name)}" content="${escapeAttribute(content)}">`)
    .join("");
  const scriptTag = pageScript === undefined ? "" : `<script>${pageScript.replace(/<\//g, "<\\/")}</script>`;
  const tags = metaTags + scriptTag;
  if (config === undefined && tags.length === 0) return undefined;
  return (html) => {
    const withMeta = tags.length === 0 ? html : insertBeforeHeadClose(html, tags);
    return config === undefined ? withMeta : injectDevtoolConfig(withMeta, config);
  };
}

/** Escape a value for a double-quoted HTML attribute. */
function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
