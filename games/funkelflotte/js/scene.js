// 3D stage for Funkel-Flotte: two themed dioramas (yours and the
// opponent's — possibly different worlds), a cinematic camera that
// flies between them, touch/drag interaction via raycasting, layered
// sky/backdrop shaders and juicy particle effects.
// Pure presentation — game rules live in engine.js.

import * as THREE from "../vendor/three.module.min.js";
import { tween, Ease, updateTweens } from "./tween.js";
import { getWorld } from "./worlds.js";
import { buildCreature, buildDecoy } from "./models.js";
import { buildEnvironment } from "./environments.js";

const GRID = 8;
const TILE = 1;
const SPAN = GRID * TILE;
const DIORAMA_GAP = 90;

let renderer = null;
let scene = null;
let camera = null;
let canvas = null;
let hemi = null;
let sun = null;
let sky = null;
let sunSprite = null;
let clockT = 0;
let focused = "mine";
let running = false;
let camKick = 0;

const dioramas = { mine: null, enemy: null };

// per-slot creature customization: shipId -> { tint, hat } (see models.js)
const customs = { mine: {}, enemy: {} };

export function setCustomization(slot, map) {
  customs[slot] = map || {};
}

let tapHandler = null;
let placement = null;
let drag = null;
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

// free-look: user-controlled orbit/tilt/zoom around the focused board
const orbit = { azim: 0, elev: null, zoom: 1 };
const pointers = new Map();
let gesture = null; // 'ship' | 'orbit' | 'pinch' | null
let pinchStart = null;

function clampNum(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

function defaultElevation() {
  return camera.aspect < 0.8 ? 0.7 : 0.62;
}

// camera pose for a slot from framing + user orbit state
function pose(slot) {
  const cx = dioramaX(slot);
  const e = clampNum(orbit.elev ?? defaultElevation(), 0.42, 1.35);
  const a = orbit.azim; // full 360° — spin all the way around
  // tilting low zooms in, top-down pulls back — plus manual pinch zoom
  const angleZoom = 0.78 + 0.5 * ((e - 0.42) / (1.35 - 0.42));
  const dist = framingDistance() * angleZoom * clampNum(orbit.zoom, 0.55, 1.5);
  const posV = new THREE.Vector3(
    cx + dist * Math.cos(e) * Math.sin(a),
    dist * Math.sin(e),
    dist * Math.cos(e) * Math.cos(a)
  );
  // look slightly past the board center, away from the camera, so the
  // board sits low in the frame at every rotation angle
  const lookV = new THREE.Vector3(cx - 2.0 * Math.sin(a), -0.2, -2.0 * Math.cos(a));
  return { pos: posV, look: lookV, elev: e, dist };
}

// --------------------------------------------------------------- helpers

export function radialTexture(inner = "rgba(255,255,255,1)", outer = "rgba(255,255,255,0)", size = 128) {
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ------------------------------------------------------------------ init

export function initScene(canvasEl) {
  canvas = canvasEl;
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;

  scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x9fd9f5, 48, 150);

  camera = new THREE.PerspectiveCamera(46, 1, 0.1, 400);
  camera.position.set(0, 14, 14);
  camera.lookAt(0, 0, 0);

  hemi = new THREE.HemisphereLight(0xffffff, 0x668899, 0.8);
  scene.add(hemi);
  sun = new THREE.DirectionalLight(0xfff4d6, 1.3);
  sun.position.set(-10, 16, 8);
  scene.add(sun);

  // gradient sky dome that follows the camera
  sky = new THREE.Mesh(
    new THREE.SphereGeometry(240, 24, 14),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top: { value: new THREE.Color(0x2a86c8) },
        horizon: { value: new THREE.Color(0xbfe6f5) },
      },
      vertexShader: `
        varying vec3 vPos;
        void main() {
          vPos = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 top;
        uniform vec3 horizon;
        varying vec3 vPos;
        void main() {
          float h = normalize(vPos).y * 0.5 + 0.5;
          vec3 col = mix(horizon, top, smoothstep(0.42, 0.85, h));
          gl_FragColor = vec4(col, 1.0);
        }`,
    })
  );
  scene.add(sky);

  // soft sun/glow sprite high in the sky
  sunSprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: radialTexture("rgba(255,246,200,0.95)", "rgba(255,246,200,0)"),
      transparent: true,
      depthWrite: false,
      fog: false,
    })
  );
  sunSprite.scale.setScalar(46);
  sunSprite.position.set(-60, 65, -110);
  scene.add(sunSprite);

  window.addEventListener("resize", resize);
  resize();

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);

  if (!running) {
    running = true;
    let last = performance.now();
    const loop = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      clockT += dt;
      updateTweens(dt);
      for (const d of Object.values(dioramas)) {
        if (!d) continue;
        if (d.env.userData.animate) d.env.userData.animate(clockT);
        for (const c of d.creatures.values()) {
          if (c.model.userData.animate) c.model.userData.animate(clockT + c.phase);
          c.holder.position.y = c.baseY + Math.sin(clockT * 1.4 + c.phase) * 0.05;
        }
        updateBursts(d, dt);
      }
      camKick *= Math.max(0, 1 - dt * 7);
      idleCamera();
      sky.position.copy(camera.position);
      renderer.render(scene, camera);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
}

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  focusBoard(focused, { immediate: true });
}

// -------------------------------------------------------------- dioramas

function dioramaX(slot) {
  return slot === "mine" ? 0 : DIORAMA_GAP;
}

