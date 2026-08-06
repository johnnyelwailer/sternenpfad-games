# Sternenpfad Games

Monorepo scaffold for multiple story-driven programming games.

## Top-level layout

- `apps/` — shared web shells, dev tools, and future game launchers
- `games/` — one self-contained directory per game
- `packages/` — small shared runtime contracts and utilities
- `docs/` — design, production, and playtest documentation

The first game, Sternenpfad, lives under `games/sternenpfad/` and owns its
scene, assets, tests, local runtime, and static Pages entrypoint.

## Games

### 🐳 Funkel-Flotte (`games/funkelflotte/`)

A kid-friendly "Schiffe versenken" (battleship) built with plain browser
tech — no framework, no build step. Instead of sinking ships, kids search
for hidden friends across four themed worlds (ocean, space, candy land,
dino jungle). Mobile first, fullscreen, with physics-based particle
effects and a WebAudio sound synth.

Modes:

- **Alleine gegen Robo** — play against a friendly AI
- **Zu zweit abwechselnd** — hot-seat on one device with a pass screen
- **Mit zwei Geräten** — peer-to-peer over WebRTC (PeerJS). The host
  shows a QR code / 4-letter code, the guest scans or types it. Signaling
  uses the free public PeerJS cloud by default; `?ps=host:port` switches
  to a self-hosted `scripts/peer-server.mjs`.

Development:

```bash
npm ci
npm run dev:funkelflotte  # static server on :8123 → /games/funkelflotte/
npm run dev:peer          # local PeerJS signaling server on :9200 (optional)
npm run test:unit         # engine + AI unit tests
npm run test:e2e          # Playwright browser tests (incl. two-device P2P)
```

## Deployment

GitHub Pages is the deployment target. Pushes to `main` run
`.github/workflows/deploy-pages.yml`; the local equivalent is:

```bash
npm run deploy:pages
```

The workflow assembles `dist/` (Sternenpfad at `/`, Funkel-Flotte at
`/funkelflotte/`), uploads it as a Pages artifact, and publishes it with
GitHub's Pages deployment actions.
