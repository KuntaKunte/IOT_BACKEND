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
- The Compose stack includes `mosquitto` (MQTT broker), `postgres` (database), and `node-ingestion` (this project).
- Postgres persistent data is stored in the `pgdata` volume.
- Services use `restart: unless-stopped` to stay up across crashes/reboots.
- `node-ingestion` waits for Postgres healthcheck before starting (Compose health-based dependency).

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

If you want me to also add a makefile or sample systemd unit for production, tell me which target environment you want.
