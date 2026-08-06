// Per-world 3D environments — multi-layered dioramas (far silhouettes,
// mid decorations, near details) around one game board.
// Each builder returns a Group with userData.animate(t).

import * as THREE from "../vendor/three.module.min.js";
import { radialTexture } from "./scene.js";

function mat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.9, flatShading: true, ...opts });
}

function basic(color, opts = {}) {
  return new THREE.MeshBasicMaterial({ color, ...opts });
}

// floating point-cloud (bubbles, stardust, fireflies)
function particleField(count, color, size, radius, height) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    pos[i * 3] = (Math.random() - 0.5) * radius * 2;
    pos[i * 3 + 1] = Math.random() * height;
    pos[i * 3 + 2] = (Math.random() - 0.5) * radius * 2;
    seed[i] = Math.random() * 10;
  }
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const points = new THREE.Points(
    geo,
    new THREE.PointsMaterial({
      color,
      size,
      transparent: true,
      opacity: 0.75,
      sizeAttenuation: true,
      map: radialTexture(),
      depthWrite: false,
    })
  );
  points.userData.update = (t) => {
    const p = geo.attributes.position.array;
    for (let i = 0; i < count; i += 1) {
      p[i * 3 + 1] += 0.008 + Math.sin(t + seed[i]) * 0.002;
      if (p[i * 3 + 1] > height) p[i * 3 + 1] = 0;
      p[i * 3] += Math.sin(t * 0.8 + seed[i]) * 0.004;
    }
    geo.attributes.position.needsUpdate = true;
  };
  return points;
}

function cloud(scale) {
  const g = new THREE.Group();
  const m = mat(0xffffff, { roughness: 1, transparent: true, opacity: 0.92 });
  for (const [x, y, z, r] of [
    [0, 0, 0, 1],
    [0.9, -0.1, 0.2, 0.7],
    [-0.9, -0.15, -0.1, 0.75],
    [0.3, 0.35, -0.3, 0.6],
  ]) {
    const s = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), m);
    s.position.set(x, y, z);
    s.scale.y = 0.62;
    g.add(s);
  }
  g.scale.setScalar(scale);
  return g;
}

function rock(scale, color = 0x8a8f9a) {
  const r = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 0), mat(color));
  r.scale.set(scale, scale * 0.7, scale);
  r.rotation.y = Math.random() * Math.PI;
  return r;
}

// simple two-wing flyer (seagull / butterfly / pterosaur silhouette)
function flyer(color, size, wingShape = "round") {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.14 * size, 8, 6), mat(color));
  body.scale.set(1.8, 0.8, 0.8);
  g.add(body);
  const wings = [];
  for (const s of [-1, 1]) {
    const geo =
      wingShape === "round"
        ? new THREE.CircleGeometry(0.35 * size, 8, 0, Math.PI)
        : new THREE.PlaneGeometry(0.5 * size, 0.3 * size);
    const w = new THREE.Mesh(geo, mat(color, { side: THREE.DoubleSide }));
    w.position.z = s * 0.12 * size;
    w.rotation.y = s * Math.PI * 0.5;
    g.add(w);
    wings.push({ w, s });
  }
  g.userData.flap = (t, speed = 7) => {
    for (const { w, s } of wings) {
      w.rotation.x = s * Math.sin(t * speed) * 0.7;
    }
  };
  return g;
}

// ---------------------------------------------------------------- Ozean

