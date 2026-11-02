/**
 * What the super app's own pages (the landing page and the login page) share:
 * their look, and escaping text written into their HTML.
 */

/** The shared look of the super app's own pages, light and dark. */
export const PAGE_STYLE = `:root{color-scheme:light dark;--bg:#fafaf9;--fg:#1c1917;--muted:#78716c;--card:#fff;--line:#e7e5e4;--accent:#1c1917;--on-accent:#fafaf9;--bad:#dc2626}
@media (prefers-color-scheme:dark){:root{--bg:#0c0a09;--fg:#f5f5f4;--muted:#a8a29e;--card:#1c1917;--line:#292524;--accent:#f5f5f4;--on-accent:#0c0a09;--bad:#f87171}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif}`;

/** Text made safe to write into HTML, as content or as a quoted attribute value. */
export const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
