// Funkel-Flotte progression: sticker album + unlockable hats.
// Standalone (no DOM, no three.js) so node tests can run it; the
// browser uses localStorage via the default store.

const KEY = "ff-progress";
const CREATURES_PER_WORLD = 5;

// must match ACCESSORIES in models.js (index-for-index)
export const HAT_KINDS = [null, "party", "krone", "propeller", "blume", "schleife"];

// total stickers needed to unlock each hat
export const HAT_UNLOCKS = { party: 0, blume: 2, schleife: 4, krone: 7, propeller: 10 };

function defaultStore() {
  return {
    get() {
      try {
        return localStorage.getItem(KEY);
      } catch {
        return null;
      }
    },
    set(v) {
      try {
        localStorage.setItem(KEY, v);
      } catch {
        /* private mode etc. */
      }
    },
  };
}

let store = defaultStore();

export function useStore(customStore) {
  store = customStore || defaultStore();
}

export function loadProgress() {
  try {
    const p = JSON.parse(store.get() || "{}");
    if (!p || typeof p !== "object") return { stickers: {}, wins: 0 };
    return { stickers: p.stickers || {}, wins: p.wins || 0 };
  } catch {
    return { stickers: {}, wins: 0 };
  }
}

function save(p) {
  store.set(JSON.stringify(p));
}

export function totalStickers(p = loadProgress()) {
  return Object.values(p.stickers).reduce((a, b) => a + b, 0);
}

export function stickerCount(worldId, idx, p = loadProgress()) {
  return p.stickers[`${worldId}-${idx}`] || 0;
}

// Award one sticker for a win in `worldId` (the world you searched in).
// Prefers creatures still missing from the album so it stays completable.
export function awardSticker(worldId, rng = Math.random) {
  const p = loadProgress();
  const missing = [];
  for (let i = 0; i < CREATURES_PER_WORLD; i += 1) {
    if (!p.stickers[`${worldId}-${i}`]) missing.push(i);
  }
  const idx = missing.length
    ? missing[Math.floor(rng() * missing.length)]
    : Math.floor(rng() * CREATURES_PER_WORLD);
  const k = `${worldId}-${idx}`;
  const isNew = !p.stickers[k];
  const before = unlockedHatKinds(p);
  p.stickers[k] = (p.stickers[k] || 0) + 1;
  p.wins += 1;
  save(p);
  const after = unlockedHatKinds(p);
  const newHats = after.filter((h) => !before.includes(h));
  return { worldId, idx, isNew, newHats, total: totalStickers(p) };
}

// hat kinds (strings) currently unlocked
export function unlockedHatKinds(p = loadProgress()) {
  const total = totalStickers(p);
  return HAT_KINDS.filter((kind) => kind && total >= (HAT_UNLOCKS[kind] ?? 0));
}

export function isHatUnlocked(hatIdx, p = loadProgress()) {
  const kind = HAT_KINDS[hatIdx];
  if (!kind) return true; // "no hat" is always available
  return totalStickers(p) >= (HAT_UNLOCKS[kind] ?? 0);
}

// the next locked hat and how many stickers are still missing
export function nextUnlock(p = loadProgress()) {
  const total = totalStickers(p);
  let best = null;
  for (const kind of HAT_KINDS) {
    if (!kind) continue;
    const at = HAT_UNLOCKS[kind] ?? 0;
    if (total >= at) continue;
    if (!best || at < best.at) best = { kind, at, remaining: at - total };
  }
  return best;
}
