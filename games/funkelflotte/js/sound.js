// Tiny WebAudio synthesizer — no audio assets needed.

let ctx = null;
let muted = false;

try {
  muted = localStorage.getItem("ff-muted") === "1";
} catch {
  muted = false;
}

export function isMuted() {
  return muted;
}

export function setMuted(m) {
  muted = m;
  try {
    localStorage.setItem("ff-muted", m ? "1" : "0");
  } catch {
    /* private mode etc. */
  }
}

export function unlock() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
  }
  if (ctx.state === "suspended") ctx.resume();
}

function tone(freq, start, dur, type = "sine", gain = 0.15, slideTo = null) {
  if (muted || !ctx) return;
  const t0 = ctx.currentTime + start;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

function noise(start, dur, gain = 0.12, freq = 800) {
  if (muted || !ctx) return;
  const t0 = ctx.currentTime + start;
  const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(filter).connect(g).connect(ctx.destination);
  src.start(t0);
}

// tiny random detune so repeated sounds never feel stamped out
function jit(f, pct = 0.05) {
  return f * (1 + (Math.random() * 2 - 1) * pct);
}

export function tap() {
  tone(jit(520), 0, 0.08, "sine", 0.08);
}

// ------------------------------------------------- world-flavored combat
// Different worlds sound different, and hits on YOUR creatures sound
// nothing like hits you land on theirs.

export function hitEnemy(worldId) {
  if (worldId === "weltraum") {
    // laser zap + shimmer
    tone(jit(950), 0, 0.12, "square", 0.12, 220);
    tone(jit(1400), 0.06, 0.16, "triangle", 0.08, 500);
    noise(0.02, 0.12, 0.04, 2400);
  } else if (worldId === "dino") {
    // wood block + jungle tom
    noise(0, 0.06, 0.16, 1400);
    tone(jit(190), 0.03, 0.16, "sine", 0.2, 120);
    tone(jit(520), 0.1, 0.1, "triangle", 0.1);
  } else if (worldId === "teich") {
    // juicy splash + froggy blip
    tone(jit(340), 0, 0.14, "sine", 0.16, 520);
    noise(0.03, 0.2, 0.08, 900);
    tone(jit(660), 0.14, 0.1, "sawtooth", 0.05, 880);
  } else if (worldId === "eis") {
    // glassy ice chime + crackle
    tone(jit(1180), 0, 0.16, "triangle", 0.12, 1500);
    tone(jit(1760), 0.08, 0.18, "sine", 0.08);
    noise(0.02, 0.1, 0.06, 3200); // ice crackle
  } else if (worldId === "vulkan") {
    // hot hiss + deep rumble pop
    noise(0, 0.16, 0.1, 2000); // steam hiss
    tone(jit(140), 0.04, 0.2, "sawtooth", 0.14, 90);
    tone(jit(720), 0.12, 0.1, "square", 0.05, 950);
  } else if (worldId === "piraten") {
    // creaking timber + a splash of grog
    noise(0, 0.09, 0.14, 600); // wood knock
    tone(jit(160), 0.02, 0.22, "sawtooth", 0.09, 110); // creak
    tone(jit(420), 0.1, 0.14, "sine", 0.12, 620);
    noise(0.12, 0.16, 0.06, 1000);
  } else if (worldId === "marine") {
    // ship's bell ding + metal clank
    tone(jit(880), 0, 0.3, "triangle", 0.14, 860);
    tone(jit(1320), 0.02, 0.2, "sine", 0.07);
    noise(0.04, 0.08, 0.08, 2800); // clank
  } else {
    // ozean: bubbly rising double-plop
    tone(jit(300), 0, 0.12, "sine", 0.16, 480);
    tone(jit(480), 0.09, 0.14, "sine", 0.14, 720);
    noise(0.05, 0.18, 0.05, 1100);
  }
  tone(jit(1050), 0.16, 0.12, "triangle", 0.07);
}

export function hitOwn() {
  // ominous: low thud + falling minor second
  noise(0, 0.14, 0.12, 240);
  tone(jit(96), 0, 0.3, "sine", 0.24, 60);
  tone(jit(330), 0.12, 0.22, "sine", 0.08, 311);
}

export function missWorld(worldId) {
  if (worldId === "weltraum") {
    tone(jit(520), 0, 0.18, "triangle", 0.08, 140); // soft pew into the void
  } else if (worldId === "dino") {
    noise(0, 0.16, 0.07, 2600); // leaves rustle
    tone(jit(240), 0.04, 0.1, "sine", 0.06, 180);
  } else if (worldId === "eis") {
    noise(0, 0.14, 0.08, 1800); // crunching snow
    tone(jit(880), 0.05, 0.1, "triangle", 0.05, 660);
  } else if (worldId === "vulkan") {
    noise(0, 0.22, 0.08, 1400); // ash puff
    tone(jit(180), 0.03, 0.14, "sine", 0.06, 120);
  } else {
    // watery worlds: classic plop
    tone(jit(360), 0, 0.18, "sine", 0.16, 120);
    noise(0.02, 0.25, 0.07, 1200);
  }
}

export function sunkEnemy(worldId) {
  if (worldId === "weltraum") {
    tone(220, 0, 0.3, "sawtooth", 0.1, 880); // riser…
    noise(0.26, 0.5, 0.14, 500); // …boom
    tone(110, 0.28, 0.4, "sine", 0.18, 55);
  } else if (worldId === "dino") {
    for (let i = 0; i < 5; i += 1) noise(i * 0.07, 0.06, 0.12, 900 + i * 200); // drum roll
    tone(140, 0.36, 0.4, "sawtooth", 0.12, 90); // triumphant rumble
    tone(560, 0.4, 0.3, "triangle", 0.1);
  } else if (worldId === "teich") {
    tone(jit(300), 0, 0.2, "sine", 0.18, 640);
    noise(0.06, 0.35, 0.12, 800); // big splash
    for (let i = 0; i < 3; i += 1) tone(150 + i * 30, 0.3 + i * 0.14, 0.12, "sawtooth", 0.05, 110);
  } else if (worldId === "eis") {
    // big ice crack, then a sparkling bell cascade
    noise(0, 0.2, 0.14, 2600);
    tone(90, 0.02, 0.35, "sine", 0.16, 55);
    const bells = [1047, 1319, 1568, 2093];
    bells.forEach((f, i) => tone(f, 0.2 + i * 0.09, 0.22, "triangle", 0.1));
  } else if (worldId === "vulkan") {
    // eruption: riser, boom, sizzling embers
    tone(110, 0, 0.3, "sawtooth", 0.12, 440);
    noise(0.26, 0.5, 0.16, 400); // boom
    tone(70, 0.28, 0.5, "sine", 0.18, 40);
    for (let i = 0; i < 4; i += 1) noise(0.5 + i * 0.09, 0.06, 0.05, 2800 + i * 400); // sizzle
  } else if (worldId === "piraten") {
    // a rowdy concertina shanty riff + treasure jingle
    const shanty = [262, 330, 392, 330, 523];
    shanty.forEach((f, i) => tone(f, i * 0.11, 0.2, "sawtooth", 0.06, f * 1.02));
    for (let i = 0; i < 3; i += 1) tone(1568 + i * 200, 0.5 + i * 0.07, 0.12, "triangle", 0.08); // coins
    noise(0.1, 0.3, 0.08, 700);
  } else if (worldId === "marine") {
    // proud foghorn + bell peal
    tone(98, 0, 0.7, "sawtooth", 0.14, 82); // fooooog
    tone(65, 0.05, 0.7, "sine", 0.12, 60);
    for (let i = 0; i < 3; i += 1) tone(880, 0.5 + i * 0.16, 0.22, "triangle", 0.1);
    noise(0.06, 0.35, 0.1, 800); // bow wave
  } else {
    // ozean: harp-like rising arpeggio on a wave
    const notes = [392, 494, 587, 784];
    notes.forEach((f, i) => tone(f, i * 0.09, 0.25, "triangle", 0.12));
    noise(0.1, 0.4, 0.08, 700);
  }
}

export function sunkOwn() {
  tone(392, 0, 0.25, "sine", 0.14, 330);
  tone(330, 0.2, 0.3, "sine", 0.12, 262);
  tone(98, 0.05, 0.45, "sine", 0.16, 65);
}

// music-box treasure moment
export function treasure() {
  noise(0, 0.18, 0.05, 300); // creaking lid
  const notes = [784, 988, 1175, 1568, 1319];
  notes.forEach((f, i) => tone(f, 0.12 + i * 0.09, 0.22, "triangle", 0.1));
}

// power activation timbres by temperament
export function powerCast(category) {
  if (category === "attack") {
    tone(jit(880), 0, 0.14, "square", 0.09, 240);
    tone(jit(1320), 0.07, 0.16, "square", 0.06, 330);
  } else if (category === "defense") {
    tone(jit(392), 0, 0.4, "triangle", 0.1);
    tone(jit(494), 0.08, 0.42, "triangle", 0.08);
    tone(jit(587), 0.16, 0.46, "triangle", 0.07);
  } else if (category === "move") {
    noise(0, 0.35, 0.08, 600);
    tone(jit(300), 0.05, 0.25, "sine", 0.08, 620);
  } else {
    // info: curious ascending chime
    tone(jit(659), 0, 0.12, "triangle", 0.1);
    tone(jit(880), 0.1, 0.14, "triangle", 0.1);
    tone(jit(1175), 0.2, 0.18, "triangle", 0.08);
  }
}

export function plop() {
  // water plop: quick downward slide + splash noise
  tone(360, 0, 0.18, "sine", 0.18, 120);
  noise(0.02, 0.25, 0.08, 1200);
}

export function sparkle() {
  // found something! rising arpeggio
  tone(523, 0, 0.12, "triangle", 0.14);
  tone(659, 0.09, 0.12, "triangle", 0.14);
  tone(784, 0.18, 0.2, "triangle", 0.16);
}

export function fanfare() {
  // creature fully found
  const notes = [523, 659, 784, 1047];
  notes.forEach((f, i) => tone(f, i * 0.11, 0.22, "square", 0.07));
  notes.forEach((f, i) => tone(f * 0.5, i * 0.11, 0.22, "triangle", 0.1));
}

export function bigWin() {
  const melody = [523, 587, 659, 784, 880, 1047, 1319];
  melody.forEach((f, i) => {
    tone(f, i * 0.13, 0.3, "square", 0.06);
    tone(f / 2, i * 0.13, 0.3, "triangle", 0.1);
  });
  noise(0.9, 0.6, 0.05, 3000);
}

export function sad() {
  tone(392, 0, 0.25, "sine", 0.12, 330);
  tone(330, 0.22, 0.35, "sine", 0.12, 262);
}

export function whoosh() {
  noise(0, 0.3, 0.06, 500);
}

// monster roar: low, mean, and a little too close
export function growl() {
  tone(72, 0, 0.5, "sawtooth", 0.2, 45);
  tone(54, 0.08, 0.55, "sawtooth", 0.16, 36);
  noise(0, 0.5, 0.05, 180);
}

// proximity heartbeat for the chase: the closer, the faster it thumps
export function heartbeat(dist) {
  const d = Math.min(4, Math.max(1, dist));
  const thumps = 5 - d; // 4 at dist 1 … 1 at dist 4+
  const gap = 0.12 + d * 0.05;
  for (let i = 0; i < thumps; i += 1) {
    tone(95 + (4 - d) * 18, i * gap, 0.09, "sine", 0.2, 58);
    tone(60, i * gap + 0.045, 0.07, "sine", 0.12, 45);
  }
}

// ---------------------------------------------------------------- ambient
// gentle looping soundscape per world (waves / space hum / jungle)

let ambient = null;

function noiseBuffer(seconds = 2) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i += 1) {
    // pinkish noise via leaky integrator
    last = last * 0.97 + (Math.random() * 2 - 1) * 0.03;
    data[i] = last * 8;
  }
  return buf;
}