export function setupBoard(slot, worldId) {
  disposeDiorama(slot);
  const world = getWorld(worldId);
  const root = new THREE.Group();
  root.position.x = dioramaX(slot);

  const env = buildEnvironment(worldId, SPAN * 0.72);
  root.add(env);

  // soft dark mat under the play area so grid + pads read clearly
  const mat = new THREE.Mesh(
    new THREE.PlaneGeometry(SPAN * 1.6, SPAN * 1.6),
    new THREE.MeshBasicMaterial({
      map: radialTexture("rgba(0,10,20,0.26)", "rgba(0,10,20,0)"),
      transparent: true,
      depthWrite: false,
    })
  );
  mat.rotation.x = -Math.PI / 2;
  mat.position.y = 0.035;
  root.add(mat);

  // --- crisp dotted grid, drawn once into a canvas texture ---------------
  const grid = new THREE.Mesh(
    new THREE.PlaneGeometry(SPAN, SPAN),
    new THREE.MeshBasicMaterial({
      map: gridTexture(world.colors.gridLine ?? 0xffffff),
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    })
  );
  grid.rotation.x = -Math.PI / 2;
  grid.position.y = 0.06;
  root.add(grid);

  // --- nearly invisible pick/state cells ---------------------------------
  const tiles = new Map();
  const tileGeo = new THREE.PlaneGeometry(TILE * 0.98, TILE * 0.98);
  tileGeo.rotateX(-Math.PI / 2);
  const tilesGroup = new THREE.Group();
  for (let y = 0; y < GRID; y += 1) {
    for (let x = 0; x < GRID; x += 1) {
      const m = new THREE.Mesh(
        tileGeo,
        new THREE.MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0.045,
          depthWrite: false,
        })
      );
      m.position.set(x - GRID / 2 + 0.5, 0.045, y - GRID / 2 + 0.5);
      m.userData = { cell: { x, y }, slot, state: "unknown" };
      tiles.set(`${x},${y}`, m);
      tilesGroup.add(m);
    }
  }
  root.add(tilesGroup);

  const creaturesGroup = new THREE.Group();
  root.add(creaturesGroup);
  const marksGroup = new THREE.Group();
  root.add(marksGroup);

  scene.add(root);
  dioramas[slot] = {
    slot,
    worldId,
    world,
    root,
    env,
    tiles,
    tilesGroup,
    creaturesGroup,
    marksGroup,
    creatures: new Map(),
    bursts: [],
  };
  return dioramas[slot];
}

function disposeDiorama(slot) {
  const d = dioramas[slot];
  if (!d) return;
  scene.remove(d.root);
  d.root.traverse((o) => {
    if (o.isMesh || o.isPoints || o.isLine || o.isSprite) {
      o.geometry?.dispose?.();
      if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
      else o.material?.dispose?.();
    }
  });
  dioramas[slot] = null;
}

export function resetScene() {
  disposeDiorama("mine");
  disposeDiorama("enemy");
  customs.mine = {};
  customs.enemy = {};
  tapHandler = null;
  placement = null;
  drag = null;
  orbit.azim = 0;
  orbit.elev = null;
  orbit.zoom = 1;
  pointers.clear();
  gesture = null;
}

function shipAnchor(ship) {
  const cells = [];
  for (let i = 0; i < ship.size; i += 1) {
    cells.push(ship.dir === "h" ? [ship.x + i, ship.y] : [ship.x, ship.y + i]);
  }
  const cx = cells.reduce((a, c) => a + c[0], 0) / cells.length;
  const cy = cells.reduce((a, c) => a + c[1], 0) / cells.length;
  return new THREE.Vector3(cx - GRID / 2 + 0.5, 0.1, cy - GRID / 2 + 0.5);
}

export function placeCreatures(slot, ships, { popIn = false, found = null } = {}) {
  const d = dioramas[slot];
  if (!d) return;
  d.creaturesGroup.clear();
  d.creatures.clear();
  for (const ship of ships) {
    addCreature(slot, ship, { popIn, found });
  }
}

export function addCreature(slot, ship, { popIn = false, found = null } = {}) {
  const d = dioramas[slot];
  if (!d) return null;
  const model = ship.decoy
    ? buildDecoy()
    : buildCreature(d.worldId, ship.id, ship.size, customs[slot]?.[ship.id] ?? null);
  model.rotation.y = 0.16; // subtle 3/4 turn so faces catch the camera
  const holder = new THREE.Group();
  holder.add(model);
  holder.position.copy(shipAnchor(ship));
  // +90° for vertical ships keeps their faces toward the camera
  holder.rotation.y = ship.dir === "v" ? Math.PI / 2 : 0;

  // occupancy pads: one soft glowing disc per occupied cell
  const padTex = padTexture();
  for (let i = 0; i < ship.size; i += 1) {
    const pad = new THREE.Mesh(
      new THREE.PlaneGeometry(0.92, 0.92),
      new THREE.MeshBasicMaterial({
        map: padTex,
        color: d.world.colors.accent,
        transparent: true,
        opacity: 0.62,
        depthWrite: false,
      })
    );
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(i - (ship.size - 1) / 2, 0.02, 0);
    holder.add(pad);
  }
  // soft blob shadow
  const blob = new THREE.Mesh(
    new THREE.CircleGeometry(0.4, 16),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.16, depthWrite: false })
  );
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.05;
  blob.scale.set(ship.size * 0.95, 0.85, 1);
  holder.add(blob);

  // persistent golden ring marks creatures that were already found
  const isFound = found ?? (Array.isArray(ship.hits) && ship.hits.length >= ship.size);
  if (isFound) addFoundRing(d, holder, ship);

  d.creaturesGroup.add(holder);
  const entry = { model, holder, baseY: 0.1, phase: Math.random() * 7, ship: { ...ship } };
  d.creatures.set(ship.id, entry);
  if (popIn) {
    holder.scale.setScalar(0.01);
    tween((v) => holder.scale.setScalar(v), { dur: 0.7, ease: Ease.outBack });
  }
  return entry;
}

export function removeCreature(slot, id) {
  const d = dioramas[slot];
  const c = d?.creatures.get(id);
  if (!c) return;
  d.creaturesGroup.remove(c.holder);
  d.creatures.delete(id);
}

let cachedPadTex = null;
function padTexture() {
  if (!cachedPadTex) {
    cachedPadTex = radialTexture("rgba(255,255,255,0.85)", "rgba(255,255,255,0)");
  }
  return cachedPadTex;
}

