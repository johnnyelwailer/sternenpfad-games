"use client";

import * as THREE from "three";
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

declare global {
  interface Window {
    render_game_to_text?: () => string;
    advanceTime?: (milliseconds: number) => string;
  }
}

type RealmId = "forest" | "moss" | "cloud";
type Command = "forward" | "left" | "right" | "action" | "loop" | "function" | "call";
type ProgramCommand = Exclude<Command, "loop" | "function" | "call">;
type LoopItem = { type: "loop"; command: ProgramCommand; count: number };
type FunctionItem = { type: "function"; body: ProgramCommand[] };
type CallItem = { type: "call" };
type ProgramItem = ProgramCommand | LoopItem | FunctionItem | CallItem;
type Heading = "up" | "right" | "down" | "left";
type RunState = "idle" | "running" | "success" | "retry";
type RunMode = "slow" | "fast" | "manual";
type GridPoint = { x: number; y: number; height?: number };
type PlayerState = { step: number; heading: Heading; grid: GridPoint; programIndex?: number; error?: "edge" | "blocked" | "action" | "function" };
type Level = {
  id: string;
  realm: RealmId;
  location: string;
  title: string;
  intro: string;
  success: string;
  points: GridPoint[];
  startHeading: Heading;
  programLength: number;
  goalLabel: string;
  nextStory: string;
  availableCommands: Command[];
  board?: { width: number; height: number };
  actionGaps?: GridPoint[];
  storySymbol?: string;
  concept?: string;
};
type Simulation = { trace: PlayerState[]; success: boolean; errors: Array<{ index: number; kind: "edge" | "blocked" | "action" | "function" }> };
type SceneSnapshot = {
  level: Level;
  player: PlayerState;
  preview: PlayerState;
  runState: RunState;
  commands: ProgramItem[];
  completed: string[];
  showPhantom: boolean;
};

const commandMeta: Record<Command, { label: string; short: string; key: string }> = {
  forward: { label: "Einen Schritt gehen", short: "GEHEN", key: "1" },
  left: { label: "Nach links drehen", short: "LINKS", key: "2" },
  right: { label: "Nach rechts drehen", short: "RECHTS", key: "3" },
  action: { label: "Springen oder klettern", short: "ÜBERWINDEN", key: "4" },
  loop: { label: "Schritt als Schleife bauen", short: "SCHLEIFE", key: "6" },
  function: { label: "Funktion aus den letzten zwei Schritten bauen", short: "FUNKTION", key: "7" },
  call: { label: "Funktion ausführen", short: "AUFRUF", key: "8" },
};

const commandGlyph: Record<Command, string> = { forward: "↑", left: "↶", right: "↷", action: "↟", loop: "↻", function: "ƒ", call: "↗" };

function isLoopItem(item: ProgramItem): item is LoopItem {
  return typeof item !== "string" && item.type === "loop";
}

function isFunctionItem(item: ProgramItem): item is FunctionItem {
  return typeof item !== "string" && item.type === "function";
}

function isCallItem(item: ProgramItem): item is CallItem {
  return typeof item !== "string" && item.type === "call";
}

function programItemLabel(item: ProgramItem) {
  if (isLoopItem(item)) return `Schleife: ${commandMeta[item.command].label}, ${item.count} Wiederholungen`;
  if (isFunctionItem(item)) return `Funktion: ${item.body.map((command) => commandMeta[command].short).join(" und ")}`;
  if (isCallItem(item)) return commandMeta.call.label;
  return commandMeta[item].label;
}

const realmMeta: Record<RealmId, { name: string; subtitle: string; sky: number; fog: number; ground: number; accent: string }> = {
  forest: { name: "Sternenwald", subtitle: "Die ersten Schritte", sky: 0x0b1630, fog: 0x0b1630, ground: 0x2b5545, accent: "#78e7cf" },
  moss: { name: "Moosgärten", subtitle: "Rhythmus und Schleifen", sky: 0x102338, fog: 0x102338, ground: 0x244f46, accent: "#9de675" },
  cloud: { name: "Wolkenwerk", subtitle: "Rezepte aus Funktionen", sky: 0x201b4a, fog: 0x201b4a, ground: 0x303a6b, accent: "#c3b7ff" },
};
const realmOrder: RealmId[] = ["forest", "moss", "cloud"];

const runModeMeta: Record<RunMode, { label: string; glyph: string }> = {
  slow: { label: "Langsam ausführen", glyph: "◒" },
  fast: { label: "Schnell ausführen", glyph: "»" },
  manual: { label: "Schritt für Schritt ausführen", glyph: "›|" },
};
const runModeDelay: Record<Exclude<RunMode, "manual">, number> = { slow: 620, fast: 180 };