// stylized water: calm bright lagoon around the board, waves further
// out, caustic sparkles inside, animated foam ring at the beach edge
function makeWater(lagoonR, beachR, { shallow = 0x6fd4e8, deep = 0x1e72b8, fog = 0xa8dcef } = {}) {
  const geo = new THREE.PlaneGeometry(120, 120, 52, 52);
  geo.rotateX(-Math.PI / 2);
  const material = new THREE.ShaderMaterial({
    transparent: false,
    uniforms: {
      uTime: { value: 0 },
      uShallow: { value: new THREE.Color(shallow) },
      uDeep: { value: new THREE.Color(deep) },
      uLagoonR: { value: lagoonR },
      uBeachR: { value: beachR },
      uFog: { value: new THREE.Color(fog) },
    },
    vertexShader: `
      uniform float uTime;
      uniform float uLagoonR;
      varying vec3 vPos;
      void main() {
        vec3 p = position;
        float d = length(p.xz);
        float amp = smoothstep(uLagoonR + 1.0, uLagoonR + 7.0, d);
        p.y += (sin(p.x * 0.42 + uTime * 1.4) * 0.16 + cos(p.z * 0.36 + uTime * 0.95) * 0.13) * amp;
        vPos = p;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: `
      uniform float uTime;
      uniform vec3 uShallow;
      uniform vec3 uDeep;
      uniform float uLagoonR;
      uniform float uBeachR;
      uniform vec3 uFog;
      varying vec3 vPos;
      void main() {
        float d = length(vPos.xz);
        vec3 col = mix(uShallow, uDeep, smoothstep(uLagoonR * 0.45, uLagoonR + 7.0, d));
        // caustic sparkles inside the lagoon
        float c = sin(vPos.x * 2.6 + uTime * 1.2) * sin(vPos.z * 2.4 - uTime * 0.9)
                + sin((vPos.x + vPos.z) * 1.7 + uTime * 1.6) * 0.6;
        float spark = smoothstep(1.15, 1.5, c) * (1.0 - smoothstep(uLagoonR * 0.4, uLagoonR + 2.0, d));
        col += spark * 0.28;
        // soft wave crests far out
        float crest = smoothstep(0.24, 0.34, sin(vPos.x * 0.42 + uTime * 1.4) * cos(vPos.z * 0.36 + uTime * 0.95));
        col += crest * smoothstep(uLagoonR + 2.0, uLagoonR + 9.0, d) * 0.12;
        // animated foam where lagoon meets the beach ring
        float foam = smoothstep(0.5, 0.0, abs(d - uBeachR) - 0.22)
                   * (0.55 + 0.35 * sin(uTime * 2.2 + d * 2.4));
        col = mix(col, vec3(1.0), foam * 0.65);
        // fade into the sky fog at the horizon
        col = mix(col, uFog, smoothstep(34.0, 58.0, d));
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.y = -0.06;
  return mesh;
}

function palmTree(scale) {
  const g = new THREE.Group();
  // gently curved trunk from stacked segments
  let px = 0;
  for (let i = 0; i < 5; i += 1) {
    const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.11 - i * 0.012, 0.13 - i * 0.012, 0.5, 7), mat(0x9a6b3f));
    px += i * 0.045;
    seg.position.set(px, 0.22 + i * 0.46, 0);
    seg.rotation.z = -0.12 * i;
    g.add(seg);
  }
  const top = new THREE.Vector3(px + 0.15, 2.5, 0);
  const leaves = [];
  for (let i = 0; i < 6; i += 1) {
    const a = (i / 6) * Math.PI * 2;
    const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.16, 1.5, 5), mat(0x3fae6a));
    leaf.scale.z = 0.35;
    leaf.position.set(top.x + Math.cos(a) * 0.55, top.y, top.z + Math.sin(a) * 0.55);
    leaf.rotation.z = Math.cos(a) * 1.25;
    leaf.rotation.x = -Math.sin(a) * 1.25;
    leaf.userData.a = a;
    leaves.push(leaf);
    g.add(leaf);
  }
  for (const [dx, dz] of [[0.16, 0.1], [-0.05, -0.16]]) {
    const nut = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), mat(0x6b4423));
    nut.position.set(top.x + dx, top.y - 0.18, top.z + dz);
    g.add(nut);
  }
  g.scale.setScalar(scale);
  g.userData.sway = (t) => {
    leaves.forEach((leaf) => {
      leaf.rotation.y = Math.sin(t * 1.3 + leaf.userData.a) * 0.12;
    });
    g.rotation.z = Math.sin(t * 0.9) * 0.015;
  };
  return g;
}

function starfish(color) {
  const g = new THREE.Group();
  for (let i = 0; i < 5; i += 1) {
    const a = (i / 5) * Math.PI * 2;
    const arm = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.3, 5), mat(color, { roughness: 0.7 }));
    arm.position.set(Math.cos(a) * 0.14, 0.03, Math.sin(a) * 0.14);
    arm.rotation.z = Math.PI / 2;
    arm.rotation.y = -a;
    g.add(arm);
  }
  g.add(new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), mat(color, { roughness: 0.7 })));
  return g;
}