function addFoundRing(d, holder, ship) {
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.62, 0.05, 8, 30),
    new THREE.MeshStandardMaterial({
      color: d.world.colors.accent,
      emissive: d.world.colors.accent,
      emissiveIntensity: 1.1,
      flatShading: true,
    })
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.08;
  ring.scale.set(ship.size * 0.78, 0.9, 1);
  ring.userData.foundRing = true;
  holder.add(ring);
  return ring;
}

const gridTexCache = new Map();
function gridTexture(colorHex) {
  if (gridTexCache.has(colorHex)) return gridTexCache.get(colorHex);
  const px = 1024;
  const cell = px / GRID;
  const c = document.createElement("canvas");
  c.width = px;
  c.height = px;
  const ctx = c.getContext("2d");
  const col = new THREE.Color(colorHex);
  const css = (a) => `rgba(${Math.round(col.r * 255)},${Math.round(col.g * 255)},${Math.round(col.b * 255)},${a})`;
  ctx.strokeStyle = css(0.55);
  ctx.lineWidth = 4;
  ctx.lineCap = "round";
  ctx.setLineDash([14, 18]);
  for (let i = 0; i <= GRID; i += 1) {
    const v = Math.min(px - 2, Math.max(2, i * cell));
    ctx.beginPath();
    ctx.moveTo(v, 2);
    ctx.lineTo(v, px - 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(2, v);
    ctx.lineTo(px - 2, v);
    ctx.stroke();
  }
  // little corner dots make intersections pop
  ctx.setLineDash([]);
  ctx.fillStyle = css(0.8);
  for (let i = 0; i <= GRID; i += 1) {
    for (let j = 0; j <= GRID; j += 1) {
      ctx.beginPath();
      ctx.arc(Math.min(px - 4, Math.max(4, i * cell)), Math.min(px - 4, Math.max(4, j * cell)), 4.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  gridTexCache.set(colorHex, tex);
  return tex;
}

export function moveCreature(slot, ship, { animate = true } = {}) {
  const d = dioramas[slot];
  const c = d?.creatures.get(ship.id);
  if (!c) return;
  c.ship = { ...ship };
  const target = shipAnchor(ship);
  const targetRot = ship.dir === "v" ? Math.PI / 2 : 0;
  if (!animate) {
    c.holder.position.copy(target);
    c.holder.rotation.y = targetRot;
    c.baseY = 0.1;
    return;
  }
  const from = c.holder.position.clone();
  const fromRot = c.holder.rotation.y;
  tween(
    (v) => {
      c.holder.position.lerpVectors(from, target, v);
      c.holder.rotation.y = fromRot + (targetRot - fromRot) * v;
    },
    { dur: 0.25, ease: Ease.outCubic }
  );
}

export function setCreatureInvalid(slot, shipId, invalid) {
  const d = dioramas[slot];
  const c = d?.creatures.get(shipId);
  if (!c) return;
  c.holder.traverse((o) => {
    if (o.isMesh && o.material && o.material.emissive !== undefined) {
      if (invalid) {
        if (o.userData.savedEmissive === undefined) {
          o.userData.savedEmissive = o.material.emissive.getHex();
          o.userData.savedIntensity = o.material.emissiveIntensity;
        }
        o.material.emissive.setHex(0xff2222);
        o.material.emissiveIntensity = 0.8;
      } else if (o.userData.savedEmissive !== undefined) {
        o.material.emissive.setHex(o.userData.savedEmissive);
        o.material.emissiveIntensity = o.userData.savedIntensity;
        delete o.userData.savedEmissive;
        delete o.userData.savedIntensity;
      }
    }
  });
}

export function shakeCreature(slot, shipId) {
  const d = dioramas[slot];
  const c = d?.creatures.get(shipId);
  if (!c) return;
  const baseX = c.holder.position.x;
  tween(
    (v) => {
      c.holder.position.x = baseX + Math.sin(v * Math.PI * 6) * 0.12 * (1 - v);
    },
    { dur: 0.5, ease: Ease.linear }
  );
}

// ----------------------------------------------------------------- marks

function missMarker(d, tile, key) {
  // dark dimple + themed floater
  tile.userData.state = "miss";
  tile.material.color.setHex(d.world.colors.tileDark);
  tile.material.opacity = 0.42;
  const floater = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.11, 0),
    new THREE.MeshStandardMaterial({ color: d.world.colors.tileDark, roughness: 0.9, flatShading: true })
  );
  floater.position.set(tile.position.x, 0.12, tile.position.z);
  floater.userData.bob = Math.random() * 7;
  floater.userData.cellKey = key;
  d.marksGroup.add(floater);
}

// number sprite for the sonar rule: warm colors near, cool colors far
const digitTexCache = new Map();
function digitTexture(dist) {
  const color = dist <= 1 ? "#ff6b5f" : dist === 2 ? "#ffb347" : dist === 3 ? "#ffe066" : "#9fd9f5";
  const cacheKey = `${dist}`;
  if (digitTexCache.has(cacheKey)) return digitTexCache.get(cacheKey);
  const c = document.createElement("canvas");
  c.width = 96;
  c.height = 96;
  const ctx = c.getContext("2d");
  ctx.font = "900 64px Nunito, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 10;
  ctx.strokeStyle = "rgba(10,20,40,0.9)";
  ctx.strokeText(String(dist), 48, 52);
  ctx.fillStyle = color;
  ctx.fillText(String(dist), 48, 52);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  digitTexCache.set(cacheKey, tex);
  return tex;
}

function sonarMarker(d, tile, key, dist) {
  const spr = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: digitTexture(dist), transparent: true, depthWrite: false })
  );
  spr.position.set(tile.position.x, 0.42, tile.position.z);
  spr.scale.setScalar(0.62);
  spr.userData.cellKey = key;
  spr.userData.bob = Math.random() * 7;
  spr.userData.bobBase = 0.42;
  d.marksGroup.add(spr);
  return spr;
}

