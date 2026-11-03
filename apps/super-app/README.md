# Super app

Hosts Kitchen Sink, Shift Manager, Teammates and Claude Code Style behind one
port, one sub-route each, with a sign-in in front of all of them.

```bash
pnpm build                       # builds everything, plus Kitchen Sink under /kitchen-sink and the DevTool page
SUPER_APP_USERNAME=ops SUPER_APP_PASSWORD=… SUPER_APP_SECURE_COOKIE=1 pnpm serve   # port 80, all interfaces, HTTPS in front
pnpm dev                         # http://localhost:8080, Kitchen Sink on `next dev`
```

| Route                 | App               | Behind it        |
| --------------------- | ----------------- | ---------------- |
| `/`                   | Landing page      | the proxy        |
| `/login`              | Sign-in           | the proxy        |
| `/kitchen-sink`       | Kitchen Sink      | `127.0.0.1:3110` |
| `/shift-manager/`     | Shift Manager     | `127.0.0.1:3120` |
| `/teammates/`         | Teammates         | `127.0.0.1:3130` |
| `/claude-code-style/` | Claude Code Style | `127.0.0.1:3140` |
| `/devtool/`           | DevTool           | the proxy        |

## DevTool

Every app's pages carry a round button at the bottom right. It opens the DevTool
on that app in a new tab (`/devtool/?app=<id>`). The DevTool is one page with a
switcher across the top: pick another app and the same panel reconnects to it,
with that app's sessions, traces and state. The address holds the choice, so a
link opens straight on an app.

The page talks to each app through the flow API the proxy already serves at
`/<app>/api/flows`, so it needs nothing from the apps themselves. It opens an
app as the user that app declares: Kitchen Sink's one user, and for a lab the
`userId` (and token, if any) its pages carry. With none declared, the panel's own
user editor decides. It sits behind the same sign-in as everything else.

The page is a small Vite build (`pnpm build:devtool`, into `dist/`). `pnpm dev`
rebuilds it at start and again as its source changes; `pnpm serve` serves what `pnpm build` made, and warns when
there is none.

## Settings

| Variable | Default | What it does |
| --- | --- | --- |
| `PORT` | `80` (`serve`), `8080` (`dev`) | Where the proxy listens. Port 80 needs root on Linux; set `PORT` to listen elsewhere behind a load balancer. |
| `HOST` | `0.0.0.0` (`serve`), `127.0.0.1` (`dev`) | The interface the proxy binds. The apps always bind loopback. |
| `SUPER_APP_USERNAME`, `SUPER_APP_PASSWORD` | — | The one sign-in. Required for `serve`, and for `dev` on anything but loopback. |
| `SUPER_APP_SECRET` | random per process | Signs the session cookie. Set it so sign-ins survive a restart. |
| `SUPER_APP_SECURE_COOKIE` | off | `1` says HTTPS is in front of this server: the cookie is marked `Secure`. Off loopback, this or `SUPER_APP_ALLOW_HTTP` is required. |
| `SUPER_APP_ALLOW_HTTP` | off | `1` serves plain HTTP off loopback anyway. Use it only on a network you trust: the password and cookie cross it unencrypted. |
| `SUPER_APP_ONLY` | all | Comma-separated app ids to start, e.g. `teammates,shift-manager`. |

Each app also reads its own settings (models, data folders, harness sign-ins);
see its README. They load `.env.local` the way they do standalone.

## How it works

- **Sign-in.** Until a request carries the session cookie `POST /login` sets,
  a page load is sent to `/login` and everything else (API calls, assets,
  streams, WebSocket upgrades) gets `401`. The cookie is `HttpOnly`,
  `SameSite=Lax`, lasts seven days, and is signed with HMAC-SHA256, so nothing
  is stored server-side. It is stripped before a request reaches an app.
  After five wrong passwords from one address (an IPv6 address counts as its
  /64), each further attempt waits twice as long, up to 15 minutes. Failures
  are remembered for 24 hours, so waiting a lockout out doesn't earn fresh
  tries; a correct sign-in clears them. Past 60 failures a minute across all
  addresses, addresses that have been failing wait out the minute; one that
  hasn't failed still signs in. An address may have two sign-ins in flight,
  and a form that hasn't arrived within 5 seconds is dropped. Behind a load
  balancer every attempt shares its address, so a guessing loop slows sign-in
  for everyone rather than trusting a forwarded header.
- **No sign-in** is allowed only for `pnpm dev` on loopback, and then the proxy
  answers only requests addressed to `localhost`, `127.0.0.1` or `[::1]`, so a
  web page can't reach the apps by rebinding its own domain to this machine.
- **Kitchen Sink** is a Next app, and Next reads `basePath` at build time, so
  `pnpm build` builds it a second time into `.next-super-app` with
  `KITCHEN_SINK_BASE_PATH=/kitchen-sink`. Its root-served `.next` build is untouched.
- **The labs** serve at the root of their own port. Their pages build with
  relative asset URLs against a `<base href="/">`, which the proxy rewrites to
  the app's prefix; the pages read their API's base from it
  (`readBasePath()` in `@flow-state-dev/devtool/react`). The same build works
  standalone and here.
- **The button** is written in by the proxy: a labs' page as it is rewritten, and
  a Next page as it streams past (the page is asked for uncompressed, on the
  loopback hop, so there is text to write into). The script adds the link after
  the page's `load`, to `<html>` rather than `<body>`, so a framework hydrating the
  body never meets a node it didn't render.
- An app that stops leaves the rest running: its route answers `502` and the
  landing page marks it stopped. Log lines carry the app's id.

## Limits

- The labs run as `fsdev dev --app`, the way they run standalone. Each one still
  starts its own DevTool on a random loopback port, which isn't proxied and which
  nothing here uses; use `/devtool/` instead. Their in-app "Open trace" links point
  at that port, so they only work on the machine itself.
- `pnpm dev` picks up client changes, but without HMR: each lab's pages (and the
  DevTool page) are rebuilt with `vite build --watch` once the app is up, and a
  browser refresh loads the new build. Vite's dev client loads from absolute
  paths that can't live under a prefix. Kitchen Sink keeps `next dev` HMR. A
  lab's server side (its flows and config) isn't watched: that needs a restart.
- The button is an inline script, so a `Content-Security-Policy` an app sets
  that forbids inline scripts would stop it showing, with no error on the page.
  None of the hosted apps sets one.
- Kitchen Sink's Bull Board (`REDIS_URL` set) mounts at `/api/admin/queues`
  without the prefix and isn't reachable through the proxy.
- A lab page's relative URLs resolve against its `<base href>`, so a
  hash-only link (`href="#section"`) opens `/<prefix>/#section`, not the
  current page's anchor. None of the labs has one today; write
  `href={`${location.pathname}#section`}` (or scroll in code) if one is added.