const levels: Level[] = [
  {
    id: "lichtung-1",
    realm: "forest",
    location: "Sternenlichtung",
    title: "Der erste Stern",
    intro: "Milo steht auf dem grünen Startstein. Der goldene Stein ist das Ziel.",
    success: "Der Schrein leuchtet. Hinter den Tannen wartet der Mondquell.",
    points: [{ x: 1, y: 4 }, { x: 2, y: 4 }, { x: 3, y: 4 }, { x: 3, y: 3 }, { x: 3, y: 2 }],
    startHeading: "right",
    programLength: 5,
    goalLabel: "ZIEL",
    nextStory: "Ein Bach glitzert zwischen den Bäumen.",
    availableCommands: ["forward", "left", "right"],
  },
  {
    id: "mondquell-1",
    realm: "forest",
    location: "Mondquell",
    title: "Über die Brücke",
    intro: "Die Steine führen zur Brücke. Der goldene Stein wartet dahinter.",
    success: "Das Wasser singt. Hinter der Brücke leuchtet der Mondturm.",
    points: [{ x: 1, y: 4 }, { x: 2, y: 4 }, { x: 3, y: 4 }, { x: 3, y: 3 }, { x: 3, y: 2 }, { x: 4, y: 2 }],
    startHeading: "right",
    programLength: 7,
    goalLabel: "ZIEL",
    nextStory: "Hinter dem Wasser ragt ein Turm in den Mond.",
    availableCommands: ["forward", "left", "right"],
  },
  {
    id: "mondturm-1",
    realm: "forest",
    location: "Mondturm",
    title: "Das Licht im Turm",
    intro: "Hinter der Brücke führt der Steinepfad zum Mondturm.",
    success: "Der Mondturm erwacht. Der Sternenpfad ist offen.",
    points: [{ x: 1, y: 4 }, { x: 2, y: 4 }, { x: 3, y: 4 }, { x: 3, y: 3 }, { x: 3, y: 2 }, { x: 4, y: 2 }, { x: 5, y: 2 }, { x: 5, y: 1 }],
    startHeading: "right",
    programLength: 10,
    goalLabel: "MONDTURM",
    nextStory: "Der Weg ist offen.",
    availableCommands: ["forward", "left", "right"],
  },
  {
    id: "wipfelpfad-1",
    realm: "moss",
    location: "Wipfelpfad",
    title: "Hinauf zum Wipfel",
    intro: "Der leuchtende Schritt führt vorwärts und hinauf zur nächsten Ebene.",
    success: "Milo steht über den Baumkronen. Der Sternenbogen ruft.",
    points: [{ x: 1, y: 4 }, { x: 2, y: 4 }, { x: 3, y: 4 }, { x: 3, y: 3, height: 1 }, { x: 3, y: 2, height: 1 }, { x: 4, y: 2, height: 1 }, { x: 5, y: 2, height: 1 }],
    startHeading: "right",
    programLength: 8,
    goalLabel: "WIPFEL",
    nextStory: "Im Tal klafft eine Lücke.",
    availableCommands: ["forward", "left", "right", "action"],
  },
  {
    id: "sprungtal-1",
    realm: "moss",
    location: "Sprungtal",
    title: "Über den Spalt",
    intro: "Der Weg hat eine Lücke. Der Sprungstein wartet dahinter.",
    success: "Der Sprung über das Tal öffnet den Sternenbogen.",
    points: [{ x: 1, y: 4 }, { x: 2, y: 4 }, { x: 3, y: 4 }, { x: 5, y: 4 }, { x: 5, y: 3 }, { x: 5, y: 2 }],
    startHeading: "right",
    programLength: 6,
    goalLabel: "STERNENBOGEN",
    nextStory: "",
    availableCommands: ["forward", "left", "right", "action"],
    actionGaps: [{ x: 4, y: 4 }],
  },
  {
    id: "felsenbogen-1",
    realm: "moss",
    location: "Felsenbogen",
    title: "Der lange Bogen",
    intro: "Der Pfad macht einen weiten Bogen. Der Spalt liegt genau zwischen den Steinen.",
    success: "Milo landet sicher. Hinter dem Felsenbogen beginnt der Moosgarten.",
    points: [{ x: 1, y: 5 }, { x: 2, y: 5 }, { x: 3, y: 5 }, { x: 5, y: 5 }, { x: 5, y: 4 }, { x: 5, y: 3 }, { x: 6, y: 3 }, { x: 7, y: 3 }, { x: 7, y: 2 }, { x: 7, y: 1 }],
    startHeading: "right",
    programLength: 12,
    goalLabel: "BOGEN",
    nextStory: "Im Moosgarten wartet ein Rhythmus.",
    availableCommands: ["forward", "left", "right", "action"],
    actionGaps: [{ x: 4, y: 5 }],
    board: { width: 9, height: 8 },
    storySymbol: "⌁",
    concept: "Mehrere Abschnitte",
  },
  {
    id: "moosgarten-1",
    realm: "moss",
    location: "Moosgarten",
    title: "Der verschlungene Rhythmus",
    intro: "Der Pfad windet sich durch den Garten. Baue ein goldenes Schleifenstück, wenn ein Schritt zweimal erklingen soll.",
    success: "Die Moosblüten öffnen sich im Takt. Das Sternentor ist ganz nah.",
    points: [{ x: 1, y: 6 }, { x: 2, y: 6 }, { x: 3, y: 6 }, { x: 3, y: 5 }, { x: 3, y: 4 }, { x: 4, y: 4 }, { x: 5, y: 4 }, { x: 5, y: 3 }, { x: 5, y: 2 }, { x: 6, y: 2 }],
    startHeading: "right",
    programLength: 10,
    goalLabel: "MOOSBLÜTE",
    nextStory: "Hinter den Blüten wartet das Sternentor.",
    availableCommands: ["forward", "left", "right", "loop"],
    board: { width: 9, height: 8 },
    storySymbol: "⟳",
    concept: "Schleifen",
  },
  {
    id: "wolkenwerk-1",
    realm: "cloud",
    location: "Wolkenwerk",
    title: "Das kleine Rezept",
    intro: "Im Wolkenwerk werden gute Wege zu Rezepten. Fasse zwei Schritte in einer violetten Funktion zusammen.",
    success: "Das Rezept glitzert. Eine Wolkenbrücke wächst zum nächsten Atelier.",
    points: [{ x: 1, y: 6 }, { x: 2, y: 6 }, { x: 3, y: 6 }, { x: 3, y: 5 }, { x: 3, y: 4 }, { x: 4, y: 4 }, { x: 5, y: 4 }, { x: 5, y: 3 }, { x: 5, y: 2 }, { x: 6, y: 2 }, { x: 7, y: 2 }],
    startHeading: "right",
    programLength: 11,
    goalLabel: "REZEPT",
    nextStory: "Ein Spalt trennt das nächste Wolkenatelier.",
    availableCommands: ["forward", "left", "right", "function", "call"],
    board: { width: 9, height: 8 },
    storySymbol: "ƒ",
    concept: "Funktionen",
  },
  {
    id: "wolkenwerk-2",
    realm: "cloud",
    location: "Wolkenwerk",
    title: "Das Sprungrezept",
    intro: "Ein Rezept darf auch einen Sprung enthalten. Baue es einmal und rufe es an jeder Kurve wieder auf.",
    success: "Das Rezept trägt Milo über den Spalt. Nur noch das große Sternentor wartet.",
    points: [{ x: 1, y: 6 }, { x: 2, y: 6 }, { x: 3, y: 6 }, { x: 3, y: 5 }, { x: 3, y: 4 }, { x: 5, y: 4 }, { x: 5, y: 3 }, { x: 5, y: 2 }, { x: 6, y: 2 }, { x: 7, y: 2 }],
    startHeading: "right",
    programLength: 11,
    goalLabel: "ATELIER",
    nextStory: "Das große Tor hängt über allen drei Reichen.",
    availableCommands: ["forward", "left", "right", "action", "function", "call"],
    actionGaps: [{ x: 4, y: 4 }],
    board: { width: 9, height: 8 },
    storySymbol: "↟",
    concept: "Funktionen + Überwinden",
  },
  {
    id: "sternentor-1",
    realm: "cloud",
    location: "Sternentor",
    title: "Das große Rezept",
    intro: "Das letzte Tor braucht deinen eigenen Plan: Funktion, Drehung und den leuchtenden Schritt.",
    success: "Das Sternentor öffnet sich. Milo kennt jetzt Wege, Schleifen und eigene Rezepte.",
    points: [{ x: 1, y: 6 }, { x: 2, y: 6 }, { x: 3, y: 6 }, { x: 3, y: 5, height: 1 }, { x: 3, y: 4, height: 1 }, { x: 5, y: 4, height: 1 }, { x: 5, y: 3, height: 1 }, { x: 5, y: 2, height: 1 }, { x: 6, y: 2, height: 1 }, { x: 7, y: 2, height: 1 }, { x: 7, y: 1, height: 1 }],
    startHeading: "right",
    programLength: 13,
    goalLabel: "TOR",
    nextStory: "",
    availableCommands: ["forward", "left", "right", "action", "function", "call"],
    actionGaps: [{ x: 4, y: 4, height: 1 }],
    board: { width: 9, height: 8 },
    storySymbol: "✺",
    concept: "Eigene Funktionen",
  },
];

const TILE_SPACING = 1.72;
const HEIGHT_STEP = 1.35;

function gridToWorld(point: GridPoint) {
  return new THREE.Vector3((point.x - 3) * TILE_SPACING, (point.height ?? 0) * HEIGHT_STEP, (point.y - 2.7) * TILE_SPACING);
}

function sameGridPoint(a: GridPoint, b: GridPoint) {
  return a.x === b.x && a.y === b.y && (a.height ?? 0) === (b.height ?? 0);
}

function walkablePoints(level: Level) {
  const points = level.points;
  return points.filter((point, index) => points.findIndex((candidate) => sameGridPoint(candidate, point)) === index);
}

function turn(heading: Heading, direction: "left" | "right"): Heading {
  const order: Heading[] = ["up", "right", "down", "left"];
  const delta = direction === "right" ? 1 : -1;
  return order[(order.indexOf(heading) + delta + order.length) % order.length];
}

function simulate(level: Level, program: ProgramItem[]): Simulation {
  let state: PlayerState = { step: 0, heading: level.startHeading, grid: { ...level.points[0] } };
  const trace: PlayerState[] = [{ ...state }];
  const errors: Array<{ index: number; kind: "edge" | "blocked" | "action" | "function" }> = [];
  let functionBody: ProgramCommand[] | null = null;
  const pushBump = (index: number, kind: "edge" | "blocked" | "action" | "function") => {
    errors.push({ index, kind });
    state = { ...state, programIndex: index, error: kind };
    trace.push({ ...state });
  };
  const deltas: Record<Heading, GridPoint> = {
    up: { x: 0, y: -1 },
    right: { x: 1, y: 0 },
    down: { x: 0, y: 1 },
    left: { x: -1, y: 0 },
  };
  const execute = (index: number, command: ProgramCommand) => {
    if (command === "left" || command === "right") {
      state = { step: state.step, heading: turn(state.heading, command), grid: state.grid, programIndex: index };
      trace.push({ ...state });
      return;
    }
    const isAction = command === "action";
    const delta = deltas[state.heading];
    const oneStepGrid = { x: state.grid.x + delta.x, y: state.grid.y + delta.y, height: state.grid.height };
    const jumpGrid = { x: state.grid.x + delta.x * 2, y: state.grid.y + delta.y * 2, height: state.grid.height };
    const nextRoute = level.points[state.step + 1];
    const nextHeight = nextRoute?.height ?? 0;
    const currentHeight = state.grid.height ?? 0;
    const isClimb = Boolean(isAction && nextRoute && nextRoute.x === oneStepGrid.x && nextRoute.y === oneStepGrid.y && nextHeight === currentHeight + 1);
    const isJump = Boolean(isAction && nextRoute && nextRoute.x === jumpGrid.x && nextRoute.y === jumpGrid.y && nextHeight === currentHeight);
    const nextGrid = isAction ? (isClimb ? oneStepGrid : jumpGrid) : oneStepGrid;
    const board = level.board ?? { width: 7, height: 6 };
    const isInsideBoard = nextGrid.x >= 0 && nextGrid.x < board.width && nextGrid.y >= 0 && nextGrid.y < board.height;
    if (!isInsideBoard) {
      pushBump(index, "edge");
      return;
    }
    const isForward = Boolean(nextRoute && nextRoute.x === nextGrid.x && nextRoute.y === nextGrid.y && nextHeight === currentHeight);
    if ((isAction && !isClimb && !isJump) || (!isAction && !isForward)) {
      pushBump(index, isAction ? "action" : "blocked");
      return;
    }
    state = {
      step: state.step + 1,
      heading: state.heading,
      grid: { ...nextRoute },
      programIndex: index,
    };
    trace.push({ ...state });
  };
  const executeItem = (index: number, item: ProgramItem) => {
    if (typeof item === "string") {
      execute(index, item);
      return;
    }
    if (isLoopItem(item)) {
      for (let iteration = 0; iteration < item.count; iteration += 1) execute(index, item.command);
      return;
    }
    if (isFunctionItem(item)) {
      functionBody = item.body;
      state = { ...state, programIndex: index, error: undefined };
      trace.push({ ...state });
      return;
    }
    if (!functionBody) {
      pushBump(index, "function");
      return;
    }
    for (const command of functionBody) execute(index, command);
  };
  for (const [index, item] of program.entries()) executeItem(index, item);
  const goal = level.points[level.points.length - 1];
  return { trace, success: state.grid.x === goal.x && state.grid.y === goal.y && (state.grid.height ?? 0) === (goal.height ?? 0), errors };
}