function decoyMarker(d, tile, key) {
  tile.userData.state = "decoy";
  tile.material.color.setHex(0xff5f6d);
  tile.material.opacity = 0.4;
  // a sad little balloon scrap
  const scrap = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.13, 0),
    new THREE.MeshStandardMaterial({ color: 0xff5f6d, roughness: 0.6, flatShading: true })
  );
  scrap.scale.set(1, 0.35, 1);
  scrap.position.set(tile.position.x, 0.1, tile.position.z);
  scrap.userData.bob = Math.random() * 7;
  scrap.userData.cellKey = key;
  d.marksGroup.add(scrap);
}

// --------------------------------------------------- puzzle edge counts

function textTexture(str, color = "#ffffff") {
  const c = document.createElement("canvas");
  c.width = 96;
  c.height = 96;
  const ctx = c.getContext("2d");
  ctx.font = "900 60px Nunito, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 10;
  ctx.strokeStyle = "rgba(10,20,40,0.9)";
  ctx.strokeText(String(str), 48, 52);
  ctx.fillStyle = color;
  ctx.fillText(String(str), 48, 52);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// row counts along the left edge, column counts along the far edge
export function setEdgeCounts(slot, rows, cols) {
  const d = dioramas[slot];
  if (!d) return;
  if (d.edgeGroup) d.root.remove(d.edgeGroup);
  const group = new THREE.Group();
  d.edgeSprites = { rows: [], cols: [] };
  const make = (n, x, z) => {
    const spr = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: textTexture(n), transparent: true, depthWrite: false })
    );
    spr.position.set(x, 0.5, z);
    spr.scale.setScalar(0.72);
    group.add(spr);
    return spr;
  };
  rows.forEach((n, y) => {
    d.edgeSprites.rows.push(make(n, -GRID / 2 - 0.6, y - GRID / 2 + 0.5));
  });
  cols.forEach((n, x) => {
    d.edgeSprites.cols.push(make(n, x - GRID / 2 + 0.5, -GRID / 2 - 0.6));
  });
  d.edgeGroup = group;
  d.root.add(group);
}

// dim a satisfied row/column so kids see which clues are done
export function dimEdgeCount(slot, axis, index) {
  const d = dioramas[slot];
  const spr = d?.edgeSprites?.[axis]?.[index];
  if (!spr) return;
  spr.material.color.setHex(0x6f8296);
  spr.material.opacity = 0.55;
}

// ghost rule: a faded miss becomes unknown again
export function clearMark(slot, x, y) {
  const d = dioramas[slot];
  if (!d) return;
  const key = `${x},${y}`;
  const tile = d.tiles.get(key);
  if (!tile || tile.userData.state !== "miss") return;
  tile.userData.state = "unknown";
  tween(
    (v) => {
      tile.material.opacity = 0.42 - v * 0.375;
    },
    { dur: 0.6, ease: Ease.outQuad, onDone: () => {
      tile.material.color.setHex(0xffffff);
      tile.material.opacity = 0.045;
    } }
  );
  for (const m of [...d.marksGroup.children]) {
    if (m.userData.cellKey !== key) continue;
    tween(
      (v) => {
        m.scale.setScalar(Math.max(0.01, (1 - v)) * (m.isSprite ? 0.62 : 1));
        if (m.material) m.material.opacity = 1 - v;
      },
      {
        dur: 0.5,
        ease: Ease.outQuad,
        onDone: () => {
          d.marksGroup.remove(m);
          m.geometry?.dispose?.();
          m.material?.dispose?.();
        },
      }
    );
    if (m.material) m.material.transparent = true;
  }
}

function hitMarker(d, tile, key) {
  tile.userData.state = "hit";
  tile.material.color.setHex(d.world.colors.tileHit);
  tile.material.opacity = 0.35;
  const crystal = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.2, 0),
    new THREE.MeshStandardMaterial({
      color: d.world.colors.accent,
      emissive: d.world.colors.accent,
      emissiveIntensity: 1.3,
      flatShading: true,
    })
  );
  crystal.position.set(tile.position.x, 0.45, tile.position.z);
  crystal.userData.cellKey = key;
  crystal.userData.spin = true;
  const halo = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: padTexture(),
      color: d.world.colors.accent,
      transparent: true,
      opacity: 0.65,
      depthWrite: false,
    })
  );
  halo.scale.setScalar(1.1);
  crystal.add(halo);
  d.marksGroup.add(crystal);
  return crystal;
}

export function applyShot(slot, x, y, result, { sonarDist = null } = {}) {
  const d = dioramas[slot];
  if (!d) return;
  const key = `${x},${y}`;
  const tile = d.tiles.get(key);
  if (!tile) return;
  const world = d.world;
  const pos = tile.getWorldPosition(new THREE.Vector3());

  camKick = result === "miss" ? 0.12 : 0.3;
  flash(d, tile.position, result === "miss" ? world.colors.sky : world.colors.accent);

  if (result === "decoy") {
    // POP! the bluff balloon bursts in the shooter's face
    camKick = 0.5;
    decoyMarker(d, tile, key);
    flash(d, tile.position, 0xff5f6d);
    ringWave(d, tile.position, 0xff5f6d);
    ringWave(d, tile.position, 0xffffff);
    burst(d, pos, 0xff5f6d, { count: 55 });
    burst(d, pos, 0xffffff, { count: 20, up: true });
    starburst(d, tile.position);
  } else if (result === "miss") {
    missMarker(d, tile, key);
    if (sonarDist != null) {
      const spr = sonarMarker(d, tile, key, sonarDist);
      spr.scale.setScalar(0.01);
      tween((v) => spr.scale.setScalar(0.62 * v), { dur: 0.45, ease: Ease.outBack });
      for (let i = 0; i < Math.min(sonarDist, 3); i += 1) {
        setTimeout(() => ringWave(d, tile.position, world.colors.accent), i * 160);
      }
    }
    splashColumn(d, tile.position, world.colors.splash ?? world.colors.sky);
    ringWave(d, tile.position, world.colors.text);
    burst(d, pos, world.colors.splash ?? world.colors.sky, { count: 30, up: true });
  } else {
    const crystal = hitMarker(d, tile, `${x},${y}`);
    crystal.scale.setScalar(0.01);
    tween((v) => crystal.scale.setScalar(v), { dur: 0.5, ease: Ease.outBack });
    ringWave(d, tile.position, world.colors.accent);
    burst(d, pos, world.colors.accent, { count: 46 });
    burst(d, pos, 0xffffff, { count: 16 });
  }
}

