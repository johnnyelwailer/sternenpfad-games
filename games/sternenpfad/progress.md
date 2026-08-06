# Sternenpfad rebuild

Original prompt: Build a fullscreen mobile German programming game for children from age 7 with a connected story, simple readable interaction, and real end-to-end playtesting.

## Quality contract

- The first screen must make the next action obvious without reading instructions.
- The board must show one intentional route; no arbitrary grid guessing.
- No floating direction badge. The character's pose and route marker must communicate state.
- Every control must cause a visible state change.
- Browser QA must cover boot, world-map transition, command entry, drag reorder, wrong run, reset, correct run, authored later routes, loop grouping and count changes, function definition and calls, success, reload persistence, and return to map at 320x568 and 390x844.
- Keep `window.render_game_to_text` available for agentic inspection and expose a deterministic `window.advanceTime(ms)` test hook.

## Research decisions

- Use a low-poly Three.js/WebGL scene with real stepping stones, trees, rocks, lanterns, a bridge, and a shrine instead of abstract 2.5D icons.
- Use explicit route data and a tiny command interpreter; route stones, landmarks, and the world map carry the navigation instead of an always-on goal line.
- Use Playwright screenshots, state telemetry, WebGL fallback/context-loss handling, overflow checks, and console-error capture as release gates.
- Keep the HUD small and high-contrast so the world remains the main experience on mobile.

## Current build

- True 3D/WebGL slice implemented in `app/page.tsx` with explicit route data, real turn semantics, low-poly fox character, animated idle/run motion, physical stepping stones, a river, trees, rocks, mushrooms, lanterns, a bridge, a shrine, sequential unlocks, and no floating direction badge.
- The avatar has a readable face/tail silhouette and rotates with its heading. The authored start stone and blocked moves get world-space rings, so the route stays readable without a permanent goal arrow.
- The phantom preview is optional via a compact HUD toggle. The Mondquell bridge now spans a narrow visible river with physical banks between the route's two crossing stones.
- The playfield is now a natural moss clearing rather than a full paved grid: only raised start/route/goal stones are walkable. Grass is deliberately solid, so an incorrect move bumps Milo in place and the program continues.
- The journey now has three authored realms: Sternenwald teaches sequences and turns, Moosgärten introduces the merged action and visual loops, and Wolkenwerk introduces reusable functions across three levels. The HUD progress rail reflects all ten destinations.
- Visible action labels are removed from the command strip. Directional glyphs, color, position, and the fox's facing make the controls visual; accessible names remain for assistive technology and browser QA.
- The fourth and fifth levels introduce one merged `action` command. It advances Milo forward and up when the next authored stone is a ledge, or two cells across a visible gap when the next authored stone is a landing.
- The later worlds use larger 9x8 boards with one explicit authored route per chapter. The simulator does not union arbitrary stones into a free grid, so grass and shortcuts remain blocked.
- Felsenbogen is a longer multi-section route with a visible jump gap. Moosgarten introduces a visible loop block that groups a step and shows its repeat count. Wolkenwerk uses purple function blocks and blue call blocks, then combines functions with climbing and jumping at Sternentor without age-dependent command filtering.
- The world map is a playable chapter surface with locked/unlocked/completed destinations and a concise story/concept card. Chapter completion opens the map instead of silently resetting the last level.
- Program slots support touch/mouse pointer dragging to reorder commands, while tapping a filled slot still removes it. Completion persists in local storage.
- A red bump ring and a small fox recoil communicate blocked commands without letting the avatar wander onto arbitrary grass.
- The old single narration clip now plays at most once, on the first run. Web Audio cues provide distinct command, movement, bump, retry, and success feedback without third-party sound assets.
- A successful run locks the program and avatar in place until the next-level action, preventing an accidental edit from visually resetting the completed route.
- Programs are now a real debugger: incomplete or incorrect programs still execute every command on the board. Slow, fast, and manual one-step execution modes are available.
- `tests/rendered-html.test.mjs` covers server markup/assets and the WebGL runtime contract; `tests/game-playtest.mjs` covers mobile boot, visible story, dynamic ten-stop progress, three realm map grouping, pointer drag reorder, preview, grass collision, wrong run, reset, success locking, bridge, persistence, screenshots, overflow, WebGL fallback, browser errors, visual loop blocks, and function definition/call execution.
- Playwright Chromium, lint, build, SSR checks, and the full command flow pass at 320x568 and 390x844, including partial/wrong execution, manual stepping, merged action behavior, longer worlds, visible loop blocks, function recipes, and reload persistence. Screenshot QA covers boot, the three-realm map, function blocks, and the longer routes.
