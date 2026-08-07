// Procedural low-poly creature models — no external assets. Each
// builder returns a THREE.Group sized to span `size` board tiles along
// X (1 tile = 1 unit) with a characterful idle animation attached as
// group.userData.animate(t). Design goals: instantly recognizable
// silhouettes, soft two-tone bodies, alive motion (blinks, tails,
// flaps) — never static props.

import * as THREE from "../vendor/three.module.min.js";

function mat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.75,
    metalness: 0.04,
    flatShading: true,
    ...opts,
  });
}

function add(parent, geo, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

// pair of blinking eyes; returns apply(t) to animate
function makeEyes(parent, x, y, z, spread, r = 0.09, phase = 0) {
  const whiteM = mat(0xffffff, { roughness: 0.35 });
  const blackM = mat(0x27303d, { roughness: 0.25 });
  const parts = [];
  for (const s of [-1, 1]) {
    const white = add(parent, new THREE.SphereGeometry(r, 10, 8), whiteM, x, y, z + s * spread);
    const pupil = add(
      parent,
      new THREE.SphereGeometry(r * 0.52, 8, 6),
      blackM,
      x - r * 0.55,
      y + r * 0.12,
      z + s * spread
    );
    parts.push(white, pupil);
  }
  return (t) => {
    const blink = 1 - 0.92 * Math.max(0, Math.sin((t + phase) * 1.15) ** 48);
    for (const p of parts) p.scale.y = blink;
  };
}

function smile(parent, x, y, z, r = 0.12, thickness = 0.02) {
  const arc = new THREE.Mesh(
    new THREE.TorusGeometry(r, thickness, 6, 12, Math.PI * 0.8),
    mat(0x27303d, { roughness: 0.4 })
  );
  arc.position.set(x, y, z);
  arc.rotation.set(0, Math.PI / 2, Math.PI + 0.35);
  parent.add(arc);
  return arc;
}

// ---------------------------------------------------------------- Ozean

function wal(size) {
  const g = new THREE.Group();
  const len = size * 0.94;
  const bodyM = mat(0x4f8fd0);
  const bellyM = mat(0xe6f5fd, { roughness: 0.6 });

  const body = add(g, new THREE.SphereGeometry(0.5, 16, 12), bodyM, -len * 0.1, 0.5, 0);
  body.scale.set(len * 0.72, 0.92, 1.06);
  const belly = add(g, new THREE.SphereGeometry(0.47, 14, 10), bellyM, -len * 0.1, 0.42, 0);
  belly.scale.set(len * 0.66, 0.72, 0.96);

  // tail: peduncle + two-lobe fluke, waving up/down
  const tail = new THREE.Group();
  tail.position.set(len * 0.24, 0.52, 0);
  add(tail, new THREE.ConeGeometry(0.22, 0.5, 8), bodyM, 0.2, 0, 0).rotation.z = -Math.PI / 2;
  for (const s of [-1, 1]) {
    const lobe = add(tail, new THREE.SphereGeometry(0.22, 8, 6), bodyM, 0.48, 0.06, s * 0.18);
    lobe.scale.set(1.4, 0.28, 0.85);
    lobe.rotation.y = s * 0.55;
    lobe.rotation.z = 0.15;
  }
  g.add(tail);

  // side fins
  const fins = [];
  for (const s of [-1, 1]) {
    const fin = add(g, new THREE.SphereGeometry(0.2, 8, 6), bodyM, -len * 0.2, 0.3, s * 0.5);
    fin.scale.set(1.7, 0.28, 0.8);
    fin.rotation.z = -0.35;
    fin.rotation.y = s * 0.35;
    fins.push({ fin, s });
  }

  // blowhole fountain
  const drops = [];
  for (let i = 0; i < 3; i += 1) {
    drops.push(
      add(g, new THREE.SphereGeometry(0.06 - i * 0.012, 8, 6), mat(0xbfe9ff, { transparent: true, opacity: 0.85 }), -len * 0.24, 1.0, 0)
    );
  }
  const blinkEyes = makeEyes(g, -len * 0.42, 0.58, 0, 0.33, 0.09);
  smile(g, -len * 0.45, 0.4, 0, 0.13);

  g.userData.animate = (t) => {
    tail.rotation.z = Math.sin(t * 2.4) * 0.3;
    body.position.y = 0.5 + Math.sin(t * 1.6) * 0.02;
    for (const { fin, s } of fins) fin.rotation.z = -0.35 + Math.sin(t * 2.2 + s) * 0.18;
    drops.forEach((dr, i) => {
      const ph = (t * 1.3 + i * 0.33) % 1;
      dr.position.y = 0.92 + ph * 0.6;
      dr.position.z = Math.sin(ph * Math.PI) * 0.12 * (i - 1);
      dr.material.opacity = 0.85 * (1 - ph);
    });
    blinkEyes(t);
  };
  return g;
}

function oktopus(size) {
  const g = new THREE.Group();
  const bodyM = mat(0xe0709d);
  const darkM = mat(0xc25a85);
  const scale = size / 3 + 0.5;

  const head = add(g, new THREE.SphereGeometry(0.5, 14, 12), bodyM, 0, 0.66, 0);
  head.scale.set(1.05, 1.12, 1.05);

  // 8 curling tentacles from sphere chains
  const tentacles = [];
  for (let i = 0; i < 8; i += 1) {
    const a = (i / 8) * Math.PI * 2 + 0.4;
    const arm = new THREE.Group();
    arm.position.set(Math.cos(a) * 0.3, 0.3, Math.sin(a) * 0.3);
    arm.rotation.y = -a;
    for (let k = 0; k < 4; k += 1) {
      const seg = add(arm, new THREE.SphereGeometry(0.12 - k * 0.02, 8, 6), darkM, 0.14 + k * 0.14, -0.12 + Math.sin(k * 0.9) * 0.1 - k * 0.03, 0);
    }
    g.add(arm);
    tentacles.push({ arm, i });
  }

  // blush + eyes
  for (const s of [-1, 1]) {
    const blush = add(g, new THREE.CircleGeometry(0.07, 10), mat(0xff9db8, { roughness: 1 }), -0.42, 0.6, s * 0.3);
    blush.rotation.y = -Math.PI / 2;
  }
  const blinkEyes = makeEyes(g, -0.42, 0.74, 0, 0.19, 0.1);
  smile(g, -0.46, 0.58, 0, 0.09);

  g.scale.setScalar(scale);
  g.userData.animate = (t) => {
    head.scale.y = 1.12 + Math.sin(t * 2.6) * 0.06;
    head.position.y = 0.66 + Math.sin(t * 2.6) * 0.025;
    for (const { arm, i } of tentacles) {
      arm.rotation.z = Math.sin(t * 2.2 + i * 0.8) * 0.16;
      arm.position.y = 0.3 + Math.sin(t * 2.6 + i) * 0.02;
    }
    blinkEyes(t);
  };
  return g;
}

function robbe(size) {
  const g = new THREE.Group();
  const furM = mat(0xb9c8d4);
  const lightM = mat(0xe9f1f6, { roughness: 0.6 });
  const len = size * 0.9;

  // sitting-up pose: chest raised, nose balancing a ball
  const body = add(g, new THREE.SphereGeometry(0.42, 12, 10), furM, len * 0.12, 0.36, 0);
  body.scale.set(len * 0.62, 0.8, 0.95);
  const chest = add(g, new THREE.SphereGeometry(0.34, 12, 10), lightM, -len * 0.2, 0.55, 0);
  chest.scale.set(0.95, 1.25, 0.9);
  const head = add(g, new THREE.SphereGeometry(0.24, 12, 10), furM, -len * 0.26, 1.0, 0);
  const snout = add(g, new THREE.SphereGeometry(0.12, 10, 8), lightM, -len * 0.36, 0.94, 0);
  snout.scale.set(1.2, 0.8, 1);
  add(g, new THREE.SphereGeometry(0.05, 8, 6), mat(0x39424e), -len * 0.43, 0.98, 0);

  // whiskers
  const whiskerM = mat(0xf5f8fa, { roughness: 0.5 });
  for (const s of [-1, 1]) {
    for (const dy of [-0.02, 0.03]) {
      const wsk = add(g, new THREE.CylinderGeometry(0.006, 0.006, 0.24, 4), whiskerM, -len * 0.4, 0.92 + dy, s * 0.1);
      wsk.rotation.x = s * 1.25;
      wsk.rotation.z = 0.35;
    }
  }

  // front flippers + tail
  for (const s of [-1, 1]) {
    const fl = add(g, new THREE.SphereGeometry(0.16, 8, 6), furM, -len * 0.1, 0.16, s * 0.34);
    fl.scale.set(1.7, 0.3, 0.75);
    fl.rotation.y = s * 0.45;
  }
  const tail = add(g, new THREE.SphereGeometry(0.17, 8, 6), furM, len * 0.42, 0.2, 0);
  tail.scale.set(1.4, 0.4, 1.5);

  // the red ball on the nose — the seal's signature
  const ball = new THREE.Group();
  const ballMesh = add(ball, new THREE.SphereGeometry(0.2, 12, 10), mat(0xe85d5d, { roughness: 0.5 }));
  const stripe = add(ball, new THREE.TorusGeometry(0.2, 0.045, 8, 18), mat(0xfff1d6, { roughness: 0.5 }));
  stripe.rotation.x = 0.4;
  ball.position.set(-len * 0.36, 1.32, 0);
  g.add(ball);

  const blinkEyes = makeEyes(g, -len * 0.33, 1.08, 0, 0.14, 0.07);

  g.userData.animate = (t) => {
    ball.position.y = 1.32 + Math.abs(Math.sin(t * 2.4)) * 0.12;
    ball.rotation.z = t * 1.6;
    head.rotation.z = Math.sin(t * 2.4) * 0.05;
    tail.rotation.z = Math.sin(t * 2.8) * 0.35;
    blinkEyes(t);
  };
  return g;
}

function schildkroete(size) {
  const g = new THREE.Group();
  const shellM = mat(0x3f8f5f);
  const shellDark = mat(0x2f7049);
  const skinM = mat(0x9fd68f);
  const len = size * 0.86;

  const shell = add(g, new THREE.SphereGeometry(0.5, 14, 10), shellM, 0, 0.4, 0);
  shell.scale.set(len * 0.74, 0.6, 0.95);
  const rim = add(g, new THREE.TorusGeometry(0.48, 0.09, 8, 20), mat(0xd8c88f), 0, 0.32, 0);
  rim.rotation.x = Math.PI / 2;
  rim.scale.set(len * 0.72, 0.92, 1);
  for (const [bx, bz] of [[0, 0], [0.32, 0.2], [0.32, -0.2], [-0.32, 0.2], [-0.32, -0.2], [0, 0.36], [0, -0.36]]) {
    const bump = add(g, new THREE.SphereGeometry(0.12, 8, 6), shellDark, bx * len * 0.5, 0.62, bz);
    bump.scale.y = 0.45;
  }

  const headG = new THREE.Group();
  headG.position.set(-len * 0.44, 0.4, 0);
  add(headG, new THREE.SphereGeometry(0.18, 12, 10), skinM, -0.12, 0.08, 0);
  const blinkEyes = makeEyes(headG, -0.2, 0.18, 0, 0.11, 0.06);
  smile(headG, -0.24, 0.03, 0, 0.07);
  g.add(headG);

  const flippers = [];
  for (const [sx, sz] of [[-0.28, -0.4], [-0.28, 0.4], [0.3, -0.4], [0.3, 0.4]]) {
    const f = add(g, new THREE.SphereGeometry(0.14, 8, 6), skinM, sx * len, 0.18, sz);
    f.scale.set(1.7, 0.35, 0.8);
    f.rotation.y = sz > 0 ? 0.5 : -0.5;
    flippers.push({ f, sx, sz });
  }

  g.userData.animate = (t) => {
    headG.position.x = -len * 0.44 - Math.max(0, Math.sin(t * 1.1)) * 0.07;
    headG.rotation.y = Math.sin(t * 0.7) * 0.25;
    flippers.forEach(({ f, sx, sz }, i) => {
      f.rotation.z = Math.sin(t * 2.4 + i * Math.PI * 0.5) * 0.22;
    });
    g.position.y = Math.abs(Math.sin(t * 1.2)) * 0.03;
    blinkEyes(t);
  };
  return g;
}

function qualle(size) {
  const g = new THREE.Group();
  const jellyM = mat(0xc9a6ff, { transparent: true, opacity: 0.72, roughness: 0.3 });
  const glowM = mat(0xe8d9ff, { emissive: 0xb388ff, emissiveIntensity: 0.9, transparent: true, opacity: 0.9 });
  const width = size * 0.42 + 0.32;

  const dome = add(g, new THREE.SphereGeometry(0.5, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2), jellyM, 0, 0.46, 0);
  dome.scale.set(width, 0.92, 1);
  const skirt = add(g, new THREE.TorusGeometry(0.48, 0.06, 8, 20), jellyM, 0, 0.46, 0);
  skirt.rotation.x = Math.PI / 2;
  skirt.scale.set(width, 1, 1);
  const core = add(g, new THREE.SphereGeometry(0.24, 10, 8), glowM, 0, 0.56, 0);
  core.scale.set(width * 0.8, 0.7, 0.8);

  // bead-chain tentacles
  const tentacles = [];
  for (let i = 0; i < 7; i += 1) {
    const a = (i / 7) * Math.PI * 2;
    const chain = new THREE.Group();
    chain.position.set(Math.cos(a) * 0.3 * width, 0.42, Math.sin(a) * 0.3);
    for (let k = 0; k < 4; k += 1) {
      add(chain, new THREE.SphereGeometry(0.045 - k * 0.006, 6, 5), mat(0xb08aef, { transparent: true, opacity: 0.85 }), 0, -0.1 - k * 0.11, 0);
    }
    g.add(chain);
    tentacles.push({ chain, i });
  }
  const blinkEyes = makeEyes(g, -0.3 * width, 0.6, 0, 0.16, 0.075);

  g.userData.animate = (t) => {
    const pulse = 1 + Math.sin(t * 2.6) * 0.1;
    dome.scale.set(width * (2 - pulse), 0.92 * pulse, 2 - pulse);
    core.material.emissiveIntensity = 0.7 + Math.sin(t * 2.6) * 0.4;
    g.position.y = Math.sin(t * 1.5) * 0.08;
    for (const { chain, i } of tentacles) {
      chain.rotation.x = Math.sin(t * 2.2 + i) * 0.28;
      chain.rotation.z = Math.cos(t * 1.8 + i) * 0.2;
    }
    blinkEyes(t);
  };
  return g;
}

// -------------------------------------------------------------- Weltraum

function station(size) {
  const g = new THREE.Group();
  const hullM = mat(0xdde2f2, { metalness: 0.4, roughness: 0.45 });
  const darkM = mat(0x8890b8, { metalness: 0.4, roughness: 0.5 });
  const len = size * 0.92;

  add(g, new THREE.CylinderGeometry(0.13, 0.13, len * 0.92, 10), hullM, 0, 0.55, 0).rotation.z = Math.PI / 2;
  const hub = add(g, new THREE.SphereGeometry(0.38, 14, 12), hullM, 0, 0.55, 0);
  add(g, new THREE.CylinderGeometry(0.2, 0.2, 0.26, 10), darkM, -len * 0.42, 0.55, 0).rotation.z = Math.PI / 2;
  add(g, new THREE.CylinderGeometry(0.2, 0.2, 0.26, 10), darkM, len * 0.42, 0.55, 0).rotation.z = Math.PI / 2;

  // rotating habitat ring with lit windows
  const ringG = new THREE.Group();
  ringG.position.set(0, 0.55, 0);
  add(ringG, new THREE.TorusGeometry(0.6, 0.08, 8, 24), darkM);
  for (let i = 0; i < 8; i += 1) {
    const a = (i / 8) * Math.PI * 2;
    add(
      ringG,
      new THREE.SphereGeometry(0.035, 6, 5),
      mat(0xffe28a, { emissive: 0xffd447, emissiveIntensity: 1.6 }),
      Math.cos(a) * 0.6,
      Math.sin(a) * 0.6,
      0.07
    );
  }
  ringG.rotation.y = Math.PI / 2;
  g.add(ringG);

  // solar panels
  const panels = [];
  for (const s of [-1, 1]) {
    const p = add(
      g,
      new THREE.BoxGeometry(0.72, 0.03, 0.52),
      mat(0x2f5fd0, { metalness: 0.55, roughness: 0.3, emissive: 0x1a3fa0, emissiveIntensity: 0.55 }),
      s * len * 0.28,
      0.55,
      0
    );
    panels.push(p);
  }
  const beacon = add(g, new THREE.SphereGeometry(0.06, 8, 6), mat(0xff5f7e, { emissive: 0xff5f7e, emissiveIntensity: 2 }), 0, 1.06, 0);
  add(g, new THREE.CylinderGeometry(0.018, 0.018, 0.34, 6), darkM, 0, 0.88, 0);

  g.userData.animate = (t) => {
    ringG.rotation.x = t * 0.7;
    beacon.material.emissiveIntensity = 1.1 + Math.sin(t * 5) * 1;
    panels.forEach((p, i) => {
      p.rotation.x = Math.sin(t * 0.6 + i) * 0.3;
    });
    hub.rotation.y = t * 0.3;
  };
  return g;
}

function rakete(size) {
  const g = new THREE.Group();
  const len = size * 0.92;
  const bodyM = mat(0xf4f6fc, { roughness: 0.45 });
  const redM = mat(0xe85d75, { roughness: 0.5 });

  const rocket = new THREE.Group();
  add(rocket, new THREE.CylinderGeometry(0.26, 0.3, len * 0.52, 14), bodyM, 0, 0.5, 0);
  const nose = add(rocket, new THREE.SphereGeometry(0.26, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), redM, 0, 0.5 + len * 0.26, 0);
  nose.scale.y = 1.7;
  for (let i = 0; i < 3; i += 1) {
    const a = (i / 3) * Math.PI * 2;
    const fin = add(rocket, new THREE.BoxGeometry(0.05, 0.36, 0.3), redM, Math.cos(a) * 0.27, 0.28, Math.sin(a) * 0.27);
    fin.rotation.y = -a;
  }
  add(rocket, new THREE.TorusGeometry(0.115, 0.035, 8, 16), redM, 0, 0.62, 0.255);
  add(rocket, new THREE.SphereGeometry(0.095, 10, 8), mat(0x9fdcff, { emissive: 0x5f9fd0, emissiveIntensity: 0.8, roughness: 0.2 }), 0, 0.62, 0.26);

  const flameOuter = add(rocket, new THREE.ConeGeometry(0.2, 0.55, 10), mat(0xff8c1a, { emissive: 0xff7711, emissiveIntensity: 1.7, transparent: true, opacity: 0.85 }), 0, 0.02, 0);
  flameOuter.rotation.x = Math.PI;
  const flameInner = add(rocket, new THREE.ConeGeometry(0.1, 0.36, 8), mat(0xffe28a, { emissive: 0xffd447, emissiveIntensity: 2.2, transparent: true, opacity: 0.95 }), 0, 0.1, 0);
  flameInner.rotation.x = Math.PI;

  rocket.rotation.z = -Math.PI / 2.35;
  rocket.position.set(-len * 0.08, 0.28, 0);
  g.add(rocket);

  // little exhaust puffs
  const puffs = [];
  for (let i = 0; i < 3; i += 1) {
    const puff = add(g, new THREE.SphereGeometry(0.09, 8, 6), mat(0xd9dbe8, { transparent: true, opacity: 0.5 }), 0, 0, 0);
    puff.userData.phase = i / 3;
    puffs.push(puff);
  }

  g.userData.animate = (t) => {
    flameOuter.scale.setScalar(0.85 + Math.sin(t * 16) * 0.2);
    flameInner.scale.setScalar(0.9 + Math.cos(t * 19) * 0.25);
    rocket.position.y = 0.28 + Math.sin(t * 2.2) * 0.06;
    rocket.rotation.z = -Math.PI / 2.35 + Math.sin(t * 1.4) * 0.04;
    puffs.forEach((p) => {
      const ph = (t * 0.8 + p.userData.phase) % 1;
      p.position.set(len * 0.3 + ph * 0.7, 0.24 - ph * 0.05, 0);
      p.material.opacity = 0.5 * (1 - ph);
      p.scale.setScalar(0.7 + ph * 1.6);
    });
  };
  return g;
}

function ufo(size) {
  const g = new THREE.Group();
  const metalM = mat(0xaeb6d4, { metalness: 0.5, roughness: 0.35 });
  const width = size * 0.42 + 0.38;

  const saucer = add(g, new THREE.SphereGeometry(0.62, 18, 12), metalM, 0, 0.5, 0);
  saucer.scale.set(width, 0.26, 1);
  const edge = add(g, new THREE.TorusGeometry(0.62, 0.09, 8, 26), mat(0x8890b8, { metalness: 0.5, roughness: 0.4 }), 0, 0.5, 0);
  edge.rotation.x = Math.PI / 2;
  edge.scale.set(width, 1, 1);
  add(g, new THREE.SphereGeometry(0.34, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat(0xbef2ff, { transparent: true, opacity: 0.5, roughness: 0.15, metalness: 0.1 }), 0, 0.58, 0);

  // little green pilot with bobble antenna
  const alien = new THREE.Group();
  add(alien, new THREE.SphereGeometry(0.15, 10, 8), mat(0x86e08f), 0, 0.7, 0);
  add(alien, new THREE.CylinderGeometry(0.012, 0.012, 0.14, 5), mat(0x5fae68), 0, 0.85, 0);
  const bobble = add(alien, new THREE.SphereGeometry(0.04, 8, 6), mat(0xffe066, { emissive: 0xffd447, emissiveIntensity: 1.4 }), 0, 0.93, 0);
  const blinkEyes = makeEyes(alien, -0.11, 0.73, 0, 0.07, 0.045);
  g.add(alien);

  // chasing running lights
  const lights = [];
  for (let i = 0; i < 8; i += 1) {
    const a = (i / 8) * Math.PI * 2;
    lights.push(
      add(g, new THREE.SphereGeometry(0.055, 8, 6), mat(0xffe066, { emissive: 0xffe066, emissiveIntensity: 0.4 }), Math.cos(a) * 0.62 * width, 0.47, Math.sin(a) * 0.62)
    );
  }

  g.userData.animate = (t) => {
    lights.forEach((l, i) => {
      const chase = (t * 3) % 8;
      const dist = Math.min(Math.abs(chase - i), 8 - Math.abs(chase - i));
      l.material.emissiveIntensity = Math.max(0.25, 1.8 - dist * 0.8);
    });
    g.rotation.z = Math.sin(t * 1.3) * 0.05;
    g.rotation.x = Math.cos(t * 1.1) * 0.05;
    bobble.position.y = 0.93 + Math.sin(t * 3.2) * 0.02;
    blinkEyes(t);
  };
  return g;
}

function satellit(size) {
  const g = new THREE.Group();
  const goldM = mat(0xd9b64a, { metalness: 0.6, roughness: 0.35 });
  const metalM = mat(0xcfd6ea, { metalness: 0.5, roughness: 0.4 });

  add(g, new THREE.BoxGeometry(0.42, 0.42, 0.42), goldM, 0, 0.55, 0);
  const panels = [];
  for (const s of [-1, 1]) {
    const arm = add(g, new THREE.CylinderGeometry(0.03, 0.03, 0.22, 6), metalM, s * 0.3, 0.55, 0);
    arm.rotation.z = Math.PI / 2;
    const p = add(
      g,
      new THREE.BoxGeometry(size * 0.4, 0.025, 0.42),
      mat(0x2f5fd0, { emissive: 0x1a3fa0, emissiveIntensity: 0.5, metalness: 0.5, roughness: 0.3 }),
      s * (size * 0.22 + 0.28),
      0.55,
      0
    );
    panels.push(p);
  }
  const dishG = new THREE.Group();
  dishG.position.set(0, 0.85, 0);
  const dish = add(dishG, new THREE.ConeGeometry(0.2, 0.13, 14, 1, true), metalM);
  dish.rotation.x = Math.PI;
  add(dishG, new THREE.CylinderGeometry(0.012, 0.012, 0.16, 5), metalM, 0, 0.08, 0);
  add(dishG, new THREE.SphereGeometry(0.035, 8, 6), mat(0xff5f7e, { emissive: 0xff5f7e, emissiveIntensity: 2 }), 0, 0.17, 0);
  g.add(dishG);

  g.userData.animate = (t) => {
    dishG.rotation.y = t * 0.9;
    dishG.rotation.z = Math.sin(t * 0.7) * 0.2;
    panels.forEach((p, i) => {
      p.material.emissiveIntensity = 0.4 + Math.max(0, Math.sin(t * 1.6 + i * 2)) * 0.5;
      p.rotation.x = Math.sin(t * 0.5 + i) * 0.18;
    });
    g.rotation.y = Math.sin(t * 0.4) * 0.25;
  };
  return g;
}

function funkelstern(size) {
  const g = new THREE.Group();
  const shape = new THREE.Shape();
  for (let i = 0; i < 10; i += 1) {
    const r = i % 2 === 0 ? 0.5 : 0.24;
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    if (i === 0) shape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  const starG = new THREE.Group();
  const star = add(
    starG,
    new THREE.ExtrudeGeometry(shape, { depth: 0.16, bevelEnabled: true, bevelSize: 0.06, bevelThickness: 0.06 }),
    mat(0xffd447, { emissive: 0xe0a814, emissiveIntensity: 0.75 }),
    0,
    0,
    -0.08
  );
  const s = size * 0.38 + 0.3;
  starG.scale.setScalar(s);
  starG.position.y = 0.62;
  starG.rotation.x = -Math.PI / 2; // lie flat, face up — reads from every angle
  g.add(starG);

  const blinkEyes = makeEyes(starG, -0.16, 0.02, 0.16, 0.14, 0.075);
  smile(starG, -0.2, -0.14, 0.12, 0.08, 0.018);

  const orbiters = [];
  for (let i = 0; i < 3; i += 1) {
    orbiters.push(
      add(g, new THREE.SphereGeometry(0.05, 8, 6), mat(0xffffff, { emissive: 0xffffff, emissiveIntensity: 1.5 }), 0.7, 0.6, 0)
    );
  }

  g.userData.animate = (t) => {
    starG.rotation.z = t * 0.4; // slow lazy spin like a compass needle
    starG.position.y = 0.62 + Math.sin(t * 2.1) * 0.05;
    star.material.emissiveIntensity = 0.6 + Math.sin(t * 3.1) * 0.25;
    orbiters.forEach((o, i) => {
      const a = t * 1.7 + (i * Math.PI * 2) / 3;
      o.position.set(Math.cos(a) * 0.8 * s, 0.62 + Math.sin(t * 2 + i) * 0.14, Math.sin(a) * 0.8 * s);
    });
    blinkEyes(t);
  };
  return g;
}

// ------------------------------------------------------------------ Dino

function langhals(size) {
  const g = new THREE.Group();
  const skinM = mat(0x6fbf73);
  const bellyM = mat(0xd7eebc, { roughness: 0.65 });
  const spotM = mat(0x549e58);
  const len = size * 0.92;

  const body = add(g, new THREE.SphereGeometry(0.5, 14, 10), skinM, len * 0.06, 0.52, 0);
  body.scale.set(len * 0.46, 0.88, 1);
  add(g, new THREE.SphereGeometry(0.42, 12, 9), bellyM, len * 0.06, 0.4, 0).scale.set(len * 0.42, 0.62, 0.9);
  for (const [sx, sy, sz] of [[-0.1, 0.85, 0.3], [0.25, 0.9, -0.25], [0.05, 0.95, 0]]) {
    const spot = add(g, new THREE.SphereGeometry(0.09, 8, 6), spotM, sx * len, sy, sz);
    spot.scale.y = 0.4;
  }

  // neck chain + head, gently swaying and "grazing"
  const neck = new THREE.Group();
  neck.position.set(-len * 0.3, 0.62, 0);
  for (let i = 0; i < 4; i += 1) {
    add(neck, new THREE.SphereGeometry(0.19 - i * 0.018, 10, 8), skinM, -i * 0.15, i * 0.3, 0);
  }
  const headG = new THREE.Group();
  headG.position.set(-0.62, 1.22, 0);
  const head = add(headG, new THREE.SphereGeometry(0.17, 12, 9), skinM, 0, 0, 0);
  head.scale.set(1.35, 0.95, 0.9);
  add(headG, new THREE.SphereGeometry(0.09, 8, 6), bellyM, -0.16, -0.04, 0);
  const blinkEyes = makeEyes(headG, -0.08, 0.1, 0, 0.11, 0.055);
  neck.add(headG);
  g.add(neck);

  const tail = new THREE.Group();
  tail.position.set(len * 0.3, 0.48, 0);
  for (let i = 0; i < 4; i += 1) {
    add(tail, new THREE.SphereGeometry(0.17 - i * 0.035, 8, 6), skinM, i * 0.22, i * 0.05, 0);
  }
  g.add(tail);

  for (const [sx, sz] of [[-0.14, -0.32], [-0.14, 0.32], [0.28, -0.32], [0.28, 0.32]]) {
    add(g, new THREE.CylinderGeometry(0.12, 0.14, 0.44, 8), skinM, sx * len, 0.2, sz);
  }

  g.userData.animate = (t) => {
    neck.rotation.z = Math.sin(t * 0.9) * 0.1;
    neck.rotation.x = Math.sin(t * 0.6) * 0.06;
    headG.rotation.z = Math.sin(t * 1.7) * 0.1; // nibbling
    tail.rotation.y = Math.sin(t * 1.6) * 0.25;
    body.position.y = 0.52 + Math.sin(t * 1.5) * 0.015;
    blinkEyes(t);
  };
  return g;
}

function rexi(size) {
  const g = new THREE.Group();
  const skinM = mat(0xe0854a);
  const bellyM = mat(0xf5ce9e, { roughness: 0.65 });
  const len = size * 0.92;

  const body = add(g, new THREE.SphereGeometry(0.42, 12, 10), skinM, len * 0.05, 0.58, 0);
  body.scale.set(len * 0.42, 1.05, 0.9);
  body.rotation.z = 0.25;
  add(g, new THREE.SphereGeometry(0.32, 10, 8), bellyM, len * 0.02, 0.5, 0).scale.set(len * 0.36, 0.8, 0.75);

  // big head with opening jaw
  const headG = new THREE.Group();
  headG.position.set(-len * 0.28, 1.06, 0);
  const skull = add(headG, new THREE.SphereGeometry(0.3, 12, 10), skinM, 0, 0.06, 0);
  skull.scale.set(1.3, 0.85, 0.9);
  const jaw = new THREE.Group();
  jaw.position.set(-0.1, -0.08, 0);
  const jawMesh = add(jaw, new THREE.SphereGeometry(0.2, 10, 8), skinM, -0.08, -0.05, 0);
  jawMesh.scale.set(1.4, 0.55, 0.8);
  // teeth
  for (const s of [-1, 1]) {
    for (let k = 0; k < 3; k += 1) {
      const tooth = add(headG, new THREE.ConeGeometry(0.028, 0.09, 5), mat(0xfdfaef, { roughness: 0.4 }), -0.28 - k * 0.02, -0.06, s * (0.08 + k * 0.05));
      tooth.rotation.x = Math.PI;
    }
  }
  headG.add(jaw);
  const blinkEyes = makeEyes(headG, -0.14, 0.2, 0, 0.17, 0.07);
  g.add(headG);

  // tail, legs, tiny arms
  const tail = new THREE.Group();
  tail.position.set(len * 0.3, 0.52, 0);
  for (let i = 0; i < 3; i += 1) {
    const seg = add(tail, new THREE.ConeGeometry(0.17 - i * 0.05, 0.34, 8), skinM, i * 0.24, -i * 0.02, 0);
    seg.rotation.z = -Math.PI / 2;
  }
  g.add(tail);
  for (const s of [-1, 1]) {
    add(g, new THREE.CylinderGeometry(0.13, 0.16, 0.52, 8), skinM, len * 0.08, 0.26, s * 0.26);
    const foot = add(g, new THREE.SphereGeometry(0.13, 8, 6), skinM, len * 0.05, 0.05, s * 0.27);
    foot.scale.set(1.5, 0.5, 1);
  }
  const arms = [];
  for (const s of [-1, 1]) {
    const arm = add(g, new THREE.CylinderGeometry(0.045, 0.05, 0.2, 6), skinM, -len * 0.16, 0.72, s * 0.28);
    arm.rotation.x = s * 0.5;
    arm.rotation.z = 0.7;
    arms.push(arm);
  }

  g.userData.animate = (t) => {
    // roar cycle: mouth opens wide every few seconds
    const roar = Math.max(0, Math.sin(t * 0.9) ** 9);
    jaw.rotation.z = -roar * 0.55 - 0.04;
    headG.rotation.z = roar * 0.18 + Math.sin(t * 2.1) * 0.03;
    tail.rotation.y = Math.sin(t * 2.3) * 0.3;
    arms.forEach((a, i) => {
      a.rotation.z = 0.7 + Math.sin(t * 3 + i * 2) * 0.2;
    });
    g.position.y = Math.abs(Math.sin(t * 2.6)) * 0.04;
    blinkEyes(t);
  };
  return g;
}

function triceratops(size) {
  const g = new THREE.Group();
  const skinM = mat(0x8f7ec9);
  const frillM = mat(0x6f5fb0);
  const hornM = mat(0xf7efd8, { roughness: 0.5 });
  const len = size * 0.92;

  const body = add(g, new THREE.SphereGeometry(0.46, 14, 10), skinM, len * 0.08, 0.5, 0);
  body.scale.set(len * 0.46, 0.85, 1);
  add(g, new THREE.SphereGeometry(0.38, 12, 9), mat(0xcfc4ee, { roughness: 0.65 }), len * 0.08, 0.4, 0).scale.set(len * 0.42, 0.6, 0.9);

  const headG = new THREE.Group();
  headG.position.set(-len * 0.32, 0.62, 0);
  add(headG, new THREE.SphereGeometry(0.26, 12, 10), skinM, -0.06, 0, 0);
  // beak
  const beak = add(headG, new THREE.ConeGeometry(0.09, 0.22, 6), hornM, -0.34, -0.05, 0);
  beak.rotation.z = Math.PI / 2;
  // frill: circular sector behind the head with rim
  const frill = add(headG, new THREE.CircleGeometry(0.45, 18, Math.PI * 0.15, Math.PI * 0.7), frillM, 0.14, 0.1, 0);
  frill.rotation.y = -Math.PI / 2;
  frill.material.side = THREE.DoubleSide;
  const frillRim = add(headG, new THREE.TorusGeometry(0.45, 0.035, 6, 16, Math.PI * 0.7), mat(0x5a4b96), 0.14, 0.1, 0);
  frillRim.rotation.y = -Math.PI / 2;
  frillRim.rotation.z = Math.PI * 0.15;
  // horns
  for (const s of [-1, 1]) {
    const horn = add(headG, new THREE.ConeGeometry(0.045, 0.3, 8), hornM, -0.1, 0.22, s * 0.13);
    horn.rotation.z = 0.5;
  }
  const nHorn = add(headG, new THREE.ConeGeometry(0.05, 0.2, 8), hornM, -0.28, 0.12, 0);
  nHorn.rotation.z = 0.9;
  const blinkEyes = makeEyes(headG, -0.2, 0.06, 0, 0.15, 0.06);
  g.add(headG);

  const tail = add(g, new THREE.ConeGeometry(0.16, 0.6, 8), skinM, len * 0.44, 0.42, 0);
  tail.rotation.z = -Math.PI / 2;
  for (const [sx, sz] of [[-0.08, -0.3], [-0.08, 0.3], [0.28, -0.3], [0.28, 0.3]]) {
    add(g, new THREE.CylinderGeometry(0.11, 0.13, 0.42, 8), skinM, sx * len, 0.2, sz);
  }

  g.userData.animate = (t) => {
    headG.rotation.z = Math.sin(t * 1.2) * 0.09 - 0.03; // grazing bob
    headG.rotation.y = Math.sin(t * 0.6) * 0.12;
    tail.rotation.y = Math.sin(t * 1.9) * 0.2;
    g.position.y = Math.abs(Math.sin(t * 1.3)) * 0.02;
    blinkEyes(t);
  };
  return g;
}

function flugsaurier(size) {
  const g = new THREE.Group();
  const skinM = mat(0x5fb0c9);
  const wingM = mat(0x4a94ab, { side: THREE.DoubleSide });

  const bodyG = new THREE.Group();
  const body = add(bodyG, new THREE.SphereGeometry(0.2, 10, 8), skinM, 0, 0, 0);
  body.scale.set(size * 0.5, 0.75, 0.7);
  const headG = new THREE.Group();
  headG.position.set(-size * 0.28, 0.1, 0);
  add(headG, new THREE.SphereGeometry(0.13, 10, 8), skinM);
  const beak = add(headG, new THREE.ConeGeometry(0.05, 0.3, 6), mat(0xe8a13f), -0.22, -0.02, 0);
  beak.rotation.z = Math.PI / 2;
  const crest = add(headG, new THREE.ConeGeometry(0.06, 0.26, 6), mat(0xe85d75), 0.1, 0.14, 0);
  crest.rotation.z = -1.1;
  const blinkEyes = makeEyes(headG, -0.06, 0.07, 0, 0.09, 0.045);
  bodyG.add(headG);

  // proper triangular membrane wings (two segments each, tip lags)
  const wings = [];
  for (const s of [-1, 1]) {
    const wing = new THREE.Group();
    wing.position.set(0, 0.06, s * 0.12);
    const inner = new THREE.Mesh(makeWingGeo(size * 0.34, 0.34, s), wingM);
    wing.add(inner);
    const tipG = new THREE.Group();
    tipG.position.set(0, 0, s * 0.34);
    const outer = new THREE.Mesh(makeWingGeo(size * 0.26, 0.3, s), wingM);
    tipG.add(outer);
    wing.add(tipG);
    bodyG.add(wing);
    wings.push({ wing, tipG, s });
  }
  bodyG.position.y = 0.8;
  g.add(bodyG);

  function makeWingGeo(w, d, s) {
    const geo = new THREE.BufferGeometry();
    const verts = new Float32Array([
      -w * 0.5, 0, 0,
      w * 0.5, 0, 0,
      -w * 0.1, 0, s * d,
    ]);
    geo.setAttribute("position", new THREE.BufferAttribute(verts, 3));
    geo.computeVertexNormals();
    return geo;
  }

  g.userData.animate = (t) => {
    for (const { wing, tipG, s } of wings) {
      wing.rotation.x = s * Math.sin(t * 6) * 0.55;
      tipG.rotation.x = s * Math.sin(t * 6 - 0.9) * 0.5;
    }
    bodyG.position.y = 0.8 + Math.sin(t * 2.8) * 0.1;
    bodyG.rotation.z = Math.sin(t * 1.6) * 0.08;
    blinkEyes(t);
  };
  return g;
}

function babyBibo(size) {
  const g = new THREE.Group();
  const shellM = mat(0xfdf6e3, { roughness: 0.55 });
  const skinM = mat(0xa8d977);
  const width = size * 0.36 + 0.36;

  // egg cup with zigzag rim
  const cup = add(g, new THREE.SphereGeometry(0.42, 14, 10, 0, Math.PI * 2, Math.PI * 0.32, Math.PI * 0.68), shellM, 0, 0.42, 0);
  cup.scale.set(width, 1, 1);
  const rimBits = 10;
  for (let i = 0; i < rimBits; i += 1) {
    const a = (i / rimBits) * Math.PI * 2;
    const spike = add(g, new THREE.ConeGeometry(0.075, 0.14, 4), shellM, Math.cos(a) * 0.36 * width, 0.62, Math.sin(a) * 0.36);
  }

  // baby peeking out
  const babyG = new THREE.Group();
  const head = add(babyG, new THREE.SphereGeometry(0.23, 12, 10), skinM, 0, 0, 0);
  const snout = add(babyG, new THREE.SphereGeometry(0.1, 8, 6), mat(0xd7eebc), -0.18, -0.05, 0);
  const blinkEyes = makeEyes(babyG, -0.12, 0.09, 0, 0.13, 0.065);
  // shell cap hat
  const cap = add(babyG, new THREE.SphereGeometry(0.19, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.45), shellM, 0.05, 0.14, 0);
  cap.rotation.z = -0.35;
  babyG.position.y = 0.66;
  g.add(babyG);

  g.userData.animate = (t) => {
    const peek = Math.max(0, Math.sin(t * 1.3));
    babyG.position.y = 0.56 + peek * 0.16;
    babyG.rotation.y = Math.sin(t * 0.8) * 0.4;
    cap.rotation.z = -0.35 + Math.sin(t * 1.3) * 0.12;
    g.rotation.z = Math.sin(t * 2.2) * 0.02;
    blinkEyes(t);
  };
  return g;
}


// ----------------------------------------------------------------- Teich

function karpfen(size) {
  const g = new THREE.Group();
  const goldM = mat(0xe8963f, { roughness: 0.55, metalness: 0.15 });
  const bellyM = mat(0xf7d9a8, { roughness: 0.6 });
  const finM = mat(0xd97b2f, { roughness: 0.6, side: THREE.DoubleSide });
  const len = size * 0.94;

  const body = add(g, new THREE.SphereGeometry(0.5, 16, 12), goldM, -len * 0.06, 0.5, 0);
  body.scale.set(len * 0.62, 0.82, 0.72);
  add(g, new THREE.SphereGeometry(0.44, 14, 10), bellyM, -len * 0.06, 0.4, 0).scale.set(len * 0.56, 0.6, 0.64);
  // big carp lips
  const lips = add(g, new THREE.TorusGeometry(0.1, 0.045, 8, 14), goldM, -len * 0.38, 0.5, 0);
  lips.rotation.y = Math.PI / 2;
  // dorsal fin + tail fan
  const dorsal = add(g, new THREE.CircleGeometry(0.32, 10, 0, Math.PI * 0.8), finM, -len * 0.02, 0.92, 0);
  dorsal.rotation.x = 0;
  const tail = new THREE.Group();
  tail.position.set(len * 0.28, 0.5, 0);
  const fan = add(tail, new THREE.CircleGeometry(0.36, 10, -Math.PI * 0.4, Math.PI * 0.8), finM, 0.24, 0, 0);
  g.add(tail);
  for (const sd of [-1, 1]) {
    const fin = add(g, new THREE.CircleGeometry(0.18, 8, 0, Math.PI * 0.9), finM, -len * 0.16, 0.32, sd * 0.34);
    fin.rotation.y = sd * 1.1;
    fin.rotation.z = -0.6;
  }
  // bubbles from the lips
  const bubbles = [];
  for (let i = 0; i < 3; i += 1) {
    bubbles.push(add(g, new THREE.SphereGeometry(0.05 - i * 0.01, 8, 6), mat(0xdff4ff, { transparent: true, opacity: 0.7 }), -len * 0.42, 0.6, 0));
  }
  const blinkEyes = makeEyes(g, -len * 0.3, 0.62, 0, 0.24, 0.08);

  g.userData.animate = (t) => {
    tail.rotation.y = Math.sin(t * 3.2) * 0.4;
    body.rotation.y = Math.sin(t * 3.2) * 0.03;
    lips.scale.setScalar(1 + Math.max(0, Math.sin(t * 2.2)) * 0.25);
    bubbles.forEach((b, i) => {
      const ph = (t * 0.9 + i * 0.33) % 1;
      b.position.y = 0.58 + ph * 0.55;
      b.position.x = -len * 0.42 - ph * 0.1;
      b.material.opacity = 0.7 * (1 - ph);
    });
    blinkEyes(t);
  };
  return g;
}

function ente(size) {
  const g = new THREE.Group();
  const featherM = mat(0xfdf6e3, { roughness: 0.7 });
  const beakM = mat(0xf2a13f, { roughness: 0.5 });
  const len = size * 0.9;

  // mama duck
  const mama = new THREE.Group();
  const body = add(mama, new THREE.SphereGeometry(0.4, 14, 10), featherM, 0.1, 0.42, 0);
  body.scale.set(1.35, 0.95, 0.95);
  const tailFeather = add(mama, new THREE.ConeGeometry(0.14, 0.3, 8), featherM, 0.6, 0.55, 0);
  tailFeather.rotation.z = -1.1;
  const headG = new THREE.Group();
  headG.position.set(-0.36, 0.86, 0);
  add(headG, new THREE.SphereGeometry(0.22, 12, 10), featherM);
  const beak = add(headG, new THREE.ConeGeometry(0.09, 0.24, 8), beakM, -0.28, -0.02, 0);
  beak.rotation.z = Math.PI / 2;
  const blinkEyes = makeEyes(headG, -0.12, 0.08, 0, 0.13, 0.055);
  mama.add(headG);
  const wings = [];
  for (const sd of [-1, 1]) {
    const w = add(mama, new THREE.SphereGeometry(0.2, 10, 8), mat(0xf2e8cf, { roughness: 0.75 }), 0.08, 0.5, sd * 0.3);
    w.scale.set(1.3, 0.6, 0.4);
    wings.push(w);
  }
  mama.position.x = -len * 0.26;
  g.add(mama);

  // duckling paddling behind
  const kid = new THREE.Group();
  add(kid, new THREE.SphereGeometry(0.18, 10, 8), mat(0xffe28a, { roughness: 0.7 }), 0, 0.3, 0).scale.set(1.3, 0.9, 0.9);
  const kidHead = add(kid, new THREE.SphereGeometry(0.12, 10, 8), mat(0xffe28a, { roughness: 0.7 }), -0.16, 0.52, 0);
  const kidBeak = add(kid, new THREE.ConeGeometry(0.05, 0.12, 6), beakM, -0.28, 0.5, 0);
  kidBeak.rotation.z = Math.PI / 2;
  const kidEyes = makeEyes(kid, -0.2, 0.57, 0, 0.08, 0.035, 2);
  kid.position.x = len * 0.3;
  g.add(kid);

  g.userData.animate = (t) => {
    mama.position.y = Math.sin(t * 1.8) * 0.04;
    mama.rotation.z = Math.sin(t * 1.8) * 0.03;
    headG.rotation.z = Math.sin(t * 1.1) * 0.12;
    wings.forEach((w, i) => {
      w.rotation.x = Math.sin(t * 2.4 + i * Math.PI) * 0.1;
    });
    kid.position.y = Math.sin(t * 2.2 + 1) * 0.05;
    kid.rotation.z = Math.sin(t * 2.6) * 0.08;
    kid.position.x = len * 0.3 + Math.sin(t * 0.9) * 0.06;
    blinkEyes(t);
    kidEyes(t);
  };
  return g;
}

function flossi(size) {
  const g = new THREE.Group();
  const bodyM = mat(0x4fb8d9, { roughness: 0.5 });
  const stripeM = mat(0xffd447, { roughness: 0.55 });
  const finM = mat(0x3f96b8, { roughness: 0.6, side: THREE.DoubleSide });
  const len = size * 0.9;

  // tall flat tropical fish
  const body = add(g, new THREE.SphereGeometry(0.5, 16, 12), bodyM, -len * 0.08, 0.62, 0);
  body.scale.set(len * 0.42, 1.05, 0.42);
  for (const dx of [-0.14, 0.1]) {
    const stripe = add(g, new THREE.SphereGeometry(0.5, 14, 10), stripeM, -len * 0.08 + dx * len, 0.62, 0);
    stripe.scale.set(len * 0.07, 1.06, 0.43);
  }
  const tail = new THREE.Group();
  tail.position.set(len * 0.2, 0.62, 0);
  add(tail, new THREE.CircleGeometry(0.4, 10, -Math.PI * 0.45, Math.PI * 0.9), finM, 0.28, 0, 0);
  g.add(tail);
  const topFin = add(g, new THREE.CircleGeometry(0.3, 8, Math.PI * 0.1, Math.PI * 0.8), finM, -len * 0.08, 1.12, 0);
  const botFin = add(g, new THREE.CircleGeometry(0.22, 8, Math.PI * 1.1, Math.PI * 0.8), finM, -len * 0.08, 0.16, 0);
  const blinkEyes = makeEyes(g, -len * 0.3, 0.74, 0, 0.14, 0.07);
  smile(g, -len * 0.34, 0.52, 0, 0.08);

  g.userData.animate = (t) => {
    tail.rotation.y = Math.sin(t * 3.6) * 0.5;
    g.rotation.y = 0.35 + Math.sin(t * 3.6) * 0.02;
    g.position.y = Math.sin(t * 1.7) * 0.06;
    topFin.rotation.z = Math.sin(t * 2.4) * 0.12;
    blinkEyes(t);
  };
  g.rotation.y = 0.35;
  return g;
}

function frosch(size) {
  const g = new THREE.Group();
  const skinM = mat(0x5fbf5f, { roughness: 0.6 });
  const bellyM = mat(0xd7f0b8, { roughness: 0.65 });
  const width = size * 0.4 + 0.3;

  // lily pad
  const pad = add(g, new THREE.CircleGeometry(0.62, 18, 0.3, Math.PI * 1.85), mat(0x3f9a52, { roughness: 0.9, side: THREE.DoubleSide }), 0, 0.06, 0);
  pad.rotation.x = -Math.PI / 2;
  pad.scale.set(width * 1.15, 1, 1);

  const frog = new THREE.Group();
  const body = add(frog, new THREE.SphereGeometry(0.32, 14, 10), skinM, 0, 0.32, 0);
  body.scale.set(width, 0.85, 1);
  add(frog, new THREE.SphereGeometry(0.26, 12, 9), bellyM, -0.04, 0.26, 0).scale.set(width * 0.9, 0.7, 0.9);
  // bulging eyes on top
  const eyeBulbs = [];
  for (const sd of [-1, 1]) {
    add(frog, new THREE.SphereGeometry(0.11, 10, 8), skinM, -0.14, 0.62, sd * 0.16);
  }
  const blinkEyes = makeEyes(frog, -0.2, 0.64, 0, 0.16, 0.07);
  smile(frog, -0.28, 0.36, 0, 0.11);
  // throat bubble
  const throat = add(frog, new THREE.SphereGeometry(0.12, 10, 8), mat(0xf7ffd9, { transparent: true, opacity: 0.85 }), -0.24, 0.24, 0);
  // folded legs
  for (const sd of [-1, 1]) {
    const leg = add(frog, new THREE.SphereGeometry(0.13, 8, 6), skinM, 0.16, 0.18, sd * (width * 0.75));
    leg.scale.set(1.4, 0.6, 0.8);
  }
  g.add(frog);

  g.userData.animate = (t) => {
    // croak: throat inflates rhythmically
    const croak = Math.max(0, Math.sin(t * 1.4)) ** 3;
    throat.scale.setScalar(0.7 + croak * 0.9);
    frog.scale.y = 1 - croak * 0.06;
    // little hop every few seconds
    const hop = Math.max(0, Math.sin(t * 0.8 + 2)) ** 14;
    frog.position.y = hop * 0.3;
    pad.rotation.z = Math.sin(t * 1.2) * 0.03;
    blinkEyes(t);
  };
  return g;
}

function krabbe(size) {
  const g = new THREE.Group();
  const shellM = mat(0xe86450, { roughness: 0.55 });
  const width = size * 0.4 + 0.28;

  const body = add(g, new THREE.SphereGeometry(0.34, 14, 10), shellM, 0, 0.34, 0);
  body.scale.set(width, 0.7, 0.9);
  // eye stalks
  const stalks = [];
  for (const sd of [-1, 1]) {
    const stalk = add(g, new THREE.CylinderGeometry(0.03, 0.03, 0.22, 6), shellM, -0.1, 0.62, sd * 0.12);
    stalks.push(stalk);
  }
  const blinkEyes = makeEyes(g, -0.12, 0.76, 0, 0.12, 0.06);
  // big claws
  const claws = [];
  for (const sd of [-1, 1]) {
    const claw = new THREE.Group();
    claw.position.set(-0.2, 0.34, sd * width * 0.9);
    add(claw, new THREE.CylinderGeometry(0.045, 0.045, 0.3, 6), shellM, -0.1, 0, 0).rotation.z = Math.PI / 2;
    const pincer = add(claw, new THREE.SphereGeometry(0.14, 10, 8), shellM, -0.3, 0.02, 0);
    pincer.scale.set(1.3, 0.9, 0.8);
    add(claw, new THREE.ConeGeometry(0.05, 0.14, 6), shellM, -0.44, 0.1, 0).rotation.z = 0.7;
    claws.push({ claw, sd });
    g.add(claw);
  }
  // legs
  for (const sd of [-1, 1]) {
    for (let k = 0; k < 3; k += 1) {
      const leg = add(g, new THREE.CylinderGeometry(0.025, 0.02, 0.3, 5), shellM, 0.08 + k * 0.14, 0.2, sd * (width * 0.8));
      leg.rotation.x = sd * 0.9;
    }
  }

  g.userData.animate = (t) => {
    for (const { claw, sd } of claws) {
      claw.rotation.z = Math.sin(t * 2.6 + sd) * 0.3 + 0.15;
    }
    stalks.forEach((st, i) => {
      st.rotation.x = Math.sin(t * 1.9 + i) * 0.15;
    });
    // scuttle side-step
    g.position.z = Math.sin(t * 1.1) * 0.08;
    g.position.y = Math.abs(Math.sin(t * 4.4)) * 0.02;
    blinkEyes(t);
  };
  return g;
}

// -------------------------------------------------------------- registry


// ---------------------------------------------------------- Eisberg-Bucht

function walross(size) {
  const g = new THREE.Group();
  const skinM = mat(0xb08268, { roughness: 0.7 });
  const bellyM = mat(0xd9b393, { roughness: 0.72 });
  const len = size * 0.92;

  const body = add(g, new THREE.SphereGeometry(0.5, 16, 12), skinM, 0.1, 0.42, 0);
  body.scale.set(len * 0.95, 0.82, 0.95);
  add(g, new THREE.SphereGeometry(0.42, 14, 10), bellyM, 0, 0.32, 0).scale.set(len * 0.8, 0.62, 0.82);
  // head with jowly cheeks
  const head = new THREE.Group();
  head.position.set(-len * 0.42, 0.56, 0);
  add(head, new THREE.SphereGeometry(0.3, 14, 10), skinM, 0, 0, 0);
  for (const s of [-1, 1]) add(head, new THREE.SphereGeometry(0.13, 10, 8), bellyM, -0.16, -0.08, s * 0.12);
  // proud tusks
  const tuskM = mat(0xf7f2e2, { roughness: 0.35 });
  for (const s of [-1, 1]) {
    const tusk = add(head, new THREE.CylinderGeometry(0.035, 0.02, 0.3, 6), tuskM, -0.18, -0.24, s * 0.09);
    tusk.rotation.x = s * 0.12;
    tusk.rotation.z = 0.25;
  }
  const eyes = makeEyes(head, -0.2, 0.12, 0, 0.14, 0.07);
  // whisker dots
  for (const s of [-1, 1]) for (let i = 0; i < 2; i += 1) add(head, new THREE.SphereGeometry(0.02, 6, 5), mat(0x6b4a34), -0.26, -0.1 + i * 0.05, s * 0.1);
  g.add(head);
  // flippers + tail
  for (const s of [-1, 1]) {
    const fl = add(g, new THREE.SphereGeometry(0.16, 8, 6), skinM, -len * 0.1, 0.16, s * 0.42);
    fl.scale.set(1.6, 0.4, 0.8);
  }
  const tail = add(g, new THREE.SphereGeometry(0.18, 8, 6), skinM, len * 0.48, 0.3, 0);
  tail.scale.set(1.2, 0.5, 1.3);

  g.userData.animate = (t) => {
    body.scale.y = 0.82 + Math.sin(t * 1.1) * 0.03; // sleepy breathing
    head.rotation.z = Math.sin(t * 0.7) * 0.08;
    tail.rotation.z = Math.sin(t * 1.3) * 0.25;
    eyes(t);
  };
  return g;
}

function pinguin(size) {
  const g = new THREE.Group();
  const bodyM = mat(0x2b3a4d, { roughness: 0.6 });
  const bellyM = mat(0xf4f8fb, { roughness: 0.5 });
  const beakM = mat(0xffb347, { roughness: 0.5 });
  const len = size * 0.9;
  // a little marching column of penguins — one per tile-ish
  const count = Math.max(2, Math.round(size));
  const birds = [];
  for (let i = 0; i < count; i += 1) {
    const p = new THREE.Group();
    p.position.x = (i - (count - 1) / 2) * (len / count);
    const body = add(p, new THREE.SphereGeometry(0.26, 12, 10), bodyM, 0, 0.34, 0);
    body.scale.set(0.9, 1.25, 0.9);
    add(p, new THREE.SphereGeometry(0.2, 10, 8), bellyM, -0.08, 0.3, 0).scale.set(0.72, 1.05, 0.8);
    add(p, new THREE.ConeGeometry(0.06, 0.14, 6), beakM, -0.24, 0.52, 0).rotation.z = Math.PI / 2;
    const eyes = makeEyes(p, -0.16, 0.58, 0, 0.09, 0.05, i);
    for (const s of [-1, 1]) {
      const wing = add(p, new THREE.SphereGeometry(0.1, 8, 6), bodyM, 0.02, 0.34, s * 0.22);
      wing.scale.set(0.5, 1.1, 0.3);
    }
    for (const s of [-1, 1]) add(p, new THREE.SphereGeometry(0.07, 6, 5), beakM, 0.02, 0.04, s * 0.09).scale.set(1.5, 0.4, 1);
    g.add(p);
    birds.push({ p, eyes, ph: i * 1.4 });
  }
  g.userData.animate = (t) => {
    for (const b of birds) {
      b.p.rotation.x = Math.sin(t * 3 + b.ph) * 0.12; // waddle
      b.p.position.y = Math.max(0, Math.sin(t * 3 + b.ph)) * 0.045;
      b.eyes(t);
    }
  };
  return g;
}

function eisbaer(size) {
  const g = new THREE.Group();
  // icy grey-blue rather than pure white, so style tints can grab it
  const furM = mat(0xc6d1d9, { roughness: 0.85 });
  const len = size * 0.9;

  const body = add(g, new THREE.SphereGeometry(0.42, 14, 10), furM, 0.08, 0.4, 0);
  body.scale.set(len * 0.85, 0.78, 0.92);
  const head = new THREE.Group();
  head.position.set(-len * 0.42, 0.52, 0);
  add(head, new THREE.SphereGeometry(0.26, 14, 10), furM, 0, 0, 0);
  add(head, new THREE.SphereGeometry(0.12, 8, 6), mat(0xe6ebef), -0.18, -0.06, 0).scale.set(1.2, 0.8, 1);
  add(head, new THREE.SphereGeometry(0.05, 6, 5), mat(0x27303d), -0.29, -0.02, 0);
  for (const s of [-1, 1]) add(head, new THREE.SphereGeometry(0.08, 8, 6), furM, 0.06, 0.22, s * 0.14);
  const eyes = makeEyes(head, -0.14, 0.1, 0, 0.12, 0.05);
  g.add(head);
  for (const s of [-1, 1]) {
    add(g, new THREE.SphereGeometry(0.13, 8, 6), furM, -len * 0.18, 0.12, s * 0.3).scale.set(1.2, 0.6, 0.8);
    add(g, new THREE.SphereGeometry(0.14, 8, 6), furM, len * 0.3, 0.12, s * 0.28).scale.set(1.2, 0.6, 0.8);
  }
  add(g, new THREE.SphereGeometry(0.09, 8, 6), furM, len * 0.48, 0.36, 0);

  g.userData.animate = (t) => {
    body.scale.y = 0.78 + Math.sin(t * 0.9) * 0.035;
    head.rotation.y = Math.sin(t * 0.5) * 0.25; // looking around for fish
    head.rotation.z = Math.sin(t * 0.8 + 1) * 0.05;
    eyes(t);
  };
  return g;
}

function schneehase(size) {
  const g = new THREE.Group();
  const furM = mat(0xffffff, { roughness: 0.8 });
  const innerM = mat(0xf5c6d0, { roughness: 0.6 });
  const width = size * 0.4 + 0.3;

  const body = add(g, new THREE.SphereGeometry(0.3, 12, 10), furM, 0.06, 0.3, 0);
  body.scale.set(width * 1.1, 0.95, 0.9);
  const head = new THREE.Group();
  head.position.set(-0.28, 0.52, 0);
  add(head, new THREE.SphereGeometry(0.18, 12, 9), furM, 0, 0, 0);
  add(head, new THREE.SphereGeometry(0.045, 6, 5), innerM, -0.17, -0.02, 0);
  const eyes = makeEyes(head, -0.1, 0.06, 0, 0.11, 0.05);
  const ears = [];
  for (const s of [-1, 1]) {
    const ear = new THREE.Group();
    ear.position.set(0.02, 0.14, s * 0.07);
    add(ear, new THREE.SphereGeometry(0.07, 8, 6), furM, 0, 0.16, 0).scale.set(0.5, 2.2, 0.7);
    add(ear, new THREE.SphereGeometry(0.045, 6, 5), innerM, -0.02, 0.16, 0).scale.set(0.4, 1.8, 0.5);
    ear.rotation.z = -0.15 + s * 0.05;
    head.add(ear);
    ears.push(ear);
  }
  g.add(head);
  add(g, new THREE.SphereGeometry(0.12, 8, 6), furM, 0.34, 0.32, 0); // puff tail
  for (const s of [-1, 1]) add(g, new THREE.SphereGeometry(0.1, 8, 6), furM, 0.12, 0.08, s * 0.16).scale.set(1.6, 0.5, 0.7);

  g.userData.animate = (t) => {
    const hop = Math.max(0, Math.sin(t * 1.6)) ** 10;
    g.position.y = hop * 0.18;
    for (const [i, ear] of ears.entries()) ear.rotation.x = Math.sin(t * 2.2 + i) * 0.12;
    head.rotation.z = Math.sin(t * 1.1) * 0.06; // nose twitch vibe
    eyes(t);
  };
  return g;
}

function schneemann(size) {
  const g = new THREE.Group();
  const snowM = mat(0xf7fafc, { roughness: 0.85 });
  const width = size * 0.36 + 0.3;

  const base = add(g, new THREE.SphereGeometry(0.3, 12, 10), snowM, 0, 0.26, 0);
  base.scale.setScalar(width * 1.05);
  const mid = add(g, new THREE.SphereGeometry(0.22, 12, 10), snowM, 0, 0.62, 0);
  const head = new THREE.Group();
  head.position.set(0, 0.92, 0);
  add(head, new THREE.SphereGeometry(0.16, 12, 9), snowM, 0, 0, 0);
  const carrot = add(head, new THREE.ConeGeometry(0.05, 0.22, 7), mat(0xff8c42, { roughness: 0.5 }), -0.2, 0, 0);
  carrot.rotation.z = Math.PI / 2;
  const eyes = makeEyes(head, -0.1, 0.06, 0, 0.08, 0.04);
  // bucket hat
  const hat = add(head, new THREE.CylinderGeometry(0.12, 0.15, 0.14, 10), mat(0x3d6ea6, { roughness: 0.5 }), 0.02, 0.17, 0);
  hat.rotation.z = -0.15;
  g.add(head);
  // coal buttons + twig arms
  for (let i = 0; i < 3; i += 1) add(g, new THREE.SphereGeometry(0.03, 6, 5), mat(0x27303d), -0.2 - i * 0.004, 0.52 + i * 0.14, 0);
  const twigM = mat(0x6b4a2f, { roughness: 0.9 });
  const arms = [];
  for (const s of [-1, 1]) {
    const arm = add(g, new THREE.CylinderGeometry(0.02, 0.03, 0.4, 5), twigM, 0, 0.66, s * 0.3);
    arm.rotation.x = s * (Math.PI / 2.5);
    arms.push(arm);
  }

  g.userData.animate = (t) => {
    g.rotation.y = Math.sin(t * 0.6) * 0.08; // gentle sway
    head.rotation.z = Math.sin(t * 0.9 + 1) * 0.07;
    for (const [i, arm] of arms.entries()) arm.rotation.z = Math.sin(t * 1.4 + i * 2) * 0.15;
    mid.scale.setScalar(1 + Math.sin(t * 1.1) * 0.02);
    eyes(t);
  };
  return g;
}

// ------------------------------------------------------------ Glut-Insel

function drache(size) {
  const g = new THREE.Group();
  const scaleM = mat(0xc0392b, { roughness: 0.55 });
  const bellyM = mat(0xf2b26a, { roughness: 0.6 });
  const wingM = mat(0xe67e22, { roughness: 0.5, side: THREE.DoubleSide });
  const len = size * 0.92;

  const segs = [];
  const n = 4;
  for (let i = 0; i < n; i += 1) {
    const s = add(g, new THREE.SphereGeometry(0.3 - i * 0.035, 12, 9), scaleM, -len / 2 + 0.35 + (i * (len - 0.7)) / (n - 1), 0.4, 0);
    segs.push(s);
  }
  add(g, new THREE.SphereGeometry(0.22, 10, 8), bellyM, -len / 2 + 0.35, 0.28, 0).scale.set(1.4, 0.7, 0.9);
  // head with tiny horns + snout
  const head = new THREE.Group();
  head.position.set(-len / 2 + 0.05, 0.56, 0);
  add(head, new THREE.SphereGeometry(0.24, 12, 9), scaleM, 0, 0, 0);
  add(head, new THREE.SphereGeometry(0.13, 8, 6), bellyM, -0.18, -0.06, 0).scale.set(1.3, 0.7, 1);
  for (const s of [-1, 1]) add(head, new THREE.ConeGeometry(0.05, 0.16, 6), mat(0xf7f2e2), 0.05, 0.22, s * 0.1);
  const eyes = makeEyes(head, -0.12, 0.1, 0, 0.13, 0.055);
  // nostril smoke puffs
  const smokeM = mat(0xcccccc, { transparent: true, opacity: 0.5 });
  const puffs = [];
  for (const s of [-1, 1]) puffs.push(add(head, new THREE.SphereGeometry(0.05, 6, 5), smokeM, -0.3, 0, s * 0.06));
  g.add(head);
  // wings
  const wings = [];
  for (const s of [-1, 1]) {
    const wing = add(g, new THREE.ConeGeometry(0.34, 0.7, 4), wingM, 0, 0.62, s * 0.24);
    wing.rotation.x = s * (Math.PI / 3);
    wing.rotation.z = 0.3;
    wings.push(wing);
  }
  // tail spike
  add(g, new THREE.ConeGeometry(0.08, 0.24, 5), scaleM, len / 2 + 0.08, 0.4, 0).rotation.z = -Math.PI / 2;

  g.userData.animate = (t) => {
    for (const [i, wseg] of segs.entries()) wseg.position.y = 0.4 + Math.sin(t * 1.6 + i * 0.9) * 0.05;
    for (const [i, wing] of wings.entries()) wing.rotation.z = 0.3 + Math.sin(t * 2.2 + i) * 0.35;
    for (const [i, p] of puffs.entries()) {
      const c = (t * 0.7 + i * 0.5) % 1;
      p.position.y = c * 0.2;
      p.material.opacity = 0.5 * (1 - c);
      p.scale.setScalar(0.7 + c);
    }
    head.rotation.z = Math.sin(t * 0.9) * 0.06;
    eyes(t);
  };
  return g;
}

function phoenix(size) {
  const g = new THREE.Group();
  const bodyM = mat(0xe67e22, { roughness: 0.5 });
  const flameM = mat(0xffd447, { emissive: 0xff8c1a, emissiveIntensity: 0.8, roughness: 0.4 });
  const len = size * 0.88;

  const body = add(g, new THREE.SphereGeometry(0.3, 12, 10), bodyM, 0, 0.42, 0);
  body.scale.set(len * 0.7, 0.9, 0.8);
  const head = new THREE.Group();
  head.position.set(-len * 0.34, 0.62, 0);
  add(head, new THREE.SphereGeometry(0.16, 12, 9), bodyM, 0, 0, 0);
  add(head, new THREE.ConeGeometry(0.05, 0.14, 6), mat(0xffc94d), -0.17, -0.02, 0).rotation.z = Math.PI / 2;
  const eyes = makeEyes(head, -0.09, 0.05, 0, 0.1, 0.045);
  // flame crest
  const crest = [];
  for (let i = 0; i < 3; i += 1) {
    const f = add(head, new THREE.ConeGeometry(0.05 - i * 0.01, 0.18, 5), flameM, 0.03 + i * 0.05, 0.16 + i * 0.02, 0);
    f.rotation.z = -0.4 - i * 0.25;
    crest.push(f);
  }
  g.add(head);
  // fiery tail feathers
  const tail = [];
  for (let i = -1; i <= 1; i += 1) {
    const f = add(g, new THREE.ConeGeometry(0.07, 0.5, 5), flameM, len * 0.42, 0.42 + i * 0.06, i * 0.12);
    f.rotation.z = -Math.PI / 2 + i * 0.15;
    tail.push(f);
  }
  const wings = [];
  for (const s of [-1, 1]) {
    const wing = add(g, new THREE.SphereGeometry(0.2, 8, 6), bodyM, 0.02, 0.46, s * 0.28);
    wing.scale.set(1.4, 0.35, 0.7);
    wings.push(wing);
  }

  g.userData.animate = (t) => {
    for (const [i, f] of crest.entries()) f.scale.y = 1 + Math.sin(t * 5 + i) * 0.25;
    for (const [i, f] of tail.entries()) {
      f.scale.y = 1 + Math.sin(t * 4 + i * 1.3) * 0.18;
      f.material.emissiveIntensity = 0.8 + Math.sin(t * 6 + i) * 0.3;
    }
    for (const [i, w] of wings.entries()) w.rotation.x = Math.sin(t * 2.4 + i * Math.PI) * 0.25;
    body.position.y = 0.42 + Math.sin(t * 1.3) * 0.05;
    head.position.y = 0.62 + Math.sin(t * 1.3) * 0.05;
    eyes(t);
  };
  return g;
}

function salamander(size) {
  const g = new THREE.Group();
  const skinM = mat(0x2f2438, { roughness: 0.6 });
  const spotM = mat(0xffb347, { emissive: 0xff8c1a, emissiveIntensity: 0.45, roughness: 0.5 });
  const len = size * 0.92;

  const body = add(g, new THREE.SphereGeometry(0.24, 12, 9), skinM, 0, 0.24, 0);
  body.scale.set(len * 1.05, 0.6, 0.85);
  // glowing spots along the back
  const spots = [];
  for (let i = 0; i < 4; i += 1) {
    spots.push(add(g, new THREE.SphereGeometry(0.06, 8, 6), spotM, -len * 0.32 + i * (len * 0.21), 0.4, (i % 2 ? 1 : -1) * 0.06));
  }
  const head = new THREE.Group();
  head.position.set(-len * 0.5, 0.26, 0);
  add(head, new THREE.SphereGeometry(0.17, 12, 9), skinM, 0, 0, 0).scale.set(1.2, 0.8, 1);
  const eyes = makeEyes(head, -0.1, 0.1, 0, 0.11, 0.05);
  smile(head, -0.19, -0.02, 0, 0.09);
  g.add(head);
  const tail = add(g, new THREE.ConeGeometry(0.1, 0.5, 6), skinM, len * 0.52, 0.2, 0);
  tail.rotation.z = -Math.PI / 2;
  for (const s of [-1, 1]) for (const fx of [-0.3, 0.3]) {
    add(g, new THREE.SphereGeometry(0.07, 6, 5), skinM, len * fx, 0.08, s * 0.24).scale.set(1.3, 0.5, 0.7);
  }

  g.userData.animate = (t) => {
    tail.rotation.y = Math.sin(t * 2.1) * 0.4; // curvy tail wag
    for (const [i, sp] of spots.entries()) sp.material.emissiveIntensity = 0.45 + Math.sin(t * 3 + i * 1.4) * 0.3;
    head.rotation.y = Math.sin(t * 1.2) * 0.15;
    body.scale.y = 0.6 + Math.sin(t * 1.5) * 0.03;
    eyes(t);
  };
  return g;
}

function lavaschnecke(size) {
  const g = new THREE.Group();
  const bodyM = mat(0xd35400, { roughness: 0.6 });
  const shellM = mat(0x8c2f1a, { emissive: 0xff5f2a, emissiveIntensity: 0.5, roughness: 0.45 });
  const width = size * 0.42 + 0.3;

  const foot = add(g, new THREE.SphereGeometry(0.24, 12, 9), bodyM, -0.08, 0.18, 0);
  foot.scale.set(width * 1.5, 0.5, 0.8);
  // glowing spiral shell
  const shell = new THREE.Group();
  shell.position.set(0.12, 0.44, 0);
  const spiral = add(shell, new THREE.TorusGeometry(0.2, 0.11, 8, 18), shellM, 0, 0, 0);
  add(shell, new THREE.TorusGeometry(0.09, 0.06, 6, 12), shellM, 0.04, 0.07, 0);
  g.add(shell);
  // eye stalks
  const stalks = [];
  for (const s of [-1, 1]) {
    const stalk = new THREE.Group();
    stalk.position.set(-width * 0.55, 0.3, s * 0.08);
    add(stalk, new THREE.CylinderGeometry(0.025, 0.035, 0.22, 5), bodyM, 0, 0.1, 0);
    const eye = add(stalk, new THREE.SphereGeometry(0.06, 8, 6), mat(0xffffff, { roughness: 0.35 }), 0, 0.24, 0);
    add(stalk, new THREE.SphereGeometry(0.03, 6, 5), mat(0x27303d), -0.03, 0.26, 0);
    stalk.rotation.z = -0.3;
    g.add(stalk);
    stalks.push(stalk);
  }

  g.userData.animate = (t) => {
    for (const [i, st] of stalks.entries()) st.rotation.z = -0.3 + Math.sin(t * 1.8 + i * 2) * 0.2;
    spiral.material.emissiveIntensity = 0.5 + Math.sin(t * 2.4) * 0.25;
    foot.scale.x = width * 1.5 + Math.sin(t * 1.2) * 0.06; // inchworm scoot
    shell.rotation.z = Math.sin(t * 1.2 + 1) * 0.06;
  };
  return g;
}

function feuerkaefer(size) {
  const g = new THREE.Group();
  const shellM = mat(0x8c2f1a, { roughness: 0.5 });
  const emberM = mat(0xffd447, { emissive: 0xff8c1a, emissiveIntensity: 0.9, roughness: 0.4 });
  const width = size * 0.4 + 0.3;

  // glowing body under split wing shells
  const belly = add(g, new THREE.SphereGeometry(0.26, 12, 9), emberM, 0, 0.26, 0);
  belly.scale.set(width, 0.7, 0.9);
  const shells = [];
  for (const s of [-1, 1]) {
    const wing = add(g, new THREE.SphereGeometry(0.28, 12, 9, 0, Math.PI), shellM, 0.02, 0.3, 0);
    wing.rotation.x = s > 0 ? 0 : Math.PI;
    wing.rotation.y = -0.15;
    wing.scale.set(width * 0.95, 0.75, 0.85);
    shells.push(wing);
  }
  const head = new THREE.Group();
  head.position.set(-width * 0.62, 0.26, 0);
  add(head, new THREE.SphereGeometry(0.14, 10, 8), shellM, 0, 0, 0);
  const eyes = makeEyes(head, -0.07, 0.05, 0, 0.1, 0.045);
  for (const s of [-1, 1]) {
    const feeler = add(head, new THREE.CylinderGeometry(0.015, 0.015, 0.2, 4), shellM, -0.08, 0.14, s * 0.06);
    feeler.rotation.z = 0.5;
  }
  g.add(head);
  for (const s of [-1, 1]) for (const fx of [-0.2, 0.15]) {
    add(g, new THREE.CylinderGeometry(0.02, 0.02, 0.16, 4), shellM, fx, 0.1, s * (0.22 + Math.abs(fx) * 0.3)).rotation.x = s * 0.7;
  }

  g.userData.animate = (t) => {
    const flick = Math.max(0, Math.sin(t * 1.1)) ** 6;
    for (const [i, sh] of shells.entries()) sh.rotation.z = flick * 0.35 * (i ? 1 : -1);
    belly.material.emissiveIntensity = 0.9 + Math.sin(t * 4) * 0.35 + flick * 0.6;
    head.rotation.z = Math.sin(t * 1.6) * 0.08;
    eyes(t);
  };
  return g;
}

// -------------------------------------------------------------- Piraten
// Real ships at last — weathered wood, patched sails, cheeky faces on
// the bow. Hulls point -X like every creature's head.

// shared: a chunky box hull with a pointed prow — the prow is a
// 45°-turned cube whose side corners sit exactly flush with the hull
// walls, so the tip reads clean from every angle. Face on the prow.
function pirateHull(g, len, hullColor, { beam = 0.5, faceY = 0.42 } = {}) {
  const hullM = mat(hullColor, { roughness: 0.85 });
  const w = beam * 1.9;
  const bodyLen = len * 0.86;
  add(g, new THREE.BoxGeometry(bodyLen, 0.34, w), hullM, 0, 0.3, 0);
  const prow = add(g, new THREE.BoxGeometry(w * 0.71, 0.34, w * 0.71), hullM, -bodyLen / 2, 0.3, 0);
  prow.rotation.y = Math.PI / 4;
  // lighter deck planks + a slim dark gunwale band
  add(g, new THREE.BoxGeometry(bodyLen, 0.05, w * 0.8), mat(0x9a6b3f, { roughness: 0.9 }), 0, 0.49, 0);
  add(g, new THREE.BoxGeometry(bodyLen * 1.02, 0.07, w * 1.05), mat(0x6b4423), 0, 0.44, 0);
  // cheeky face right on the prow's angled cheeks
  const blinkEyes = makeEyes(g, -bodyLen / 2 - w * 0.16, faceY, 0, 0.2, 0.095);
  smile(g, -bodyLen / 2 - w * 0.32, faceY - 0.16, 0, 0.11);
  return blinkEyes;
}

function pirateSail(g, x, h, w, color = 0xf3e6c8) {
  add(g, new THREE.CylinderGeometry(0.035, 0.05, h, 6), mat(0x6b4423), x, 0.45 + h / 2, 0);
  // a billowing sheet: an open cylinder slice bulging toward the bow
  const sail = new THREE.Mesh(
    new THREE.CylinderGeometry(0.55, 0.55, h * 0.6, 12, 1, true, Math.PI * 1.125, Math.PI * 0.75),
    mat(color, { roughness: 0.9, side: THREE.DoubleSide })
  );
  sail.position.set(x + 0.1, 0.52 + h * 0.52, 0);
  sail.scale.set(w * 1.5, 1, w * 1.5);
  sail.userData.bx = w * 1.5; // billow animations scale around this
  g.add(sail);
  // a friendly star flag instead of grim symbols
  const flag = add(g, new THREE.PlaneGeometry(0.26, 0.16), mat(0xffcc33, { side: THREE.DoubleSide }), x + 0.14, 0.5 + h, 0);
  flag.rotation.y = Math.PI / 2;
  return { sail, flag };
}

function galeone(size) {
  const g = new THREE.Group();
  const len = size * 0.92;
  const blinkEyes = pirateHull(g, len, 0x7a4a26, { beam: 0.55 });
  // raised stern castle
  add(g, new THREE.BoxGeometry(len * 0.24, 0.3, 0.8), mat(0x8a5a2b), len * 0.34, 0.62, 0);
  add(g, new THREE.BoxGeometry(len * 0.16, 0.16, 0.6), mat(0x6b4423), len * 0.38, 0.86, 0);
  const rig = [pirateSail(g, -len * 0.22, 1.25, 0.5), pirateSail(g, len * 0.06, 1.5, 0.6), pirateSail(g, len * 0.3, 1.0, 0.4)];
  // golden tooth figurehead glint
  add(g, new THREE.OctahedronGeometry(0.09, 0), mat(0xffcc33, { emissive: 0xaa7700, emissiveIntensity: 0.5 }), -len * 0.52, 0.56, 0);
  g.userData.animate = (t) => {
    g.rotation.z = Math.sin(t * 1.1) * 0.03;
    g.rotation.x = Math.sin(t * 0.8 + 1) * 0.025;
    rig.forEach(({ sail, flag }, i) => {
      sail.scale.x = sail.userData.bx * (1 + Math.sin(t * 1.6 + i) * 0.1);
      flag.rotation.x = Math.sin(t * 3 + i) * 0.3;
    });
    blinkEyes(t);
  };
  return g;
}

function segler(size) {
  const g = new THREE.Group();
  const len = size * 0.9;
  const blinkEyes = pirateHull(g, len, 0x8a5a2b, { beam: 0.45 });
  const rig = [pirateSail(g, -len * 0.12, 1.3, 0.5), pirateSail(g, len * 0.22, 0.95, 0.38)];
  // one patched sail — a proper pirate look
  add(g, new THREE.PlaneGeometry(0.2, 0.16), mat(0x9a6b3f, { side: THREE.DoubleSide }), -len * 0.12 + 0.26, 1.15, 0.02).rotation.y = Math.PI / 2;
  g.userData.animate = (t) => {
    g.rotation.z = Math.sin(t * 1.3) * 0.04;
    rig.forEach(({ sail, flag }, i) => {
      sail.scale.x = sail.userData.bx * (1 + Math.sin(t * 1.8 + i * 2) * 0.12);
      flag.rotation.x = Math.sin(t * 3.4 + i) * 0.35;
    });
    blinkEyes(t);
  };
  return g;
}

function ruderboot(size) {
  const g = new THREE.Group();
  const len = size * 0.88;
  const blinkEyes = pirateHull(g, len, 0x9a6b3f, { beam: 0.4, faceY: 0.4 });
  // two pairs of oars, pivoting at the gunwale, dipped toward the water
  const oars = [];
  for (const [dx, s] of [[-len * 0.15, -1], [-len * 0.15, 1], [len * 0.15, -1], [len * 0.15, 1]]) {
    const oar = new THREE.Group();
    oar.position.set(dx, 0.48, s * 0.4);
    const shaft = add(oar, new THREE.CylinderGeometry(0.028, 0.028, 0.9, 6), mat(0x6b4423), 0, 0, s * 0.45);
    shaft.rotation.x = Math.PI / 2; // shaft reaches straight outboard
    const blade = add(oar, new THREE.SphereGeometry(0.09, 6, 5), mat(0x6b4423), 0, 0, s * 0.92);
    blade.scale.set(0.45, 0.18, 1.4);
    oar.rotation.x = s * 0.35; // resting dip into the water
    g.add(oar);
    oars.push({ oar, s });
  }
  // a little bench + lantern
  add(g, new THREE.BoxGeometry(0.14, 0.06, 0.7), mat(0x6b4423), 0, 0.46, 0);
  add(g, new THREE.SphereGeometry(0.08, 8, 6), mat(0xffe066, { emissive: 0xffaa00, emissiveIntensity: 0.8 }), len * 0.4, 0.6, 0);
  g.userData.animate = (t) => {
    for (const { oar, s } of oars) {
      oar.rotation.x = s * (0.35 + Math.sin(t * 2.6 + s) * 0.18); // dip …
      oar.rotation.y = Math.cos(t * 2.6 + s) * 0.22; // … and stroke
    }
    g.rotation.z = Math.sin(t * 1.4) * 0.03;
    g.position.y = Math.sin(t * 1.8) * 0.03;
    blinkEyes(t);
  };
  return g;
}

function fassfloss(size) {
  const g = new THREE.Group();
  const len = size * 0.86;
  // a raft of lashed barrels
  const barrelM = mat(0x8a5a2b, { roughness: 0.9 });
  const bandM = mat(0x3a3f4a, { metalness: 0.4, roughness: 0.5 });
  for (let i = 0; i < 3; i += 1) {
    const x = (i - 1) * len * 0.33;
    const barrel = add(g, new THREE.CylinderGeometry(0.24, 0.24, 0.8, 10), barrelM, x, 0.26, 0);
    barrel.rotation.x = Math.PI / 2;
    barrel.scale.y = 1.08;
    for (const bz of [-0.25, 0.25]) {
      const band = add(g, new THREE.TorusGeometry(0.25, 0.025, 6, 12), bandM, x, 0.26, bz);
      band.rotation.x = 0;
    }
  }
  add(g, new THREE.BoxGeometry(len * 0.95, 0.05, 0.5), mat(0x9a6b3f), 0, 0.55, 0);
  const rig = pirateSail(g, 0, 0.85, 0.3);
  const blinkEyes = makeEyes(g, -len * 0.42, 0.42, 0, 0.16, 0.07);
  smile(g, -len * 0.46, 0.28, 0, 0.08);
  g.userData.animate = (t) => {
    g.rotation.x = Math.sin(t * 1.7) * 0.05;
    g.position.y = Math.sin(t * 1.5) * 0.03;
    rig.sail.scale.x = rig.sail.userData.bx * (1 + Math.sin(t * 2) * 0.12);
    rig.flag.rotation.x = Math.sin(t * 3.2) * 0.35;
    blinkEyes(t);
  };
  return g;
}

function beiboot(size) {
  const g = new THREE.Group();
  const len = size * 0.85;
  const blinkEyes = pirateHull(g, len, 0x7a4a26, { beam: 0.42, faceY: 0.4 });
  // tiny mast, big flag, a stowed treasure sack
  const rig = pirateSail(g, len * 0.05, 0.75, 0.28);
  const sack = add(g, new THREE.SphereGeometry(0.16, 8, 6), mat(0xc4a05a, { roughness: 0.95 }), len * 0.32, 0.5, 0);
  sack.scale.y = 1.2;
  g.userData.animate = (t) => {
    g.rotation.z = Math.sin(t * 1.9) * 0.05;
    g.position.y = Math.sin(t * 2.1) * 0.035;
    rig.flag.rotation.x = Math.sin(t * 4) * 0.4;
    sack.rotation.y = Math.sin(t * 1.2) * 0.1;
    blinkEyes(t);
  };
  return g;
}

// --------------------------------------------------------------- Marine
// The harbor fleet: crisp hulls, red trim, proud little machines.

function marineHull(g, len, hullColor, deckColor = 0xd8dce2) {
  const hullM = mat(hullColor, { roughness: 0.6 });
  const w = 0.84;
  const bodyLen = len * 0.86;
  add(g, new THREE.BoxGeometry(bodyLen, 0.32, w), hullM, 0, 0.28, 0);
  const prow = add(g, new THREE.BoxGeometry(w * 0.71, 0.32, w * 0.71), hullM, -bodyLen / 2, 0.28, 0);
  prow.rotation.y = Math.PI / 4;
  add(g, new THREE.BoxGeometry(bodyLen, 0.07, w * 0.9), mat(deckColor, { roughness: 0.55 }), 0, 0.46, 0);
  // crisp waterline stripe all around
  add(g, new THREE.BoxGeometry(bodyLen * 1.01, 0.05, w * 1.03), mat(0xd8483c, { roughness: 0.55 }), 0, 0.14, 0);
  const blinkEyes = makeEyes(g, -bodyLen / 2 - w * 0.16, 0.36, 0, 0.19, 0.09);
  smile(g, -bodyLen / 2 - w * 0.32, 0.2, 0, 0.1);
  return blinkEyes;
}

function flaggschiff(size) {
  const g = new THREE.Group();
  const len = size * 0.92;
  const blinkEyes = marineHull(g, len, 0x2a4d7e);
  // bridge + two proud funnels with drifting smoke
  add(g, new THREE.BoxGeometry(len * 0.3, 0.3, 0.6), mat(0xd8dce2, { roughness: 0.5 }), -len * 0.08, 0.68, 0);
  add(g, new THREE.BoxGeometry(len * 0.18, 0.2, 0.44), mat(0xc2c8d2), -len * 0.08, 0.92, 0);
  const puffs = [];
  for (const fx of [len * 0.14, len * 0.3]) {
    add(g, new THREE.CylinderGeometry(0.11, 0.14, 0.5, 10), mat(0xd8483c), fx, 0.78, 0);
    add(g, new THREE.CylinderGeometry(0.12, 0.12, 0.1, 10), mat(0x27303d), fx, 1.02, 0);
    for (let i = 0; i < 2; i += 1) {
      puffs.push(
        add(g, new THREE.SphereGeometry(0.09 + i * 0.03, 8, 6), mat(0xe8ecf2, { transparent: true, opacity: 0.7 }), fx, 1.15, 0)
      );
    }
  }
  // signal mast with pennant
  add(g, new THREE.CylinderGeometry(0.025, 0.035, 0.9, 6), mat(0xc2c8d2), -len * 0.3, 0.9, 0);
  const pennant = add(g, new THREE.PlaneGeometry(0.24, 0.12), mat(0xff5f6d, { side: THREE.DoubleSide }), -len * 0.3 + 0.12, 1.3, 0);
  pennant.rotation.y = Math.PI / 2;
  g.userData.animate = (t) => {
    g.rotation.z = Math.sin(t * 0.9) * 0.02;
    puffs.forEach((p, i) => {
      const k = (t * 0.5 + i * 0.5) % 1;
      p.position.y = 1.15 + k * 0.55;
      p.material.opacity = 0.7 * (1 - k);
      p.scale.setScalar(0.8 + k * 1.1);
    });
    pennant.rotation.x = Math.sin(t * 3) * 0.3;
    blinkEyes(t);
  };
  return g;
}

function schlepper(size) {
  const g = new THREE.Group();
  const len = size * 0.88;
  const blinkEyes = marineHull(g, len, 0xd8483c, 0xe4e8ee);
  // chunky wheelhouse + tire fenders — the classic harbor buddy
  add(g, new THREE.BoxGeometry(len * 0.3, 0.34, 0.56), mat(0xe4e8ee, { roughness: 0.5 }), 0, 0.7, 0);
  add(g, new THREE.CylinderGeometry(0.09, 0.11, 0.34, 8), mat(0x27303d), len * 0.22, 0.7, 0);
  const fenders = [];
  for (const [fx, s] of [[-len * 0.2, -1], [-len * 0.2, 1], [len * 0.14, -1], [len * 0.14, 1]]) {
    const tire = add(g, new THREE.TorusGeometry(0.11, 0.045, 8, 12), mat(0x27303d, { roughness: 0.9 }), fx, 0.3, s * 0.46);
    fenders.push(tire);
  }
  const puff = add(g, new THREE.SphereGeometry(0.1, 8, 6), mat(0xe8ecf2, { transparent: true, opacity: 0.7 }), len * 0.22, 0.95, 0);
  g.userData.animate = (t) => {
    g.rotation.z = Math.sin(t * 1.5) * 0.035;
    g.position.y = Math.sin(t * 1.7) * 0.025;
    const k = (t * 0.7) % 1;
    puff.position.y = 0.95 + k * 0.4;
    puff.material.opacity = 0.7 * (1 - k);
    puff.scale.setScalar(0.7 + k);
    blinkEyes(t);
  };
  return g;
}

function uboot(size) {
  const g = new THREE.Group();
  const len = size * 0.9;
  const hullM = mat(0x5a6e86, { roughness: 0.5, metalness: 0.15 });
  const body = add(g, new THREE.SphereGeometry(0.42, 14, 10), hullM, 0, 0.34, 0);
  body.scale.set(len * 0.95, 0.75, 0.8);
  // conning tower + wiggling periscope
  add(g, new THREE.CylinderGeometry(0.18, 0.22, 0.3, 10), hullM, -len * 0.06, 0.72, 0);
  const scope = new THREE.Group();
  scope.position.set(-len * 0.06, 0.87, 0);
  add(scope, new THREE.CylinderGeometry(0.035, 0.035, 0.34, 6), mat(0xc2c8d2), 0, 0.17, 0);
  add(scope, new THREE.BoxGeometry(0.16, 0.07, 0.07), mat(0xc2c8d2), -0.06, 0.36, 0);
  g.add(scope);
  // porthole rivets + red nose stripe
  for (const px of [-len * 0.28, -len * 0.02, len * 0.24]) {
    add(g, new THREE.TorusGeometry(0.07, 0.02, 6, 10), mat(0xffd447), px, 0.4, 0.32).rotation.y = 0.35;
  }
  add(g, new THREE.SphereGeometry(0.2, 8, 6), mat(0xd8483c), -len * 0.4, 0.34, 0).scale.set(0.8, 0.75, 0.75);
  // propeller
  const prop = new THREE.Group();
  prop.position.set(len * 0.48, 0.34, 0);
  for (let i = 0; i < 3; i += 1) {
    const blade = add(prop, new THREE.SphereGeometry(0.1, 6, 5), mat(0xffd447), 0, 0.09, 0);
    blade.scale.set(0.25, 1.2, 0.5);
    const holder = new THREE.Group();
    holder.rotation.x = (i / 3) * Math.PI * 2;
    holder.add(blade);
    prop.add(holder);
  }
  g.add(prop);
  const blinkEyes = makeEyes(g, -len * 0.29, 0.5, 0, 0.17, 0.08);
  smile(g, -len * 0.33, 0.36, 0, 0.09);
  g.userData.animate = (t) => {
    prop.rotation.x = t * 6;
    scope.rotation.y = Math.sin(t * 0.9) * 0.9;
    g.position.y = Math.sin(t * 1.3) * 0.04;
    g.rotation.z = Math.sin(t * 1.0) * 0.02;
    blinkEyes(t);
  };
  return g;
}

function rettungsboot(size) {
  const g = new THREE.Group();
  const len = size * 0.86;
  const blinkEyes = marineHull(g, len, 0xf28c28, 0xe4e8ee);
  // white safety stripe + a life ring on the side
  add(g, new THREE.BoxGeometry(len * 0.92, 0.07, 0.9), mat(0xe4e8ee), 0, 0.36, 0);
  const ring = add(g, new THREE.TorusGeometry(0.14, 0.05, 8, 14), mat(0xe4e8ee), 0, 0.52, 0.42);
  ring.rotation.y = 0.2;
  for (let i = 0; i < 4; i += 1) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    add(g, new THREE.SphereGeometry(0.045, 6, 5), mat(0xd8483c), Math.cos(a) * 0.14, 0.52 + Math.sin(a) * 0.14, 0.46);
  }
  // small cabin with a spinning rescue beacon
  add(g, new THREE.BoxGeometry(len * 0.24, 0.22, 0.5), mat(0xe4e8ee), len * 0.1, 0.62, 0);
  const beacon = add(g, new THREE.SphereGeometry(0.07, 8, 6), mat(0xff5f6d, { emissive: 0xff2233, emissiveIntensity: 1 }), len * 0.1, 0.8, 0);
  g.userData.animate = (t) => {
    g.rotation.z = Math.sin(t * 1.8) * 0.045;
    g.position.y = Math.sin(t * 2) * 0.03;
    beacon.material.emissiveIntensity = 0.5 + Math.max(0, Math.sin(t * 4)) * 0.9;
    blinkEyes(t);
  };
  return g;
}

function flitzer(size) {
  const g = new THREE.Group();
  const len = size * 0.85;
  const blinkEyes = marineHull(g, len, 0xe4e8ee, 0x2a4d7e);
  // racing stripes on the flanks, windshield, outboard motor with spray
  for (const s of [-1, 1]) {
    add(g, new THREE.BoxGeometry(len * 0.8, 0.09, 0.04), mat(0xff5f6d), 0, 0.34, s * 0.43);
  }
  const shield = add(g, new THREE.PlaneGeometry(0.44, 0.24), mat(0xbfe9ff, { transparent: true, opacity: 0.65, side: THREE.DoubleSide }), -len * 0.12, 0.58, 0);
  shield.rotation.y = Math.PI / 2;
  shield.rotation.z = -0.35;
  add(g, new THREE.BoxGeometry(0.16, 0.26, 0.14), mat(0x27303d), len * 0.44, 0.5, 0);
  const spray = [];
  for (let i = 0; i < 3; i += 1) {
    spray.push(
      add(g, new THREE.SphereGeometry(0.06, 6, 5), mat(0xcfe8ff, { transparent: true, opacity: 0.8 }), len * 0.5, 0.3, 0)
    );
  }
  g.userData.animate = (t) => {
    g.rotation.z = Math.sin(t * 2.4) * 0.05;
    g.rotation.x = Math.sin(t * 2.1) * 0.03;
    spray.forEach((p, i) => {
      const k = (t * 1.2 + i * 0.33) % 1;
      p.position.x = len * 0.5 + k * 0.35;
      p.position.y = 0.3 + Math.sin(k * Math.PI) * 0.25;
      p.material.opacity = 0.8 * (1 - k);
    });
    blinkEyes(t);
  };
  return g;
}

const BUILDERS = {
  ozean: [wal, oktopus, robbe, schildkroete, qualle],
  weltraum: [station, rakete, ufo, satellit, funkelstern],
  dino: [langhals, rexi, triceratops, flugsaurier, babyBibo],
  teich: [karpfen, ente, flossi, frosch, krabbe],
  eis: [walross, pinguin, eisbaer, schneehase, schneemann],
  vulkan: [drache, phoenix, salamander, lavaschnecke, feuerkaefer],
  piraten: [galeone, segler, ruderboot, fassfloss, beiboot],
  marine: [flaggschiff, schlepper, uboot, rettungsboot, flitzer],
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// ------------------------------------------------------- customization

// kid-friendly tint palette (null = the creature's natural colors)
export const TINTS = [null, 0xff7a6b, 0x5fb8e8, 0x8fd05f, 0xb388ff, 0xff8ac2, 0xffc94d];

// snap-on accessories, auto-anchored on top of any creature.
// Only APPEND here — saved customizations store indexes.
export const ACCESSORIES = [null, "party", "krone", "propeller", "blume", "schleife", "kappe", "zauberhut"];
export const ACCESSORY_NAMES = {
  party: "Partyhut",
  krone: "Krone",
  propeller: "Propeller",
  blume: "Blume",
  schleife: "Schleife",
  kappe: "Kappe",
  zauberhut: "Zauberhut",
};

function buildAccessory(kind) {
  const g = new THREE.Group();
  let animate = null;
  if (kind === "party") {
    const cone = add(g, new THREE.ConeGeometry(0.17, 0.42, 10), mat(0xff8ac2, { roughness: 0.55 }), 0, 0.21, 0);
    add(g, new THREE.TorusGeometry(0.17, 0.028, 6, 14), mat(0xffd447), 0, 0.02, 0).rotation.x = Math.PI / 2;
    add(g, new THREE.SphereGeometry(0.06, 8, 6), mat(0x5fb8e8), 0, 0.45, 0);
    for (const [dy, dz] of [[0.12, 0.08], [0.24, -0.06], [0.3, 0.05]]) {
      add(g, new THREE.SphereGeometry(0.03, 6, 5), mat(0xfdf6e3), 0.1, dy, dz);
    }
  } else if (kind === "krone") {
    const goldM = mat(0xffc94d, { metalness: 0.45, roughness: 0.35 });
    add(g, new THREE.CylinderGeometry(0.17, 0.19, 0.14, 10), goldM, 0, 0.07, 0);
    for (let i = 0; i < 5; i += 1) {
      const a = (i / 5) * Math.PI * 2;
      add(g, new THREE.ConeGeometry(0.05, 0.16, 5), goldM, Math.cos(a) * 0.15, 0.2, Math.sin(a) * 0.15);
    }
    add(g, new THREE.SphereGeometry(0.045, 8, 6), mat(0xe85d75, { roughness: 0.3 }), 0, 0.16, 0.14);
  } else if (kind === "propeller") {
    add(g, new THREE.SphereGeometry(0.19, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(0x5fb8e8, { roughness: 0.6 }), 0, 0, 0);
    add(g, new THREE.CylinderGeometry(0.02, 0.02, 0.14, 5), mat(0xcfd6ea), 0, 0.2, 0);
    const rotor = new THREE.Group();
    rotor.position.y = 0.28;
    for (const sd of [-1, 1]) {
      const blade = add(rotor, new THREE.BoxGeometry(0.3, 0.02, 0.08), mat(0xff7a6b), sd * 0.16, 0, 0);
      blade.rotation.y = sd * 0.12;
    }
    add(rotor, new THREE.SphereGeometry(0.035, 6, 5), mat(0xcfd6ea), 0, 0, 0);
    g.add(rotor);
    animate = (t) => {
      rotor.rotation.y = t * 9;
    };
  } else if (kind === "blume") {
    add(g, new THREE.CylinderGeometry(0.015, 0.02, 0.22, 5), mat(0x5fae4f), 0, 0.11, 0);
    for (let i = 0; i < 6; i += 1) {
      const a = (i / 6) * Math.PI * 2;
      const petal = add(g, new THREE.SphereGeometry(0.075, 8, 6), mat(0xfdf6e3, { roughness: 0.6 }), Math.cos(a) * 0.1, 0.26, Math.sin(a) * 0.1);
      petal.scale.y = 0.5;
    }
    add(g, new THREE.SphereGeometry(0.06, 8, 6), mat(0xffd447), 0, 0.27, 0);
  } else if (kind === "schleife") {
    const bowM = mat(0xe85d75, { roughness: 0.55 });
    for (const sd of [-1, 1]) {
      const loop = add(g, new THREE.SphereGeometry(0.11, 8, 6), bowM, sd * 0.12, 0.06, 0);
      loop.scale.set(1.2, 0.7, 0.5);
      loop.rotation.z = sd * 0.4;
    }
    add(g, new THREE.SphereGeometry(0.055, 8, 6), bowM, 0, 0.06, 0);
  } else if (kind === "kappe") {
    const capM = mat(0x4f8fd0, { roughness: 0.6 });
    const dome = add(g, new THREE.SphereGeometry(0.19, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), capM, 0, 0.02, 0);
    dome.scale.set(1, 0.85, 1);
    const brim = add(g, new THREE.CylinderGeometry(0.14, 0.15, 0.03, 12), capM, -0.2, 0.03, 0);
    brim.scale.set(1.5, 1, 1);
    add(g, new THREE.SphereGeometry(0.045, 8, 6), mat(0xffd447), 0, 0.19, 0);
  } else if (kind === "zauberhut") {
    const hatM = mat(0x5a4fc9, { roughness: 0.55 });
    add(g, new THREE.ConeGeometry(0.19, 0.5, 10), hatM, 0, 0.25, 0).rotation.z = -0.12;
    add(g, new THREE.TorusGeometry(0.2, 0.04, 6, 14), hatM, 0, 0.02, 0).rotation.x = Math.PI / 2;
    // little stars on the cone
    for (const [dx, dy, dz] of [[0.1, 0.18, 0.08], [-0.06, 0.32, -0.1], [0.02, 0.44, 0.05]]) {
      add(g, new THREE.OctahedronGeometry(0.035, 0), mat(0xffd447, { emissive: 0xffd447, emissiveIntensity: 0.9 }), dx, dy, dz);
    }
  }
  g.userData.animate = animate;
  return g;
}

// generic tint: shift body materials toward the chosen color while
// keeping eyes, whites and glowing bits untouched. Materials can be
// shared across meshes, so collect them first and lerp each ONCE.
function applyTint(root, tintHex) {
  const tint = new THREE.Color(tintHex);
  const mats = new Set();
  root.traverse((o) => {
    if (o.isMesh && o.material && o.material.color) mats.add(o.material);
  });
  for (const m of mats) {
    // skip only materials that actually glow (emissive intensity is 1
    // by default even on non-glowing materials — check the color too)
    const e = m.emissive;
    if (e && e.r + e.g + e.b > 0.05 && (m.emissiveIntensity ?? 1) >= 0.8) continue;
    const c = m.color;
    const max = Math.max(c.r, c.g, c.b);
    const min = Math.min(c.r, c.g, c.b);
    if (max > 0.86 && min > 0.72) continue; // whites/creams (eyes, bellies)
    if (max < 0.22) continue; // near-black (pupils)
    c.lerp(tint, 0.55);
  }
}

// Build a creature and normalize its footprint so every model clearly
// spans its `size` cells along X and stays within ~1 cell of depth.
// `custom` = { tint: index into TINTS, hat: index into ACCESSORIES }
// `shape` "sq" makes a chunky 2×2 friend instead of a line creature.
export function buildCreature(worldId, index, size, custom = null, shape = "line") {
  const builders = BUILDERS[worldId] || BUILDERS.ozean;
  const eff = shape === "sq" ? 2 : size;
  const inner = builders[index % builders.length](eff);
  if (custom && TINTS[custom.tint]) applyTint(inner, TINTS[custom.tint]);
  const bbox = new THREE.Box3().setFromObject(inner);
  const w = Math.max(0.001, bbox.max.x - bbox.min.x);
  const d = Math.max(0.001, bbox.max.z - bbox.min.z);
  const spanX = shape === "sq" ? 1.76 : size * 0.88;
  const spanZ = shape === "sq" ? 1.76 : 1.02;
  const sx = clamp(spanX / w, 0.75, 2.1);
  const sz = clamp(spanZ / d, 0.6, shape === "sq" ? 2.4 : 1);
  inner.scale.set(sx, clamp((sx + sz) / 2, 0.85, 1.25), sz);
  const wrap = new THREE.Group();
  wrap.add(inner);

  let hatAnim = null;
  const hatKind = custom ? ACCESSORIES[custom.hat] : null;
  if (hatKind) {
    const hat = buildAccessory(hatKind);
    const scaled = new THREE.Box3().setFromObject(wrap);
    // sit on the highest point, slightly toward the face (-X)
    hat.position.set((scaled.min.x + scaled.max.x) / 2 - eff * 0.12, scaled.max.y - 0.03, (scaled.min.z + scaled.max.z) / 2);
    hat.scale.setScalar(clamp(eff * 0.45, 0.85, 1.35));
    wrap.add(hat);
    hatAnim = hat.userData.animate;
  }

  const innerAnim = inner.userData.animate;
  wrap.userData.animate = (t) => {
    if (innerAnim) innerAnim(t);
    if (hatAnim) hatAnim(t);
  };
  return wrap;
}

// --------------------------------------------------------- treasure chest
// Visible on the board for BOTH players: digging it costs a turn but
// grants a Zauber-Kraft. Golden, glinting, impossible to miss.

export function buildTreasureChest(worldId = "ozean") {
  const g = new THREE.Group();
  const goldM = mat(0xffc94d, { metalness: 0.5, roughness: 0.3, emissive: 0xaa7700, emissiveIntensity: 0.35 });
  const gem = add(g, new THREE.OctahedronGeometry(0.09, 0), mat(0x7de8ff, { emissive: 0x7de8ff, emissiveIntensity: 1 }), 0, 0.46, 0);
  let lid = new THREE.Group();
  let wobble = null;

  if (worldId === "weltraum") {
    // glowing tech capsule with a sliding hatch
    const shellM = mat(0x8892a8, { metalness: 0.6, roughness: 0.3 });
    const body = add(g, new THREE.CylinderGeometry(0.26, 0.3, 0.34, 8), shellM, 0, 0.2, 0);
    body.rotation.y = Math.PI / 8;
    const stripe = add(g, new THREE.TorusGeometry(0.28, 0.035, 6, 12), mat(0x7de8ff, { emissive: 0x2fa8d8, emissiveIntensity: 0.9 }), 0, 0.2, 0);
    stripe.rotation.x = Math.PI / 2;
    lid.position.set(0, 0.38, -0.14);
    add(lid, new THREE.CylinderGeometry(0.24, 0.27, 0.1, 8), shellM, 0, 0, 0.14);
    add(lid, new THREE.SphereGeometry(0.05, 6, 5), mat(0xff5f6d, { emissive: 0xff5f6d, emissiveIntensity: 1 }), 0, 0.08, 0.14);
    wobble = (t) => {
      stripe.scale.setScalar(1 + Math.sin(t * 3.1) * 0.04);
    };
  } else if (worldId === "dino") {
    // mossy stone egg cracked open at the top, crystals poking out
    const stoneM = mat(0x9aa08a, { roughness: 0.95 });
    const egg = add(g, new THREE.SphereGeometry(0.3, 10, 8), stoneM, 0, 0.24, 0);
    egg.scale.set(1, 1.2, 0.95);
    add(g, new THREE.SphereGeometry(0.16, 8, 6), mat(0x5faf6f, { roughness: 0.9 }), 0.12, 0.42, 0.08).scale.y = 0.5;
    for (const [dx, dz, s] of [[-0.08, 0.06, 0.09], [0.1, -0.05, 0.07]]) {
      add(g, new THREE.OctahedronGeometry(s, 0), mat(0xb388ff, { emissive: 0x7a55cc, emissiveIntensity: 0.8 }), dx, 0.5, dz);
    }
    lid.position.set(0, 0.52, -0.1);
    const cap = add(lid, new THREE.SphereGeometry(0.18, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), stoneM, 0, 0, 0.1);
    cap.scale.set(1.1, 0.8, 1);
  } else if (worldId === "teich") {
    // painted clay pot with a lily-pad lid
    const clayM = mat(0xc47f5a, { roughness: 0.85 });
    const pot = add(g, new THREE.CylinderGeometry(0.24, 0.18, 0.32, 10), clayM, 0, 0.19, 0);
    pot.scale.x = 1.1;
    add(g, new THREE.TorusGeometry(0.24, 0.045, 6, 12), mat(0x8a5535, { roughness: 0.8 }), 0, 0.36, 0).rotation.x = Math.PI / 2;
    lid.position.set(0, 0.42, -0.12);
    const pad = add(lid, new THREE.CylinderGeometry(0.26, 0.24, 0.05, 12), mat(0x4da06a, { roughness: 0.6 }), 0, 0, 0.12);
    pad.scale.z = 0.9;
    add(lid, new THREE.SphereGeometry(0.07, 8, 6), mat(0xff8ac2, { roughness: 0.5 }), 0, 0.07, 0.12);
  } else if (worldId === "eis") {
    // frosted ice block with a snow cap that tips open
    const iceM = mat(0x9fe0f7, { roughness: 0.15, metalness: 0.1, emissive: 0x2a7a9a, emissiveIntensity: 0.25 });
    const block = add(g, new THREE.BoxGeometry(0.46, 0.3, 0.36), iceM, 0, 0.18, 0);
    block.rotation.y = 0.1;
    for (const [dx, dz, s] of [[-0.18, 0.12, 0.1], [0.2, -0.1, 0.08]]) {
      add(g, new THREE.OctahedronGeometry(s, 0), mat(0xdff6ff, { emissive: 0x7db8d8, emissiveIntensity: 0.6 }), dx, 0.36, dz);
    }
    lid.position.set(0, 0.36, -0.16);
    const cap = add(lid, new THREE.SphereGeometry(0.24, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), mat(0xffffff, { roughness: 0.9 }), 0, 0, 0.16);
    cap.scale.set(1.05, 0.6, 0.85);
    wobble = (t) => {
      block.rotation.y = 0.1 + Math.sin(t * 1.4) * 0.04;
    };
  } else if (worldId === "vulkan") {
    // dark lava rock with glowing cracks and an ember-lit slab lid
    const rockM = mat(0x3a2228, { roughness: 0.95 });
    const rock = add(g, new THREE.DodecahedronGeometry(0.3, 0), rockM, 0, 0.22, 0);
    rock.scale.set(1.15, 0.9, 1);
    for (const [dx, dz, a] of [[-0.12, 0.16, 0.4], [0.16, 0.1, -0.5], [0, -0.18, 1.1]]) {
      const crack = add(g, new THREE.BoxGeometry(0.2, 0.03, 0.05), mat(0xff8c42, { emissive: 0xff5a2a, emissiveIntensity: 1 }), dx, 0.26, dz);
      crack.rotation.y = a;
    }
    lid.position.set(0, 0.42, -0.12);
    const slab = add(lid, new THREE.CylinderGeometry(0.22, 0.26, 0.08, 7), rockM, 0, 0, 0.12);
    const emberEye = add(lid, new THREE.SphereGeometry(0.06, 8, 6), mat(0xffe066, { emissive: 0xffaa00, emissiveIntensity: 1 }), 0, 0.06, 0.12);
    wobble = (t) => {
      emberEye.scale.setScalar(1 + Math.max(0, Math.sin(t * 2.6)) * 0.35);
      slab.rotation.y = Math.sin(t * 0.9) * 0.05;
    };
  } else if (worldId === "piraten") {
    // the pirate's pride: a plank chest already spilling gold
    const woodM = mat(0x6b4423, { roughness: 0.9 });
    add(g, new THREE.BoxGeometry(0.5, 0.26, 0.36), woodM, 0, 0.16, 0);
    for (const bx of [-0.16, 0.16]) {
      add(g, new THREE.BoxGeometry(0.06, 0.28, 0.38), mat(0x3a3f4a, { metalness: 0.4, roughness: 0.5 }), bx, 0.16, 0);
    }
    const coins = [];
    for (const [cx, cz, s] of [[-0.08, 0.05, 0.07], [0.06, -0.06, 0.06], [0.13, 0.08, 0.05], [-0.02, 0.12, 0.05]]) {
      const coin = add(g, new THREE.CylinderGeometry(s, s, 0.03, 10), goldM, cx, 0.32, cz);
      coin.rotation.x = Math.random() * 0.5;
      coins.push(coin);
    }
    lid.position.set(0, 0.3, -0.18);
    const lidMesh = add(lid, new THREE.CylinderGeometry(0.18, 0.18, 0.48, 10, 1, false, 0, Math.PI), woodM, 0, 0, 0.18);
    lidMesh.rotation.z = Math.PI / 2;
    lid.rotation.x = -0.5; // ajar — the gold inside twinkles out
    wobble = (t) => {
      coins.forEach((c, i) => {
        c.scale.setScalar(1 + Math.max(0, Math.sin(t * 2.4 + i * 1.8)) * 0.25);
      });
    };
  } else if (worldId === "marine") {
    // a proper navy sea locker: steel, rivets, signal lamp on top
    const steelM = mat(0x2a4d7e, { metalness: 0.35, roughness: 0.45 });
    add(g, new THREE.BoxGeometry(0.5, 0.3, 0.36), steelM, 0, 0.18, 0);
    add(g, new THREE.BoxGeometry(0.52, 0.06, 0.38), mat(0xd8dce2, { metalness: 0.3, roughness: 0.4 }), 0, 0.1, 0);
    for (const [rx, rz] of [[-0.2, 0.19], [0.2, 0.19], [-0.2, -0.19], [0.2, -0.19]]) {
      add(g, new THREE.SphereGeometry(0.03, 6, 5), mat(0xc2c8d2), rx, 0.28, rz);
    }
    const lamp = add(g, new THREE.SphereGeometry(0.07, 8, 6), mat(0xff5f6d, { emissive: 0xff2233, emissiveIntensity: 1 }), 0.16, 0.4, 0);
    lid.position.set(0, 0.34, -0.18);
    add(lid, new THREE.BoxGeometry(0.5, 0.08, 0.38), steelM, 0, 0, 0.18);
    add(lid, new THREE.TorusGeometry(0.07, 0.02, 6, 10), mat(0xd8dce2), -0.14, 0.06, 0.18).rotation.x = Math.PI / 2;
    wobble = (t) => {
      lamp.material.emissiveIntensity = 0.4 + Math.max(0, Math.sin(t * 3.2)) * 1.0;
    };
  } else {
    // ozean: the classic golden-banded wooden chest
    const woodM = mat(0x8a5a2b, { roughness: 0.8 });
    add(g, new THREE.BoxGeometry(0.52, 0.26, 0.38), woodM, 0, 0.16, 0);
    lid.position.set(0, 0.29, -0.19);
    const lidMesh = add(lid, new THREE.CylinderGeometry(0.19, 0.19, 0.5, 10, 1, false, 0, Math.PI), woodM, 0, 0, 0.19);
    lidMesh.rotation.z = Math.PI / 2;
    add(g, new THREE.BoxGeometry(0.56, 0.06, 0.42), goldM, 0, 0.1, 0);
    add(g, new THREE.BoxGeometry(0.09, 0.3, 0.4), goldM, 0, 0.17, 0);
    const lock = add(g, new THREE.SphereGeometry(0.06, 8, 6), goldM, 0, 0.28, 0.2);
    wobble = (t) => {
      lock.scale.setScalar(1 + Math.max(0, Math.sin(t * 3)) * 0.25);
    };
  }

  g.add(lid);
  g.userData.lid = lid;
  g.userData.animate = (t) => {
    gem.position.y = 0.46 + Math.sin(t * 2.2) * 0.06;
    gem.rotation.y = t * 1.6;
    g.rotation.z = Math.sin(t * 1.1) * 0.03;
    if (wobble) wobble(t);
  };
  return g;
}

// ------------------------------------------------------------ power icons
// Tiny 3D sculptures for every Zauber-Kraft — no generic glyphs. They
// get rendered offscreen into crisp chip/card images.

export function buildPowerIcon(kind) {
  const g = new THREE.Group();
  const gold = () => mat(0xffc94d, { metalness: 0.4, roughness: 0.35 });
  if (kind === "welle") {
    const curl = add(g, new THREE.TorusGeometry(0.42, 0.16, 10, 20, Math.PI * 1.25), mat(0x3f8fd6, { roughness: 0.4 }), 0, 0.45, 0);
    curl.rotation.z = Math.PI * 0.1;
    add(g, new THREE.SphereGeometry(0.13, 8, 6), mat(0xeaf7ff, { roughness: 0.3 }), 0.45, 0.75, 0);
    add(g, new THREE.SphereGeometry(0.09, 8, 6), mat(0xeaf7ff, { roughness: 0.3 }), 0.62, 0.5, 0.1);
  } else if (kind === "radar") {
    const dish = add(g, new THREE.SphereGeometry(0.42, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2.6), mat(0xcfd6ea, { roughness: 0.35 }), 0, 0.52, 0);
    dish.rotation.x = Math.PI * 0.78;
    add(g, new THREE.CylinderGeometry(0.05, 0.07, 0.5, 6), mat(0x8892a8), 0, 0.22, 0);
    add(g, new THREE.SphereGeometry(0.09, 8, 6), mat(0xff5f6d, { emissive: 0xff5f6d, emissiveIntensity: 0.9 }), 0, 0.72, 0.22);
  } else if (kind === "trommel") {
    add(g, new THREE.CylinderGeometry(0.34, 0.38, 0.4, 12), mat(0xb0713a, { roughness: 0.7 }), 0, 0.4, 0);
    add(g, new THREE.CylinderGeometry(0.35, 0.35, 0.06, 12), mat(0xf6e7c8, { roughness: 0.5 }), 0, 0.62, 0);
    for (const s of [-1, 1]) {
      const stick = add(g, new THREE.CylinderGeometry(0.035, 0.035, 0.42, 6), mat(0xe8dcc0), s * 0.22, 0.85, 0);
      stick.rotation.z = s * 0.7;
      add(g, new THREE.SphereGeometry(0.08, 8, 6), mat(0xe8dcc0), s * 0.36, 0.98, 0);
    }
  } else if (kind === "schild") {
    const pad = add(g, new THREE.CylinderGeometry(0.5, 0.44, 0.08, 12), mat(0x4da06a, { roughness: 0.6 }), 0, 0.3, 0);
    pad.scale.z = 0.85;
    for (let i = 0; i < 5; i += 1) {
      const a = (i / 5) * Math.PI * 2;
      add(g, new THREE.SphereGeometry(0.09, 8, 6), mat(0xff8ac2, { roughness: 0.5 }), Math.cos(a) * 0.14, 0.42, Math.sin(a) * 0.14).scale.y = 0.55;
    }
    add(g, new THREE.SphereGeometry(0.07, 8, 6), gold(), 0, 0.45, 0);
  } else if (kind === "fernglas") {
    for (const s of [-1, 1]) {
      add(g, new THREE.CylinderGeometry(0.16, 0.2, 0.5, 10), mat(0x27303d, { roughness: 0.45 }), s * 0.19, 0.5, 0);
      add(g, new THREE.CylinderGeometry(0.17, 0.17, 0.05, 10), mat(0x7de8ff, { emissive: 0x7de8ff, emissiveIntensity: 0.7 }), s * 0.19, 0.76, 0);
    }
    add(g, new THREE.BoxGeometry(0.16, 0.12, 0.18), mat(0x27303d), 0, 0.5, 0);
  } else if (kind === "doppel") {
    for (const [dx, dy] of [[-0.16, 0.42], [0.2, 0.62]]) {
      add(g, new THREE.OctahedronGeometry(0.24, 0), mat(0xffc94d, { emissive: 0xcc8800, emissiveIntensity: 0.5 }), dx, dy, 0);
    }
  } else if (kind === "zeit") {
    const glassM = mat(0x9fdcff, { roughness: 0.2, emissive: 0x2277aa, emissiveIntensity: 0.3 });
    add(g, new THREE.ConeGeometry(0.3, 0.4, 10), glassM, 0, 0.66, 0).rotation.x = Math.PI;
    add(g, new THREE.ConeGeometry(0.3, 0.4, 10), glassM, 0, 0.28, 0);
    add(g, new THREE.CylinderGeometry(0.34, 0.34, 0.06, 10), gold(), 0, 0.05, 0);
    add(g, new THREE.CylinderGeometry(0.34, 0.34, 0.06, 10), gold(), 0, 0.9, 0);
  } else if (kind === "wirbel") {
    for (let i = 0; i < 4; i += 1) {
      const ring = add(g, new THREE.TorusGeometry(0.14 + i * 0.11, 0.05, 8, 16), mat(0xbfd4e6, { roughness: 0.4 }), (i % 2 ? 0.06 : -0.04), 0.2 + i * 0.22, 0);
      ring.rotation.x = Math.PI / 2;
    }
  } else if (kind === "ballon") {
    const b = add(g, new THREE.SphereGeometry(0.34, 12, 10), mat(0xff5f6d, { roughness: 0.35 }), 0, 0.62, 0);
    b.scale.y = 1.15;
    add(g, new THREE.ConeGeometry(0.07, 0.12, 6), mat(0xff5f6d), 0, 0.28, 0).rotation.x = Math.PI;
    add(g, new THREE.SphereGeometry(0.08, 8, 6), mat(0xffffff, { roughness: 0.2 }), -0.13, 0.75, 0.14);
  } else if (kind === "kompass") {
    add(g, new THREE.CylinderGeometry(0.42, 0.42, 0.1, 14), gold(), 0, 0.3, 0);
    add(g, new THREE.CylinderGeometry(0.36, 0.36, 0.04, 14), mat(0xfdf6e3, { roughness: 0.4 }), 0, 0.37, 0);
    const needleN = add(g, new THREE.ConeGeometry(0.09, 0.3, 4), mat(0xff5f6d), 0, 0.42, -0.12);
    needleN.rotation.x = -Math.PI / 2;
    const needleS = add(g, new THREE.ConeGeometry(0.09, 0.3, 4), mat(0x8892a8), 0, 0.42, 0.12);
    needleS.rotation.x = Math.PI / 2;
  } else if (kind === "glocke") {
    const bell = add(g, new THREE.SphereGeometry(0.36, 12, 8, 0, Math.PI * 2, 0, Math.PI / 1.6), gold(), 0, 0.55, 0);
    bell.scale.y = 1.2;
    add(g, new THREE.SphereGeometry(0.09, 8, 6), mat(0x8a5a2b), 0, 0.18, 0);
    add(g, new THREE.SphereGeometry(0.07, 8, 6), gold(), 0, 0.92, 0);
  } else if (kind === "klee") {
    const leafM = mat(0x4da06a, { roughness: 0.5 });
    for (let i = 0; i < 4; i += 1) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const leaf = add(g, new THREE.SphereGeometry(0.19, 8, 6), leafM, Math.cos(a) * 0.2, 0.62 + Math.sin(a) * 0.2, 0);
      leaf.scale.z = 0.35;
    }
    add(g, new THREE.CylinderGeometry(0.03, 0.04, 0.4, 6), leafM, 0, 0.2, 0).rotation.z = 0.2;
  } else if (kind === "salve") {
    for (const [dx, dy, s] of [[-0.25, 0.4, 0.16], [0.05, 0.65, 0.22], [0.3, 0.35, 0.13]]) {
      add(g, new THREE.OctahedronGeometry(s, 0), mat(0xffe066, { emissive: 0xffaa00, emissiveIntensity: 0.7 }), dx, dy, 0);
    }
  } else if (kind === "frost") {
    // six-armed ice crystal star
    const iceM = mat(0xbdefff, { roughness: 0.2, emissive: 0x4dd2ff, emissiveIntensity: 0.5 });
    for (let i = 0; i < 6; i += 1) {
      const arm = add(g, new THREE.ConeGeometry(0.09, 0.44, 4), iceM, 0, 0.55, 0);
      arm.position.x = Math.cos((i / 6) * Math.PI * 2) * 0.22;
      arm.position.y = 0.55 + Math.sin((i / 6) * Math.PI * 2) * 0.22;
      arm.rotation.z = (i / 6) * Math.PI * 2 - Math.PI / 2;
    }
    add(g, new THREE.SphereGeometry(0.12, 8, 6), mat(0xffffff, { roughness: 0.15 }), 0, 0.55, 0);
  } else if (kind === "funke") {
    // a bright spark with four ember rays
    add(g, new THREE.OctahedronGeometry(0.2, 0), mat(0xffe066, { emissive: 0xffaa00, emissiveIntensity: 1 }), 0, 0.55, 0);
    const emberM = mat(0xff8c42, { emissive: 0xff5a2a, emissiveIntensity: 0.8 });
    for (const [dx, dy] of [[0, 0.34], [0, -0.34], [-0.34, 0], [0.34, 0]]) {
      const ray = add(g, new THREE.ConeGeometry(0.07, 0.24, 4), emberM, dx, 0.55 + dy, 0);
      ray.rotation.z = Math.atan2(-dx, dy);
    }
  } else if (kind === "enterhaken") {
    // a grappling hook on a coiled rope
    const ironM = mat(0x3a3f4a, { metalness: 0.5, roughness: 0.4 });
    add(g, new THREE.CylinderGeometry(0.05, 0.05, 0.5, 8), ironM, 0, 0.62, 0);
    for (let i = 0; i < 3; i += 1) {
      const claw = add(g, new THREE.TorusGeometry(0.16, 0.045, 8, 12, Math.PI * 0.9), ironM, 0, 0.36, 0);
      claw.rotation.y = (i / 3) * Math.PI * 2;
      claw.rotation.z = Math.PI * 0.75;
    }
    const rope = add(g, new THREE.TorusGeometry(0.14, 0.05, 8, 14), mat(0xc4a05a, { roughness: 0.95 }), 0, 0.95, 0);
    rope.rotation.x = Math.PI / 2;
  } else if (kind === "leuchtfeuer") {
    // a striped lighthouse with a glowing lantern
    add(g, new THREE.CylinderGeometry(0.16, 0.26, 0.66, 10), mat(0xd8483c, { roughness: 0.5 }), 0, 0.4, 0);
    for (const sy of [0.28, 0.56]) {
      add(g, new THREE.CylinderGeometry(0.245 - sy * 0.14, 0.245 - sy * 0.14, 0.1, 10), mat(0xf0f4f8, { roughness: 0.45 }), 0, sy, 0);
    }
    add(g, new THREE.SphereGeometry(0.11, 8, 6), mat(0xffe066, { emissive: 0xffcc33, emissiveIntensity: 1 }), 0, 0.82, 0);
    add(g, new THREE.ConeGeometry(0.16, 0.16, 10), mat(0x2a4d7e), 0, 0.96, 0);
  } else {
    add(g, new THREE.OctahedronGeometry(0.3, 0), gold(), 0, 0.5, 0);
  }
  return g;
}

// ------------------------------------------------------------ decoy balloon
// The Schwindler rule's bluff: a cheeky balloon that pops when found.
// One clear look across all worlds so kids instantly recognize it.

export function buildDecoy() {
  const g = new THREE.Group();
  const redM = mat(0xff5f6d, { roughness: 0.35 });
  const balloon = add(g, new THREE.SphereGeometry(0.34, 14, 12), redM, 0, 0.78, 0);
  balloon.scale.set(1, 1.15, 1);
  // shine spot
  const shine = add(g, new THREE.SphereGeometry(0.09, 8, 6), mat(0xffffff, { roughness: 0.2 }), -0.14, 0.94, 0.14);
  shine.scale.set(0.9, 1.4, 0.6);
  // knot + string
  add(g, new THREE.ConeGeometry(0.07, 0.12, 6), redM, 0, 0.42, 0).rotation.x = Math.PI;
  const string = add(g, new THREE.CylinderGeometry(0.012, 0.012, 0.36, 4), mat(0xfdf6e3), 0, 0.2, 0);
  // cheeky face
  const blinkEyes = makeEyes(g, -0.26, 0.82, 0, 0.13, 0.06);
  smile(g, -0.32, 0.7, 0, 0.08, 0.015);

  g.userData.animate = (t) => {
    balloon.position.y = 0.78 + Math.sin(t * 1.6) * 0.05;
    shine.position.y = 0.94 + Math.sin(t * 1.6) * 0.05;
    g.rotation.z = Math.sin(t * 1.2) * 0.08;
    string.rotation.z = Math.sin(t * 2.1) * 0.15;
    blinkEyes(t);
  };
  return g;
}