function setShadow(object: THREE.Object3D, cast = true) {
  object.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.castShadow = cast;
      child.receiveShadow = true;
    }
  });
  return object;
}

function material(color: number, options: Partial<THREE.MeshStandardMaterialParameters> = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: .78, metalness: .06, ...options });
}

function makeFox(opacity = 1) {
  const group = new THREE.Group();
  const orange = material(0xd86f45, { transparent: opacity < 1, opacity });
  const orangeDark = material(0x98433f, { transparent: opacity < 1, opacity });
  const cream = material(0xffd9a1, { transparent: opacity < 1, opacity });
  const black = material(0x15172a, { transparent: opacity < 1, opacity });
  const body = new THREE.Mesh(new THREE.SphereGeometry(.46, 12, 8), orange);
  body.scale.set(.86, 1.05, 1.18);
  body.position.y = .67;
  group.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(.38, 12, 8), orange);
  head.position.set(0, 1.28, -.32);
  group.add(head);
  const muzzle = new THREE.Mesh(new THREE.SphereGeometry(.22, 10, 6), cream);
  muzzle.scale.set(1, .72, .95);
  muzzle.position.set(0, 1.19, -.63);
  group.add(muzzle);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(.09, 8, 6), black);
  nose.position.set(0, 1.2, -.83);
  group.add(nose);
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(.045, 8, 6), black);
    eye.position.set(side * .16, 1.37, -.63);
    group.add(eye);
  }
  for (const side of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(.17, .4, 4), orangeDark);
    ear.position.set(side * .2, 1.6, -.34);
    ear.rotation.y = side * .25;
    group.add(ear);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(.09, .11, .48, 7), orangeDark);
    leg.position.set(side * .22, .29, -.18);
    group.add(leg);
    const backLeg = new THREE.Mesh(new THREE.CylinderGeometry(.09, .11, .48, 7), orangeDark);
    backLeg.position.set(side * .22, .29, .3);
    group.add(backLeg);
  }
  const tail = new THREE.Mesh(new THREE.ConeGeometry(.27, .95, 8), orangeDark);
  tail.position.set(0, .83, .62);
  tail.rotation.x = -Math.PI / 2;
  group.add(tail);
  const scarf = new THREE.Mesh(new THREE.TorusGeometry(.31, .055, 6, 16), material(0x70d3c1, { transparent: opacity < 1, opacity }));
  scarf.rotation.x = Math.PI / 2;
  scarf.position.set(0, 1.02, -.12);
  group.add(scarf);
  group.scale.setScalar(1.18);
  group.userData.idlePhase = opacity < 1 ? 1.7 : .4;
  return setShadow(group);
}

function makeTree(scale = 1) {
  const group = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(.16, .25, 1.8, 7), material(0x704c43));
  trunk.position.y = .9;
  group.add(trunk);
  const low = new THREE.Mesh(new THREE.ConeGeometry(1.05, 1.65, 7), material(0x1c5b57));
  low.position.y = 1.65;
  group.add(low);
  const high = new THREE.Mesh(new THREE.ConeGeometry(.78, 1.55, 7), material(0x287766));
  high.position.y = 2.55;
  group.add(high);
  const top = new THREE.Mesh(new THREE.ConeGeometry(.48, 1.25, 7), material(0x4e9b7e));
  top.position.y = 3.35;
  group.add(top);
  group.scale.setScalar(scale);
  return setShadow(group);
}

function makeRock(scale = 1) {
  const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(.52, 0), material(0x74828a));
  rock.scale.set(1.25 * scale, .7 * scale, .95 * scale);
  rock.position.y = .33 * scale;
  return setShadow(rock);
}

function makeTrailPebble(scale = 1) {
  const pebble = new THREE.Mesh(new THREE.CylinderGeometry(.16, .2, .08, 6), material(0x9a8b69, { roughness: .96 }));
  pebble.scale.setScalar(scale);
  pebble.position.y = .11;
  return setShadow(pebble);
}

function makeLantern(scene: THREE.Scene) {
  const group = new THREE.Group();
  const brass = material(0xc99b53, { metalness: .36, roughness: .42 });
  const dark = material(0x394455, { roughness: .55 });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(.26, .32, .15, 8), brass);
  base.position.y = .08;
  group.add(base);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(.045, .06, 1.15, 7), dark);
  pole.position.y = .68;
  group.add(pole);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(.3, .18, 4), brass);
  roof.position.y = 1.35;
  roof.rotation.y = Math.PI / 4;
  group.add(roof);
  const glow = new THREE.Mesh(new THREE.SphereGeometry(.14, 10, 8), material(0xffe890, { emissive: 0xffb84d, emissiveIntensity: 2.2 }));
  glow.position.y = 1.16;
  group.add(glow);
  const light = new THREE.PointLight(0xffbe62, 1.35, 4.6, 2);
  light.position.set(0, 1.15, 0);
  group.add(light);
  scene.add(group);
  return setShadow(group);
}

function makeShrine(scene: THREE.Scene) {
  const group = new THREE.Group();
  const stone = material(0x88929b, { roughness: .6 });
  const pale = material(0xd9d1a3, { roughness: .48 });
  const base = new THREE.Mesh(new THREE.BoxGeometry(1.1, .45, 1.1), stone);
  base.position.y = .23;
  group.add(base);
  const cap = new THREE.Mesh(new THREE.BoxGeometry(.88, .18, .88), pale);
  cap.position.y = .55;
  group.add(cap);
  const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(.42, 0), material(0xffd86b, { emissive: 0xe9834e, emissiveIntensity: 1.8, roughness: .28 }));
  crystal.position.y = 1.02;
  group.add(crystal);
  const light = new THREE.PointLight(0xffc75a, 1.8, 5.4, 2);
  light.position.y = 1.05;
  group.add(light);
  scene.add(group);
  return setShadow(group);
}

function makeMoonTower(scene: THREE.Scene) {
  const group = new THREE.Group();
  const stone = material(0x718391, { roughness: .6 });
  const pale = material(0xb9d2d1, { roughness: .45 });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(.78, .92, .34, 8), stone);
  base.position.y = .17;
  group.add(base);
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(.42, .56, 1.45, 8), pale);
  tower.position.y = 1.04;
  group.add(tower);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(.72, .54, 8), material(0x304d66, { roughness: .66 }));
  roof.position.y = 2.03;
  group.add(roof);
  const moon = new THREE.Mesh(new THREE.TorusGeometry(.3, .065, 7, 18), material(0xffe29a, { emissive: 0xd88a42, emissiveIntensity: 1.9, roughness: .32 }));
  moon.position.set(0, 2.53, 0);
  group.add(moon);
  const beacon = new THREE.Mesh(new THREE.OctahedronGeometry(.17, 0), material(0x8cebdd, { emissive: 0x55bcae, emissiveIntensity: 2.2, roughness: .25 }));
  beacon.position.y = 2.5;
  group.add(beacon);
  const light = new THREE.PointLight(0x79eadb, 2.1, 6.5, 2);
  light.position.set(0, 2.4, 0);
  group.add(light);
  scene.add(group);
  return setShadow(group);
}

