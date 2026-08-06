// The Funkel-Flotte worlds. Each is a fully realized 3D theme —
// environment, creature models, effect colors and wording. Creature
// order matches DEFAULT_FLEET (4, 3, 3, 2, 2).

export const WORLDS = {
  ozean: {
    id: "ozean",
    name: "Ozean",
    tagline: "Tauch ab und finde die Meerestiere!",
    colors: {
      sky: 0x3f9fdc,
      horizon: 0xd8f1fa,
      splash: 0x9fdcff,
      fog: 0xa8dcef,
      ground: 0x1d6fa5,
      water: 0x2a86c8,
      tile: 0x3ea0dd,
      tileDark: 0x1c5e8f,
      tileHit: 0xffd447,
      accent: 0xffd447,
      gridLine: 0x0d4f7a,
      light: 0xfff4d6,
      ui: "#0b3d6b",
      ui2: "#1d6fa5",
      text: "#f2fbff",
    },
    creatures: [
      { size: 4, name: "Wanda Wal" },
      { size: 3, name: "Otto Oktopus" },
      { size: 3, name: "Rita Robbe" },
      { size: 2, name: "Theo Schildkröte" },
      { size: 2, name: "Quirin Qualle" },
    ],
    words: {
      board: "Riff",
      boardIn: "im Riff",
      miss: "Platsch! Nur Wasser.",
      hit: "Blubb! Da versteckt sich was!",
      sunk: "gefunden!",
      win: "Alle Meerestiere gefunden!",
    },
  },
  weltraum: {
    id: "weltraum",
    name: "Weltraum",
    tagline: "Flieg los und entdecke die Raumflotte!",
    colors: {
      sky: 0x070518,
      horizon: 0x432f80,
      splash: 0xb388ff,
      fog: 0x241a4d,
      ground: 0x241a4d,
      water: 0x241a4d,
      tile: 0x4a3a8c,
      tileDark: 0x2a2058,
      tileHit: 0xffe066,
      accent: 0xb388ff,
      gridLine: 0xcfc4ff,
      light: 0xcfd6ff,
      ui: "#160f33",
      ui2: "#4b3591",
      text: "#f4efff",
    },
    creatures: [
      { size: 4, name: "Sternenstation Stella" },
      { size: 3, name: "Rakete Rosi" },
      { size: 3, name: "Ufo Udo" },
      { size: 2, name: "Satellit Sammy" },
      { size: 2, name: "Funkelstern" },
    ],
    words: {
      board: "Sternenfeld",
      boardIn: "im Sternenfeld",
      miss: "Nur Sternenstaub!",
      hit: "Piep piep! Da funkt was!",
      sunk: "entdeckt!",
      win: "Die ganze Raumflotte entdeckt!",
    },
  },
  dino: {
    id: "dino",
    name: "Dino-Dschungel",
    tagline: "Pirsch dich ran und finde die Dinos!",
    colors: {
      sky: 0x7ec8f0,
      horizon: 0xeaf7cf,
      splash: 0xa8e063,
      fog: 0xc2e8c5,
      ground: 0x2e7d3f,
      water: 0x3c9a52,
      tile: 0x51b06a,
      tileDark: 0x2a6b3a,
      tileHit: 0xffcf4d,
      accent: 0xffcf4d,
      gridLine: 0x3a2f1f,
      light: 0xfff2c9,
      ui: "#14421f",
      ui2: "#2e7d3f",
      text: "#f3ffee",
    },
    creatures: [
      { size: 4, name: "Langhals Lulu" },
      { size: 3, name: "Rexi" },
      { size: 3, name: "Trixi Triceratops" },
      { size: 2, name: "Flitzi Flugsaurier" },
      { size: 2, name: "Baby Bibo" },
    ],
    words: {
      board: "Lichtung",
      boardIn: "auf der Lichtung",
      miss: "Nur Blätter!",
      hit: "Raschel raschel! Da brummt was!",
      sunk: "gefunden!",
      win: "Alle Dinos gefunden!",
    },
  },
  teich: {
    id: "teich",
    name: "Angelteich",
    tagline: "Angle die Freunde aus dem Teich!",
    colors: {
      sky: 0x5fb8e8,
      horizon: 0xf2ecc4,
      splash: 0xa8e8d0,
      fog: 0xd2ecd8,
      ground: 0x3c9a52,
      water: 0x2a8a76,
      tile: 0x3fae91,
      tileDark: 0x1d5c4e,
      tileHit: 0xffd447,
      accent: 0xffb347,
      gridLine: 0x0f4a3e,
      light: 0xfff2c9,
      ui: "#124b40",
      ui2: "#2a8a76",
      text: "#effff8",
    },
    creatures: [
      { size: 4, name: "Karpfen Kuno" },
      { size: 3, name: "Ente Emma" },
      { size: 3, name: "Flossi" },
      { size: 2, name: "Frosch Fredi" },
      { size: 2, name: "Krabbe Kalle" },
    ],
    words: {
      board: "Teich",
      boardIn: "im Teich",
      miss: "Platsch! Nur Seegras.",
      hit: "Da zappelt was an der Angel!",
      sunk: "geangelt!",
      win: "Alle Teichfreunde geangelt!",
    },
  },
};

export const WORLD_IDS = Object.keys(WORLDS);

export function getWorld(id) {
  return WORLDS[id] || WORLDS.ozean;
}

export function randomOtherWorld(notId) {
  const pool = WORLD_IDS.filter((w) => w !== notId);
  return pool[Math.floor(Math.random() * pool.length)];
}
