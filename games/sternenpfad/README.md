# Sternenpfad

The first game in the monorepo: a German mobile-first programming adventure
with authored 3D realms, visual commands, loops, functions, narration, and
deterministic browser playtests.

## Commands

Run these from the repository root:

```bash
npm run dev
npm run lint
npm test
npm run test:play
npm run build:pages
```

The GitHub Pages build is a client-only Vite entry that reuses the game scene
and UI from `app/`, while the local Vinext build remains available for SSR and
browser QA.