function makeLadder(scene: THREE.Scene, fromPoint: GridPoint, toPoint: GridPoint) {
  const group = new THREE.Group();
  const wood = material(0xf1bc71, { emissive: 0x7c3a20, emissiveIntensity: .35, roughness: .7 });
  const height = (toPoint.height ?? 0) - (fromPoint.height ?? 0);
  const railHeight = height * HEIGHT_STEP + .18;
  for (const side of [-1, 1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(.09, railHeight, .09), wood);
    rail.position.set(side * .32, railHeight / 2 + .22, 0);
    group.add(rail);
  }
  for (let index = 0; index < Math.max(3, Math.round(railHeight / .34)); index += 1) {
    const rung = new THREE.Mesh(new THREE.BoxGeometry(.7, .08, .1), wood);
    rung.position.set(0, .34 + index * .34, 0);
    group.add(rung);
  }
  const from = gridToWorld(fromPoint);
  const to = gridToWorld(toPoint);
  group.position.set((from.x + to.x) / 2, from.y, (from.z + to.z) / 2);
  // Put the ladder beside the route, rather than hiding it inside the two stones.
  if (Math.abs(to.x - from.x) > Math.abs(to.z - from.z)) group.position.z += .46;
  else group.position.x += .46;
  scene.add(setShadow(group));
}

function makeJumpGap(scene: THREE.Scene, point: GridPoint) {
  const gap = new THREE.Group();
  const voidMaterial = material(0x111a2c, { roughness: .25, metalness: .12, emissive: 0x060b17, emissiveIntensity: .5 });
  const voidPlane = new THREE.Mesh(new THREE.CircleGeometry(.68, 8), voidMaterial);
  voidPlane.rotation.x = -Math.PI / 2;
  voidPlane.position.y = .035;
  gap.add(voidPlane);
  const edgeMaterial = material(0xffb65d, { emissive: 0xb7523e, emissiveIntensity: 1.8, roughness: .42 });
  for (const side of [-1, 1]) {
    const edge = new THREE.Mesh(new THREE.BoxGeometry(.12, .08, 1.3), edgeMaterial);
    edge.position.set(side * .64, .08, 0);
    gap.add(edge);
  }
  gap.position.copy(gridToWorld(point));
  scene.add(setShadow(gap));
}

function makeMossCluster(scale = 1) {
  const group = new THREE.Group();
  const stone = material(0x536d62, { roughness: .96 });
  const glow = material(0x9de675, { emissive: 0x4e9d55, emissiveIntensity: 1.25, roughness: .48 });
  const base = new THREE.Mesh(new THREE.DodecahedronGeometry(.48, 0), stone);
  base.scale.set(1.3, .72, 1);
  base.position.y = .35;
  group.add(base);
  for (const [x, z, size] of [[-.3, .04, .34], [.18, -.08, .28], [.4, .14, .22]] as const) {
    const stalk = new THREE.Mesh(new THREE.CylinderGeometry(.045, .065, .38 * size * 2, 6), glow);
    stalk.position.set(x * scale, .55 * scale, z * scale);
    group.add(stalk);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(.2 * size * 2, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), glow);
    cap.position.set(x * scale, .78 * scale, z * scale);
    group.add(cap);
  }
  group.scale.setScalar(scale);
  return setShadow(group);
}

function makeCloudPuff(scale = 1) {
  const group = new THREE.Group();
  const cloud = material(0xd9e7ff, { transparent: true, opacity: .82, roughness: .92 });
  for (const [x, y, z, radius] of [[-.42, .22, 0, .46], [0, .38, .04, .58], [.48, .2, -.02, .4]] as const) {
    const puff = new THREE.Mesh(new THREE.SphereGeometry(radius, 10, 7), cloud);
    puff.position.set(x * scale, y * scale, z * scale);
    group.add(puff);
  }
  group.scale.setScalar(scale);
  return setShadow(group, false);
}

function makeSkyCrystal(scale = 1) {
  const group = new THREE.Group();
  const violet = material(0xb8a6ff, { emissive: 0x7356d6, emissiveIntensity: 1.65, roughness: .32, metalness: .12 });
  const blue = material(0x80d7ff, { emissive: 0x2c74b5, emissiveIntensity: 1.4, roughness: .3, metalness: .1 });
  const left = new THREE.Mesh(new THREE.OctahedronGeometry(.35, 0), violet);
  left.position.set(-.18, .45, 0);
  left.rotation.z = -.2;
  group.add(left);
  const right = new THREE.Mesh(new THREE.OctahedronGeometry(.27, 0), blue);
  right.position.set(.22, .35, .05);
  right.rotation.z = .28;
  group.add(right);
  group.scale.setScalar(scale);
  return setShadow(group);
}

function makeCloudGate(scene: THREE.Scene) {
  const group = new THREE.Group();
  const frame = material(0xc3b7ff, { emissive: 0x715dd1, emissiveIntensity: 1.4, roughness: .34, metalness: .2 });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.06, .13, 8, 28), frame);
  ring.position.y = 1.17;
  group.add(ring);
  for (const side of [-1, 1]) {
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(.16, .22, 1.2, 7), frame);
    pillar.position.set(side * .82, .62, 0);
    group.add(pillar);
  }
  const core = new THREE.Mesh(new THREE.SphereGeometry(.35, 12, 8), material(0xf1edff, { emissive: 0xb7a8ff, emissiveIntensity: 2.1, transparent: true, opacity: .82 }));
  core.position.y = 1.18;
  group.add(core);
  const light = new THREE.PointLight(0xb3a5ff, 2.2, 6.5, 2);
  light.position.y = 1.15;
  group.add(light);
  scene.add(group);
  return setShadow(group);
}