function ozean(boardSpan) {
  const g = new THREE.Group();
  const lagoonR = boardSpan * 1.0;
  const beachR = boardSpan * 1.28;

  const water = makeWater(lagoonR, beachR);
  g.add(water);

  // beach ring around the lagoon
  const beach = new THREE.Mesh(
    new THREE.RingGeometry(lagoonR + 0.15, beachR + 1.6, 44),
    mat(0xf2e3b3, { roughness: 0.95 })
  );
  beach.rotation.x = -Math.PI / 2;
  beach.position.y = 0.02;
  g.add(beach);
  const beachOuter = new THREE.Mesh(
    new THREE.RingGeometry(beachR + 1.55, beachR + 2.6, 44),
    mat(0xe3cf9a, { roughness: 1 })
  );
  beachOuter.rotation.x = -Math.PI / 2;
  beachOuter.position.y = -0.03;
  g.add(beachOuter);

  // palm + beach props
  const palm = palmTree(1.15);
  palm.position.set(-boardSpan * 1.14, 0.02, -boardSpan * 0.62);
  g.add(palm);
  const palm2 = palmTree(0.85);
  palm2.position.set(boardSpan * 1.2, 0.02, -boardSpan * 0.4);
  palm2.rotation.y = 2.4;
  g.add(palm2);
  const star1 = starfish(0xff8a5f);
  star1.position.set(boardSpan * 1.08, 0.05, boardSpan * 0.72);
  g.add(star1);
  const star2 = starfish(0xffb35f);
  star2.position.set(-boardSpan * 0.95, 0.05, boardSpan * 0.92);
  star2.rotation.y = 1.2;
  g.add(star2);
  for (let i = 0; i < 6; i += 1) {
    const a = Math.PI * 0.2 + (i / 6) * Math.PI * 1.6;
    const shell = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.14, 6), mat(0xfff1d6, { roughness: 0.6 }));
    shell.position.set(Math.cos(a) * (beachR + 0.4), 0.06, Math.sin(a) * (beachR + 0.4));
    g.add(shell);
  }

  // mid: rocks poking out of the sea + sailboat
  for (const [x, z, sc] of [[-8, -13, 1.4], [9, -14, 1.1], [13, 7, 1.7], [-13, 9, 1.0]]) {
    const rk = rock(sc, 0x7d8894);
    rk.position.set(x, -0.25, z);
    g.add(rk);
  }
  const boat = new THREE.Group();
  const hull = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.5, 0.5, 4, 1), mat(0xa8552f));
  hull.rotation.y = Math.PI / 4;
  hull.scale.set(1.7, 0.6, 0.85);
  boat.add(hull);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.6, 6), mat(0x6b4423));
  mast.position.y = 0.9;
  boat.add(mast);
  const sail = new THREE.Mesh(new THREE.ConeGeometry(0.65, 1.3, 4), mat(0xf7f0dd, { roughness: 1 }));
  sail.position.set(0.1, 1.0, 0);
  boat.add(sail);
  boat.position.set(-9, 0.05, -16);
  g.add(boat);

  const clouds = [];
  for (const [x, y, z, sc] of [[-10, 7, -15, 1.7], [11, 8, -11, 1.3], [3, 9.5, -20, 2.2], [-6, 8, 14, 1.4]]) {
    const c = cloud(sc);
    c.position.set(x, y, z);
    clouds.push(c);
    g.add(c);
  }

  // far islands with mini palms
  for (const [x, z, sc, h] of [[-17, -35, 9, 6], [19, -31, 12, 8], [2, -45, 10, 7], [-31, -21, 8, 5]]) {
    const isle = new THREE.Mesh(new THREE.ConeGeometry(sc, h, 7), mat(0x74a88f, { roughness: 1 }));
    isle.position.set(x, h / 2 - 1.4, z);
    g.add(isle);
  }

  const gulls = [];
  for (let i = 0; i < 3; i += 1) {
    const gull = flyer(0xffffff, 1.1, "round");
    gull.userData.orbit = { r: 8 + i * 2.5, h: 6 + i * 1.2, speed: 0.14 + i * 0.03, phase: i * 2.1 };
    gulls.push(gull);
    g.add(gull);
  }

  const bubbles = particleField(50, 0xffffff, 0.14, 12, 6);
  g.add(bubbles);

  g.userData.animate = (t) => {
    water.material.uniforms.uTime.value = t;
    boat.position.y = 0.05 + Math.sin(t * 1.2) * 0.12;
    boat.rotation.z = Math.sin(t * 1.4) * 0.07;
    palm.userData.sway(t);
    palm2.userData.sway(t + 2);
    clouds.forEach((c, i) => {
      c.position.x += Math.sin(t * 0.08 + i) * 0.003;
    });
    for (const gull of gulls) {
      const o = gull.userData.orbit;
      const a = t * o.speed + o.phase;
      gull.position.set(Math.cos(a) * o.r, o.h + Math.sin(t * 0.9 + o.phase) * 0.5, Math.sin(a) * o.r);
      gull.rotation.y = -a - Math.PI / 2;
      gull.userData.flap(t + o.phase, 6);
    }
    bubbles.userData.update(t);
  };
  return g;
}

// -------------------------------------------------------------- Weltraum

