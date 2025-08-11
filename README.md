# Private Scraping Bridge (PSB)

Services:
- `bridge/`: Express app serving the widget and session/event endpoints
- `worker/`: BullMQ worker running Playwright scrapers

## Environment Variables
Set these in both local and production environments:
- `ENCRYPTION_KEY` (required): 32-byte hex key (64 hex chars) used for AES-256-GCM
- `REDIS_URL` (required in prod): Redis connection string for BullMQ (e.g. `redis://:password@host:6379` or `rediss://...`)
- `REDIS_TLS_REJECT_UNAUTHORIZED` (optional): set to `false` if your managed Redis uses self-signed certs
- `BRIDGE_BASE_URL`: Public URL of the bridge service (e.g. `https://your-bridge.up.railway.app`)
- `ALLOWED_ORIGIN`: Comma-separated list of origins allowed to embed the widget (e.g. `https://fundxng.com`)
- `FRONTEND_BASE_URL`: The parent site origin used for postMessage target (usually your Fundxng domain)
- `BRIDGE_BASE_ENCRYPTION_KEY` (optional): Shared secret; when set, the bridge requires `X-Bridge-Key` on `/v1/sessions`, `/v1/sessions/:id/events`, and `/v1/sessions/:id/result`. The worker automatically sends this header if configured.

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
# Optional shared secret across your systems
export BRIDGE_BASE_ENCRYPTION_KEY=choose-a-long-random-secret

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

## Embedding in your site

1) From your backend, create a session using `/v1/sessions` and persist `session_id` and `iframe_url`.
2) Render an `<iframe>` pointing to `iframe_url`.
3) Listen for `postMessage` events from the iframe with `event.data.source === 'psb-widget'`.

Example minimal React:

```jsx
export function CreditConnect({ iframeUrl }) {
  useEffect(() => {
    function onMsg(e) {
      if (!e?.data || e.origin !== new URL(iframeUrl).origin) return;
      const { source, type, payload, sessionId } = e.data;
      if (source !== 'psb-widget') return;
      // types include: 'created', 'submitted', 'queued', 'started', 'otp_required', 'error', 'final', 'completed'
      console.log('PSB event', { type, payload, sessionId });
      if (type === 'final') {
        // Optionally poll your backend for final data via /v1/sessions/:id/result if you own the bridge
      }
    }
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [iframeUrl]);

  return (
    <iframe src={iframeUrl} title="Connect Credit" style={{ width: 420, height: 420, border: 0, borderRadius: 12 }} />
  );
}
```

Notes:
- The widget now establishes an SSE connection to `/v1/sessions/:id/stream` and forwards live updates to the parent via `postMessage`.
- Ensure `ALLOWED_ORIGIN`/`FRONTEND_BASE_URL` includes your parent origin; CSP `frame-ancestors` and CORS are enforced.

## API

- `POST /v1/sessions` -> `{ session_id, iframe_url }`
- `GET /v1/sessions/:id/stream` -> Server-Sent Events stream of `{ type, data, ts }`
- `POST /v1/sessions/:id/events` (internal, from worker) -> `{ ok: true }`
- `GET /v1/sessions/:id/result` -> final data, or 404 `{ error: 'not_ready' }`
- `GET /v1/sessions/:id/pretty` -> markdown summary
- `GET /v1/sessions/:id/pretty.html` -> simple HTML wrapper

## Deployment (Railway/Render)
- Deploy `bridge/` and `worker/` as separate services
- Set the same `ENCRYPTION_KEY` on both services
- Configure `REDIS_URL` to your managed Redis instance
  - If using `rediss://`, set `REDIS_TLS_REJECT_UNAUTHORIZED=false` if your provider uses self-signed certs
- Set `BRIDGE_BASE_URL` to the deployed bridge URL
- Set `ALLOWED_ORIGIN` and `FRONTEND_BASE_URL` to your site origin (single origin preferred)
- Optionally set `BRIDGE_BASE_ENCRYPTION_KEY` and ensure your backend and the worker send `X-Bridge-Key`
- Worker runs Playwright on Railway. The provided `worker/Dockerfile` uses the official Playwright base image including browsers
  - For non-Docker builds, set `PLAYWRIGHT_BROWSERS_PATH=0` and run `npx playwright install --with-deps`
  - We pass Chromium flags `--no-sandbox --disable-dev-shm-usage` to improve stability in containers

## Security & Compliance
- Credentials are encrypted with AES-256-GCM in the bridge before queuing and decrypted only in the worker
- Do not log plaintext credentials; audit logs record only metadata (timestamp, session, provider, IP)
- Only automate portals with explicit user permission
- Embedding is controlled via CSP `frame-ancestors` and the allowed origins you configure

## Persistence
Currently the bridge stores session statuses and results in memory. Replace with a database for production or forward final results to your existing Supabase functions. If you choose a DB, persist rows shaped like `credit_sessions` and `credit_results` when a `final` event is received.

## Testing
- `GET /health` should return `{ ok: true }`
- Create a session, open the widget, submit credentials, and observe events posted to `/v1/sessions/:id/events`
- Listen for `postMessage` updates in your parent app while the SSE stream relays live events
- View a pretty report at `/v1/sessions/:id/pretty.html`