export function applyShotQuiet(slot, x, y, result, { sonarDist = null } = {}) {
  const d = dioramas[slot];
  if (!d) return;
  const key = `${x},${y}`;
  const tile = d.tiles.get(key);
  if (!tile || tile.userData.state !== "unknown") return;
  if (result === "decoy") {
    decoyMarker(d, tile, key);
  } else if (result === "miss") {
    missMarker(d, tile, key);
    if (sonarDist != null) sonarMarker(d, tile, key, sonarDist);
  } else {
    hitMarker(d, tile, key);
  }
}

export function revealWater(slot, cells) {
  const d = dioramas[slot];
  if (!d) return;
  cells.forEach((c, i) => {
    const tile = d.tiles.get(`${c.x},${c.y}`);
    if (!tile || tile.userData.state !== "unknown") return;
    tile.userData.state = "miss";
    tween(
      (v) => {
        tile.material.color.lerpColors(new THREE.Color(0xffffff), new THREE.Color(d.world.colors.tileDark), v);
        tile.material.opacity = 0.045 + v * 0.3;
      },
      { dur: 0.4, delay: i * 0.04, ease: Ease.outQuad }
    );
  });
}

export function revealShip(slot, ship) {
  const d = dioramas[slot];
  if (!d) return;
  const cells = new Set();
  for (let i = 0; i < ship.size; i += 1) {
    cells.add(ship.dir === "h" ? `${ship.x + i},${ship.y}` : `${ship.x},${ship.y + i}`);
  }
  for (const m of [...d.marksGroup.children]) {
    if (cells.has(m.userData.cellKey)) d.marksGroup.remove(m);
  }
  let entry = d.creatures.get(ship.id);
  if (!entry) entry = addCreature(slot, ship, { found: false });
  const holder = entry.holder;
  const baseRot = holder.rotation.y;
  const center = shipAnchor(ship);
  const worldPos = holder.getWorldPosition(new THREE.Vector3());
  worldPos.y += 0.5;

  // --- themed discovery burst -------------------------------------------
  const w = d.worldId;
  if (w === "weltraum") {
    // machines explode: flash, fiery debris, smoke, shock rings
    flash(d, center, 0xffa050);
    ringWave(d, center, 0xff8c1a);
    ringWave(d, center, 0xffe066);
    burst(d, worldPos, 0xff8c1a, { count: 60 });
    burst(d, worldPos, 0xffe066, { count: 40 });
    burst(d, worldPos, 0x8a8f9a, { count: 26, up: true }); // smoke
    camKick = 0.7;
  } else if (w === "ozean" || w === "teich") {
    // sea friends burst out of a big fountain
    flash(d, center, d.world.colors.accent);
    splashColumn(d, center, d.world.colors.splash ?? 0x9fdcff);
    splashColumn(d, { x: center.x + 0.4, z: center.z }, 0xffffff);
    ringWave(d, center, 0xffffff);
    ringWave(d, center, d.world.colors.splash ?? 0x9fdcff);
    burst(d, worldPos, d.world.colors.splash ?? 0x9fdcff, { count: 55, up: true });
    burst(d, worldPos, 0xffffff, { count: 25, up: true });
    camKick = 0.45;
  } else {
    // jungle: leaves fly, dust rolls, ground thumps
    flash(d, center, d.world.colors.accent);
    ringWave(d, center, 0x8a6a43);
    burst(d, worldPos, 0x51b06a, { count: 45 });
    burst(d, worldPos, 0x2e7d3f, { count: 30 });
    burst(d, worldPos, 0xc9b48f, { count: 22, up: true }); // dust
    camKick = 0.6;
  }
  starburst(d, center);
  burst(d, worldPos, d.world.colors.accent, { count: 40 });

  // --- creature entrance: emerge, one joyful hop with a single spin,
  // land with a squash-and-stretch bounce ---------------------------------
  holder.position.y = -1.4;
  holder.scale.setScalar(0.6);
  const leapH = w === "teich" ? 1.5 : 1.05; // hooked pond fish jump higher
  tween(
    (v) => {
      if (v < 0.3) {
        // emerge from the board, decelerating (ends at zero velocity)
        const k = Ease.outQuad(v / 0.3);
        holder.position.y = -1.4 + k * 1.5;
        holder.scale.setScalar(0.6 + 0.4 * k);
      } else {
        // ballistic hop + exactly one spin, both easing out to rest
        const k = (v - 0.3) / 0.7;
        holder.position.y = 0.1 + Math.sin(Math.PI * k) * leapH;
        holder.rotation.y = baseRot + Math.PI * 2 * Ease.inOutQuad(k);
        holder.scale.setScalar(1);
      }
    },
    {
      dur: 1.15,
      ease: Ease.linear,
      onDone: () => {
        holder.rotation.y = baseRot;
        holder.position.y = 0.1;
        entry.baseY = 0.1;
        // squash & stretch landing
        tween(
          (u) => {
            const sq = Math.sin(Math.PI * u);
            holder.scale.set(1 + 0.16 * sq, 1 - 0.22 * sq, 1 + 0.16 * sq);
          },
          { dur: 0.28, ease: Ease.outQuad }
        );
        ringWave(d, center, d.world.colors.accent);
        const ring = addFoundRing(d, holder, ship);
        ring.scale.setScalar(0.01);
        tween((v2) => ring.scale.set(ship.size * 0.78 * v2, 0.9 * v2, v2), { dur: 0.4, ease: Ease.outBack });
        camKick = Math.max(camKick, 0.3);
      },
    }
  );
}

// ------------------------------------------------------------- particles

