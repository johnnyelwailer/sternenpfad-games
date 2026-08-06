# Sternenpfad Games

Monorepo scaffold for multiple story-driven programming games.

## Top-level layout

- `apps/` — shared web shells, dev tools, and future game launchers
- `games/` — one self-contained directory per game
- `packages/` — small shared runtime contracts and utilities
- `docs/` — design, production, and playtest documentation

The first game, Sternenpfad, lives under `games/sternenpfad/` and owns its
scene, assets, tests, local runtime, and static Pages entrypoint.

## Deployment

GitHub Pages is the deployment target. Pushes to `main` run
`.github/workflows/deploy-pages.yml`; the local equivalent is:

```bash
npm run deploy:pages
```

The workflow builds the selected game into `games/sternenpfad/dist/`, uploads
it as a Pages artifact, and publishes it with GitHub's Pages deployment
actions.
