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

## Nginx Proxy Manager

NPM terminates TLS and forwards to the container; Access does the
authenticating in front of it. In the proxy host:

- **Scheme** `http`, **Forward Hostname** the container name or host IP,
  **Forward Port** `3000`
- **Websockets Support** on — the AI chat streams responses
- **SSL** — request a certificate and enable **Force SSL** and **HTTP/2**

Leave NPM's *Access List* empty. It only does HTTP Basic auth, which would put
a second, weaker prompt in front of Access without adding protection.

If NPM runs in its own Compose project, put both on a shared Docker network so
it can resolve the container by name instead of publishing a port.

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