function burst(d, worldPos, color, { count = 30, up = false } = {}) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  const vel = [];
  const local = d.root.worldToLocal(worldPos.clone());
  for (let i = 0; i < count; i += 1) {
    pos[i * 3] = local.x;
    pos[i * 3 + 1] = local.y + 0.2;
    pos[i * 3 + 2] = local.z;
    const a = Math.random() * Math.PI * 2;
    const p = up ? Math.random() * 0.9 + 0.7 : Math.random() * 2 - 0.4;
    const speed = 1.6 + Math.random() * 3.2;
    vel.push(
      new THREE.Vector3(Math.cos(a) * speed * (up ? 0.45 : 1), p * speed, Math.sin(a) * speed * (up ? 0.45 : 1))
    );
  }
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const points = new THREE.Points(
    geo,
    new THREE.PointsMaterial({
      color,
      size: 0.17,
      transparent: true,
      opacity: 1,
      map: padTexture(),
      depthWrite: false,
    })
  );
  d.root.add(points);
  d.bursts.push({ points, vel, life: 0, max: 0.95 });
}

function updateBursts(d, dt) {
  for (const b of [...d.bursts]) {
    b.life += dt;
    const p = b.points.geometry.attributes.position.array;
    for (let i = 0; i < b.vel.length; i += 1) {
      b.vel[i].y -= 9.5 * dt;
      p[i * 3] += b.vel[i].x * dt;
      p[i * 3 + 1] += b.vel[i].y * dt;
      p[i * 3 + 2] += b.vel[i].z * dt;
    }
    b.points.geometry.attributes.position.needsUpdate = true;
    b.points.material.opacity = Math.max(0, 1 - b.life / b.max);
    if (b.life >= b.max) {
      d.root.remove(b.points);
      b.points.geometry.dispose();
      b.points.material.dispose();
      d.bursts.splice(d.bursts.indexOf(b), 1);
    }
  }
  for (const m of d.marksGroup.children) {
    if (m.userData.spin) {
      m.rotation.y += dt * 2.2;
      m.position.y = 0.45 + Math.sin(clockT * 3 + m.position.x) * 0.05;
    }
    if (m.userData.bob !== undefined) {
      m.position.y = (m.userData.bobBase ?? 0.12) + Math.sin(clockT * 2 + m.userData.bob) * 0.04;
      m.rotation.y += dt * 0.6;
    }
  }
}

function splashColumn(d, localPos, color) {
  const col = new THREE.Mesh(
    new THREE.SphereGeometry(0.22, 10, 8),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false })
  );
  col.position.set(localPos.x, 0.1, localPos.z);
  d.root.add(col);
  tween(
    (v) => {
      col.scale.set(1 - v * 0.5, 1 + v * 5.5, 1 - v * 0.5);
      col.position.y = 0.1 + v * 0.55;
      col.material.opacity = 0.85 * (1 - v);
    },
    {
      dur: 0.5,
      ease: Ease.outQuad,
      onDone: () => {
        d.root.remove(col);
        col.geometry.dispose();
        col.material.dispose();
      },
    }
  );
}

function ringWave(d, localPos, color) {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.3, 0.44, 26),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(localPos.x, 0.14, localPos.z);
  d.root.add(ring);
  tween(
    (v) => {
      ring.scale.setScalar(1 + v * 3.4);
      ring.material.opacity = 0.85 * (1 - v);
    },
    {
      dur: 0.75,
      ease: Ease.outQuad,
      onDone: () => {
        d.root.remove(ring);
        ring.geometry.dispose();
        ring.material.dispose();
      },
    }
  );
}

function starburst(d, localPos) {
  const spr = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: padTexture(),
      color: 0xffffff,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    })
  );
  spr.position.set(localPos.x, 0.8, localPos.z);
  d.root.add(spr);
  tween(
    (v) => {
      spr.scale.setScalar(0.5 + v * 7);
      spr.material.opacity = 0.9 * (1 - v);
    },
    {
      dur: 0.6,
      ease: Ease.outQuad,
      onDone: () => {
        d.root.remove(spr);
        spr.material.dispose();
      },
    }
  );
}

function flash(d, localPos, color) {
  const light = new THREE.PointLight(color, 14, 8, 2);
  light.position.set(localPos.x, 1.4, localPos.z);
  d.root.add(light);
  tween((v) => (light.intensity = 14 * (1 - v)), {
    dur: 0.45,
    ease: Ease.outQuad,
    onDone: () => d.root.remove(light),
  });
}

