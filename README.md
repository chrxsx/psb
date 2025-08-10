# Private Scraping Bridge (PSB)

Services:
- `bridge/`: Express app serving the widget and session/event endpoints
- `worker/`: BullMQ worker running Playwright scrapers

## Environment Variables
Set these in both local and production environments:
- `ENCRYPTION_KEY` (required): 32-byte hex key (64 hex chars) used for AES-256-GCM
- `REDIS_URL` (required in prod): Redis connection string for BullMQ (e.g. `redis://:password@host:6379`)
- `BRIDGE_BASE_URL`: Public URL of the bridge service (e.g. `https://your-bridge.up.railway.app`)
- `ALLOWED_ORIGIN`: Comma-separated list of origins allowed to embed the widget (e.g. `https://fundxng.com`)
- `FRONTEND_BASE_URL`: The parent site origin used for postMessage target (usually your Fundxng domain)

## Local Development

Option A: Docker Compose

```bash
cp .env.example .env # create and edit with your secrets (or export envs directly)
docker compose up --build
# Bridge: http://localhost:8080/health => { ok: true }
```

Option B: Node locally (requires Redis)

```bash
# In one terminal: run Redis locally or use Docker
docker run -p 6379:6379 -d redis:7

# Install deps
( cd bridge && npm i )
( cd worker && npm i )

# Set envs in your shell
export ENCRYPTION_KEY=YOUR_64_CHAR_HEX_KEY
export REDIS_URL=redis://localhost:6379
export BRIDGE_BASE_URL=http://localhost:8080
export ALLOWED_ORIGIN=http://localhost:8082
export FRONTEND_BASE_URL=http://localhost:8082

# Start services
( cd bridge && npm run dev )
( cd worker && npm start )
```

Create a session from your backend or curl:

```bash
curl -s -X POST http://localhost:8080/v1/sessions \
  -H 'Content-Type: application/json' \
  -d '{"user_id":"test-user-1","provider_hint":"experian"}'
# => { "session_id": "...", "iframe_url": "http://localhost:8080/widget/<id>" }
```

Embed the `iframe_url` in your app or open it directly to test the widget.

## Deployment (Railway/Render)
- Deploy `bridge/` and `worker/` as separate services
- Set the same `ENCRYPTION_KEY` on both services
- Configure `REDIS_URL` to your managed Redis instance
- Set `BRIDGE_BASE_URL` to the deployed bridge URL
- Set `ALLOWED_ORIGIN` and `FRONTEND_BASE_URL` to your Fundxng site origin

## Security & Compliance
- Credentials are encrypted with AES-256-GCM in the bridge before queuing and decrypted only in the worker
- Do not log plaintext credentials; audit logs record only metadata (timestamp, session, provider, IP)
- Only automate portals with explicit user permission

## Persistence
Currently the bridge stores session statuses and results in memory. Replace with a database for production or forward final results to your existing Supabase functions.

## Testing
- `GET /health` should return `{ ok: true }`
- Create a session, open the widget, submit credentials, and observe events posted to `/v1/sessions/:id/events`
- View a pretty report at `/v1/sessions/:id/pretty.html`
