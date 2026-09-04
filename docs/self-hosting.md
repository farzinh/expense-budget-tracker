# Self-hosting

Run the app on your own server with Docker, without any AWS dependency.

The AWS path in [deployment.md](deployment.md) is unchanged and remains the
upstream hosted setup. This document covers `AUTH_MODE=cloudflare_access`,
which exists so the app can be deployed outside AWS.

## What runs where

| Component | Self-hosted | AWS path |
| --- | --- | --- |
| Postgres | `postgres` container | RDS |
| Migrations | `migrate` container | ECS task |
| Web app | `web` container | ECS Fargate |
| FX worker | `worker` container | Lambda + EventBridge |
| Authentication | Cloudflare Access | Cognito + `auth` container |

Only authentication differs. The worker reads `DATABASE_URL` directly and only
touches Secrets Manager when `DB_SECRET_ARN` is set, so nothing else needs AWS.

## Why authentication cannot simply be turned off

`AUTH_MODE=none` treats every request as a single hardcoded local user. The
startup guard in [`apps/web/src/server/authMode.ts`](../apps/web/src/server/authMode.ts)
therefore refuses it in a production build on a non-loopback host, and refuses
it entirely unless `CORS_ORIGIN` is a local http origin. That last check is
never waived, so `none` can never serve a public domain.

A TLS-terminating reverse proxy — Nginx Proxy Manager, Caddy, Traefik — does
**not** authenticate anyone. Putting the app behind one and disabling auth
would publish your financial data. Something has to actually identify the user,
which is what Cloudflare Access does here.

## Setting up Cloudflare Access

Prerequisites: a domain on Cloudflare, and a server reachable from it.

1. **Create the Zero Trust team.** In the Cloudflare dashboard open **Zero
   Trust**. Pick a team name; your team domain becomes
   `<team>.cloudflareaccess.com`. The free plan covers up to 50 users.

2. **Point the subdomain at your server.** Add a DNS record for
   `money.example.com` in Cloudflare. Keep it **proxied** (orange cloud) —
   Access can only protect proxied traffic.

3. **Create the Access application.** **Zero Trust → Access → Applications →
   Add an application → Self-hosted**. Set the domain to `money.example.com`.

4. **Add a policy.** Action *Allow*, with a rule such as *Emails* →
   your own address. This is who may reach the app at all.

5. **Copy the audience tag.** On the application's **Overview** tab, copy the
   **Application Audience (AUD) Tag** — a 64-character hex string. This binds a
   token to this one application; without it, a token minted for any other
   application in your team would be accepted.

6. **Configure the app.** In `infra/docker/.env`:

   ```bash
   AUTH_MODE=cloudflare_access
   ALLOW_INSECURE_NO_AUTH=
   CORS_ORIGIN=https://money.example.com
   CF_ACCESS_TEAM_DOMAIN=yourteam.cloudflareaccess.com
   CF_ACCESS_AUD=<the 64-character tag from step 5>
   ```

   Then `make up` (or redeploy the stack in Portainer).

   `COOKIE_DOMAIN` is not needed here. It only scopes the session, refresh, and
   `logged_in` cookies of the Cognito flow; in this mode Cloudflare owns the
   session and the app issues no cookie of its own except `__Host-csrf`, whose
   prefix forbids a `Domain` attribute.

### Why the public origin, when the app listens on a LAN address

`CORS_ORIGIN` is the origin **the browser** uses, not the address the container
binds to. It is compared against the `Origin` header on every mutating request
in `checkCsrf`, so it has to be the URL in the address bar
(`https://money.example.com`). Setting it to the LAN address the proxy forwards
to makes every write fail CSRF validation with `403`.

It must also be `https`, because the `__Host-csrf` cookie is issued `Secure`. A
browser will not store a `Secure` cookie from a plain-http origin, so every
write would fail even before the origin comparison.

