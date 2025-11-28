# Deploying BlockChat Relay on Railway

This document explains repository-specific steps and tips to run `server.js` on Railway (or similar PaaS).

Summary
- Server: Node.js >= 18, entrypoint `server.js`.
- Key behavior: WebSocket relay (wallet-based routing) + file upload endpoint (`/upload`).

Railway service settings
- Environment: choose Node 18+. Railway often provides a `PORT` variable — the server reads `process.env.PORT`.
- Start command: `npm start` (uses `node server.js`). For development you can use `npm run dev`.
- Build command: `npm install` (Railway runs this automatically if `package.json` is present).

Required env vars
- `PORT` (optional; Railway injects a port). Example: `3001`.
- `ALLOWED_ORIGINS` (comma-separated list for CORS if using the `.env` sample). `server.js` reads CORS config from process env implicitly.

Important repo-specific notes
- Bind address: `server.js` has been updated to bind the HTTP server on `0.0.0.0` so Railway can route traffic to it.
- Uploads dir: `uploads/` is created at startup. Railway's filesystem is ephemeral — files written to the container will be lost on restarts/deploys.
  - If you need persistence, use external storage (S3 / DigitalOcean Spaces / Cloud Storage). See the "Persistent uploads" section below.
- Healthcheck: `GET /health` returns `{ status:'ok', connectedClients, uptime }`. Use this for readiness/liveness probes.

Networking & WebSocket notes
- Railway exposes your service over an automatically provisioned URL. For secure connections use `wss://` from clients.
- If you front the service with a proxy or Cloudflare, ensure WebSocket upgrades are allowed.

Persistent uploads (recommended)
1. Create an S3 bucket (or equivalent) and add credentials as Railway environment variables (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `S3_BUCKET`).
2. Replace the disk-backed multer store with a streaming upload to S3 (example uses `@aws-sdk/client-s3` and `multer-s3` or manual streaming).

Quick troubleshooting
- If uploads fail, check that `uploads/` exists (the server now creates it on startup).
- If WebSocket connections are refused, verify the Railway service URL and that clients use `wss://` with the correct host and port. Also confirm the server is bound to `0.0.0.0`.
- Logs: Railway captures stdout/stderr. Use `console.log` statements present in `server.js` to follow registration, routing, and upload events.

Example Railway deploy checklist
- Create a new Railway project and link the Git repo.
- Set environment variables in Railway dashboard: `ALLOWED_ORIGINS`, (optional) `PORT`.
- Ensure start command is `npm start` and Node version is 18+.
- Deploy and use `GET /health` to confirm readiness.

Next steps / Improvements
- Replace local uploads with S3-backed storage for durability.
- Add metrics (Prometheus/Datadog) and structured logs for production observability.

If you want, I can add an example S3-backed upload implementation and update `server.js` to use it.
