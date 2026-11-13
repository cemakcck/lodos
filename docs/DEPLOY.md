# Deploying Lodos

Lodos runs as **one long-lived Node 22 process** (the API, which also serves the built web app) plus a **MongoDB replica set**. This page covers the hosting details; the [README](../README.md) covers running it locally.

## Environment variables

| Variable | Required | What it does |
| --- | --- | --- |
| `MONGODB_URI` | yes | MongoDB connection string. It must be a replica set (transactions) |
| `SESSION_SECRET` | yes | Signs session and sandbox cookies; at least 32 characters |
| `DEMO_MODE` | no | `1` turns on the demo: a sandbox per visitor, the banner, one-click roles, the simulator |
| `WEB_ORIGIN` | no | The web app's origin, for CORS (default `http://localhost:5180`) |
| `PORT`, `HOST` | no | Where the API listens (default `4100` on `0.0.0.0`) |
| `DEMO_SANDBOXES_PER_IP_HOUR` | no | New sandboxes allowed per IP per hour (default 5) |
| `TRUST_PROXY` | no | Behind a reverse proxy: `false` (default), `true`, a hop count, or a comma-separated list of proxy IPs / CIDRs. Per-IP limits then see the client's address |
| `COOKIE_SECURE` | no | `1` / `0`: session and sandbox cookies are HTTPS-only. Defaults to on when `NODE_ENV=production` |

**Storage caps.** Every restaurant (and every demo sandbox) holds at most 120 dishes and 20 MB of uploaded photos; past that, creating a dish or uploading a photo answers `409 limit_exceeded`. Replacing a photo frees the old one first. The caps are always on, not only in demo mode: a public demo visitor must not be able to fill the database, and a real menu never comes near them.

## A real restaurant (demo mode off)

With `DEMO_MODE=1` every visitor gets a seeded sandbox and the banner's one-click roles; nobody needs a PIN except for a manager approval (the demo PINs are in the README). With demo mode off, set up the restaurant from the command line instead (it refuses to run while `DEMO_MODE=1`):

```bash
npm run setup -w @lodos/api -- --tenant main --seed-menu \
  --staff "Selin:manager:482910" --staff "Deniz:waiter:1234" --staff "Kitchen:kitchen:5555" --staff "Bar:bar:6666"
```

`--seed-menu` loads the Lodos menu, rooms and tables without the demo's live service; `--staff "Name:role:PIN"` creates or updates a person (roles: manager, waiter, kitchen, bar).

## Railway (one container)

The `Dockerfile` builds the web app and the API into one image, and the API serves the built app itself (`WEB_DIST`, set in the image), so `/api`, `/socket.io` and the pages share one origin with no proxy to configure. `railway.json` points Railway at the Dockerfile and health-checks `/api/health`.

1. Create a free MongoDB Atlas cluster (M0). Under Network Access allow `0.0.0.0/0` (Railway has no fixed outbound IP), create a database user, and copy the connection string with a database name, e.g. `mongodb+srv://lodos:<password>@cluster0.xxxxx.mongodb.net/lodos?retryWrites=true&w=majority`.
2. In Railway: New Project → Deploy from GitHub repo → this repo. Then Settings → Networking → Generate Domain.
3. Variables: `MONGODB_URI` (from step 1), `SESSION_SECRET` (`openssl rand -base64 48`), `DEMO_MODE=1`, `WEB_ORIGIN=https://<the generated domain>`, `TRUST_PROXY=1`. Railway sets `PORT`; the image sets `NODE_ENV=production`, which makes cookies Secure.
4. Keep one replica (Socket.IO rooms and the demo timers live in one process, see below).

## Other hosts

The supported setup is **one origin**: either run the image above, or have the web host serve the built app and reverse-proxy `/api` and `/socket.io` to the API. The client uses relative URLs, so the browser only ever talks to the web origin, and the staff session cookie is first-party everywhere (iPad Safari included). The spec's alternative of an `api.lodos.<domain>` subdomain is not supported: the client has no setting for a separate API origin.

- **Proxy both paths**, and pass the WebSocket upgrade for `/socket.io` (`Upgrade` and `Connection` headers). In nginx that is a `location /socket.io/` block with `proxy_http_version 1.1`, `proxy_set_header Upgrade $http_upgrade` and `proxy_set_header Connection "upgrade"`.
- **`TRUST_PROXY`**: set it to the hops in front of the API (often `1`, or the proxy's address), so `X-Forwarded-For` gives the client's address to the per-IP limits. Leave it `false` when nothing sits in front: then the header is ignored and cannot be spoofed.
- **`NODE_ENV=production`** turns on `COOKIE_SECURE`, so cookies are sent over HTTPS only. Serve the site over HTTPS; set `COOKIE_SECURE=0` only for a local production build on plain HTTP.
- **`SESSION_SECRET`**: a fresh random string of 32 characters or more (`openssl rand -base64 48`). Changing it signs everyone out.
- **`WEB_ORIGIN`**: the public origin of the web app, for example `https://lodos.example.com`.
- **`DEMO_MODE`**: `1` for the public portfolio demo, unset for a real restaurant (then run `npm run setup`, see [A real restaurant](#a-real-restaurant-demo-mode-off)).
- **MongoDB**: Atlas works, but it must be a replica set (every Atlas cluster is), because orders use multi-document transactions.
- **The API must be always on.** It holds the Socket.IO connections and runs the demo's sandbox cleanup and order simulator on timers, so a host that sleeps idle processes or runs functions per request will drop live updates. Use a long-running Node 22 process (a VM, a container, or a platform's always-on tier).