export function confettiRain(slot) {
  const d = dioramas[slot];
  if (!d) return;
  const count = 150;
  const colors = [0xff5f7e, 0xffd447, 0x5be7a9, 0x5bb2ff, 0xc58bff];
  const mesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.16, 0.02, 0.1),
    new THREE.MeshBasicMaterial(),
    count
  );
  const dummy = new THREE.Object3D();
  const items = [];
  for (let i = 0; i < count; i += 1) {
    items.push({
      x: (Math.random() - 0.5) * 14,
      y: 8 + Math.random() * 8,
      z: (Math.random() - 0.5) * 14,
      vy: -(2.2 + Math.random() * 2),
      rot: Math.random() * Math.PI * 2,
      vr: (Math.random() - 0.5) * 6,
      sway: 1 + Math.random() * 2,
      phase: Math.random() * 7,
    });
    mesh.setColorAt(i, new THREE.Color(colors[i % colors.length]));
  }
  d.root.add(mesh);
  const start = clockT;
  const timer = setInterval(() => {
    const t = clockT - start;
    items.forEach((it, i) => {
      it.y += it.vy * 0.016;
      it.rot += it.vr * 0.016;
      dummy.position.set(it.x + Math.sin(clockT * it.sway + it.phase) * 0.6, it.y, it.z);
      dummy.rotation.set(it.rot, it.phase, it.rot * 0.7);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (t > 6) {
      clearInterval(timer);
      d.root.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
  }, 16);
}

// ---------------------------------------------------------------- camera

let camTween = null;
let camBase = { pos: new THREE.Vector3(0, 14, 14), look: new THREE.Vector3() };

function framingDistance() {
  const margin = 1.2;
  const span = SPAN * margin;
  const vfov = (camera.fov * Math.PI) / 180;
  const fitH = span / 2 / Math.tan(vfov / 2);
  const hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect);
  const fitW = span / 2 / Math.tan(hfov / 2);
  return Math.max(fitH, fitW, 9);
}

export function focusBoard(slot, { immediate = false, onDone = null } = {}) {
  const wasFocused = focused;
  focused = slot;
  const cx = dioramaX(slot);
  const P = pose(slot);
  const dist = P.dist;
  const elevation = P.elev;
  const pos = P.pos;
  const look = P.look;

  const d = dioramas[slot];
  const world = d ? d.world : getWorld("ozean");

  // already looking at this board and at rest: nothing to animate
  if (!immediate && wasFocused === slot && !camTween && camBase.pos.distanceTo(pos) < 0.5) {
    if (onDone) onDone();
    return;
  }

  if (camTween) {
    camTween.cancel();
    camTween = null;
  }
  if (immediate) {
    camBase.pos.copy(pos);
    camBase.look.copy(look);
    camera.position.copy(pos);
    camera.lookAt(look);
    applySkyImmediate(world);
    if (onDone) onDone();
    return;
  }

  const fromPos = camera.position.clone();
  const fromLook = camBase.look.clone();
  const fromTop = sky.material.uniforms.top.value.clone();
  const fromHor = sky.material.uniforms.horizon.value.clone();
  const fromFog = scene.fog.color.clone();
  const fromHemi = hemi.color.clone();
  const toTop = new THREE.Color(world.colors.sky);
  const toHor = new THREE.Color(world.colors.horizon ?? world.colors.fog);
  const toFog = new THREE.Color(world.colors.fog);
  const toHemi = new THREE.Color(world.colors.light);

  const lerpSky = (v) => {
    sky.material.uniforms.top.value.lerpColors(fromTop, toTop, v);
    sky.material.uniforms.horizon.value.lerpColors(fromHor, toHor, v);
    scene.fog.color.lerpColors(fromFog, toFog, v);
    hemi.color.lerpColors(fromHemi, toHemi, v);
  };

  const sameBoard = Math.abs(fromPos.x - cx) < DIORAMA_GAP / 2;

  if (sameBoard) {
    camTween = tween(
      (v) => {
        camera.position.lerpVectors(fromPos, pos, v);
        camBase.look.lerpVectors(fromLook, look, v);
        camera.lookAt(camBase.look);
        lerpSky(v);
      },
      {
        dur: 0.35,
        ease: Ease.inOutQuad,
        onDone: () => {
          camBase.pos.copy(pos);
          camTween = null;
          if (onDone) onDone();
        },
      }
    );
    return;
  }

  // Board switch: PLATE FLIP. The camera whips over the top of the old
  // board until it looks straight down (board fills the frame), then the
  // new board tilts up into view on the other side. Fast and direct —
  // no journey through the sky.
  const fromCx = fromPos.x > DIORAMA_GAP / 2 ? DIORAMA_GAP : 0;
  const fromCenter = new THREE.Vector3(fromCx, 0, 0);
  const toCenter = new THREE.Vector3(cx, 0, 0);
  const fromDist = Math.max(9, fromPos.distanceTo(fromCenter));
  const eTop = Math.PI * 0.49; // nearly straight down
  const orbit = (center, e, r) =>
    new THREE.Vector3(center.x, Math.sin(e) * r, Math.cos(e) * r);
  const fromElev = Math.asin(Math.min(1, Math.max(0, (fromPos.y - 0) / fromDist)));

  camTween = tween(
    (v) => {
      // one global ease drives both halves so the angular velocity is
      // continuous through the top of the flip — no midpoint hitch
      const E = Ease.inOutCubic(v);
      if (E < 0.5) {
        const k = E * 2;
        const e = fromElev + (eTop - fromElev) * k;
        camera.position.copy(orbit(fromCenter, e, fromDist));
        camBase.look.lerpVectors(fromLook, fromCenter, k);
      } else {
        const k = (E - 0.5) * 2;
        const e = eTop + (elevation - eTop) * k;
        camera.position.copy(orbit(toCenter, e, dist));
        camBase.look.lerpVectors(toCenter, look, k);
      }
      camera.lookAt(camBase.look);
      lerpSky(v);
    },
    {
      dur: 0.55,
      ease: Ease.linear,
      onDone: () => {
        camBase.pos.copy(pos);
        camTween = null;
        if (onDone) onDone();
      },
    }
  );
}

function applySkyImmediate(world) {
  sky.material.uniforms.top.value.setHex(world.colors.sky);
  sky.material.uniforms.horizon.value.setHex(world.colors.horizon ?? world.colors.fog);
  scene.fog.color.setHex(world.colors.fog);
  hemi.color.setHex(world.colors.light);
}

export function debugCamera() {
  return {
    pos: camera.position.toArray().map((n) => Math.round(n * 10) / 10),
    look: camBase.look.toArray().map((n) => Math.round(n * 10) / 10),
    aspect: Math.round(camera.aspect * 100) / 100,
    focused,
    tweening: !!camTween,
  };
}

function idleCamera() {
  if (camTween) return;
  const P = pose(focused);
  const kick = Math.sin(clockT * 42) * camKick;
  camera.position.set(
    P.pos.x + Math.sin(clockT * 0.4) * 0.3 + kick,
    P.pos.y + Math.sin(clockT * 0.55) * 0.2 + kick * 0.6,
    P.pos.z
  );
  camBase.pos.copy(P.pos);
  camBase.look.copy(P.look);
  camera.lookAt(P.look);
}

export function currentFocus() {
  return focused;
}

// ----------------------------------------------------------- interaction

export function setTapMode(slot, handler) {
  tapHandler = handler ? { slot, handler } : null;
}

export function setPlacementMode(handlers) {
  placement = handlers; // { slot, canPlaceAt(id,x,y,dir), onMove(id,x,y,dir), onRotate(id) }
}

export function clearInteraction() {
  tapHandler = null;
  placement = null;
  drag = null;
}

function raycastTiles(e, slot) {
  const rect = canvas.getBoundingClientRect();
  pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const d = dioramas[slot];
  if (!d) return null;
  const hits = raycaster.intersectObjects(d.tilesGroup.children, false);
  return hits.length ? hits[0].object.userData.cell : null;
}

function onPointerDown(e) {
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY });
  canvas.setPointerCapture(e.pointerId);

  if (pointers.size === 2) {
    // second finger: switch to pinch zoom
    const [p1, p2] = [...pointers.values()];
    pinchStart = { dist: Math.hypot(p1.x - p2.x, p1.y - p2.y), zoom: orbit.zoom };
    gesture = "pinch";
    drag = null;
    return;
  }

  if (placement) {
    const cell = raycastTiles(e, placement.slot);
    if (cell) {
      const d = dioramas[placement.slot];
      for (const [, entry] of d.creatures) {
        const sh = entry.ship;
        for (let i = 0; i < sh.size; i += 1) {
          const cx = sh.dir === "h" ? sh.x + i : sh.x;
          const cy = sh.dir === "v" ? sh.y + i : sh.y;
          if (cx === cell.x && cy === cell.y) {
            drag = {
              entry,
              grabDx: cell.x - sh.x,
              grabDy: cell.y - sh.y,
              startX: e.clientX,
              startY: e.clientY,
              moved: false,
              previewX: sh.x,
              previewY: sh.y,
            };
            gesture = "ship";
            return;
          }
        }
      }
    }
  }
  // empty space (or battle board): candidate for orbit / tap
  gesture = "maybe-orbit";
}

