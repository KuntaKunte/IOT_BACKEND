# IOT Backend (Docker)

Quick instructions to run the ingestion + API stack locally using Docker Compose.

Prerequisites
- Docker
- Docker Compose

Environment
- Copy or edit `.env` to set `DB_URL` and other env vars used by the Node service.

Build and start (foreground)
```bash
docker compose up --build
```

Build and start (detached)
```bash
docker compose up --build -d
```

Stop and remove containers (preserves volumes)
```bash
docker compose down
```

Stop and remove containers + volumes (wipe DB data)
```bash
docker compose down -v
```

View logs
```bash
docker compose logs -f node-ingestion
```

Notes
- The Compose stack includes `mosquitto` (MQTT broker), `postgres` (database), `node-ingestion` (ingestion service), and `node-api` (API service).
- Postgres persistent data is stored in the `pgdata` volume.
- Services use `restart: unless-stopped` to stay up across crashes/reboots.
- `node-ingestion` waits for Postgres healthcheck before starting (Compose health-based dependency).
- `node-api` exposes HTTP on port 3000 and has its own separate lifecycle.

Database initialization
- If `db/schema.sql` exists it will be executed automatically by Postgres on first startup because the folder is mounted into `/docker-entrypoint-initdb.d`.
- To reset the DB schema, stop the stack and remove volumes:
```bash
docker compose down -v
```

Local testing
- Run tests locally (outside Docker):
```bash
npm install
npm test
```

Authentication
- The frontend uses secure `httpOnly` cookies for admin login, access tokens, and refresh tokens.
- Admin users sign in via the dashboard UI, which stores tokens only in cookies and not in browser localStorage.
- A logout button is available in the header to clear the session and revoke the current tokens.

Local development with Docker Compose override:
```bash
docker compose -f docker-compose.yml -f docker-compose.override.yml up --build
```

Production deploy (explicit prod config, no automatic restarts):
```bash
docker compose -f docker-compose.prod.yml up --build
```

Manual service start scripts:
```bash
npm run start:ingestion
npm run start:api
```