function makeWorld(level: Level) {
  const scene = new THREE.Scene();
  const theme = realmMeta[level.realm];
  scene.background = new THREE.Color(theme.sky);
  scene.fog = new THREE.Fog(theme.fog, 18, 38);
  scene.add(new THREE.HemisphereLight(0x93b9d5, 0x172438, 1.65));
  const moonLight = new THREE.DirectionalLight(0xb4d8ff, 2.2);
  moonLight.position.set(-7, 13, 8);
  moonLight.castShadow = true;
  moonLight.shadow.mapSize.set(1024, 1024);
  moonLight.shadow.camera.left = -12;
  moonLight.shadow.camera.right = 12;
  moonLight.shadow.camera.top = 12;
  moonLight.shadow.camera.bottom = -12;
  scene.add(moonLight);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(20, 16), material(theme.ground, { roughness: .98 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  if (level.id === "mondquell-1") {
    const river = new THREE.Mesh(new THREE.PlaneGeometry(10.4, .68), material(0x1f7890, { transparent: true, opacity: .9, roughness: .25, metalness: .1 }));
    river.rotation.x = -Math.PI / 2;
    // The second route crosses this river between (3,3) and (3,2).
    // Keeping the river and bridge on the same world-space crossing prevents a
    // decorative bridge from reading as an unrelated floating prop.
    river.position.set(1.1, .19, -.34);
    scene.add(river);
    for (const offset of [-.42, .42]) {
      const bank = new THREE.Mesh(new THREE.PlaneGeometry(10.4, .14), material(0x84745a, { roughness: .94 }));
      bank.rotation.x = -Math.PI / 2;
      bank.position.set(1.1, .205, -.34 + offset);
      scene.add(bank);
    }
    const riverHighlight = new THREE.Mesh(new THREE.PlaneGeometry(8.4, .045), material(0x85e5d0, { transparent: true, opacity: .72, roughness: .2 }));
    riverHighlight.rotation.x = -Math.PI / 2;
    riverHighlight.position.set(1.1, .215, -.2);
    scene.add(riverHighlight);
  }

  const occupied = walkablePoints(level);
  if (level.realm === "forest") {
    const treeSpots = [{ x: 0, y: 1, scale: 1.08 }, { x: 6, y: 1, scale: .95 }, { x: 6, y: 5, scale: .8 }];
    for (const spot of treeSpots) {
      if (occupied.some((point) => sameGridPoint(point, spot))) continue;
      const tree = makeTree(spot.scale);
      const position = gridToWorld(spot);
      tree.position.copy(position);
      tree.position.y = 0;
      scene.add(tree);
    }
    for (const spot of [{ x: 0, y: 5, scale: .72 }, { x: 5, y: 5, scale: .62 }]) {
      if (occupied.some((point) => sameGridPoint(point, spot))) continue;
      const rock = makeRock(spot.scale);
      rock.position.copy(gridToWorld(spot));
      scene.add(rock);
    }
    for (const spot of [{ x: 1, y: 2 }, { x: 4, y: 2 }]) {
      const mushroom = new THREE.Group();
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(.1, .13, .35, 8), material(0xffd8a0));
      stem.position.y = .18;
      mushroom.add(stem);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(.32, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), material(spot.x === 1 ? 0xeb8b77 : 0xa899f4));
      cap.position.y = .4;
      mushroom.add(cap);
      mushroom.position.copy(gridToWorld(spot));
      scene.add(setShadow(mushroom));
    }
    for (const spot of [{ x: 1, y: 3 }, { x: 4, y: 3 }]) {
      const lantern = makeLantern(scene);
      lantern.position.copy(gridToWorld(spot));
    }
  } else if (level.realm === "moss") {
    for (const spot of [{ x: 0, y: 1, scale: 1.15 }, { x: 6, y: 1, scale: .92 }, { x: 6, y: 6, scale: .8 }, { x: 0, y: 6, scale: .7 }]) {
      if (occupied.some((point) => sameGridPoint(point, spot))) continue;
      const cluster = makeMossCluster(spot.scale);
      cluster.position.copy(gridToWorld(spot));
      scene.add(cluster);
    }
    for (const spot of [{ x: 1, y: 2, scale: .8 }, { x: 4, y: 2, scale: .62 }, { x: 7, y: 6, scale: .72 }]) {
      if (occupied.some((point) => sameGridPoint(point, spot))) continue;
      const rock = makeRock(spot.scale);
      rock.material = material(0x4c6c63, { roughness: .95 });
      rock.position.copy(gridToWorld(spot));
      scene.add(rock);
    }
  } else {
    for (const spot of [{ x: 0, y: 1, scale: .85 }, { x: 6, y: 1, scale: .72 }, { x: 0, y: 7, scale: .62 }]) {
      const cloud = makeCloudPuff(spot.scale);
      cloud.position.copy(gridToWorld(spot));
      cloud.position.y = -.1;
      scene.add(cloud);
    }
    for (const spot of [{ x: 1, y: 2, scale: .9 }, { x: 6, y: 5, scale: .72 }, { x: 8, y: 1, scale: .62 }]) {
      const crystal = makeSkyCrystal(spot.scale);
      crystal.position.copy(gridToWorld(spot));
      scene.add(crystal);
    }
  }
  if (level.id === "mondquell-1") {
    const bridge = new THREE.Group();
    const plankMaterial = material(0xb8784e, { roughness: .74 });
    for (let index = -2; index <= 2; index += 1) {
      const plank = new THREE.Mesh(new THREE.BoxGeometry(.42, .12, 1.25), plankMaterial);
      plank.position.set(index * .43, .26, 0);
      bridge.add(plank);
    }
    const railMaterial = material(0x765049);
    for (const side of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(2.5, .1, .1), railMaterial);
      rail.position.set(0, .77, side * .58);
      bridge.add(rail);
      for (const x of [-1, 0, 1]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(.1, .65, .1), railMaterial);
        post.position.set(x * .85, .45, side * .58);
        bridge.add(post);
      }
    }
    bridge.position.copy(gridToWorld({ x: 3, y: 2.5 }));
    bridge.rotation.y = Math.PI / 2;
    scene.add(setShadow(bridge));
  }

  for (const gap of level.actionGaps ?? []) makeJumpGap(scene, gap);

  for (let index = 0; index < level.points.length - 1; index += 1) {
    const fromPoint = level.points[index];
    const toPoint = level.points[index + 1];
    if ((toPoint.height ?? 0) > (fromPoint.height ?? 0)) makeLadder(scene, fromPoint, toPoint);
  }

  for (const route of [level.points]) {
    for (let index = 0; index < route.length - 1; index += 1) {
      if (Math.abs(route[index + 1].x - route[index].x) + Math.abs(route[index + 1].y - route[index].y) > 1) continue;
      const from = gridToWorld(route[index]);
      const to = gridToWorld(route[index + 1]);
      for (const fraction of [.28, .56, .8]) {
        const pebble = makeTrailPebble(fraction === .56 ? .82 : .62);
        pebble.position.lerpVectors(from, to, fraction);
        pebble.position.y += .12;
        scene.add(pebble);
      }
    }
  }

  const stones: THREE.Mesh[] = [];
  const terrainPoints = walkablePoints(level);
  for (const point of terrainPoints) {
    const height = point.height ?? 0;
    if (height > 0) {
      const platform = new THREE.Mesh(new THREE.BoxGeometry(1.58, height * HEIGHT_STEP, 1.58), material(0x47695d, { roughness: .94 }));
      platform.position.set(gridToWorld(point).x, height * HEIGHT_STEP / 2, gridToWorld(point).z);
      scene.add(setShadow(platform));
    }
    const isStart = sameGridPoint(point, level.points[0]);
    const isGoal = sameGridPoint(point, level.points[level.points.length - 1]);
    const stoneColor = isStart ? 0x4c9b77 : isGoal ? 0x8f7049 : 0xb39361;
    const stone = new THREE.Mesh(new THREE.CylinderGeometry(.7, .78, .3, 6), material(stoneColor, { roughness: .9 }));
    stone.position.copy(gridToWorld(point));
    stone.position.y += .28;
    scene.add(setShadow(stone));
    stones.push(stone);
  }
  const shrine = level.realm === "cloud" ? makeCloudGate(scene) : level.id === "mondturm-1" ? makeMoonTower(scene) : makeShrine(scene);
  shrine.position.copy(gridToWorld(level.points[level.points.length - 1]));
  shrine.position.y += .25;
  const startRing = new THREE.Mesh(new THREE.RingGeometry(.82, .91, 32), material(0x78e7cf, { emissive: 0x39b8aa, emissiveIntensity: 1.35, transparent: true, opacity: .85, side: THREE.DoubleSide }));
  startRing.rotation.x = -Math.PI / 2;
  const startPosition = gridToWorld(level.points[0]);
  startRing.position.set(startPosition.x, startPosition.y + .45, startPosition.z);
  scene.add(startRing);
  const avatar = makeFox();
  scene.add(avatar);
  const ghost = makeFox(.24);
  ghost.visible = false;
  scene.add(ghost);
  const offRouteRing = new THREE.Mesh(new THREE.RingGeometry(.7, .82, 32), material(0xff9d8d, { emissive: 0xb9474e, emissiveIntensity: 1.6, transparent: true, opacity: .9, side: THREE.DoubleSide }));
  offRouteRing.rotation.x = -Math.PI / 2;
  offRouteRing.position.y = .36;
  offRouteRing.visible = false;
  scene.add(offRouteRing);

  const update = (snapshot: SceneSnapshot) => {
    const playerPosition = gridToWorld(snapshot.player.grid);
    const playerTarget = playerPosition.clone();
    playerTarget.y += .25;
    avatar.userData.target = playerTarget;
    avatar.userData.heading = snapshot.player.heading;
    const previewPosition = gridToWorld(snapshot.preview.grid);
    previewPosition.y += .25;
    ghost.userData.target = previewPosition;
    ghost.userData.heading = snapshot.preview.heading;
    ghost.visible = snapshot.showPhantom && snapshot.commands.length > 0 && snapshot.runState !== "success" && (snapshot.preview.grid.x !== snapshot.player.grid.x || snapshot.preview.grid.y !== snapshot.player.grid.y || snapshot.preview.heading !== snapshot.player.heading);
    const playerOnRoute = snapshot.level.points.some((point) => point.x === snapshot.player.grid.x && point.y === snapshot.player.grid.y && (point.height ?? 0) === (snapshot.player.grid.height ?? 0));
    offRouteRing.visible = Boolean(snapshot.player.error) && playerOnRoute && snapshot.runState !== "success";
    offRouteRing.position.set(playerPosition.x, playerPosition.y + .36, playerPosition.z);
  };

  return { scene, avatar, ghost, offRouteRing, update };
}

