# Super app

Hosts Kitchen Sink, Shift Manager, Teammates and Claude Code Style behind one
port, one sub-route each, with a sign-in in front of all of them.

```bash
pnpm build                       # builds everything, plus Kitchen Sink under /kitchen-sink
SUPER_APP_USERNAME=ops SUPER_APP_PASSWORD=… pnpm serve   # port 80, all interfaces
pnpm dev                         # loopback, Kitchen Sink on `next dev`
```

| Route                 | App               | Behind it        |
| --------------------- | ----------------- | ---------------- |
| `/`                   | Landing page      | the proxy        |
| `/login`              | Sign-in           | the proxy        |
| `/kitchen-sink`       | Kitchen Sink      | `127.0.0.1:3110` |
| `/shift-manager/`     | Shift Manager     | `127.0.0.1:3120` |
| `/teammates/`         | Teammates         | `127.0.0.1:3130` |
| `/claude-code-style/` | Claude Code Style | `127.0.0.1:3140` |

## Settings

| Variable | Default | What it does |
| --- | --- | --- |
| `PORT` | `80` | Where the proxy listens. Port 80 needs root on Linux; use `PORT=8080` behind a load balancer. |
| `HOST` | `0.0.0.0` (`serve`), `127.0.0.1` (`dev`) | The interface the proxy binds. The apps always bind loopback. |
| `SUPER_APP_USERNAME`, `SUPER_APP_PASSWORD` | — | The one sign-in. Required for `serve`, and for `dev` on anything but loopback. |
| `SUPER_APP_SECRET` | random per process | Signs the session cookie. Set it so sign-ins survive a restart. |
| `SUPER_APP_SECURE_COOKIE` | off | `1` marks the cookie `Secure`. It is set automatically when a TLS proxy in front sends `x-forwarded-proto: https`. |
| `SUPER_APP_ONLY` | all | Comma-separated app ids to start, e.g. `teammates,shift-manager`. |

Each app also reads its own settings (models, data folders, harness sign-ins);
see its README. They load `.env.local` the way they do standalone.

## How it works

- **Sign-in.** Until a request carries the session cookie `POST /login` sets,
  a page load is sent to `/login` and everything else (API calls, assets,
  streams, WebSocket upgrades) gets `401`. The cookie is `HttpOnly`,
  `SameSite=Lax`, lasts seven days, and is signed with HMAC-SHA256, so nothing
  is stored server-side. It is stripped before a request reaches an app.
  After five wrong passwords from one address, each further attempt waits
  twice as long (up to 15 minutes), and at most four sign-ins are checked at
  once. Behind a load balancer every attempt shares its address, so a guessing
  loop slows sign-in for everyone rather than trusting a forwarded header.
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
- An app that stops leaves the rest running: its route answers `502` and the
  landing page marks it stopped. Log lines carry the app's id.

## Limits

- The labs run as `fsdev dev --app`, the way they run standalone. Each one's
  DevTool listens on its own random loopback port and isn't proxied, so their
  "Open trace" links only work on the machine itself.
- `pnpm dev` serves the labs' built pages (rebuilt at start), not Vite HMR:
  Vite's dev client loads from absolute paths that can't live under a prefix.
  Kitchen Sink keeps `next dev` HMR.
- Kitchen Sink's Bull Board (`REDIS_URL` set) mounts at `/api/admin/queues`
  without the prefix and isn't reachable through the proxy.
