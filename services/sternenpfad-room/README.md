# Sternenpfad room service

Small authoritative multiplayer room service for Sternenpfad. Each room is a
SQLite-backed Cloudflare Durable Object and communicates with clients over a
hibernating WebSocket.

## Local checks

```bash
npm install
npm run typecheck
```

## Temporary agent deployment

```bash
npx wrangler deploy --temporary
```

Cloudflare can return a live preview and a claim URL without an existing
Cloudflare account. The claim URL makes the temporary account permanent.
