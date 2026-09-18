# The system of record — running it

Node and Postgres. This process is the whole back end: the `/api` surface
(`src/api.js`), the org-scoped data access layer every query goes through
(`src/store.js`), and the planner's own files served from the same origin
(`src/static.js`). One dependency, `pg`; passwords are `node:crypto` scrypt and
the HTTP layer is `node:http`.

**Nothing is hosted.** What is written here is the image, the two-container
compose stack and the environment contract — deliberately, because a hosting
target and its secrets are facts nobody has supplied yet, and guessing either
would put a half-configured server in front of real work. When a host is named,
§"Going live" below is the checklist; until then this is a laptop runbook.

## Local, both containers

```sh
cd server
docker compose up -d --build
# http://localhost:8080/  -> 302 to /v2/index.html
```

`app` builds from the repository root (`docker build -f server/Dockerfile ..`),
because the image serves `web/` as well as the API. It reaches Postgres by
service name inside the compose network, and waits for the healthcheck.

## Local, app on the host

Postgres in Docker, Node on the machine — the loop for working on the server
itself:

```sh
cd server
docker compose up -d db
cp .env.example .env        # then read it; the comments are the contract
npm install
npm start                   # http://localhost:8080
```

## Tests

```sh
cd server
docker compose up -d db
npm test
```

The suite runs against a real Postgres, because every rule worth testing here is
enforced in SQL: the org scope is a predicate, the `If-Match` check is a `WHERE`
clause, and the soft delete is a partial index. `pretest` applies the schema, and
`db/migrate.js` is idempotent — `server.js` applies it again on boot, and both
are safe to repeat. Isolation comes from each test signing up its own firm, not
from truncating tables.

The client suite is separate and needs neither Docker nor a network:

```sh
cd web/v2 && npm test
```

## The environment

`.env.example` is the contract and its comments are the reasoning. The four that
bite:

| Variable | Local | Why |
|---|---|---|
| `DATABASE_URL` | `...@localhost:5440/...` on the host, `...@db:5432/...` inside compose | Two different networks, one for each way of running it |
| `COOKIE_SECURE` | `0` | A `Secure` cookie over plain HTTP is dropped by the browser and sign-in fails with nothing in any log. `1` the moment HTTPS is in front |
| `TRUST_PROXY` | `0` | `X-Forwarded-For` is client-controlled unless something in front rewrites it; trusting it while exposed makes the sign-in rate limit a formality |
| `ALLOWED_ORIGINS` | empty | The planner is same-origin, so no cross-origin request is expected. It is an allowlist, never `*`, because these responses carry a credentialed cookie |

**Port 5440 is not arbitrary.** A machine with Revit on it has usually collected
a Postgres install or two, and 5432–5434 are the ones they take. Binding one of
those fails as "password authentication failed" against somebody else's
database rather than as an honest refusal to start. Ports above 50000 are no
better on Windows: Hyper-V reserves large blocks up there and Docker reports
them as already allocated.

## Smoke checklist

After `docker compose up -d --build`, or after any deploy:

1. `curl -i http://localhost:8080/` → `302` to `/v2/index.html`. The index is a
   redirect and not bytes served at `/`, because the planner loads its modules,
   its stylesheet and its type pack by relative URL: served at `/`, its own
   `./ui.js` and `../samples/tsp-pack.json` resolve one directory too high and
   404, which looks like a blank app with no error.
2. `http://localhost:8080/v2/index.html` in a browser → the pack loads and the
   status line reads "*N* SKUs loaded".
3. `curl http://localhost:8080/api/auth/session` → `{"signedIn":false}`.
4. Create an account, draw something, and watch the chrome say **Saved**.
5. Reload. The job comes back from the server.
6. Clear all site data and reload. Sign in again: the job is still there, which
   is the whole claim.
7. New, then Open the first job again — the first one is unchanged. Two jobs are
   two rows.

## Going live

Not done, and not to be guessed at. What it needs, in order:

1. **A named host.** Fly, Railway, a VPS, anything — but named, because the
   deploy shape (managed Postgres versus a container, TLS termination, secret
   storage) follows from it and cannot be written first.
2. A real `DATABASE_URL` to a managed Postgres, and `sslmode` set to whatever
   that provider actually requires rather than to `disable` to make an error go
   away.
3. HTTPS in front, then `COOKIE_SECURE=1` and `TRUST_PROXY=1` — the second only
   if that proxy really does rewrite `X-Forwarded-For`.
4. A backup schedule for the database. It is the system of record: the browser
   holds nothing but a cache, so a lost database is lost work, and no amount of
   soft deletes helps if the rows are gone.
5. `web/v2/index.html` currently cache-busts its module graph with a query
   string and `static.js` serves `Cache-Control: no-cache`. Correct, and slow;
   a real deployment fingerprints instead.
6. `LocalConnectorHost` on `127.0.0.1:17300` is called *from* the page today.
   A hosted `https://` origin calling plain-HTTP localhost is permitted in
   Chrome but is subject to private-network-access preflights and is not uniform
   across browsers — verify it, or invert it (the connector POSTs an extract
   against a pairing code) before relying on it. See §10 of
   `CLOUD-DOCUMENTS-PLAN.md`.