export function startAmbient(worldId) {
  if (!ctx || muted) return;
  stopAmbient();
  const master = ctx.createGain();
  master.gain.value = 0;
  master.connect(ctx.destination);
  master.gain.linearRampToValueAtTime(1, ctx.currentTime + 2);
  const nodes = [master];
  const timers = [];

  const addNoise = (freq, q, gain, lfoRate, lfoDepth) => {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer();
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = freq;
    filter.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(filter).connect(g).connect(master);
    if (lfoRate) {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = lfoRate;
      const lg = ctx.createGain();
      lg.gain.value = lfoDepth;
      lfo.connect(lg).connect(g.gain);
      lfo.start();
      nodes.push(lfo);
    }
    src.start();
    nodes.push(src);
  };

  if (worldId === "ozean") {
    addNoise(420, 0.6, 0.045, 0.14, 0.03); // rolling waves
    addNoise(1600, 1.2, 0.012, 0.23, 0.008); // spray
  } else if (worldId === "teich") {
    addNoise(520, 0.9, 0.025, 0.17, 0.015); // gentle lapping
    const croak = () => {
      if (muted || !ambient) return;
      for (let i = 0; i < 2; i += 1) {
        tone(140 + Math.random() * 40, i * 0.18, 0.16, "sawtooth", 0.025, 95);
      }
      timers.push(setTimeout(croak, 3000 + Math.random() * 6000));
    };
    timers.push(setTimeout(croak, 1500));
  } else if (worldId === "weltraum") {
    for (const f of [55, 55.7, 110.3]) {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = 0.018;
      osc.connect(g).connect(master);
      osc.start();
      nodes.push(osc);
    }
    addNoise(900, 2.5, 0.006, 0.08, 0.004); // solar wind shimmer
  } else if (worldId === "eis") {
    addNoise(320, 0.5, 0.03, 0.11, 0.02); // cold wind
    addNoise(2400, 3, 0.005, 0.3, 0.003); // icy whistle
    const tinkle = () => {
      if (muted || !ambient) return;
      const base = 1600 + Math.random() * 800;
      for (let i = 0; i < 2; i += 1) tone(base + i * 300, i * 0.16, 0.2, "triangle", 0.015);
      timers.push(setTimeout(tinkle, 4000 + Math.random() * 6000));
    };
    timers.push(setTimeout(tinkle, 2000));
  } else if (worldId === "vulkan") {
    addNoise(120, 0.4, 0.05, 0.09, 0.03); // deep magma rumble
    addNoise(1800, 1.5, 0.006, 0.5, 0.004); // hissing vents
    const blub = () => {
      if (muted || !ambient) return;
      tone(90 + Math.random() * 50, 0, 0.18, "sine", 0.04, 60);
      timers.push(setTimeout(blub, 2500 + Math.random() * 5000));
    };
    timers.push(setTimeout(blub, 1800));
  } else if (worldId === "piraten") {
    addNoise(420, 0.6, 0.04, 0.13, 0.025); // cove waves
    const creak = () => {
      if (muted || !ambient) return;
      tone(120 + Math.random() * 60, 0, 0.3, "sawtooth", 0.015, 90); // rigging creaks
      timers.push(setTimeout(creak, 3500 + Math.random() * 5000));
    };
    timers.push(setTimeout(creak, 2000));
  } else if (worldId === "marine") {
    addNoise(380, 0.6, 0.035, 0.12, 0.02); // harbor swell
    addNoise(1400, 1.2, 0.008, 0.25, 0.005); // rigging clinks
    const horn = () => {
      if (muted || !ambient) return;
      tone(90, 0, 0.6, "sawtooth", 0.02, 78); // distant foghorn
      timers.push(setTimeout(horn, 8000 + Math.random() * 8000));
    };
    timers.push(setTimeout(horn, 4000));
  } else {
    addNoise(700, 0.8, 0.02, 0.19, 0.012); // breeze in the leaves
    // occasional bird chirps
    const chirp = () => {
      if (muted || !ambient) return;
      const base = 1400 + Math.random() * 900;
      for (let i = 0; i < 2 + Math.floor(Math.random() * 3); i += 1) {
        tone(base + Math.random() * 300, i * 0.14, 0.1, "sine", 0.02, base * 1.3);
      }
      timers.push(setTimeout(chirp, 2500 + Math.random() * 5000));
    };
    timers.push(setTimeout(chirp, 1200));
  }

  ambient = {
    stop() {
      timers.forEach(clearTimeout);
      master.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.6);
      setTimeout(() => {
        nodes.forEach((n) => {
          try {
            n.stop?.();
            n.disconnect?.();
          } catch {
            /* already stopped */
          }
        });
      }, 700);
    },
  };
}

export function stopAmbient() {
  if (ambient) {
    ambient.stop();
    ambient = null;
  }
}