function onPointerMove(e) {
  const p = pointers.get(e.pointerId);
  if (!p) return;
  const dx = e.clientX - p.x;
  const dy = e.clientY - p.y;
  p.x = e.clientX;
  p.y = e.clientY;

  if (gesture === "pinch" && pointers.size === 2 && pinchStart) {
    const [p1, p2] = [...pointers.values()];
    const d = Math.hypot(p1.x - p2.x, p1.y - p2.y);
    if (pinchStart.dist > 10) {
      orbit.zoom = clampNum(pinchStart.zoom * (pinchStart.dist / d), 0.55, 1.5);
    }
    return;
  }

  if (gesture === "ship" && drag && placement) {
    if (!drag.moved && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < 10) return;
    drag.moved = true;
    const cell = raycastTiles(e, placement.slot);
    if (!cell) return;
    const sh = drag.entry.ship;
    const maxX = GRID - (sh.dir === "h" ? sh.size : 1);
    const maxY = GRID - (sh.dir === "v" ? sh.size : 1);
    drag.previewX = Math.max(0, Math.min(maxX, cell.x - drag.grabDx));
    drag.previewY = Math.max(0, Math.min(maxY, cell.y - drag.grabDy));
    const candidate = { ...sh, x: drag.previewX, y: drag.previewY };
    moveCreature(placement.slot, { ...candidate, id: sh.id }, { animate: false });
    drag.entry.ship = sh;
    const ok = placement.canPlaceAt(sh.id, drag.previewX, drag.previewY, sh.dir);
    setCreatureInvalid(placement.slot, sh.id, !ok);
    return;
  }

  if (gesture === "maybe-orbit" || gesture === "orbit") {
    const total = Math.hypot(e.clientX - p.startX, e.clientY - p.startY);
    if (gesture === "maybe-orbit" && total < 9) return;
    gesture = "orbit";
    // drag to look around: horizontal = orbit, vertical = tilt
    orbit.azim = (orbit.azim - dx * 0.0045) % (Math.PI * 2);
    orbit.elev = clampNum((orbit.elev ?? defaultElevation()) + dy * 0.004, 0.42, 1.35);
  }
}

function onPointerUp(e) {
  const p = pointers.get(e.pointerId);
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinchStart = null;

  if (gesture === "ship" && drag && placement) {
    const { entry, moved, previewX, previewY } = drag;
    const sh = entry.ship;
    drag = null;
    gesture = null;
    setCreatureInvalid(placement.slot, sh.id, false);
    if (moved) {
      placement.onMove(sh.id, previewX, previewY, sh.dir);
    } else {
      placement.onRotate(sh.id);
    }
    return;
  }

  const wasOrbit = gesture === "orbit" || gesture === "pinch";
  if (pointers.size === 0) gesture = null;
  drag = null;
  if (wasOrbit) return; // a camera gesture is never a shot

  if (tapHandler && p) {
    const moved = Math.hypot(e.clientX - p.startX, e.clientY - p.startY);
    if (moved < 9) {
      const cell = raycastTiles(e, tapHandler.slot);
      if (cell) tapHandler.handler(cell.x, cell.y);
    }
  }
}

// ------------------------------------------------------------- thumbnails

let thumbRenderer = null;
export function creatureThumb(worldId, index, size = 3, px = 128, custom = null) {
  if (!thumbRenderer) {
    thumbRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    thumbRenderer.setSize(px, px);
    thumbRenderer.outputColorSpace = THREE.SRGBColorSpace;
  }
  const s = new THREE.Scene();
  const world = getWorld(worldId);
  const cam = new THREE.PerspectiveCamera(35, 1, 0.1, 50);
  cam.position.set(-2.6, 2.2, 3.4);
  cam.lookAt(0, 0.55, 0);
  s.add(new THREE.HemisphereLight(0xffffff, 0x667788, 1.15));
  const dl = new THREE.DirectionalLight(world.colors.light, 1.7);
  dl.position.set(-3, 5, 4);
  s.add(dl);
  const model = buildCreature(worldId, index, size, custom);
  s.add(model);
  thumbRenderer.render(s, cam);
  const url = thumbRenderer.domElement.toDataURL("image/png");
  s.traverse((o) => {
    if (o.isMesh) {
      o.geometry?.dispose?.();
      o.material?.dispose?.();
    }
  });
  return url;
}