function weltraum(boardSpan) {
  const g = new THREE.Group();

  // --- near: pulsing energy platform under the grid
  const disc = new THREE.Mesh(
    new THREE.CylinderGeometry(boardSpan * 0.84, boardSpan * 0.6, 0.5, 26),
    mat(0x241a4d, { roughness: 0.6, metalness: 0.2 })
  );
  disc.position.y = -0.42;
  g.add(disc);
  const glow = new THREE.Mesh(
    new THREE.CircleGeometry(boardSpan * 0.84, 40),
    basic(0x7a4fe0, { transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = -0.14;
  g.add(glow);
  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(boardSpan * 0.86, 0.1, 8, 44),
    mat(0xb388ff, { emissive: 0x7a4fe0, emissiveIntensity: 1.5 })
  );
  rim.rotation.x = Math.PI / 2;
  rim.position.y = -0.16;
  g.add(rim);
  const halos = [];
  for (let i = 0; i < 2; i += 1) {
    const halo = new THREE.Mesh(
      new THREE.RingGeometry(boardSpan * (0.9 + i * 0.14), boardSpan * (1.02 + i * 0.16), 44),
      basic(0x9d7bff, {
        transparent: true,
        opacity: 0.16,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
    );
    halo.rotation.x = -Math.PI / 2;
    halo.position.y = -0.12 - i * 0.02;
    halos.push(halo);
    g.add(halo);
  }

  // floating glowing shards around the platform edge
  const shards = [];
  for (let i = 0; i < 8; i += 1) {
    const a = (i / 8) * Math.PI * 2;
    const shard = new THREE.Mesh(
      new THREE.TetrahedronGeometry(0.28 + Math.random() * 0.2),
      mat(0x9d7bff, { emissive: 0x6a3fe0, emissiveIntensity: 0.9, flatShading: true })
    );
    shard.position.set(Math.cos(a) * boardSpan * 1.02, 0.4, Math.sin(a) * boardSpan * 1.02);
    shard.userData.phase = i * 1.3;
    shards.push(shard);
    g.add(shard);
  }

  // --- mid: asteroid belt slowly orbiting
  const belt = new THREE.Group();
  const asteroids = [];
  for (let i = 0; i < 16; i += 1) {
    const a = (i / 16) * Math.PI * 2;
    const r = 24 + Math.random() * 10;
    const ast = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5 + Math.random() * 0.9, 0), mat(0x6a6480, { roughness: 1 }));
    ast.position.set(Math.cos(a) * r, (Math.random() - 0.4) * 7, Math.sin(a) * r);
    ast.rotation.set(Math.random() * 3, Math.random() * 3, 0);
    ast.userData.spin = (Math.random() - 0.5) * 1.4;
    asteroids.push(ast);
    belt.add(ast);
  }
  g.add(belt);

  // --- far: nebula sprites + starfield + planets
  const nebulaColors = ["rgba(180,110,255,0.35)", "rgba(255,110,190,0.28)", "rgba(90,190,255,0.3)"];
  const nebulas = [];
  nebulaColors.forEach((c, i) => {
    const spr = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: radialTexture(c, "rgba(0,0,0,0)", 256),
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
      })
    );
    spr.scale.setScalar(70 + i * 25);
    spr.position.set([-22, 26, 2][i], [20, 14, 26][i], [-50, -42, -60][i]);
    nebulas.push(spr);
    g.add(spr);
  });

  const starGeo = new THREE.BufferGeometry();
  const n = 600;
  const sp = new Float32Array(n * 3);
  for (let i = 0; i < n; i += 1) {
    const r = 40 + Math.random() * 60;
    const a = Math.random() * Math.PI * 2;
    const y = (Math.random() - 0.3) * 60;
    sp[i * 3] = Math.cos(a) * r;
    sp[i * 3 + 1] = y;
    sp[i * 3 + 2] = Math.sin(a) * r;
  }
  starGeo.setAttribute("position", new THREE.BufferAttribute(sp, 3));
  const stars = new THREE.Points(
    starGeo,
    new THREE.PointsMaterial({ color: 0xffffff, size: 0.3, transparent: true, opacity: 0.95, map: radialTexture(), depthWrite: false })
  );
  g.add(stars);

  const planet = new THREE.Mesh(new THREE.SphereGeometry(4, 16, 12), mat(0xe08d5a, { roughness: 0.85 }));
  planet.position.set(-10, 9, -26);
  g.add(planet);
  const band = new THREE.Mesh(new THREE.SphereGeometry(4.02, 16, 12, 0, Math.PI * 2, Math.PI * 0.42, Math.PI * 0.16), mat(0xc9723f));
  band.position.copy(planet.position);
  g.add(band);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(5.8, 0.45, 8, 34), mat(0xd9c9a8));
  ring.position.copy(planet.position);
  ring.rotation.x = Math.PI / 2.4;
  g.add(ring);
  const moon = new THREE.Mesh(new THREE.SphereGeometry(1.6, 12, 10), mat(0xb9c2d9));
  moon.position.set(9, 6, -19);
  g.add(moon);

  // shooting star streak
  const streak = new THREE.Mesh(
    new THREE.PlaneGeometry(6, 0.12),
    basic(0xffffff, { transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
  );
  g.add(streak);

  const dust = particleField(80, 0xb388ff, 0.14, 15, 9);
  g.add(dust);

  g.userData.animate = (t) => {
    rim.material.emissiveIntensity = 1.2 + Math.sin(t * 2.2) * 0.5;
    glow.material.opacity = 0.28 + Math.sin(t * 1.6) * 0.1;
    halos.forEach((h, i) => {
      h.material.opacity = 0.1 + Math.max(0, Math.sin(t * 1.4 + i * 2.2)) * 0.14;
      h.scale.setScalar(1 + Math.sin(t * 1.4 + i * 2.2) * 0.02);
    });
    belt.rotation.y = t * 0.02;
    for (const ast of asteroids) ast.rotation.y += ast.userData.spin * 0.008;
    for (const shard of shards) {
      shard.position.y = 0.4 + Math.sin(t * 1.2 + shard.userData.phase) * 0.35;
      shard.rotation.y = t * 0.5 + shard.userData.phase;
    }
    stars.rotation.y = t * 0.006;
    planet.rotation.y = t * 0.08;
    moon.position.y = 6 + Math.sin(t * 0.5) * 0.8;
    nebulas.forEach((nb, i) => {
      nb.material.opacity = 0.8 + Math.sin(t * 0.4 + i * 2) * 0.2;
    });
    // shooting star every ~7 s
    const cyc = t % 7;
    if (cyc < 0.9) {
      streak.material.opacity = Math.sin((cyc / 0.9) * Math.PI) * 0.9;
      streak.position.set(-30 + cyc * 60, 26 - cyc * 8, -35);
      streak.rotation.z = -0.18;
    } else {
      streak.material.opacity = 0;
    }
    dust.userData.update(t);
  };
  return g;
}

// ------------------------------------------------------------------ Dino

function dino(boardSpan) {
  const g = new THREE.Group();

  const grass = new THREE.Mesh(new THREE.CylinderGeometry(34, 34, 0.6, 28), mat(0x3c9a52));
  grass.position.y = -0.42;
  g.add(grass);
  const clearing = new THREE.Mesh(
    new THREE.CylinderGeometry(boardSpan * 0.9, boardSpan * 1.04, 0.66, 22),
    mat(0x74c184, { roughness: 0.95 })
  );
  clearing.position.y = -0.33;
  g.add(clearing);
  const moss = new THREE.Mesh(
    new THREE.TorusGeometry(boardSpan * 0.92, 0.22, 8, 40),
    mat(0x51b06a, { roughness: 1 })
  );
  moss.rotation.x = Math.PI / 2;
  moss.position.y = -0.06;
  g.add(moss);

  function tree(x, z, s) {
    const tr = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.25 * s, 0.36 * s, 1.7 * s, 7), mat(0x7a4f2e));
    trunk.position.y = 0.85 * s;
    tr.add(trunk);
    for (let i = 0; i < 3; i += 1) {
      const crown = new THREE.Mesh(new THREE.ConeGeometry((1.6 - i * 0.38) * s, 1.25 * s, 8), mat(i % 2 ? 0x2e7d3f : 0x3c9a52));
      crown.position.y = (1.7 + i * 0.8) * s;
      tr.add(crown);
    }
    tr.position.set(x, 0, z);
    return tr;
  }
  const trees = [];
  for (const [x, z, s] of [[-5, -12, 1.5], [4, -14, 1.7], [-1, -18, 2.0], [9, -11, 1.2], [-9, -9, 1.2], [9, 13, 1.2], [-9, 12, 1.1], [13, -6, 1.3], [2, 16, 1.1]]) {
    const t = tree(x, z, s);
    trees.push(t);
    g.add(t);
  }

  // near: ferns waving at the clearing edge
  const ferns = [];
  for (let i = 0; i < 12; i += 1) {
    const a = (i / 12) * Math.PI * 2 + 0.35;
    const r = boardSpan * (0.96 + Math.random() * 0.12);
    const fern = new THREE.Group();
    for (let k = -2; k <= 2; k += 1) {
      const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.8 + Math.random() * 0.3, 5), mat(0x51b06a));
      leaf.scale.x = 0.35;
      leaf.position.y = 0.35;
      leaf.rotation.z = k * 0.4;
      const pivot = new THREE.Group();
      pivot.add(leaf);
      fern.add(pivot);
    }
    fern.position.set(Math.cos(a) * r, -0.1, Math.sin(a) * r);
    fern.userData.phase = Math.random() * 6;
    ferns.push(fern);
    g.add(fern);
  }
  for (const [x, z, s] of [[-10, 10, 0.9], [10, -10, 1.1], [7, 12, 0.7]]) {
    const rk = rock(s, 0x97a08f);
    rk.position.set(x, 0, z);
    g.add(rk);
  }

  // far: hill silhouettes + volcano
  for (const [x, z, s, h, c] of [
    [-14, -36, 16, 12, 0x5da06a],
    [16, -32, 20, 15, 0x6fae78],
    [30, -18, 15, 10, 0x5da06a],
    [-30, -22, 14, 9, 0x6fae78],
  ]) {
    const hill = new THREE.Mesh(new THREE.ConeGeometry(s, h, 9), mat(c, { roughness: 1 }));
    hill.position.set(x, h / 2 - 1.4, z);
    g.add(hill);
  }
  const volcano = new THREE.Mesh(new THREE.ConeGeometry(7, 11, 12), mat(0x6b5346));
  volcano.position.set(3, 4.3, -26);
  g.add(volcano);
  const lava = new THREE.Mesh(
    new THREE.CylinderGeometry(1.8, 2.4, 0.8, 10),
    mat(0xff7733, { emissive: 0xff5511, emissiveIntensity: 1.5 })
  );
  lava.position.set(3, 8.9, -26);
  g.add(lava);
  const puffs = [];
  for (let i = 0; i < 3; i += 1) {
    const puff = new THREE.Mesh(new THREE.SphereGeometry(1.1, 10, 8), mat(0xb9b2ac, { transparent: true, opacity: 0.5 }));
    puff.userData.phase = i * 1.4;
    puffs.push(puff);
    g.add(puff);
  }

  const clouds = [];
  for (const [x, y, z, s] of [[-15, 10, -10, 1.5], [14, 11, -14, 1.8], [-4, 12, 16, 1.3]]) {
    const c = cloud(s);
    c.position.set(x, y, z);
    clouds.push(c);
    g.add(c);
  }

  // butterflies fluttering over the clearing
  const flies = [];
  for (let i = 0; i < 4; i += 1) {
    const b = flyer([0xffc94d, 0xff8ac2, 0x8ad2ff, 0xc58bff][i], 0.5, "round");
    b.userData.orbit = { r: 5 + i * 1.6, h: 1.4 + i * 0.5, speed: 0.3 + i * 0.07, phase: i * 1.7 };
    flies.push(b);
    g.add(b);
  }

  const fireflies = particleField(55, 0xfff2a8, 0.12, 14, 4);
  g.add(fireflies);

  // slanted god rays through the canopy
  const rays = [];
  for (let i = 0; i < 3; i += 1) {
    const ray = new THREE.Mesh(
      new THREE.PlaneGeometry(2.2 + i, 16),
      basic(0xfff7cf, {
        transparent: true,
        opacity: 0.07,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
    );
    ray.position.set(-7 + i * 3.4, 6.5, -4 + i * 2.4);
    ray.rotation.z = 0.5;
    ray.rotation.y = 0.35;
    rays.push(ray);
    g.add(ray);
  }

  g.userData.animate = (t) => {
    lava.material.emissiveIntensity = 1.2 + Math.sin(t * 3.1) * 0.5;
    puffs.forEach((puff) => {
      const ph = (t * 0.35 + puff.userData.phase) % 1.6;
      puff.position.set(3 + Math.sin(ph * 3) * 0.4, 9.7 + ph * 3.2, -26);
      puff.material.opacity = Math.max(0, 0.5 - ph * 0.3);
      puff.scale.setScalar(1 + ph * 0.9);
    });
    trees.forEach((tr, i) => {
      tr.rotation.z = Math.sin(t * 1.1 + i) * 0.015;
    });
    ferns.forEach((f) => {
      f.rotation.z = Math.sin(t * 1.7 + f.userData.phase) * 0.12;
    });
    rays.forEach((r, i) => {
      r.material.opacity = 0.05 + Math.max(0, Math.sin(t * 0.5 + i * 1.8)) * 0.06;
    });
    for (const b of flies) {
      const o = b.userData.orbit;
      const a = t * o.speed + o.phase;
      b.position.set(Math.cos(a) * o.r, o.h + Math.sin(t * 1.8 + o.phase) * 0.5, Math.sin(a) * o.r);
      b.rotation.y = -a - Math.PI / 2;
      b.userData.flap(t + o.phase, 11);
    }
    clouds.forEach((c, i) => {
      c.position.x += Math.sin(t * 0.07 + i) * 0.003;
    });
    fireflies.userData.update(t);
  };
  return g;
}


// ----------------------------------------------------------------- Teich

function cattail(scale) {
  const g = new THREE.Group();
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.035, 1.4, 5), mat(0x4f8f3f));
  stem.position.y = 0.7;
  g.add(stem);
  const head = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.35, 7), mat(0x6b4423));
  head.position.y = 1.45;
  g.add(head);
  const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.22, 4), mat(0x8faf5f));
  tip.position.y = 1.75;
  g.add(tip);
  for (let i = 0; i < 2; i += 1) {
    const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.06, 1.1, 4), mat(0x5fae4f));
    leaf.scale.x = 0.35;
    leaf.position.set(0.1 - i * 0.2, 0.6, 0.05);
    leaf.rotation.z = (i ? -1 : 1) * 0.25;
    g.add(leaf);
  }
  g.scale.setScalar(scale);
  return g;
}