function ThreeScene({ snapshot }: { snapshot: SceneSnapshot }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const snapshotRef = useRef(snapshot);
  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const showError = (message: string) => {
      let errorNode = stage.querySelector<HTMLDivElement>(".webgl-error");
      if (!errorNode) {
        errorNode = document.createElement("div");
        errorNode.className = "webgl-error";
        errorNode.setAttribute("role", "alert");
        stage.appendChild(errorNode);
      }
      errorNode.textContent = message;
    };
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    } catch {
      showError("3D konnte auf diesem Gerät nicht gestartet werden.");
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.setAttribute("aria-label", "Dreidimensionale Sternenlichtung");
    stage.appendChild(renderer.domElement);
    const wideWorld = (snapshotRef.current.level.board?.width ?? 7) > 7;
    const camera = new THREE.PerspectiveCamera(58, 1, .1, 60);
    camera.position.set(wideWorld ? 11.4 : 8.8, wideWorld ? 12.8 : 10.6, wideWorld ? 16.8 : 13.6);
    camera.lookAt(wideWorld ? 1.2 : 0, .3, wideWorld ? 1.15 : .45);
    const world = makeWorld(snapshotRef.current.level);
    world.scene.add(new THREE.AmbientLight(0x7384a5, .25));
    const contextLost = () => showError("Die 3D-Szene wurde vom Browser pausiert. Bitte neu laden.");
    renderer.domElement.addEventListener("webglcontextlost", contextLost);
    let animationFrame = 0;
    const resize = () => {
      const width = stage.clientWidth || window.innerWidth;
      const height = stage.clientHeight || window.innerHeight;
      camera.aspect = width / height;
      camera.fov = width < 600 ? 64 : 54;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };
    const animate = (time: number) => {
      const current = snapshotRef.current;
      world.update(current);
      const target = world.avatar.userData.target as THREE.Vector3 | undefined;
      if (target) world.avatar.position.lerp(target, current.runState === "running" ? .16 : .3);
      const avatarBob = current.runState === "running" ? Math.sin(time * .022) * .075 : Math.sin(time * .002 + (world.avatar.userData.idlePhase as number)) * .025;
      if (target) world.avatar.position.y = target.y + avatarBob;
      const bump = Boolean(current.player.error) && current.runState !== "success";
      world.avatar.rotation.z += ((bump ? Math.sin(time * .03) * .1 : 0) - world.avatar.rotation.z) * .22;
      world.avatar.scale.setScalar(1.18 * (bump ? 1 + Math.abs(Math.sin(time * .03)) * .08 : 1));
      const ghostTarget = world.ghost.userData.target as THREE.Vector3 | undefined;
      if (ghostTarget) world.ghost.position.lerp(ghostTarget, .24);
      const heading = world.avatar.userData.heading as Heading | undefined;
      if (heading) {
        const angles: Record<Heading, number> = { up: 0, right: -Math.PI / 2, down: Math.PI, left: Math.PI / 2 };
        world.avatar.rotation.y += (angles[heading] - world.avatar.rotation.y) * .16;
      }
      const ghostHeading = world.ghost.userData.heading as Heading | undefined;
      if (ghostHeading) {
        const angles: Record<Heading, number> = { up: 0, right: -Math.PI / 2, down: Math.PI, left: Math.PI / 2 };
        world.ghost.rotation.y += (angles[ghostHeading] - world.ghost.rotation.y) * .16;
      }
      world.offRouteRing.rotation.z = -time * .0012;
      world.offRouteRing.scale.setScalar(1 + Math.sin(time * .005) * .06);
      renderer.render(world.scene, camera);
      animationFrame = window.requestAnimationFrame(animate);
    };
    resize();
    window.addEventListener("resize", resize);
    animationFrame = window.requestAnimationFrame(animate);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", resize);
      renderer.domElement.removeEventListener("webglcontextlost", contextLost);
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [snapshot.level.id]);

  return <div ref={stageRef} className="webgl-stage" />;
}

function WorldMap({ levelIndex, completed, level, onOpenLevel, onClose }: { levelIndex: number; completed: string[]; level: Level; onOpenLevel: (index: number) => void; onClose: () => void }) {
  const isUnlocked = (index: number) => index === 0 || index === levelIndex || completed.includes(levels[index - 1].id);
  return <section className="world-map-overlay" aria-label="Weltkarte"><div className="world-map-card"><button className="map-close" onClick={onClose} aria-label="Weltkarte schließen">×</button><div className="map-heading"><span className="map-eyebrow">Milos Sternenpfad</span><strong>Die Welt öffnet sich</strong><span>Jeder Lichtpunkt ist ein neuer Ort.</span></div><div className="map-realms">{realmOrder.map((realmId) => <section key={realmId} className="map-realm-group"><div className="map-realm-heading"><span style={{ color: realmMeta[realmId].accent }}>{realmMeta[realmId].name}</span><small>{realmMeta[realmId].subtitle}</small></div><div className="map-path">{levels.map((entry, index) => entry.realm !== realmId ? null : (() => { const unlocked = isUnlocked(index); const selected = index === levelIndex; return <button key={entry.id} className={`map-node ${unlocked ? "is-unlocked" : "is-locked"} ${selected ? "is-selected" : ""} ${completed.includes(entry.id) ? "is-complete" : ""}`} onClick={() => unlocked && onOpenLevel(index)} disabled={!unlocked} aria-label={`${entry.location}: ${entry.title}`}><span className="map-node-symbol" aria-hidden="true">{entry.storySymbol ?? (index < 3 ? ["✦", "≈", "☾"][index] : "•")}</span><small>{index + 1}</small></button>; })())}</div></section>)}</div><div className="map-story"><span style={{ color: realmMeta[level.realm].accent }}>{realmMeta[level.realm].name} · {level.location}</span><strong>{level.title}</strong><p>{level.concept ? `Neues Denken: ${level.concept}` : level.intro}</p><i>{completed.length} von {levels.length} Lichtorten geöffnet</i></div></div></section>;
}

