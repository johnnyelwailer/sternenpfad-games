// Hand-crafted inline SVG icons for UI concepts that have no in-game 3D
// model. Soft, rounded, two-tone (currentColor + golden accent) — the
// same visual language as the low-poly world. Everything else (chests,
// creatures, balloon, spell sculptures) uses 3D thumbs from scene.js.

const GOLD = "#ffd447";

const PATHS = {
  // settings: a friendly six-tooth gear
  gear: `<circle cx="12" cy="12" r="3.2" fill="${GOLD}"/>
    <path fill="currentColor" d="M12 2.5l1.8 2.4 2.9-.8.6 3 3 .6-.8 2.9L22 12l-2.5 1.4.8 2.9-3 .6-.6 3-2.9-.8L12 21.5l-1.8-2.4-2.9.8-.6-3-3-.6.8-2.9L2 12l2.5-1.4-.8-2.9 3-.6.6-3 2.9.8L12 2.5zm0 5.1a4.4 4.4 0 100 8.8 4.4 4.4 0 000-8.8z"/>`,
  // sticker album: an open book with a star sticker
  book: `<path fill="currentColor" d="M4 4.5c2.6-1.2 5-1.2 7.3.2v14c-2.3-1.3-4.7-1.4-7.3-.3V4.5zm16 0c-2.6-1.2-5-1.2-7.3.2v14c2.3-1.3 4.7-1.4 7.3-.3V4.5z"/>
    <path fill="${GOLD}" d="M16.2 7.2l.8 1.7 1.8.3-1.3 1.3.3 1.8-1.6-.9-1.6.9.3-1.8-1.3-1.3 1.8-.3z"/>`,
  // extra rules: a bouncy die
  dice: `<rect x="3.5" y="3.5" width="17" height="17" rx="4.5" fill="currentColor"/>
    <circle cx="8.6" cy="8.6" r="1.7" fill="${GOLD}"/><circle cx="15.4" cy="15.4" r="1.7" fill="${GOLD}"/><circle cx="15.4" cy="8.6" r="1.7" fill="${GOLD}"/><circle cx="8.6" cy="15.4" r="1.7" fill="${GOLD}"/>`,
  // ghost rule
  ghost: `<path fill="currentColor" d="M12 3a7 7 0 00-7 7v9.5l2.4-1.8 2.3 1.8 2.3-1.8 2.3 1.8 2.3-1.8 2.4 1.8V10a7 7 0 00-7-7z"/>
    <circle cx="9.5" cy="10" r="1.4" fill="${GOLD}"/><circle cx="14.5" cy="10" r="1.4" fill="${GOLD}"/>`,
  // sonar: ping waves
  sonar: `<circle cx="7" cy="12" r="2.4" fill="${GOLD}"/>
    <path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" d="M11.5 7.5a6.5 6.5 0 010 9M15.5 5a10 10 0 010 14"/>`,
  // Enge Verstecke: two rounded squares snuggling
  snuggle: `<rect x="3" y="7" width="9" height="9" rx="2.6" fill="currentColor"/>
    <rect x="12.5" y="7" width="9" height="9" rx="2.6" fill="${GOLD}"/>`,
  // gentle robot
  robot: `<rect x="5" y="7" width="14" height="11" rx="3.5" fill="currentColor"/>
    <circle cx="9.5" cy="12" r="1.7" fill="${GOLD}"/><circle cx="14.5" cy="12" r="1.7" fill="${GOLD}"/>
    <rect x="9" y="15" width="6" height="1.6" rx="0.8" fill="${GOLD}"/>
    <rect x="10.9" y="3.5" width="2.2" height="3.5" rx="1.1" fill="currentColor"/><circle cx="12" cy="3.4" r="1.6" fill="${GOLD}"/>`,
  // clever robot: same bot, star-spark brain
  robotSmart: `<rect x="5" y="7" width="14" height="11" rx="3.5" fill="currentColor"/>
    <path fill="${GOLD}" d="M8 11.6l1.5.5 1.5-.5-.5 1.5.5 1.5-1.5-.5-1.5.5.5-1.5zM13 11.6l1.5.5 1.5-.5-.5 1.5.5 1.5-1.5-.5-1.5.5.5-1.5z"/>
    <rect x="9" y="15.4" width="6" height="1.6" rx="0.8" fill="${GOLD}"/>
    <path fill="${GOLD}" d="M12 1.6l.8 1.7 1.8.3-1.3 1.2.3 1.8-1.6-.8-1.6.8.3-1.8-1.3-1.2 1.8-.3z"/>`,
  // play / resume
  play: `<circle cx="12" cy="12" r="10" fill="currentColor"/>
    <path fill="${GOLD}" d="M9.8 7.8l7 4.2-7 4.2z"/>`,
  // ringing bell (invite)
  bell: `<path fill="currentColor" d="M12 3a6 6 0 00-6 6v4l-1.8 3h15.6L18 13V9a6 6 0 00-6-6z"/>
    <path fill="${GOLD}" d="M9.7 18a2.4 2.4 0 004.6 0z"/>
    <path fill="none" stroke="${GOLD}" stroke-width="1.6" stroke-linecap="round" d="M20 6.5a7.5 7.5 0 011.6 3M4 6.5a7.5 7.5 0 00-1.6 3"/>`,
  // board & fleet section: a grid tile with a golden pin
  board: `<rect x="3.5" y="3.5" width="17" height="17" rx="3.5" fill="currentColor"/>
    <path fill="none" stroke="#0b1d38" stroke-opacity="0.55" stroke-width="1.4" d="M9.2 3.5v17M14.8 3.5v17M3.5 9.2h17M3.5 14.8h17"/>
    <circle cx="14.8" cy="9.2" r="2.3" fill="${GOLD}"/>`,
  // grid presets: dot matrices that SHOW the board size
  grid6: gridIcon(3),
  grid8: gridIcon(4),
  grid10: gridIcon(5),
  gridMix: `<rect x="3.5" y="3.5" width="17" height="17" rx="3.5" fill="currentColor"/>
    <rect x="6.2" y="6.2" width="7" height="7" rx="1.6" fill="${GOLD}"/>
    <rect x="15" y="15" width="3.4" height="3.4" rx="1" fill="${GOLD}"/>`,
  // friends / handshake: two overlapping hearts
  friends: `<path fill="currentColor" d="M9 5.5c-2.7 0-4.5 1.9-4.5 4.2 0 3.3 3 5.4 6 7.8 0 0 .2.2.5.2V9.4C11 7 10.3 5.5 9 5.5z"/>
    <path fill="${GOLD}" d="M15 5.5c2.7 0 4.5 1.9 4.5 4.2 0 3.3-3 5.4-6 7.8 0 0-.2.2-.5.2V9.4C13 7 13.7 5.5 15 5.5z"/>`,
};

function gridIcon(n) {
  const pad = 5.4;
  const span = 24 - pad * 2;
  const step = span / (n - 1);
  let dots = "";
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      dots += `<circle cx="${(pad + x * step).toFixed(1)}" cy="${(pad + y * step).toFixed(1)}" r="${(step * 0.22 + 0.7).toFixed(1)}" fill="${GOLD}"/>`;
    }
  }
  return `<rect x="3" y="3" width="18" height="18" rx="3.5" fill="currentColor"/>${dots}`;
}

// inline SVG markup for `name`; size in px, extra CSS class optional
export function icon(name, size = 22, cls = "ui-icon") {
  const body = PATHS[name];
  if (!body) return "";
  return `<svg class="${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
}
