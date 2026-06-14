# DEPLOY — host DOOM-TS multiplayer on your own server

Self-host the game so friends join by IP/URL. This runbook implements
[`docs/research/multiplayer-deploy.md`](../docs/research/multiplayer-deploy.md), adapted to what
this repo actually is: a **single npm package** with a **Colyseus** match server (not the
`ws`-library monorepo the research doc sketched). The deploy shape is the doc's recommendation —
**one Node process serves the built client + the realtime server, with Caddy in front for
automatic HTTPS**.

## How it's served (the one thing to understand)

`server/prod.ts` is one Node process that, on a single port (default **2567**), serves:
- the **static client** (`dist/`, from `vite build`) via Express, with the cross-origin-isolation
  headers the game wants, and
- the **Colyseus WebSocket** endpoint **and** its `/matchmake` HTTP routes (same `MatchRoom` the
  dev server uses — packaging only, no game-logic change).

Because everything is one origin/port, the client connects to the **same host it was served
from** — no hardcoded server URL. In dev the client still targets `:2567` (Vite serves on a
different port); the resolution lives in `src/game/client.ts` and can be overridden at build time
with `VITE_MP_SERVER_URL`.

```
                 ┌─────────── your VPS ───────────┐
 friends ──443──▶│  Caddy (auto-HTTPS)            │
  (wss + https)  │    └─reverse_proxy─▶ :2567     │
                 │        Node: client + Colyseus │
                 └────────────────────────────────┘
```

## Files in this directory

| File | What it is |
|------|-----------|
| `Caddyfile` | Reverse proxy + automatic HTTPS (TLS variant B + a LAN/HTTP note). |
| `Dockerfile` + `docker-compose.yml` | Containerized run: game + Caddy. Build context = repo root. |
| `doom.service` | systemd unit (the non-Docker path; recommended for a set-and-forget box). |
| `deploy.sh` | Build locally + rsync to the box + restart the service (repeatable redeploy). |
| `.env.example` | All tunables (PORT/HOST, DOOM_HOST, DOOM_UPSTREAM, VITE_MP_SERVER_URL). |
| `verify-prod.ts` | Local check: two clients host+join a co-op match over the prod server. |

---

## Quick LAN test (5 minutes, no VPS, no TLS)

Confirms the production build works end to end on your own machine / LAN.

```bash
npm install
npm run extract-assets     # one-time: populate public/assets (needs Freedoom WADs, see below)
npm run build:all          # tsc + vite build -> dist/
npm run start:prod         # serves client + ws on http://0.0.0.0:2567
```

Open `http://localhost:2567/` (or `http://<your-LAN-ip>:2567/` from another machine on the LAN).
Host a room in one tab, join from a second tab — you're in a co-op match over the **prod**
process (not the Vite dev server). Plain HTTP means the page uses `ws://` (allowed because the
page itself is insecure); for "real" internet hosting use the TLS path below.

> **Assets:** the Freedoom WADs are not in the repo (`*.wad` is gitignored). Download them per
> `tools/extract-wad/README.md`, then `npm run extract-assets`. Without assets the client still
> boots but has no textures/sounds.

Automated equivalent of the host+join check (no browser needed), against a running prod server:

```bash
npm run start:prod &                 # in one shell
npx tsx deploy/verify-prod.ts        # in another: drives 2 clients through host->join->co-op start
```

---

## Full VPS deploy (TLS, recommended)

Assumes an **Ubuntu LTS** VPS (e.g. Hetzner CX23) with a public IPv4 — call it `203.0.113.5`.
Replace IPs/hostnames with yours. Two run options below: **systemd** (simplest) or **Docker**.

### Phase 0 — Build the client locally

```bash
npm install
npm run extract-assets         # populate public/assets (needs the Freedoom WADs)
npm run build:all              # -> dist/
```

### Phase 1 — Provision the box (one time)

```bash
ssh root@203.0.113.5
adduser doom && usermod -aG sudo doom
# copy your SSH key to the doom user (ssh-copy-id doom@203.0.113.5), then log in as doom
sudo apt update && sudo apt -y upgrade
sudo apt -y install ufw fail2ban
# Node 22 LTS:
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt -y install nodejs
node -v        # confirm v22.x
```