function teich(boardSpan) {
  const g = new THREE.Group();
  const lagoonR = boardSpan * 1.0;
  const bankR = boardSpan * 1.28;

  // murky green pond water with the same living shader
  const water = makeWater(lagoonR, bankR, { shallow: 0x63c9ae, deep: 0x1e6b5a, fog: 0xd2ecd8 });
  g.add(water);

  // grassy bank ring
  const bank = new THREE.Mesh(new THREE.RingGeometry(lagoonR + 0.15, bankR + 1.8, 44), mat(0x62b555, { roughness: 0.95 }));
  bank.rotation.x = -Math.PI / 2;
  bank.position.y = 0.02;
  g.add(bank);
  const bankOuter = new THREE.Mesh(new THREE.RingGeometry(bankR + 1.75, bankR + 3.2, 44), mat(0x4f9a48, { roughness: 1 }));
  bankOuter.rotation.x = -Math.PI / 2;
  bankOuter.position.y = -0.03;
  g.add(bankOuter);

  // wooden jetty with a fishing rod and bobber
  const jetty = new THREE.Group();
  const plankM = mat(0x9a6b3f, { roughness: 0.85 });
  for (let i = 0; i < 5; i += 1) {
    const plank = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.08, 2.6), plankM);
    plank.position.set(i * 0.66, 0.34, 0);
    jetty.add(plank);
  }
  for (const [px, pz] of [[0.2, -1.1], [0.2, 1.1], [2.6, -1.1], [2.6, 1.1]]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.9, 6), mat(0x7a4f2e));
    post.position.set(px, 0.05, pz);
    jetty.add(post);
  }
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.035, 2.4, 5), mat(0x6b4423));
  rod.position.set(-0.9, 1.0, 0.5);
  rod.rotation.z = 0.9;
  jetty.add(rod);
  const line = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 1.35, 3), basic(0xf5f8fa, { transparent: true, opacity: 0.6 }));
  line.position.set(-1.95, 0.72, 0.5);
  jetty.add(line);
  const bobber = new THREE.Group();
  const bTop = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(0xe85d5d, { roughness: 0.5 }));
  const bBot = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), mat(0xfdf6e3, { roughness: 0.5 }));
  bobber.add(bTop, bBot);
  bobber.position.set(-1.95, 0.05, 0.5);
  jetty.add(bobber);
  jetty.position.set(lagoonR + 0.4, 0, -boardSpan * 0.35);
  jetty.rotation.y = Math.PI;
  g.add(jetty);

  // lily pads drifting on the pond edge (outside the play grid)
  const pads = [];
  for (let i = 0; i < 7; i += 1) {
    const a = 0.5 + (i / 7) * Math.PI * 2;
    const r = lagoonR * (0.9 + (i % 2) * 0.14);
    const pad = new THREE.Mesh(
      new THREE.CircleGeometry(0.38 + (i % 3) * 0.12, 14, 0.4, Math.PI * 1.8),
      mat(0x3f9a52, { roughness: 0.9, side: THREE.DoubleSide })
    );
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(Math.cos(a) * r, 0.045, Math.sin(a) * r);
    pad.userData.phase = i * 1.3;
    pads.push(pad);
    g.add(pad);
    if (i % 3 === 0) {
      const bloom = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.16, 6), mat(0xffb7d5, { roughness: 0.6 }));
      bloom.position.set(Math.cos(a) * r, 0.14, Math.sin(a) * r);
      g.add(bloom);
    }
  }

  // cattails + reeds around the bank
  const reeds = [];
  for (let i = 0; i < 10; i += 1) {
    const a = (i / 10) * Math.PI * 2 + 0.9;
    const r = bankR + 0.5 + Math.random() * 0.8;
    const c = cattail(0.9 + Math.random() * 0.5);
    c.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
    c.userData.phase = Math.random() * 6;
    reeds.push(c);
    g.add(c);
  }

  // mid/far: bushes, a weeping willow silhouette, hills
  for (const [x, z, sc] of [[-9, -12, 1.6], [10, -12, 1.3], [12, 8, 1.5], [-12, 7, 1.2]]) {
    const bush = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), mat(0x6fbf6a, { roughness: 1 }));
    bush.scale.set(sc * 1.4, sc * 0.9, sc * 1.2);
    bush.position.set(x, 0.3, z);
    g.add(bush);
  }
  const willow = new THREE.Group();
  const wTrunk = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, 3.4, 7), mat(0x6b4a2e));
  wTrunk.position.y = 1.7;
  willow.add(wTrunk);
  const crown = new THREE.Mesh(new THREE.SphereGeometry(2.6, 12, 9), mat(0x74c184, { roughness: 1 }));
  crown.scale.y = 0.85;
  crown.position.y = 4.2;
  willow.add(crown);
  const strands = [];
  for (let i = 0; i < 8; i += 1) {
    const a = (i / 8) * Math.PI * 2;
    const strand = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.02, 2.2, 4), mat(0x6fbf6a));
    strand.position.set(Math.cos(a) * 2.3, 3.0, Math.sin(a) * 2.3);
    strand.userData.phase = i;
    strands.push(strand);
    willow.add(strand);
  }
  willow.position.set(-7, 0, -16);
  g.add(willow);

  for (const [x, z, sc, h] of [[-16, -34, 15, 9], [14, -32, 18, 12], [32, -16, 13, 8]]) {
    const hill = new THREE.Mesh(new THREE.ConeGeometry(sc, h, 9), mat(0x8cc794, { roughness: 1 }));
    hill.position.set(x, h / 2 - 1.4, z);
    g.add(hill);
  }

  const clouds = [];
  for (const [x, y, z, sc] of [[-11, 8, -14, 1.6], [10, 9, -12, 1.2], [2, 10, -19, 2.0]]) {
    const c = cloud(sc);
    c.position.set(x, y, z);
    clouds.push(c);
    g.add(c);
  }

  // dragonflies darting over the pond
  const dragonflies = [];
  for (let i = 0; i < 3; i += 1) {
    const dfly = flyer([0x5fd0e8, 0xb388ff, 0x8fe06a][i], 0.45, "flat");
    dfly.userData.orbit = { r: 4.5 + i * 2, h: 1.2 + i * 0.5, speed: 0.5 + i * 0.15, phase: i * 2.2 };
    dragonflies.push(dfly);
    g.add(dfly);
  }

  const sparkles = particleField(45, 0xfff8d0, 0.11, 12, 4);
  g.add(sparkles);

  g.userData.animate = (t) => {
    water.material.uniforms.uTime.value = t;
    bobber.position.y = 0.05 + Math.sin(t * 1.8) * 0.06;
    rod.rotation.z = 0.9 + Math.sin(t * 1.1) * 0.02;
    pads.forEach((pad) => {
      pad.position.y = 0.045 + Math.sin(t * 1.4 + pad.userData.phase) * 0.02;
      pad.rotation.z = Math.sin(t * 0.7 + pad.userData.phase) * 0.1;
    });
    reeds.forEach((c) => {
      c.rotation.z = Math.sin(t * 1.5 + c.userData.phase) * 0.06;
    });
    strands.forEach((st) => {
      st.rotation.x = Math.sin(t * 1.3 + st.userData.phase) * 0.08;
    });
    for (const dfly of dragonflies) {
      const o = dfly.userData.orbit;
      const a = t * o.speed + o.phase;
      dfly.position.set(
        Math.cos(a) * o.r + Math.sin(t * 2.3 + o.phase) * 0.8,
        o.h + Math.sin(t * 3.1 + o.phase) * 0.4,
        Math.sin(a) * o.r
      );
      dfly.rotation.y = -a - Math.PI / 2;
      dfly.userData.flap(t + o.phase, 18);
    }
    clouds.forEach((c, i) => {
      c.position.x += Math.sin(t * 0.07 + i) * 0.003;
    });
    sparkles.userData.update(t);
  };
  return g;
}

const BUILDERS = { ozean, weltraum, dino, teich };

export function buildEnvironment(worldId, boardSpan) {
  return (BUILDERS[worldId] || ozean)(boardSpan);
}