The app verifies the assertion Access forwards against
`https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`, checking both the
issuer and the audience, and maps the token's `sub` to the user id and `email`
to the account address.

## Closing the bypass

Access protects the Cloudflare edge. If your origin is reachable directly by
IP, an attacker can skip Access entirely.

The app refuses any request that arrives without a valid assertion — it answers
`403` rather than falling back to an unauthenticated session — so a bypass
attempt fails closed. That is the app-side half. Close the network half too:

- **Best: Cloudflare Tunnel.** Run `cloudflared` next to the app and publish
  nothing. The origin has no inbound ports at all, so there is no direct path
  to bypass.
- **Otherwise: allowlist Cloudflare.** Restrict inbound 80/443 to
  [Cloudflare's IP ranges](https://www.cloudflare.com/ips/) at your firewall.
  `scripts/update-cloudflare-ips.sh` maintains such a list.

Do not publish the `web` container's port on a public interface. Bind it to
localhost and let the proxy reach it there:

```yaml
services:
  web:
    ports:
      - "127.0.0.1:3000:3000"
```

## Deploying with Portainer

`infra/docker/compose.yml` cannot be deployed from Portainer's web editor. It
builds images from relative contexts (`context: ../..`) and bind-mounts
`../../scripts` and `../../db` into the migrate container. Portainer writes a
web-editor stack to its own directory, so there is no repository above it and
none of those paths resolve.

Use `infra/docker/compose.portainer.yml` instead. It references prebuilt images
and mounts nothing, so the server only ever pulls.

### 1. Publish the images

`.github/workflows/publish-images.yml` builds `web`, `worker`, and `migrate`
and pushes them to GHCR on every push to `main`, or on demand from the Actions
tab. Nothing is compiled on the server — worth having regardless of disk space,
because `next build` wants around 2GB of RAM and is the usual reason a build
started from Portainer fails.

The default target is `linux/amd64`. For an ARM host (Raspberry Pi, Ampere)
run the workflow manually and pick `linux/arm64`. Building ARM images under
QEMU emulation is slow, so expect a long first run.

Packages inherit the repository's visibility. If yours is private, authenticate
the server once:

```bash
echo <github-personal-access-token> | docker login ghcr.io -u <username> --password-stdin
```

The token needs only `read:packages`.

### 2. Create the stack

**Portainer → Stacks → Add stack → Web editor.** Paste the contents of
`compose.portainer.yml`, then add these under **Environment variables**:

| Variable | Value |
| --- | --- |
| `IMAGE_PREFIX` | `ghcr.io/<user>/expense-budget-tracker` |
| `IMAGE_TAG` | `latest`, or a commit SHA to pin |
| `POSTGRES_PASSWORD` | generate one, e.g. `openssl rand -hex 24` |
| `APP_DB_PASSWORD` | generate one |
| `WORKER_DB_PASSWORD` | generate one |
| `AUTH_DB_PASSWORD` | generate one |
| `CORS_ORIGIN` | `https://money.example.com` |
| `CF_ACCESS_TEAM_DOMAIN` | `yourteam.cloudflareaccess.com` |
| `CF_ACCESS_AUD` | the Access application audience tag |
| `OPENAI_API_KEY` | optional, for the AI chat |

Every required variable is declared `${VAR:?}`, so a missing one fails the
deploy with a message naming it rather than starting a broken stack.

The database passwords are read on first deploy, when the roles are created.
Changing them later does not re-issue the roles; you would need to `ALTER ROLE`
in Postgres to match.

### 3. Check it came up

`migrate` shows **Exited** — that is success, not a failure. It applies the
migrations and stops, and `web` and `worker` start only because it exited `0`.
Confirm with `Exited (0)`; a non-zero code means migrations failed and the
other services will not have started.

`postgres` is not published on the host at all — nothing outside the stack
needs it — and `web` is bound to `127.0.0.1` so the only route in is the
reverse proxy.

### 4. Updating

Push to `main`, wait for the workflow, then **Update the stack** in Portainer
with *Re-pull image* enabled. To roll back, set `IMAGE_TAG` to an earlier
commit SHA and redeploy.

## Nginx Proxy Manager

NPM terminates TLS and forwards to the container; Access does the
authenticating in front of it. In the proxy host:

- **Scheme** `http`, **Forward Hostname** the container name or host IP,
  **Forward Port** `3000`
- **Websockets Support** on — the AI chat streams responses
- **SSL** — request a certificate and enable **Force SSL** and **HTTP/2**

Leave NPM's *Access List* empty. It only does HTTP Basic auth, which would put
a second, weaker prompt in front of Access without adding protection.

### If the proxy runs on a different host

A shared Docker network is not available across machines, so the app has to be
reachable over the LAN. Set `WEB_BIND` to the app host's LAN address:

```
WEB_BIND=192.168.1.215
```

Then point the proxy host at `192.168.1.215:3000`. Two things keep this safe:

- A private RFC1918 address is not routable from the internet. Forward only
  443 to the proxy on your router — never forward this port. If your firewall
  allows it, restrict the port to the proxy's IP:
  `ufw allow from <proxy-ip> to any port 3000 proto tcp`.
- The app still refuses any request without a valid Access assertion, so
  reaching it directly from the LAN returns `403` rather than data. Verify
  that from another machine: `curl -i http://192.168.1.215:3000/` should be
  `403`, and `/api/live` should be `200`.

The assertion travels as the `Cf-Access-Jwt-Assertion` header, which nginx
forwards unchanged, so no extra proxy configuration is needed for it.

### If NPM runs in a container

This is the usual case with Portainer, and it changes the wiring. A port
published on `127.0.0.1` is on the **host's** loopback; inside the NPM
container `127.0.0.1` is NPM itself, so it cannot reach the app there. Pointing
a proxy host at `127.0.0.1:3000` will fail to connect.

Put both on the same Docker network instead:

1. Delete the `ports:` block from the `web` service in
   `compose.portainer.yml`.
2. Attach NPM to the stack's network — **Portainer → Containers → your NPM
   container → Join network** — or uncomment the `networks:` blocks at the
   bottom of that file and set `PROXY_NETWORK`.
3. Set the proxy host's **Forward Hostname** to `web` and **Forward Port** to
   `3000`.

This is the stronger arrangement anyway: with no published port the app is
unreachable except through the proxy, by construction rather than by firewall
rule.

The loopback publish is only right when NPM is installed directly on the host,
or runs with `network_mode: host`.

## Local testing in Docker

The defaults in `infra/docker/.env.example` bring up the whole stack
unauthenticated on `http://localhost:3000`:

```bash
make up
```

That works because `ALLOW_INSECURE_NO_AUTH=true` is set together with a local
`CORS_ORIGIN`. Remove it for any deployment — with a non-local `CORS_ORIGIN`
the app refuses to start, and the boot log carries a warning whenever the flag
is active.

For UI work prefer the dev server, which hot-reloads; the Docker image is a
production build, so every change otherwise needs
`docker compose -f infra/docker/compose.yml build web`:

```bash
make up            # database, migrations, FX worker
cd apps/web && AUTH_MODE=none CORS_ORIGIN=http://localhost:3000 \
  DATABASE_URL="postgresql://app:app@localhost:5432/tracker" npm run dev
```

## Backups

Everything lives in Postgres. The named volume `pgdata` holds it:

```bash
docker compose -f infra/docker/compose.yml exec -T postgres \
  pg_dump -U tracker tracker | gzip > tracker-$(date +%F).sql.gz
```

## Agent and MCP access

The `Authorization: ApiKey` path used by external agents is checked in the app
and does not depend on the auth mode, so API keys keep working. Exclude
`/api/agent` from Access (or use a service token) if you want agents to reach
it without a browser login.