Harden SSH (`/etc/ssh/sshd_config`: `PasswordAuthentication no`, `PermitRootLogin no`; restart
sshd) per `multiplayer-deploy.md §8`.

### Phase 2 — Firewall (one time)

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status
```

Note: port **2567 is NOT opened** — Caddy reaches the Node process over localhost. (Only open
2567 if you do the no-Caddy raw-IP test.)

### Phase 3 — Ship + run the game (systemd)

From your machine, the script builds, rsyncs, installs, and restarts:

```bash
deploy/deploy.sh doom@203.0.113.5 /opt/doom
```

The first time, install the service on the box:

```bash
ssh doom@203.0.113.5
cd /opt/doom
sudo cp deploy/doom.service /etc/systemd/system/doom.service
sudo systemctl daemon-reload
sudo systemctl enable --now doom
journalctl -u doom -f      # expect: [prod] DOOM client + match server on http://0.0.0.0:2567
```

### Phase 4 — Caddy + automatic HTTPS (one time)

Pick a free hostname that maps to your IP — `203.0.113.5` → `203-0-113-5.sslip.io` (sslip.io),
or a DuckDNS name, or a domain you own.

```bash
# install Caddy (official apt repo)
sudo apt -y install debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt -y install caddy

# install the repo's Caddyfile and point it at your host
sudo cp /opt/doom/deploy/Caddyfile /etc/caddy/Caddyfile
sudo sed -i 's/203-0-113-5.sslip.io/YOUR-HOST-HERE/' /etc/caddy/Caddyfile   # or edit by hand
sudo systemctl reload caddy
# Caddy now auto-fetches a Let's Encrypt cert for that host. Watch: journalctl -u caddy -f
```

### Phase 5 — Friends connect

Send them **`https://<your-host>/`** (e.g. `https://203-0-113-5.sslip.io/`). They land in the
client, host or join a room (co-op / deathmatch chosen in the lobby), and play. The page is HTTPS
so the client uses `wss://` automatically — no config on their end.

### Phase 6 — Redeploy later

```bash
deploy/deploy.sh doom@203.0.113.5 /opt/doom    # rebuild + ship + restart doom
```

---

## Alternative: Docker instead of systemd

One command brings up the game + Caddy (TLS) together:

```bash
npm run extract-assets    # assets must exist in the build context first
DOOM_HOST=203-0-113-5.sslip.io docker compose -f deploy/docker-compose.yml up -d --build
```

Caddy gets the cert for `$DOOM_HOST` and proxies to the `doom` container. Friends open
`https://$DOOM_HOST/`. Logs: `docker compose -f deploy/docker-compose.yml logs -f`. For a no-TLS
LAN test, see the commented block at the bottom of `docker-compose.yml`.

---

## Raw-IP / no-TLS variant (quick smoke test only)

Skip Caddy entirely. Open 2567 and run the prod process directly:

```bash
sudo ufw allow 2567/tcp
PORT=2567 HOST=0.0.0.0 npm run start:prod    # or via systemd
```

Friends open `http://203.0.113.5:2567/`. The page is plain HTTP, so `ws://` is allowed. **No
encryption, no secure context** (SharedArrayBuffer/cross-origin isolation off). Use only to
confirm connectivity, then switch to the TLS path and `sudo ufw delete allow 2567/tcp`.

---

## Configurable server URL (reference)

The client resolves its match-server endpoint in this order (`src/game/client.ts`):

1. **`VITE_MP_SERVER_URL`** — build-time override. `VITE_MP_SERVER_URL=wss://my.host npm run build:all`
   pins the client to that server (use when the client is hosted separately from the server).
2. **production build** — same origin as the page: `https://` page → `wss://<host>`,
   `http://` page → `ws://<host>` (no port). This is the normal single-host deploy; nothing to set.
3. **dev** (`npm run dev`) — `ws://<hostname>:2567`, since Vite and Colyseus run on different ports.
