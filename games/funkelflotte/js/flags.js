// Feature flags — every new feature ships behind a flag that is ON by
// default, so anything misbehaving can be switched off without a code
// rollback. Overrides (checked in this order):
//   1. URL:          ?flags=styles:0,boss:1   (this page load only)
//   2. localStorage: ff-flags = {"styles":false}
//   3. defaults below
//
// Flags gate FEATURES (UI + code paths). Game MODES stay opt-in for the
// player either way — a flag only controls whether the option is shown.

export const DEFAULT_FLAGS = {
  styles: true, // creature tints + hats (style panel)
  stickers: true, // sticker album + hat unlocks
  rules: true, // extra rules: decoy balloon, sonar, ghost
  powers: true, // Zauber-Kräfte: treasures, recharges, world powers
  puzzle: true, // Knobel-Insel logic puzzles
  chase: true, // Der freche Frido chase duel
  boss: true, // Monster gegen Flotte
  aquarium: true, // collected-creatures aquarium
  weltreise: true, // campaign across the worlds
  variety: true, // board presets (size/fleet) + Enge-Verstecke-Regel
  welten: true, // extra worlds: Eisberg-Bucht + Glut-Insel
};

function stored() {
  try {
    const o = JSON.parse(localStorage.getItem("ff-flags") || "{}");
    return o && typeof o === "object" ? o : {};
  } catch {
    return {};
  }
}

function fromUrl() {
  const out = {};
  try {
    const raw = new URLSearchParams(window.location.search).get("flags");
    if (!raw) return out;
    for (const part of raw.split(",")) {
      const [k, v] = part.split(":");
      if (k in DEFAULT_FLAGS) out[k.trim()] = v !== "0" && v !== "false";
    }
  } catch {
    /* no URL access (tests) */
  }
  return out;
}

const FLAGS = { ...DEFAULT_FLAGS, ...stored(), ...fromUrl() };

export function flag(name) {
  return FLAGS[name] !== false;
}

export function setFlag(name, value) {
  FLAGS[name] = !!value;
  try {
    const o = stored();
    o[name] = !!value;
    localStorage.setItem("ff-flags", JSON.stringify(o));
  } catch {
    /* private mode etc. */
  }
}

export function allFlags() {
  return { ...FLAGS };
}
