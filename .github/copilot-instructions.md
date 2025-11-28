# Copilot / AI Agent Instructions for BlockChat Relay

Purpose: provide concise, actionable guidance so an AI coding agent can be immediately productive in this repository.

**Big Picture**:
- **Role**: This repo runs a WebSocket relay server that routes realtime messages between wallet addresses and exposes a file upload endpoint.
- **Main entry**: `server.js` (root). Key behaviors: WebSocket handling, wallet-based routing, file uploads (multer), and a small HTTP API.
- **Runtime**: Node.js >= 18 (see `package.json` `engines`).

**Key files / directories**:
- `server.js` : single-file implementation of the relay logic — read this first.
- `package.json` (root) : top-level scripts (`npm run dev` uses `node --watch server.js`).
- `.env` : contains `PORT` and `ALLOWED_ORIGINS` but root `server.js` does not import `dotenv` — environment values must be set in the environment when running.
- `uploads/` : runtime directory where multer stores uploads; served statically at the `/uploads` route.
- `blockvault-relay/package.json` : an adjacent relay package that does include `dotenv`; use it as a reference for patterns or differences.

**Architecture & data flow (concise)**:
- WebSocket clients connect to the server; clients must send a registration message to associate their WebSocket with a wallet address. The server stores connections in a `Map` keyed by a normalized address (checksum then lowercased).
- Messages contain `from` and `to` addresses; the server normalizes both and forwards the JSON message to the recipient if connected.
- If a recipient is offline, the server returns a `delivery-failed` payload to the sender.

**Message types & examples** (seen in `server.js`):
- Registration: `{"type":"register","address":"0x..."}` or `{"type":"register","walletAddress":"0x..."}`
- Ping sent on connect: `{"type":"ping","timestamp":...}`
- Normal message: `{"type":"message","from":"0x...","to":"0x...","messageId":"...","body":"..."}`
- Delivery events: `registered`, `ack`, `message-delivered`, `delivery-failed`, `server-stats`.

**HTTP endpoints & upload behavior**:
- `GET /health` : returns `{ status:'ok', connectedClients, uptime }`.
- `POST /upload` : accepts form field `file`. Multer config:
  - Destination: `uploads/`
  - Max size: 50 MB
  - Allowed types: image/video/audio/pdf/doc (see regex in `server.js`)
  - On success returns `fileUrl` pointing to `/uploads/<filename>`

Example curl upload:
`curl -F "file=@./path/to/file.jpg" http://localhost:3001/upload`

**Runtime & dev workflows**:
- Install: `npm install` in repository root.
- Start (production-like): `npm start` (runs `node server.js`).
- Dev (file watch): `npm run dev` (uses `node --watch server.js`).
- Note: root project does not include `dotenv`; `.env` exists but will not be auto-loaded. Either export env vars before running or add `dotenv` and import it at top of `server.js` if you want local `.env` loading.

**Conventions and patterns discovered**:
- Address normalization: `ethers.getAddress(addr).toLowerCase()` — keys in the `clients` map are always lowercase checksum addresses.
- Logging uses emoji-prefixed messages; preserve concise, informative logs when modifying flows.
- WebSocket lifecycle: server replaces existing socket for the same address (closes old socket when a new register arrives).
- Connection cleanup runs every 30s (removes non-OPEN sockets) and broadcasts stats after cleanup.

**When editing**:
- Keep `server.js` single-process friendly (it attaches `ws` to the same HTTP server). If you split logic, preserve `clients` Map semantics or replace with shared state (Redis/pubsub) if you introduce clustering.
- Test changes locally with `npm run dev` and use `wscat` or browser clients to exercise `register` + `message` flows.

**Files to inspect for details**:
- `server.js` — message routing, registration, upload handling, cleanup, and graceful SIGTERM shut down.
- `package.json` — scripts and Node engine target.
- `.env` — sample env values (PORT, ALLOWED_ORIGINS) but not automatically loaded.
- `blockvault-relay/package.json` — shows a sibling variation that uses `dotenv`.

If anything in this summary looks incomplete or you want more examples (e.g., exact WebSocket JSON shapes used by a client), tell me which area to expand and I'll update this file.