export default function Home() {
  const [levelIndex, setLevelIndex] = useState(0);
  const [commands, setCommands] = useState<ProgramItem[]>([]);
  const [runState, setRunState] = useState<RunState>("idle");
  const [runMode, setRunMode] = useState<RunMode>("slow");
  const [activeTraceIndex, setActiveTraceIndex] = useState(0);
  const [completed, setCompleted] = useState<string[]>([]);
  const [soundOn, setSoundOn] = useState(true);
  const [showPhantom, setShowPhantom] = useState(true);
  const [worldMapOpen, setWorldMapOpen] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const soundContextRef = useRef<AudioContext | null>(null);
  const narrationPlayedRef = useRef(false);
  const runTimerRef = useRef<number | null>(null);
  const runIndexRef = useRef(0);
  const dragIndexRef = useRef<number | null>(null);
  const dragMovedRef = useRef(false);
  const completedHydratedRef = useRef(false);
  const runStateRef = useRef<RunState>("idle");
  const level = levels[levelIndex];
  const simulation = useMemo(() => simulate(level, commands), [level, commands]);
  const availableCommands = level.availableCommands;
  const player = simulation.trace[Math.min(activeTraceIndex, simulation.trace.length - 1)] ?? { step: 0, heading: level.startHeading, grid: { ...level.points[0] } };
  const preview = simulation.trace[simulation.trace.length - 1] ?? player;

  function updateRunState(next: RunState) {
    runStateRef.current = next;
    setRunState(next);
  }

  function clearRunTimer() {
    if (runTimerRef.current !== null) window.clearTimeout(runTimerRef.current);
    runTimerRef.current = null;
  }

  function narrateOnce() {
    if (narrationPlayedRef.current) return;
    narrationPlayedRef.current = true;
    if (!soundOn || !audioRef.current) return;
    audioRef.current.currentTime = 0;
    void audioRef.current.play().catch(() => setSoundOn(false));
  }

  function playCue(cue: "tap" | "turn" | "step" | "jump" | "climb" | "bump" | "run" | "success" | "retry") {
    if (!soundOn || typeof window === "undefined") return;
    try {
      const context = soundContextRef.current ?? new window.AudioContext();
      soundContextRef.current = context;
      if (context.state === "suspended") void context.resume();
      const patterns: Record<typeof cue, Array<[number, number, number]>> = {
        tap: [[520, 0, .045]],
        turn: [[310, 0, .07], [420, .06, .07]],
        step: [[240, 0, .08], [330, .06, .09]],
        jump: [[330, 0, .1], [500, .08, .1], [760, .16, .14]],
        climb: [[280, 0, .1], [420, .09, .1], [640, .18, .14]],
        bump: [[130, 0, .11], [82, .08, .16]],
        run: [[240, 0, .08], [360, .07, .1]],
        success: [[392, 0, .12], [494, .1, .12], [659, .2, .16], [784, .32, .24]],
        retry: [[180, 0, .13], [120, .11, .2]],
      };
      const now = context.currentTime;
      for (const [frequency, offset, duration] of patterns[cue]) {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = cue === "bump" || cue === "retry" ? "sawtooth" : "triangle";
        oscillator.frequency.setValueAtTime(frequency, now + offset);
        gain.gain.setValueAtTime(.0001, now + offset);
        gain.gain.exponentialRampToValueAtTime(cue === "success" ? .12 : .075, now + offset + .012);
        gain.gain.exponentialRampToValueAtTime(.0001, now + offset + duration);
        oscillator.connect(gain).connect(context.destination);
        oscillator.start(now + offset);
        oscillator.stop(now + offset + duration + .02);
      }
    } catch {
      // Audio is an enhancement; a browser without Web Audio must remain playable.
    }
  }

  function playTraceCue(traceIndex: number) {
    const previous = simulation.trace[traceIndex - 1];
    const current = simulation.trace[traceIndex];
    if (!previous || !current) return;
    if (current.error) playCue("bump");
    else if ((current.grid.height ?? 0) !== (previous.grid.height ?? 0)) playCue("climb");
    else if (Math.abs(current.grid.x - previous.grid.x) + Math.abs(current.grid.y - previous.grid.y) > 1) playCue("jump");
    else if (current.heading !== previous.heading) playCue("turn");
    else playCue("step");
  }

  function addLoop() {
    if (runState === "running" || runState === "success" || commands.length === 0) return;
    const last = commands[commands.length - 1];
    if (typeof last !== "string") return;
    setCommands((current) => {
      const currentLast = current[current.length - 1];
      if (!currentLast || typeof currentLast !== "string") return current;
      return [...current.slice(0, -1), { type: "loop", command: currentLast, count: 2 }];
    });
    playCue("tap");
    updateRunState("idle");
    setActiveTraceIndex(0);
    runIndexRef.current = 0;
  }

  function addFunction() {
    if (runState === "running" || runState === "success" || commands.some(isFunctionItem)) return;
    const body = commands.slice(-2);
    if (body.length !== 2 || body.some((item) => typeof item !== "string")) return;
    setCommands((current) => {
      const currentBody = current.slice(-2);
      if (currentBody.length !== 2 || currentBody.some((item) => typeof item !== "string")) return current;
      return [...current.slice(0, -2), { type: "function", body: currentBody }];
    });
    playCue("tap");
    updateRunState("idle");
    setActiveTraceIndex(0);
    runIndexRef.current = 0;
  }

  function addCall() {
    if (runState === "running" || runState === "success" || !commands.some(isFunctionItem) || commands.length >= level.programLength) return;
    updateRunState("idle");
    setActiveTraceIndex(0);
    runIndexRef.current = 0;
    setCommands((current) => [...current, { type: "call" }]);
    playCue("tap");
  }

  function addCommand(command: Command) {
    if (command === "loop") {
      addLoop();
      return;
    }
    if (command === "function") {
      addFunction();
      return;
    }
    if (command === "call") {
      addCall();
      return;
    }
    if (runState === "running" || runState === "success" || commands.length >= level.programLength) return;
    updateRunState("idle");
    setActiveTraceIndex(0);
    runIndexRef.current = 0;
    setCommands((current) => [...current, command]);
    playCue(command === "action" ? "jump" : command === "forward" ? "step" : "turn");
  }

  function removeCommand(index: number) {
    if (runState === "running" || runState === "success") return;
    setCommands((current) => current.filter((_, currentIndex) => currentIndex !== index));
    playCue("tap");
    updateRunState("idle");
    setActiveTraceIndex(0);
    runIndexRef.current = 0;
  }

  function cycleLoop(index: number) {
    if (runState === "running" || runState === "success") return;
    setCommands((current) => current.map((item, currentIndex) => currentIndex === index && isLoopItem(item) ? { ...item, count: item.count === 4 ? 2 : item.count + 1 } : item));
    playCue("tap");
    updateRunState("idle");
    setActiveTraceIndex(0);
    runIndexRef.current = 0;
  }

  function reorderCommands(fromIndex: number, toIndex: number) {
    if (fromIndex === toIndex || runState === "running" || runState === "success") return;
    setCommands((current) => {
      const next = [...current];
      const [moved] = next.splice(fromIndex, 1);
      if (!moved) return current;
      next.splice(toIndex, 0, moved);
      return next;
    });
    setActiveTraceIndex(0);
    runIndexRef.current = 0;
    updateRunState("idle");
  }

  function handleProgramPointerDown(index: number, event: ReactPointerEvent<HTMLButtonElement>) {
    if (!commands[index] || runState === "running" || runState === "success") return;
    dragIndexRef.current = index;
    dragMovedRef.current = false;
    setDragIndex(index);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleProgramPointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    const fromIndex = dragIndexRef.current;
    if (fromIndex === null) return;
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-program-index]");
    const targetIndex = target ? Number(target.dataset.programIndex) : NaN;
    if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= commands.length || targetIndex === fromIndex) return;
    reorderCommands(fromIndex, targetIndex);
    dragIndexRef.current = targetIndex;
    dragMovedRef.current = true;
    setDragIndex(targetIndex);
  }

  function handleProgramPointerUp() {
    const fromIndex = dragIndexRef.current;
    if (fromIndex !== null && !dragMovedRef.current) {
      if (isLoopItem(commands[fromIndex])) cycleLoop(fromIndex);
      else removeCommand(fromIndex);
    }
    dragIndexRef.current = null;
    dragMovedRef.current = false;
    setDragIndex(null);
  }

  function resetProgram() {
    if (runState === "running" || runState === "success") return;
    setCommands([]);
    updateRunState("idle");
    setActiveTraceIndex(0);
    runIndexRef.current = 0;
  }

  function advanceRunStep(scheduleNext = true) {
    const nextIndex = runIndexRef.current + 1;
    if (nextIndex < simulation.trace.length) {
      runIndexRef.current = nextIndex;
      setActiveTraceIndex(nextIndex);
      playTraceCue(nextIndex);
      if (nextIndex === simulation.trace.length - 1) {
        updateRunState(simulation.success ? "success" : "retry");
        if (simulation.success) setCompleted((current) => current.includes(level.id) ? current : [...current, level.id]);
        playCue(simulation.success ? "success" : "retry");
        runTimerRef.current = null;
        return;
      }
      if (scheduleNext && runMode !== "manual") runTimerRef.current = window.setTimeout(() => advanceRunStep(), runModeDelay[runMode]);
      return;
    }
    runIndexRef.current = nextIndex;
    updateRunState(simulation.success ? "success" : "retry");
    if (simulation.success) setCompleted((current) => current.includes(level.id) ? current : [...current, level.id]);
    runTimerRef.current = null;
  }

  function runProgram() {
    if (runState === "running" || commands.length === 0) return;
    clearRunTimer();
    updateRunState("running");
    playCue("run");
    if (levelIndex === 0) narrateOnce();
    setActiveTraceIndex(0);
    runIndexRef.current = 0;
    if (runMode !== "manual") runTimerRef.current = window.setTimeout(() => advanceRunStep(), runModeDelay[runMode]);
  }

  function stepProgram() {
    if (runMode !== "manual") return;
    if (runState === "success") return;
    if (runState !== "running") {
      if (commands.length === 0) return;
      clearRunTimer();
      updateRunState("running");
      setActiveTraceIndex(0);
      runIndexRef.current = 0;
    }
    advanceRunStep(false);
  }

  function nextLevel() {
    if (levelIndex < levels.length - 1) {
      openLevel(levelIndex + 1);
      return;
    }
    setWorldMapOpen(true);
  }

  function openLevel(index: number) {
    if (index < 0 || index >= levels.length) return;
    clearRunTimer();
    setLevelIndex(index);
    setCommands([]);
    updateRunState("idle");
    setActiveTraceIndex(0);
    runIndexRef.current = 0;
    setWorldMapOpen(false);
  }

  function selectRunMode(mode: RunMode) {
    if (runState === "running" || runState === "success") return;
    clearRunTimer();
    setRunMode(mode);
    updateRunState("idle");
    setActiveTraceIndex(0);
    runIndexRef.current = 0;
  }

  useEffect(() => () => clearRunTimer(), []);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("sternenpfad.completed");
      // Storage hydration is the one intentional state sync from an external store.
      if (saved) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setCompleted(JSON.parse(saved) as string[]);
      }
    } catch {
      // A private browsing context may deny storage; the current session still works.
    }
    completedHydratedRef.current = true;
  }, []);

  useEffect(() => {
    if (!completedHydratedRef.current) return;
    try {
      window.localStorage.setItem("sternenpfad.completed", JSON.stringify(completed));
    } catch {
      // Persistence is optional and must not block play.
    }
  }, [completed]);

  useEffect(() => {
    const renderGameToText = () => JSON.stringify({
      screen: "level",
      level: level.id,
      location: level.location,
      totalLevels: levels.length,
      concept: level.concept ?? "Grundbefehle",
      worldMapOpen,
      player: { step: player.step, heading: player.heading, grid: player.grid },
      preview: { step: preview.step, heading: preview.heading, grid: preview.grid },
      routeLength: level.points.length,
      program: commands,
      availableCommands,
      runState,
      runMode,
      showPhantom,
      errors: simulation.errors,
      completed,
      controls: { canRun: commands.length > 0 && runState !== "running" && runState !== "success", canStep: runMode === "manual" && commands.length > 0, canReset: runState !== "running" && runState !== "success" },
    });
    const testSurface = globalThis as typeof globalThis & { render_game_to_text?: () => string; advanceTime?: (milliseconds: number) => string };
    Object.assign(testSurface, {
      render_game_to_text: renderGameToText,
      advanceTime: (milliseconds: number) => {
        if (runStateRef.current === "running") {
          clearRunTimer();
          const stepDelay = runMode === "manual" ? 360 : runModeDelay[runMode];
          const steps = Math.max(1, Math.ceil(milliseconds / stepDelay));
          for (let index = 0; index < steps && runStateRef.current === "running"; index += 1) advanceRunStep(false);
        }
        return renderGameToText();
      },
    });
    return () => {
      Reflect.deleteProperty(testSurface, "render_game_to_text");
      Reflect.deleteProperty(testSurface, "advanceTime");
    };
    // The hook intentionally follows the current simulation snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableCommands, commands, completed, level, player, preview, runMode, runState, showPhantom, simulation.errors, worldMapOpen]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "1") addCommand("forward");
      if (event.key === "2") addCommand("left");
      if (event.key === "3") addCommand("right");
      if (event.key === "4" && availableCommands.includes("action")) addCommand("action");
      if (event.key === "6" && availableCommands.includes("loop")) addCommand("loop");
      if (event.key === "7" && availableCommands.includes("function")) addCommand("function");
      if (event.key === "8" && availableCommands.includes("call")) addCommand("call");
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        if (runState === "success") nextLevel();
        else runProgram();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const snapshot: SceneSnapshot = { level, player, preview, runState, commands, completed, showPhantom };
  const story = runState === "success" ? level.success : runState === "retry" ? "Dieser Weg endet noch nicht am Ziel." : level.intro;
  const canBuildLoop = commands.length > 0 && typeof commands[commands.length - 1] === "string";
  const canBuildFunction = commands.length >= 2 && !commands.some(isFunctionItem) && commands.slice(-2).every((item) => typeof item === "string");
  const hasFunction = commands.some(isFunctionItem);
  const renderCommandButton = (command: Command) => {
    const disabled = runState === "running" || runState === "success" || (command === "loop" ? !canBuildLoop : command === "function" ? !canBuildFunction : command === "call" ? !hasFunction || commands.length >= level.programLength : commands.length >= level.programLength);
    return <button key={command} className={`command-button command-${command}`} onClick={() => addCommand(command)} disabled={disabled} aria-label={commandMeta[command].label}><span className="command-key">{commandMeta[command].key}</span><span className="command-glyph" aria-hidden="true">{commandGlyph[command]}</span></button>;
  };
  const renderProgramSlot = (index: number) => {
    const item = commands[index];
    const loopItem = item && isLoopItem(item) ? item : null;
    const functionItem = item && isFunctionItem(item) ? item : null;
    const callItem = item && isCallItem(item) ? item : null;
    const itemClass = item ? (loopItem ? "loop" : functionItem ? "function" : callItem ? "call" : item) : "";
    const isPlaying = runState === "running" && simulation.trace[activeTraceIndex]?.programIndex === index;
    return <button key={index} data-program-index={index} className={`program-slot ${item ? `filled-${itemClass}` : ""} ${isPlaying ? "is-playing" : ""} ${dragIndex === index ? "is-dragging" : ""}`} onPointerDown={(event) => handleProgramPointerDown(index, event)} onPointerMove={handleProgramPointerMove} onPointerUp={handleProgramPointerUp} onPointerCancel={handleProgramPointerUp} aria-label={item ? `${programItemLabel(item)} verschieben${loopItem ? "; antippen für mehr Wiederholungen" : " oder entfernen"}` : `Befehl ${index + 1} leer`}><small>{index + 1}</small><span>{loopItem ? <><b className="loop-body-glyph" aria-hidden="true">{commandGlyph[loopItem.command]}</b><em className="loop-count" aria-hidden="true">×{loopItem.count}</em></> : functionItem ? <><b className="function-glyph" aria-hidden="true">ƒ</b><em className="function-body-glyphs" aria-hidden="true">{functionItem.body.map((command) => commandGlyph[command]).join("")}</em></> : callItem ? <b className="call-glyph" aria-hidden="true">↗</b> : item ? commandGlyph[item] : ""}</span></button>;
  };

  return <main className="three-game">
    <ThreeScene snapshot={snapshot} />
    <header className="three-hud">
      <div className="journey-badge" aria-label={`${level.location}, Level ${levelIndex + 1} von ${levels.length}`}><span className="journey-dot" /><small>{levelIndex + 1} / {levels.length}</small></div>
      <div className="hud-progress" aria-label={`${completed.length} von ${levels.length} Orten geöffnet`}>{levels.map((entry, index) => <i key={entry.id} className={completed.includes(entry.id) || index === levelIndex ? "is-lit" : ""} />)}</div>
      <div className="hud-actions"><button onClick={() => setWorldMapOpen(true)} aria-label="Weltkarte öffnen"><span aria-hidden="true">✧</span></button><button onClick={() => setSoundOn((current) => !current)} aria-label={soundOn ? "Ton ausschalten" : "Ton anschalten"}><span aria-hidden="true">{soundOn ? "♪" : "∅"}</span></button><button className={showPhantom ? "" : "is-off"} onClick={() => setShowPhantom((current) => !current)} aria-label={showPhantom ? "Phantom ausblenden" : "Phantom einblenden"}><span aria-hidden="true">◌</span></button></div>
    </header>
    <section className={`story-card state-${runState}`} aria-live="polite"><span className="story-state-symbol" aria-hidden="true">{runState === "success" ? "✦" : runState === "retry" ? "!" : level.storySymbol ?? "·"}</span><div><span className="story-location" style={{ color: realmMeta[level.realm].accent }}>{realmMeta[level.realm].name} · {level.location} · {level.title}</span><p>{story}</p></div></section>
    <section className="command-dock" aria-label="Befehle bauen">
      <div className="dock-heading"><div className="mode-row" aria-label="Ausführungsmodus">{(["slow", "fast", "manual"] as RunMode[]).map((mode) => <button key={mode} className={`mode-button ${runMode === mode ? "is-selected" : ""}`} onClick={() => selectRunMode(mode)} disabled={runState === "running"} aria-label={runModeMeta[mode].label} title={runModeMeta[mode].label}>{runModeMeta[mode].glyph}</button>)}</div><span className="command-count" aria-label={`${commands.length} von ${level.programLength} Befehlen`}>{commands.length}/{level.programLength}</span></div>
      <div className="program-row" style={{ gridTemplateColumns: `repeat(${Math.min(level.programLength, 9)}, minmax(0, 1fr)) 36px` }}>{Array.from({ length: level.programLength }, (_, index) => renderProgramSlot(index))}<button className="clear-button" onClick={resetProgram} disabled={runState === "running" || runState === "success"} aria-label="Befehle löschen"><span aria-hidden="true">×</span></button></div>
      <div className={`command-row ${availableCommands.length > 3 ? "command-row-four" : ""} ${availableCommands.length > 4 ? "command-row-many" : ""}`}>{availableCommands.map(renderCommandButton)}</div>
      <div className="execution-row"><button className={`run-button ${runState === "success" ? "is-success" : ""}`} onClick={runState === "success" ? nextLevel : runProgram} disabled={runState === "running" || (runState !== "success" && commands.length === 0)} aria-label={runState === "success" ? "Nächstes Level öffnen" : runState === "retry" ? "Programm erneut ausführen" : "Milo loslassen"}><span aria-hidden="true">{runState === "success" ? "→" : runState === "retry" ? "↻" : "▶"}</span></button><button className="step-button" onClick={stepProgram} disabled={runMode !== "manual" || commands.length === 0 || runState === "success"} aria-label="Einen Programmschritt ausführen"><span aria-hidden="true">›|</span></button></div>
    </section>
    {worldMapOpen && <WorldMap levelIndex={levelIndex} completed={completed} level={level} onOpenLevel={openLevel} onClose={() => setWorldMapOpen(false)} />}
    <audio ref={audioRef} src="story-narration.mp3" preload="metadata" />
  </main>;
}
