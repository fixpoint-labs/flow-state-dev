/**
 * The connection config an app's server writes into its pages.
 *
 * `fsdev dev` serves each lab's pages with a
 * `<script>window.__FSD_DEVTOOL_CONFIG__ = {…};</script>` carrying the `userId`
 * (and, when the lab's config sets one, a bearer token) its flows expect. The
 * standalone DevTool reads that global from its own page. Here one DevTool page
 * fronts several apps, so it reads each app's value out of that app's page
 * instead, fetched through the proxy.
 */

/**
 * @typedef {object} InjectedConfig
 * @property {string} [userId]
 * @property {string} [bearerToken]
 */

/**
 * The config a page's HTML declares; `{}` when it declares none, or one that
 * doesn't parse. Blank values are dropped, as the DevTool's own reader does.
 *
 * @param {string} html
 * @returns {InjectedConfig}
 */
export function parseInjectedConfig(html) {
  const found = html.match(/window\.__FSD_DEVTOOL_CONFIG__\s*=\s*(\{[^<]*\})\s*;?\s*<\/script>/);
  if (found === null) return {};
  try {
    const value = JSON.parse(found[1]);
    /** @type {InjectedConfig} */
    const config = {};
    if (typeof value.userId === "string" && value.userId.trim() !== "") config.userId = value.userId;
    if (typeof value.bearerToken === "string" && value.bearerToken.trim() !== "") config.bearerToken = value.bearerToken;
    return config;
  } catch {
    return {};
  }
}
